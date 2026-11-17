// module.json 의 검증과 파생 구조(흐름 단계·채점 대상·도움 정보). DOM 을 모른다.
//
// 플레이어는 과목을 모른다: 여기 있는 것은 형식 규칙뿐이고, 내용 판단은 모듈 데이터와 시험이 맡는다.
import { grade, isAutoGraded, linearSides, normalizeTerm } from './answer.js';
import { evalLine } from './chart.js';
import { BLANK_FIELDS, LINK_STAGES, stepBlanks, blankEntries, findBlank, everyStepHasResultBlank, linkLeakWarnings } from './link.js';
import { checkRevealFields } from './reveal.js';
import { checkLookbackBlocks } from './lookback.js';
import { checkLeakFields } from './check-leak.js';
import { validateProbes, probeItemIds } from './probe.js';
import { validateOpener } from './opener.js';
import { validateSkip, skipIndex } from './skip.js';
import { validateReview } from './review.js';
import { ROUND_MODES, GAP_RANGE, MAX_RANGE, ITEM_RANGE, BUCKET_RANGE, roundIndex } from './round.js';
import { shuffleFlagErrors } from './shuffle.js';
import { WORK_IDS, KNOWLEDGE_IDS, TAGGED_BLOCK_TYPES } from '../data/tags.mjs';

export const BLOCK_TYPES = ['text', 'figure', 'predict', 'check', 'link', 'problem', 'transfer', 'audio', 'lookback', 'round', 'passage'];
export const IMPLEMENTED_BLOCK_TYPES = BLOCK_TYPES.filter((t) => t !== 'audio'); // audio 는 스키마만 예약
const ANSWER_KINDS = ['number', 'numbers', 'choice', 'text', 'expr', 'linear', 'term'];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------- 구조 파생 ----------

// 흐름의 한 걸음: 글 단위 하나, 또는 글이 아닌 블록 하나.
// 장면에 figureFirst: true 가 있으면 그 장면의 첫 그림 블록의 걸음이 글 단위들보다 앞에 온다(자료의 블록 차례는 그대로, 걸음의 차례만 바뀐다). 그 걸음에는 lead: true 가 붙는다.
export function flattenSteps(mod) {
  const steps = [];
  mod.scenes.forEach((scene, sceneIndex) => {
    const lead = scene.figureFirst === true ? scene.blocks.findIndex((b) => b.type === 'figure') : -1;
    const push = (block, blockIndex) => {
      if (block.type === 'text') {
        block.units.forEach((_, unitIndex) => {
          steps.push({ index: steps.length, kind: 'unit', sceneIndex, sceneId: scene.id, blockIndex, blockId: block.id, unitIndex });
        });
      } else {
        steps.push({ index: steps.length, kind: 'block', sceneIndex, sceneId: scene.id, blockIndex, blockId: block.id, ...(blockIndex === lead ? { lead: true } : {}) });
      }
    };
    if (lead >= 0) push(scene.blocks[lead], lead);
    scene.blocks.forEach((block, blockIndex) => { if (blockIndex !== lead) push(block, blockIndex); });
  });
  return steps;
}

export function findBlock(mod, blockId) {
  for (const scene of mod.scenes) {
    const block = scene.blocks.find((b) => b.id === blockId);
    if (block) return { scene, block };
  }
  return null;
}

// 채점 대상. help 사다리(힌트→풀이)는 helpKey 단위: 확인 문항·문제는 블록 하나가 공유, 연결 빈칸은 칸마다 따로.
export function gradables(mod) {
  const out = [];
  for (const scene of mod.scenes) {
    for (const block of scene.blocks) {
      if (block.type === 'check') {
        out.push({ key: block.id, helpKey: block.id, blockId: block.id, sceneId: scene.id, answer: block.answer, misconceptions: block.misconceptions ?? [], label: block.prompt });
      } else if (block.type === 'problem' || block.type === 'transfer') {
        for (const part of block.parts) {
          out.push({ key: `${block.id}#${part.id}`, helpKey: block.id, blockId: block.id, sceneId: scene.id, answer: part.answer, misconceptions: part.misconceptions ?? [], label: part.label });
        }
      } else if (block.type === 'link' && block.mode === 'complete') {
        for (const { key, blank } of blankEntries(block)) {
          out.push({ key, helpKey: key, blockId: block.id, sceneId: scene.id, answer: blank.answer, misconceptions: blank.misconceptions ?? [], label: blank.prompt });
        }
      }
    }
  }
  return out;
}

// 도움 사다리 정의: 힌트 목록과 풀이.
export function helpSpec(mod, helpKey) {
  const [blockId, stepId] = helpKey.split('#');
  const found = findBlock(mod, blockId);
  if (!found) return { hints: [], solution: null };
  const { block } = found;
  if (stepId !== undefined && block.type === 'link') {
    const blank = findBlank(block, helpKey);
    return { hints: blank?.hints ?? [], solution: blank?.solution ?? null };
  }
  return { hints: block.hints ?? [], solution: block.solution ?? null };
}

// 저장 데이터를 거를 때 쓰는 목록.
export function moduleIndex(mod) {
  const steps = flattenSteps(mod);
  const grads = gradables(mod);
  const predictIds = new Set();
  for (const scene of mod.scenes) for (const b of scene.blocks) if (b.type === 'predict' || b.type === 'lookback') predictIds.add(b.id); // lookback 은 '견주어 본 점'을 같은 자리에 저장한다
  return {
    stepCount: steps.length,
    keys: new Set(grads.map((g) => g.key)),
    helpKeys: new Set(grads.map((g) => g.helpKey)),
    predictIds,
    rounds: roundIndex(mod),       // 묶음 돌리기(round 블록) 색인 — 진행 저장의 rounds 를 거를 때 쓴다(core/round.js)
    probeItems: probeItemIds(mod), // 본문 밖 문항 묶음(preCheck·delayedCheck)의 문항 id
    skip: skipIndex(mod),          // 건너뛰기 확인(skipCheck)의 문항·목표·장면 색인(core/skip.js)
    mod,                           // 여는 카드(opener)의 보기를 저장 데이터와 맞춰 볼 때 쓴다(core/opener.js sanitizeOpener)
  };
}

// 노트 시트 위에 한 줄로 띄울 '지금 문항의 조건'.
export function conditionFor(mod, blockId) {
  const found = findBlock(mod, blockId);
  if (!found) return '';
  return found.block.condition ?? found.scene.condition ?? '';
}

// 한 단위가 문장 2~4개인지 세는 보조 함수(모듈 작성 점검용). 숫자 사이의 마침표는 문장 끝이 아니다.
export function sentenceCount(text) {
  const matches = String(text).match(/[.?!]+(?=\s|$)/g);
  return matches ? matches.length : 0;
}

// ---------- 검증 ----------

function checkAnswer(answer, where, errors) {
  if (!isObj(answer) || !ANSWER_KINDS.includes(answer.kind)) { errors.push(`${where}: answer.kind 는 ${ANSWER_KINDS.join('|')} 중 하나여야 한다`); return false; }
  if (answer.kind === 'number') {
    if (typeof answer.value !== 'number' || !Number.isFinite(answer.value)) { errors.push(`${where}: number 답에 유한한 value 가 필요하다`); return false; }
    if (answer.tolerance !== undefined && !(typeof answer.tolerance === 'number' && answer.tolerance >= 0)) errors.push(`${where}: tolerance 는 0 이상 숫자`);
  } else if (answer.kind === 'numbers') {
    // 수 여럿: 정수 배열(차례가 있다). unordered: true 면 차례를 보지 않는다. 입력은 쉼표·띄어쓰기로 가른 정수(core/answer.js parseNumbers).
    if (!Array.isArray(answer.value) || answer.value.length < 1 || !answer.value.every((n) => Number.isInteger(n))) { errors.push(`${where}: numbers 답의 value 는 정수 1개 이상의 배열이어야 한다`); return false; }
    if (answer.unordered !== undefined && typeof answer.unordered !== 'boolean') errors.push(`${where}: unordered 는 true|false`);
  } else if (answer.kind === 'choice') {
    const ok = Array.isArray(answer.options) && answer.options.length >= 2 && answer.options.every((o) => isObj(o) && isStr(o.id) && isStr(o.label));
    if (!ok) { errors.push(`${where}: choice 는 {id,label} 보기 2개 이상이 필요하다`); return false; }
    const ids = answer.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) errors.push(`${where}: 보기 id 중복`);
    if (!ids.includes(answer.value)) errors.push(`${where}: 정답 value 가 보기 id 에 없다`);
  } else if (answer.kind === 'linear') {
    // 일차식("3t + 5") 또는 해가 하나인 일차 등식("3t + 5 = 2t + 9"). 문자는 문항이 정한다.
    if (typeof answer.variable !== 'string' || !/^[A-Za-z]$/.test(answer.variable)) { errors.push(`${where}: linear 답에는 variable(영문자 한 글자)이 필요하다`); return false; }
    const sides = linearSides(answer.value, answer.variable);
    if (!sides) { errors.push(`${where}: linear 답의 value 는 '${answer.variable}' 가 들어간 식 또는 등식 문자열이어야 한다(예: "3t + 5", "3t + 5 = 2t + 9")`); return false; }
    if (sides.some((p) => p.length > 2)) { errors.push(`${where}: linear 답은 일차 이하여야 한다`); return false; }
    if (sides.length === 2 && Math.abs((sides[0][1] ?? 0) - (sides[1][1] ?? 0)) < 1e-12) { errors.push(`${where}: linear 등식은 해가 하나여야 한다(두 변의 일차항 계수가 같다)`); return false; }
    if (answer.label !== undefined && !isStr(answer.label)) errors.push(`${where}: label 은 문자열(식 앞에 붙는 이름, 예: "C")`);
  } else if (answer.kind === 'term') {
    // 낱말 하나(공백·대소문자·끝의 마침표를 가리지 않고 견준다 — core/answer.js normalizeTerm). accept 는 같은 뜻의 다른 적는 법.
    if (!isStr(answer.value) || normalizeTerm(answer.value) === '') { errors.push(`${where}: term 답에는 비어 있지 않은 value(글)가 필요하다`); return false; }
    if (answer.accept !== undefined && !(Array.isArray(answer.accept) && answer.accept.every((a) => isStr(a) && normalizeTerm(a) !== ''))) errors.push(`${where}: accept 는 비어 있지 않은 글의 배열`);
  } else if (!isStr(answer.sample)) {
    errors.push(`${where}: ${answer.kind} 답에는 예시 답(sample)이 필요하다`);
  }
  return true;
}

// 정답값으로 채점하면 정답이고, 오개념 값은 정답이 아니어야 한다(죽은 제약 방지).
function checkGrading(answer, misconceptions, where, errors) {
  if (isAutoGraded(answer)) {
    const input = answer.kind === 'number' ? `${answer.value}${answer.unit ? ' ' + answer.unit : ''}` : answer.kind === 'numbers' ? answer.value.join(', ') : answer.value;
    if (grade(input, answer).result !== 'correct') errors.push(`${where}: 정답값을 채점하면 정답으로 판정되지 않는다`);
  }
  if (misconceptions === undefined) return;
  if (!Array.isArray(misconceptions)) { errors.push(`${where}: misconceptions 는 배열`); return; }
  misconceptions.forEach((mc, i) => {
    const w = `${where}.misconceptions[${i}]`;
    if (!isObj(mc) || !isObj(mc.match) || !isStr(mc.feedback)) { errors.push(`${w}: {match, feedback} 필요`); return; }
    if (!isAutoGraded(answer) || mc.match.kind !== answer.kind) { errors.push(`${w}: match.kind 가 답 종류(${answer.kind})와 달라 쓰일 수 없다`); return; }
    if (answer.kind === 'numbers' && !(Array.isArray(mc.match.value) && mc.match.value.length >= 1 && mc.match.value.every((n) => Number.isInteger(n)))) { errors.push(`${w}: numbers 오개념의 match.value 는 정수 배열`); return; }
    const input = answer.kind === 'number' ? String(mc.match.value) : answer.kind === 'numbers' ? mc.match.value.join(', ') : mc.match.value;
    const r = grade(input, answer);
    if (r.result === 'correct') errors.push(`${w}: 오개념 값이 정답과 같다`);
    if (r.result === 'invalid') errors.push(`${w}: 오개념 값이 이 문항의 답 형식에 맞지 않는다`);
  });
}

function checkHelpFields(obj, where, errors, { required }) {
  if (required) {
    if (!Array.isArray(obj.hints) || obj.hints.length < 1 || !obj.hints.every(isStr)) errors.push(`${where}: hints(문자열 1개 이상) 필요`);
    if (!isStr(obj.solution)) errors.push(`${where}: solution 필요`);
  } else {
    if (obj.hints !== undefined && !(Array.isArray(obj.hints) && obj.hints.every(isStr))) errors.push(`${where}: hints 는 문자열 배열`);
    if (obj.solution !== undefined && !isStr(obj.solution)) errors.push(`${where}: solution 은 문자열`);
  }
}

function checkFigureDef(name, def, errors) {
  const where = `figures.${name}`;
  if (!isObj(def)) { errors.push(`${where}: 객체여야 한다`); return; }
  if (def.kind === 'table') {
    const ok = isStr(def.caption) && Array.isArray(def.columns) && def.columns.length >= 2 && Array.isArray(def.rows) && def.rows.length >= 1
      && def.rows.every((r) => Array.isArray(r) && r.length === def.columns.length && r.every((c) => typeof c === 'string'));
    if (!ok) errors.push(`${where}: table 은 caption, columns(2+), rows(열 수와 같은 길이) 필요`);
  } else if (def.kind === 'lines') {
    const nums = ['xMax', 'yMax'].every((k) => typeof def[k] === 'number' && def[k] > 0);
    const ticks = ['xTicks', 'yTicks'].every((k) => Array.isArray(def[k]) && def[k].length >= 2 && def[k].every(Number.isFinite));
    const series = Array.isArray(def.series) && def.series.length >= 2 && def.series.every((s) => isStr(s.id) && isStr(s.label) && Number.isFinite(s.intercept) && Number.isFinite(s.slope));
    if (!(nums && ticks && series && isStr(def.xLabel) && isStr(def.yLabel) && isStr(def.title))) { errors.push(`${where}: lines 형식 오류`); return; }
    for (const s of def.series) {
      if (evalLine(s, def.xMax) > def.yMax + 1e-9 || evalLine(s, 0) < 0) errors.push(`${where}: 직선 ${s.id} 가 그래프 범위를 벗어난다`);
    }
    (def.marks ?? []).forEach((m, i) => {
      if (!(Number.isFinite(m.x) && isStr(m.label))) { errors.push(`${where}.marks[${i}]: x, label 필요`); return; }
      // 표시는 '두 직선이 만나는 점' 전용 — 만나지 않는 곳에 찍으면 거짓 그림이 된다.
      if (Math.abs(evalLine(def.series[0], m.x) - evalLine(def.series[1], m.x)) > 1e-9) errors.push(`${where}.marks[${i}]: x=${m.x} 에서 두 직선이 만나지 않는다`);
    });
  } else if (def.kind === 'points') {
    checkPointsDef(def, where, errors);
  } else if (def.kind === 'image') {
    checkImageDef(def, where, errors);
  } else {
    errors.push(`${where}: kind 는 table|lines|points|image`);
  }
}

// 그림 파일(image): 모듈 폴더 안의 .svg 하나를 <img> 로 보인다(스크립트가 돌지 않는다). 파일이 실제로 있는지는 tools/check-module.mjs 가 본다(이 검사는 브라우저에서도 돈다).
export const IMAGE_SRC_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\-/]+\.svg$/;
function checkImageDef(def, where, errors) {
  if (!isStr(def.src) || !IMAGE_SRC_PATTERN.test(def.src)) errors.push(`${where}: image 의 src 는 모듈 폴더 안의 상대 경로(.svg — '..' · 절대 경로 · 주소는 쓰지 않는다)`);
  if (!isStr(def.alt)) errors.push(`${where}: image 에는 alt(텍스트 대체)가 필요하다`);
  if (def.caption !== undefined && !isStr(def.caption)) errors.push(`${where}: caption 은 비어 있지 않은 문자열`);
}

// 점 그래프: 축 둘(label·min·max·step)과 계열 1~3개(점 1~12개). 점이 축 범위 밖이면 거짓 그림이 되므로 막는다.
const MAX_AXIS_TICKS = 40;
function checkAxis(axis, w, errors) {
  if (!isObj(axis) || !isStr(axis.label) || !['min', 'max', 'step'].every((k) => Number.isFinite(axis[k]))) { errors.push(`${w}: {label, min, max, step} 필요`); return false; }
  if (!(axis.max > axis.min)) { errors.push(`${w}: max 는 min 보다 커야 한다`); return false; }
  if (!(axis.step > 0) || (axis.max - axis.min) / axis.step > MAX_AXIS_TICKS) { errors.push(`${w}: step 은 0 보다 크고 눈금이 ${MAX_AXIS_TICKS}개를 넘지 않아야 한다`); return false; }
  return true;
}

function checkPointsDef(def, where, errors) {
  if (!isStr(def.alt)) errors.push(`${where}: points 에는 alt(텍스트 대체)가 필요하다`);
  const okX = checkAxis(def.x, `${where}.x`, errors);
  if (def.hideValues !== undefined && typeof def.hideValues !== 'boolean') errors.push(`${where}: hideValues 는 true|false(점의 <title> 에 값을 넣지 않는다)`);
  const nl = def.numberLine === true;
  if (def.numberLine !== undefined && typeof def.numberLine !== 'boolean') errors.push(`${where}: numberLine 은 true|false(수직선 — 세로축 없이 계열마다 가로 줄 하나, y 는 쓰지 않는다)`);
  const okY = nl || checkAxis(def.y, `${where}.y`, errors);
  if (!Array.isArray(def.series) || def.series.length < 1 || def.series.length > 3) { errors.push(`${where}: series 는 1~3개`); return; }
  const ids = new Set();
  def.series.forEach((s, i) => {
    const w = `${where}.series[${i}]`;
    if (!isObj(s) || !isStr(s.id) || !ID_PATTERN.test(s.id) || ids.has(s.id) || !isStr(s.label)) { errors.push(`${w}: id(형식·중복)와 label 필요`); return; }
    ids.add(s.id);
    if (s.guide !== undefined && s.guide !== 'line') errors.push(`${w}: guide 는 'line' 또는 생략`);
    if (!Array.isArray(s.points) || s.points.length < 1 || s.points.length > 12) { errors.push(`${w}: points 는 1~12개`); return; }
    s.points.forEach((pt, k) => {
      const shapeOk = nl ? Array.isArray(pt) && (pt.length === 1 || pt.length === 2) && pt.every(Number.isFinite) : Array.isArray(pt) && pt.length === 2 && pt.every(Number.isFinite);
      if (!shapeOk) { errors.push(nl ? `${w}.points[${k}]: [x] 또는 [x, y] 수 필요(수직선은 y 를 쓰지 않는다)` : `${w}.points[${k}]: [x, y] 수 둘 필요`); return; }
      if (okX && (pt[0] < def.x.min || pt[0] > def.x.max)) errors.push(`${w}.points[${k}]: x=${pt[0]} 가 가로축 범위(${def.x.min}~${def.x.max}) 밖이다`);
      if (!nl && okY && (pt[1] < def.y.min || pt[1] > def.y.max)) errors.push(`${w}.points[${k}]: y=${pt[1]} 가 세로축 범위(${def.y.min}~${def.y.max}) 밖이다`);
    });
  });
}

// 태그 검사: ids 가 허용 목록 안의 id 로 min~max 개, 중복 없이 들어 있는가. 낱말 목록은 data/tags.mjs.
function checkTagList(list, allowed, label, where, errors, { min, max }) {
  if (!Array.isArray(list) || list.length < min || list.length > max) { errors.push(`${where}: ${label} 는 ${min === max ? min : `${min}~${max}`}개의 id 배열이어야 한다(허용: ${allowed.join(', ')})`); return false; }
  const bad = list.filter((x) => !allowed.includes(x));
  if (bad.length) { errors.push(`${where}: ${label} 에 모르는 값 ${bad.map((x) => JSON.stringify(x)).join(', ')} — 허용: ${allowed.join(', ')}`); return false; }
  if (new Set(list).size !== list.length) { errors.push(`${where}: ${label} 에 중복이 있다`); return false; }
  return true;
}

// 학습자가 무언가 하는 항목(블록·문항)의 work·knowledge. focus 가 주어지면 work 는 그 안에 있어야 한다.
function checkItemTags(item, where, errors, focus) {
  const okWork = checkTagList(item.work, WORK_IDS, 'work', where, errors, { min: 1, max: 3 });
  checkTagList(item.knowledge, KNOWLEDGE_IDS, 'knowledge', where, errors, { min: 1, max: 2 });
  if (okWork && focus) {
    const out = item.work.filter((w) => !focus.includes(w));
    if (out.length) errors.push(`${where}: work ${out.join(', ')} 가 이 장면의 focus(${focus.join(', ')}) 안에 없다`);
  }
}

// 묶음 돌리기(round): 문항을 한 번에 하나씩 보이고 곧 알려 주는 짧은 묶음. 규칙은 SPEC_KINDS.md 3절, 동작은 core/round.js.
function checkRound(block, where, errors) {
  const mode = block.mode;
  if (!ROUND_MODES.includes(mode)) errors.push(`${where}: mode 는 ${ROUND_MODES.join('|')}`);
  if (!isStr(block.prompt)) errors.push(`${where}: prompt 필요`);
  const inRange = (n, [lo, hi]) => Number.isInteger(n) && n >= lo && n <= hi;
  if (block.requeue !== undefined && (!isObj(block.requeue) || !inRange(block.requeue.gap, GAP_RANGE) || !inRange(block.requeue.max, MAX_RANGE))) {
    errors.push(`${where}: requeue 는 { gap(${GAP_RANGE.join('~')}), max(${MAX_RANGE.join('~')}) } 정수`);
  }
  if (block.timing !== undefined && (mode !== 'drill' || !['after', 'none'].includes(block.timing))) errors.push(`${where}: timing 은 drill 에만, 'after' 또는 'none'`);
  if (block.pass !== undefined && !(block.gate === true && mode === 'drill')) errors.push(`${where}: pass 는 gate: true 인 drill 에만 쓴다`);
  if (block.gate === true && mode === 'drill') {
    const n = Array.isArray(block.items) ? block.items.length : 0;
    if (!inRange(block.pass, [1, Math.max(1, n)])) errors.push(`${where}: gate 판에는 pass(맞혀야 하는 문항 수, 1 이상 문항 수 이하의 정수)가 필요하다`);
  }
  let bucketIds = null;
  if (mode === 'sort') {
    const ok = Array.isArray(block.buckets) && block.buckets.length >= BUCKET_RANGE[0] && block.buckets.length <= BUCKET_RANGE[1]
      && block.buckets.every((b) => isObj(b) && isStr(b.id) && ID_PATTERN.test(b.id) && isStr(b.label));
    if (!ok) errors.push(`${where}: sort 의 buckets 는 {id, label} ${BUCKET_RANGE.join('~')}개`);
    else if (new Set(block.buckets.map((b) => b.id)).size !== block.buckets.length) errors.push(`${where}: buckets 의 id 중복`);
    else bucketIds = new Set(block.buckets.map((b) => b.id));
  } else if (block.buckets !== undefined) errors.push(`${where}: buckets 는 sort 에만 쓴다`);
  if (!Array.isArray(block.items) || !inRange(block.items.length, ITEM_RANGE)) { errors.push(`${where}: items 는 ${ITEM_RANGE.join('~')}개`); return; }
  const ids = new Set();
  block.items.forEach((item, i) => {
    const w = `${where}.items[${i}]`;
    if (!isObj(item)) { errors.push(`${w}: 객체여야 한다`); return; }
    if (!isStr(item.id) || !ID_PATTERN.test(item.id) || ids.has(item.id)) errors.push(`${w}: id 누락·형식·중복 오류`);
    ids.add(item.id);
    if (!isStr(item.cue)) errors.push(`${w}: cue 필요`);
    if (mode === 'drill' ? item.why !== undefined && !isStr(item.why) : !isStr(item.why)) errors.push(`${w}: why(${mode === 'drill' ? '선택, 글' : '틀렸을 때 정답과 함께 보일 한두 문장'}) 필요`);
    if (mode === 'sort') {
      if (item.answer !== undefined) errors.push(`${w}: sort 문항에는 answer 를 쓰지 않는다(bucket 으로 갈래를 적는다)`);
      if (bucketIds && !bucketIds.has(item.bucket)) errors.push(`${w}: bucket '${item.bucket}' 이 buckets 에 없다`);
    } else {
      if (item.bucket !== undefined) errors.push(`${w}: bucket 은 sort 에만 쓴다`);
      if (checkAnswer(item.answer, `${w}.answer`, errors)) {
        if (!isAutoGraded(item.answer)) errors.push(`${w}: 묶음 문항의 답은 number|choice|linear|term 만 쓴다(채점할 수 있어야 한다)`);
        checkGrading(item.answer, item.misconceptions, w, errors);
      }
    }
  });
}

function checkBlock(block, where, errors, mod, focus) {
  if (!isObj(block) || !BLOCK_TYPES.includes(block.type)) { errors.push(`${where}: 알 수 없는 블록 type`); return; }
  if (!isStr(block.id) || !ID_PATTERN.test(block.id)) errors.push(`${where}: id 형식 오류`);
  if (TAGGED_BLOCK_TYPES.includes(block.type)) checkItemTags(block, where, errors, focus);
  else if (block.work !== undefined || block.knowledge !== undefined) errors.push(`${where}: ${block.type} 블록에는 work·knowledge 를 두지 않는다(학습자가 무언가 하는 블록에만 붙는다: ${TAGGED_BLOCK_TYPES.join(', ')})`);
  switch (block.type) {
    case 'text': {
      if (!Array.isArray(block.units) || block.units.length < 1 || !block.units.every(isStr)) errors.push(`${where}: units(문자열 1개 이상) 필요`);
      if (block.breaks !== undefined && block.breaks !== 'none' && block.breaks !== 'sentence') errors.push(`${where}: breaks 는 'sentence'(기본 — 문장마다 줄을 바꾼다) 또는 'none'(한 덩어리)`);
      (block.help ?? []).forEach((h, i) => {
        const ok = isObj(h) && isStr(h.title) && isStr(h.body) && (h.unit === undefined || (Number.isInteger(h.unit) && h.unit >= 0 && h.unit < (block.units?.length ?? 0)));
        if (!ok) errors.push(`${where}.help[${i}]: {unit?, title, body} 필요(unit 은 단위 번호)`);
      });
      break;
    }
    case 'figure':
      if (!mod.figures || !isObj(mod.figures[block.figure])) errors.push(`${where}: 참조한 그림 '${block.figure}' 이 figures 에 없다`);
      if (!isStr(block.alt)) errors.push(`${where}: alt(텍스트 대체) 필요`);
      break;
    case 'predict':
      if (!isStr(block.prompt)) errors.push(`${where}: prompt 필요`);
      break;
    case 'check':
      if (!isStr(block.prompt)) errors.push(`${where}: prompt 필요`);
      if (checkAnswer(block.answer, `${where}.answer`, errors)) checkGrading(block.answer, block.misconceptions, where, errors);
      checkHelpFields(block, where, errors, { required: true });
      break;
    case 'problem':
    case 'transfer': {
      if (!isStr(block.prompt)) errors.push(`${where}: prompt 필요`);
      if (block.unaided !== undefined && typeof block.unaided !== 'boolean') errors.push(`${where}: unaided 는 true|false(도움 없이 먼저 푸는 자리, core/unaided.js)`);
      if (!Array.isArray(block.parts) || block.parts.length < 1) { errors.push(`${where}: parts 1개 이상 필요`); break; }
      const partIds = new Set();
      block.parts.forEach((p, i) => {
        const w = `${where}.parts[${i}]`;
        if (!isStr(p.id) || !ID_PATTERN.test(p.id) || partIds.has(p.id)) errors.push(`${w}: id 누락·형식·중복 오류`);
        partIds.add(p.id);
        if (!isStr(p.label)) errors.push(`${w}: label 필요`);
        if (checkAnswer(p.answer, `${w}.answer`, errors)) checkGrading(p.answer, p.misconceptions, w, errors);
      });
      checkHelpFields(block, where, errors, { required: true });
      break;
    }
    case 'link': {
      if (!['show', 'complete'].includes(block.mode)) errors.push(`${where}: mode 는 show|complete`);
      if (!isStr(block.goal) || !isStr(block.given)) errors.push(`${where}: goal(구하려는 것), given(알고 있는 것) 필요`);
      if (!Array.isArray(block.steps) || block.steps.length < 2) { errors.push(`${where}: steps 2개 이상 필요`); break; }
      const stepIds = new Set();
      let blanks = 0;
      block.steps.forEach((s, i) => {
        const w = `${where}.steps[${i}]`;
        if (!isStr(s.id) || !ID_PATTERN.test(s.id) || stepIds.has(s.id)) errors.push(`${w}: id 누락·형식·중복 오류`);
        stepIds.add(s.id);
        if (!isStr(s.label) || !isStr(s.gives) || !isStr(s.why)) errors.push(`${w}: label, gives, why 필요`);
        // 빈칸은 blank(한 칸) 또는 blanks(두 칸까지 — 결과 칸과 이유 칸) 중 하나로 적는다. 뜻과 화면 동작은 core/link.js.
        if (s.blank !== undefined && s.blanks !== undefined) errors.push(`${w}: blank 와 blanks 를 함께 쓸 수 없다`);
        if (s.blanks !== undefined && !(Array.isArray(s.blanks) && s.blanks.length >= 1 && s.blanks.length <= BLANK_FIELDS.length)) { errors.push(`${w}.blanks 는 빈칸 1~${BLANK_FIELDS.length}개의 배열`); return; }
        const list = stepBlanks(s);
        if (list.length > 0 && block.mode !== 'complete') errors.push(`${w}: blank 는 mode 'complete' 에서만 쓴다`);
        if (new Set(list.map((b) => b?.field)).size !== list.length) errors.push(`${w}.blanks: 한 단계에 같은 field 의 빈칸을 두 번 둘 수 없다`);
        list.forEach((b, bi) => {
          const bw = s.blanks !== undefined ? `${w}.blanks[${bi}]` : `${w}.blank`;
          blanks += 1;
          if (!isObj(b)) { errors.push(`${bw}: 객체여야 한다`); return; }
          if (!BLANK_FIELDS.includes(b.field)) errors.push(`${bw}.field 는 ${BLANK_FIELDS.join('|')}`);
          if (!isStr(b.prompt)) errors.push(`${bw}.prompt 필요`);
          if (checkAnswer(b.answer, `${bw}.answer`, errors)) {
            if (!isAutoGraded(b.answer) || b.answer.kind === 'term') errors.push(`${bw}: 연결 빈칸은 number|choice|linear 만 쓴다(수 여럿 numbers 도 된다)`);
            // 이유 칸은 결과가 보이는 채로 묻는다 — 계산해서 내는 답(숫자·식)을 이유 칸에 두면 결과 글이 답을 보여 준다.
            else if (b.field === 'why' && b.answer.kind !== 'choice') errors.push(`${bw}: field 'why' 빈칸은 choice 만 쓴다(결과가 보이는 채로 묻는 칸이다)`);
            checkGrading(b.answer, b.misconceptions, bw, errors);
          }
          checkHelpFields(b, bw, errors, { required: true });
          if (b.leakOk !== undefined && b.leakOk !== true && !isStr(b.leakOk)) errors.push(`${bw}.leakOk 는 true 또는 이유를 적은 문자열`);
        });
      });
      if (block.mode === 'complete' && blanks < 1) errors.push(`${where}: complete 모드에는 blank 가 1개 이상 있어야 한다`);
      if (block.stage !== undefined) {
        if (!LINK_STAGES.includes(block.stage)) errors.push(`${where}: stage 는 ${LINK_STAGES.join('|')} (생략하면 mode 를 따른다)`);
        else if (block.mode !== 'complete' || !everyStepHasResultBlank(block)) errors.push(`${where}: stage 'build' 는 complete 모드이고 모든 단계에 결과 칸(field 'gives')이 있어야 한다`);
      }
      break;
    }
    case 'round':
      checkRound(block, where, errors);
      break;
    case 'passage': {
      if (block.title !== undefined && !isStr(block.title)) errors.push(`${where}: title 은 글`);
      if (block.note !== undefined && !isStr(block.note)) errors.push(`${where}: note 는 글`);
      if (!Array.isArray(block.paragraphs) || block.paragraphs.length < 2) { errors.push(`${where}: paragraphs(문단) 2개 이상 필요`); break; }
      const paraIds = new Set();
      block.paragraphs.forEach((p, i) => {
        const w = `${where}.paragraphs[${i}]`;
        if (!isObj(p) || !isStr(p.id) || !ID_PATTERN.test(p.id) || paraIds.has(p.id)) errors.push(`${w}: id 누락·형식·중복 오류`);
        else paraIds.add(p.id);
        if (!isObj(p) || !isStr(p.text)) errors.push(`${w}: text 필요`);
      });
      break;
    }
    case 'audio':
      if (!isStr(block.transcript)) errors.push(`${where}: audio 는 자리만 예약 — 대본(transcript)은 필요`);
      break;
    default: break;
  }
}

export function validateModule(mod) {
  const errors = [];
  if (!isObj(mod)) return { ok: false, errors: ['모듈이 객체가 아니다'] };
  if (!isStr(mod.id) || !/^[a-z0-9][a-z0-9-]*$/.test(mod.id)) errors.push('id: 소문자·숫자·하이픈만');
  if (!isStr(mod.version) || !/^\d+\.\d{2}$/.test(mod.version)) errors.push('version 필요(예: "1.00" — 내용을 고칠 때마다 올린다. 학습 기록에 함께 남아 고친 전후를 비교할 수 있게 한다)');
  if (!isStr(mod.title)) errors.push('title 필요');
  if (!isStr(mod.centralQuestion)) errors.push('centralQuestion 필요');
  // 학습 전담 AI 의 주제 범위(선택): in 은 이 모듈이 다루는 것 한 문장, adjacent 는 바로 옆이라 답해 줄 것들. core/ai/protocol.js 가 요청에 싣는다.
  if (mod.ai !== undefined) {
    if (!isObj(mod.ai) || !isObj(mod.ai.scope)) errors.push('ai 는 { scope: { in, adjacent } } 꼴이어야 한다');
    else {
      if (!isStr(mod.ai.scope.in)) errors.push('ai.scope.in 은 비어 있지 않은 문자열');
      if (!Array.isArray(mod.ai.scope.adjacent) || !mod.ai.scope.adjacent.every(isStr)) errors.push('ai.scope.adjacent 는 문자열 배열');
    }
  }
  if (!Array.isArray(mod.prerequisites) || !mod.prerequisites.every(isStr)) errors.push('prerequisites 는 문자열 배열');
  // 사슬의 다음 모듈(선택): 모듈 id. 목록에 있는지·그 모듈의 needs 가 이 모듈을 가리키는지는 tools/chain-checks.mjs(check-module).
  if (mod.next !== undefined && (!isStr(mod.next) || !/^[a-z0-9][a-z0-9-]*$/.test(mod.next) || mod.next === mod.id)) errors.push('next 는 다른 모듈의 id(소문자·숫자·하이픈)');
  if (mod.figures !== undefined && !isObj(mod.figures)) errors.push('figures 는 객체');
  for (const [name, def] of Object.entries(mod.figures ?? {})) checkFigureDef(name, def, errors);
  if (!Array.isArray(mod.scenes) || mod.scenes.length < 1) { errors.push('scenes 1개 이상 필요'); return { ok: false, errors }; }

  const seen = new Set();
  const claim = (id, where) => {
    if (seen.has(id)) errors.push(`${where}: id '${id}' 중복`);
    seen.add(id);
  };
  mod.scenes.forEach((scene, si) => {
    const sw = `scenes[${si}]`;
    if (!isObj(scene) || !isStr(scene.id) || !ID_PATTERN.test(scene.id)) { errors.push(`${sw}: id 형식 오류`); return; }
    claim(scene.id, sw);
    if (!isStr(scene.title)) errors.push(`${sw}: title 필요`);
    const focusOk = checkTagList(scene.focus, WORK_IDS, 'focus', sw, errors, { min: 1, max: WORK_IDS.length });
    if (scene.condition !== undefined && !isStr(scene.condition)) errors.push(`${sw}: condition 은 문자열`);
    if (scene.figureFirst !== undefined) {
      // 그림 먼저: 첫 그림 블록의 앞에는 글뿐이어야 한다(문항 · 연결 같은 블록을 뛰어넘어 그림이 앞으로 오지 않게).
      const at = Array.isArray(scene.blocks) ? scene.blocks.findIndex((b) => b?.type === 'figure') : -1;
      if (typeof scene.figureFirst !== 'boolean') errors.push(`${sw}: figureFirst 는 true|false`);
      else if (scene.figureFirst && at < 0) errors.push(`${sw}: figureFirst 인데 장면에 그림 블록이 없다`);
      else if (scene.figureFirst && scene.blocks.slice(0, at).some((b) => b?.type !== 'text')) errors.push(`${sw}: figureFirst 의 그림 앞에는 글 블록만 올 수 있다(문항 블록의 차례는 바꾸지 않는다)`);
    }
    if (!Array.isArray(scene.blocks) || scene.blocks.length < 1) { errors.push(`${sw}: blocks 1개 이상 필요`); return; }
    scene.blocks.forEach((block, bi) => {
      const bw = `${sw}.blocks[${bi}]`;
      checkBlock(block, bw, errors, mod, focusOk ? scene.focus : null);
      if (isStr(block?.id)) claim(block.id, bw);
    });
  });
  // 본문 밖에서 도움 없이 푸는 문항 묶음(선택): preCheck(시작 전), delayedCheck(끝낸 뒤 며칠 지나). 문항 id 는 장면·블록 id 와도 겹치면 안 된다.
  validateProbes(mod, errors, { claim, checkAnswer, checkGrading, checkItemTags, idPattern: ID_PATTERN });
  // 여는 카드(opener): 본문 앞 첫 카드 — 그림 · 직관 질문 · 고르기 답. 규칙은 core/opener.js.
  validateOpener(mod, errors, { checkAnswer, checkGrading });
  // 건너뛰기 확인(skipCheck: 목표별 문항, 목표가 덮는 장면)과 뒤 문항의 목표 연결(goals). 규칙은 core/skip.js.
  validateSkip(mod, errors, { claim, checkAnswer, checkGrading, checkItemTags, idPattern: ID_PATTERN });
  // 복습 회차(review: 분량과 문항, 문항마다 feedback·목표). 복습 일정은 data/review.mjs, 한 회차의 진행은 core/review.js.
  validateReview(mod, errors, { claim, checkAnswer, checkGrading, checkItemTags, idPattern: ID_PATTERN });
  // 그림의 값 가리기(revealAfter)·예상 다시 보기(lookback)·누출 점검 표시(leakOk)의 형식. 앞의 검증을 통과한 모듈에만 돌린다.
  if (errors.length === 0) errors.push(...checkRevealFields(mod, gradables(mod)), ...checkLookbackBlocks(mod), ...checkLeakFields(mod), ...shuffleFlagErrors(mod));
  // 경고(막지는 않는다): 연결 빈칸의 정답이 그 빈칸보다 앞에 보이는 글에 적혀 있는가. 형식 오류가 있으면 돌리지 않는다.
  const warnings = errors.length === 0 ? linkLeakWarnings(mod).map((x) => x.message) : [];
  return { ok: errors.length === 0, errors, warnings };
}

// 작성 점검(경고): 글 단위는 뜻이 완결되는 문장 2~4개가 기준이다. 오류로 막지는 않는다.
export function unitWarnings(mod) {
  const warnings = [];
  for (const scene of mod.scenes) {
    for (const block of scene.blocks) {
      if (block.type !== 'text') continue;
      block.units.forEach((u, i) => {
        const n = sentenceCount(u);
        if (n < 2 || n > 4) warnings.push(`${block.id}[${i}]: 문장 ${n}개`);
      });
    }
  }
  return warnings;
}
