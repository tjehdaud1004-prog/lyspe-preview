// 연결 블록(link)의 규칙. DOM 을 모른다 — 화면(ui/blocks/link.js, ui/help.js)과 검증(core/module.js)이 함께 쓴다.
//  1) 빈칸 목록과 키           stepBlanks · blankEntries · findBlank
//  2) 잠금과 열림(답 노출 방지)  linkView
//  3) 도움을 줄이는 단계 이름    linkStage
//  4) 답이 새는지 기계 검사      linkLeakWarnings
import { parseExpr, linearSides, sameSides, normalizeExpr } from './answer.js';

// 빈칸이 단계 카드의 어느 부분을 대신하는가. 화면 동작이 이 값으로 갈린다(linkView).
//  gives: 결과를 묻는다 → 풀기 전에는 그 단계의 결과와 이유를 모두 숨긴다(이유 글에 결과가 들어 있다).
//  why  : 이유를 묻는다 → 결과는 보여 주고 이유만 숨긴다.
export const BLANK_FIELDS = ['gives', 'why'];

// ---------- 1) 빈칸 목록과 키 ----------

// 한 단계의 빈칸들(차례대로 푼다). 형식은 둘 중 하나: blank(한 칸) 또는 blanks(두 칸까지, field 가 서로 달라야 한다).
export function stepBlanks(step) {
  if (Array.isArray(step?.blanks)) return step.blanks;
  return step?.blank !== undefined ? [step.blank] : [];
}

// 채점·도움·기록이 쓰는 키. 단계의 첫 빈칸은 '블록#단계'(v1 과 같다), 둘째 빈칸은 '블록#단계.field'.
const blankKey = (block, step, blank, blankIndex) => (blankIndex === 0 ? `${block.id}#${step.id}` : `${block.id}#${step.id}.${blank?.field}`);

export function blankEntries(block) {
  const out = [];
  (block.steps ?? []).forEach((step, stepIndex) => {
    stepBlanks(step).forEach((blank, blankIndex) => {
      out.push({ key: blankKey(block, step, blank, blankIndex), step, stepIndex, blank, blankIndex });
    });
  });
  return out;
}

export function findBlank(block, key) {
  return blankEntries(block).find((e) => e.key === key)?.blank ?? null;
}

// ---------- 2) 잠금과 열림 ----------

// isDone(key): 그 빈칸이 풀렸는가(정답·풀이 열람·건너뛰기 — core/progress.js 의 isResolved).
// 돌려주는 것: 단계마다 { locked, showGives, showWhy, showArrow, blanks: [{ key, field, state }] }
//   locked    앞 단계에 안 푼 빈칸이 있다 → 이 단계는 제목·문항까지 통째로 가린다(뒤 단계의 글이 앞 단계의 답을 드러낸다).
//   blanks    state: 'done' 풀림 / 'active' 지금 풀 칸 / 'waiting' 같은 단계의 앞 칸을 먼저 풀어야 보임 / 'locked'
//   showGives 결과 글을 보인다: 잠기지 않았고, 이 단계의 결과 칸(gives)이 모두 풀렸다.
//   showWhy   이유 글을 보인다: 잠기지 않았고, 이 단계의 빈칸이 모두 풀렸다(도움 서랍의 '연결 이유' 목록도 이 값).
//   showArrow 다음 단계로 가는 화살표(다음 단계의 제목이 적혀 있다): 이 단계가 다 풀렸을 때만.
export function linkView(block, isDone) {
  const complete = block.mode === 'complete';
  const last = block.steps.length - 1;
  let earlierOpen = false; // 앞 단계에 안 푼 빈칸이 남아 있는가
  return block.steps.map((step, i) => {
    const entries = complete ? stepBlanks(step).map((blank, bi) => ({ blank, key: blankKey(block, step, blank, bi) })) : [];
    const locked = earlierOpen;
    let waiting = false;
    const blanks = entries.map(({ blank, key }) => {
      const done = isDone(key) === true;
      const state = locked ? 'locked' : done ? 'done' : waiting ? 'waiting' : 'active';
      if (!done) waiting = true;
      return { key, field: blank?.field, state, done };
    });
    const allDone = blanks.every((b) => b.done);
    const givesDone = blanks.every((b) => b.done || b.field !== 'gives');
    if (!allDone) earlierOpen = true;
    return {
      id: step.id, locked,
      blanks: blanks.map(({ key, field, state }) => ({ key, field, state })),
      showGives: !locked && givesDone,
      showWhy: !locked && allDone,
      showArrow: i < last && !locked && allDone,
    };
  });
}

// ---------- 3) 도움을 줄이는 단계 ----------

// show: 모두 보여 줌 / complete: 빈칸 채우기(문항이 채울 모양을 잡아 준다) / build: 스스로 세우기(단계 이름만 주고 내용은 학습자가 세운다).
// build 는 블록에 stage: 'build' 라고 적었을 때다 — 빈칸의 개수만으로는 둘을 가를 수 없다(빈칸 채우기도 모든 단계에 빈칸을 둘 수 있다).
// 검증기는 build 블록의 모든 단계에 결과 칸이 있는지 본다(보여 주는 단계가 섞여 있으면 '스스로 세우기'가 아니다).
export const LINK_STAGES = ['build'];
export function linkStage(block) {
  if (block.mode !== 'complete') return 'show';
  return block.stage === 'build' ? 'build' : 'complete';
}
export const everyStepHasResultBlank = (block) => (block.steps ?? []).every((s) => stepBlanks(s).some((b) => b?.field === 'gives'));

// ---------- 4) 답이 새는지 검사 ----------
//
// 빈칸의 정답(숫자·식)이 '그 빈칸을 풀 때 이미 화면에 보이는 글'에 적혀 있으면 경고한다. 보이는 글의 범위:
//   (가) 같은 장면에서 이 블록보다 앞에 있는 블록의 글 — 본문 단위, 그림의 글자·텍스트 대체, 문항의 물음·보기,
//        앞선 연결 블록의 글 전부 — 그리고 노트 위에 한 줄로 뜨는 조건(condition)
//   (나) 이 블록의 구하려는 것(goal)·알고 있는 것(given)
//   (다) 이 빈칸 차례가 됐을 때 linkView 가 열어 둔 것: 앞 단계의 제목·문항·결과·이유, 자기 단계의 제목,
//        자기 단계에서 이 칸까지의 문항, (이유 칸이라면) 자기 단계의 결과
//   (라) 이 빈칸의 첫 힌트 — 첫 힌트는 방향만 알려야 한다. 둘째 힌트부터와 풀이는 답을 말해도 된다(검사하지 않는다).
// 보지 않는 것: 다른 장면의 글, 오답 피드백, 보기 문항의 정답(보기 글은 낱말이 겹쳐 기계로 가릴 수 없다).
// 의도한 경우에는 그 빈칸에 leakOk(이유를 적은 문자열 또는 true)를 두면 검사하지 않는다.

const HANGUL_WORD = /^ ?([가-힣]+)/;
const NUMBER_IN_TEXT = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;

function answersOf(mod) {
  const out = [];
  for (const scene of mod.scenes ?? []) {
    for (const block of scene.blocks ?? []) {
      if (block.answer) out.push(block.answer);
      for (const part of block.parts ?? []) if (part.answer) out.push(part.answer);
      for (const step of block.steps ?? []) for (const blank of stepBlanks(step)) if (blank?.answer) out.push(blank.answer);
    }
  }
  return out;
}

const unitsOf = (answer) => [answer?.unit, ...(answer?.unitAliases ?? [])].filter((u) => typeof u === 'string' && u !== '');

function snippet(s, index, length) {
  return s.slice(Math.max(0, index - 14), Math.min(s.length, index + length + 14)).trim();
}

// 숫자 답: 글 속의 같은 값. 단, 문자 앞의 계수(100t, 100 × t)와 다른 단위가 붙은 수(답은 '분'인데 글은 '100원')는 다른 양이다.
function findNumber(text, answer, moduleUnits) {
  const s = normalizeExpr(text);
  const own = unitsOf(answer);
  const tol = (answer.tolerance ?? 0) + 1e-9;
  for (const m of s.matchAll(NUMBER_IN_TEXT)) {
    if (m.index > 0 && /[\d.,]/.test(s[m.index - 1])) continue; // 더 긴 수의 뒷부분
    if (Math.abs(Number(m[0].replace(/,/g, '')) - answer.value) > tol) continue;
    const after = s.slice(m.index + m[0].length);
    if (/^(?:[A-Za-z]| ?\* ?[A-Za-z])/.test(after)) continue;
    const word = HANGUL_WORD.exec(after)?.[1] ?? '';
    const unit = moduleUnits.find((u) => word.startsWith(u));
    if (unit && own.length > 0 && !own.includes(unit)) continue;
    return snippet(s, m.index, m[0].length);
  }
  return null;
}

// 짝이 맞지 않는 괄호에서 자른다: "6,000 + 60t (t" → ["6,000 + 60t ", "t"]. (글에서는 식 뒤에 "(t는 0 이상)" 같은 말이 붙는다.)
function splitAtLooseParens(s) {
  const cut = new Set();
  const open = [];
  [...s].forEach((ch, i) => {
    if (ch === '(') open.push(i);
    else if (ch === ')') { if (open.length > 0) open.pop(); else cut.add(i); }
  });
  for (const i of open) cut.add(i);
  const out = [];
  let cur = '';
  [...s].forEach((ch, i) => { if (cut.has(i)) { out.push(cur); cur = ''; } else cur += ch; });
  out.push(cur);
  return out;
}

// 글에서 식처럼 생긴 조각을 뽑아 계수 배열로 읽는다.
// 돌려주는 것: 등호로 이어진 묶음마다 [변, 변, …], 변 하나는 그 자리에 있던 식들 [{ text, poly|null }, …]
function expressionsIn(text, variable) {
  const allowed = new Set([...'0123456789,.+-*/()= ', variable.toLowerCase(), variable.toUpperCase()]);
  const runs = [];
  let cur = '';
  for (const ch of `${normalizeExpr(text)}\n`) {
    if (allowed.has(ch)) cur += ch;
    else { if (cur.trim() !== '') runs.push(cur); cur = ''; }
  }
  const groups = [];
  for (const run of runs) {
    for (const part of run.split(/[,.](?= |$)/)) { // 쉼표·마침표 뒤가 빈칸이면 서로 다른 식이다(천 단위 쉼표는 뒤에 숫자가 온다)
      const sides = part.split('=').map((raw) => splitAtLooseParens(raw).map((seg) => {
        const t = seg.trim().replace(/[,.+\-*/ ]+$/, '').replace(/^[,.*/ ]+/, '');
        const r = parseExpr(t, variable);
        return { text: t, poly: r.ok ? r.poly : null };
      }).filter((x) => x.text !== ''));
      if (sides.some((side) => side.some((x) => x.poly !== null))) groups.push(sides);
    }
  }
  return groups;
}

// 식 답: 글 속의 어느 식이 정답과 계수가 같다. 등식 답: 글 속에서 등호 양쪽에 놓인 두 식이 정답의 두 변과 같다.
function findLinear(text, answer) {
  const target = linearSides(answer.value, answer.variable);
  if (!target) return null;
  for (const sides of expressionsIn(text, answer.variable)) {
    if (target.length === 1) {
      const hit = sides.flat().find((x) => x.poly !== null && sameSides([x.poly], target));
      if (hit) return hit.text;
    } else {
      for (let i = 0; i + 1 < sides.length; i += 1) {
        const [a, b] = [sides[i][sides[i].length - 1], sides[i + 1][0]];
        if (a?.poly && b?.poly && sameSides([a.poly, b.poly], target)) return `${a.text} = ${b.text}`;
      }
    }
  }
  return null;
}

function figureTexts(mod, block) {
  const def = mod.figures?.[block.figure] ?? {};
  const out = [block.alt, def.caption, def.title];
  for (const col of def.columns ?? []) out.push(col);
  for (const row of def.rows ?? []) out.push(...row);
  for (const mark of def.marks ?? []) out.push(mark.label);
  if (def.kind === 'image') out.push(def.alt);
  if (def.kind === 'points') out.push(def.alt, def.x?.label, def.y?.label, ...(def.series ?? []).map((s) => s.label));
  return out;
}

const answerTexts = (answer) => (answer?.kind === 'choice' ? (answer.options ?? []).map((o) => o.label) : []);

// 블록 하나가 다 풀린 뒤 화면에 남아 있는 글(뒤 블록의 빈칸에서 보면 '앞에 보이는 글').
function blockTexts(mod, block) {
  switch (block.type) {
    case 'text': return block.units ?? [];
    case 'figure': return figureTexts(mod, block);
    case 'predict': return [block.prompt];
    case 'check': return [block.prompt, ...answerTexts(block.answer)];
    case 'problem':
    case 'transfer': return [block.prompt, ...(block.parts ?? []).flatMap((p) => [p.label, ...answerTexts(p.answer)])];
    case 'link': return [block.goal, block.given, ...(block.steps ?? []).flatMap((s) => [s.label, s.gives, s.why, ...stepBlanks(s).flatMap((b) => [b?.prompt, ...answerTexts(b?.answer)])])];
    default: return [];
  }
}

// 이 빈칸 차례에 연결 블록 안에서 보이는 글. 잠금 규칙(linkView)을 그대로 써서 정한다 — 규칙이 바뀌면 검사 범위도 같이 바뀐다.
function visibleInBlock(block, entries, index) {
  const done = new Set(entries.slice(0, index).map((e) => e.key));
  const view = linkView(block, (key) => done.has(key));
  const out = [{ where: 'goal', text: block.goal }, { where: 'given', text: block.given }];
  block.steps.forEach((step, si) => {
    const v = view[si];
    if (v.locked) return;
    const tag = `${si + 1}단계`;
    out.push({ where: `${tag} 제목`, text: step.label });
    stepBlanks(step).forEach((blank, bi) => {
      if (v.blanks[bi].state === 'waiting') return;
      for (const text of [blank?.prompt, ...answerTexts(blank?.answer)]) out.push({ where: `${tag} 문항`, text });
    });
    if (v.showGives) out.push({ where: `${tag} 결과`, text: step.gives });
    if (v.showWhy) out.push({ where: `${tag} 이유`, text: step.why });
  });
  out.push({ where: '이 칸의 첫 힌트', text: entries[index].blank.hints?.[0] });
  return out;
}

// 돌려주는 것: [{ key, where, found, message }] — 비어 있으면 새는 곳을 찾지 못한 것이다(없다는 증명은 아니다).
export function linkLeakWarnings(mod) {
  const moduleUnits = [...new Set(answersOf(mod).flatMap(unitsOf))].sort((a, b) => b.length - a.length);
  const out = [];
  for (const scene of mod.scenes ?? []) {
    (scene.blocks ?? []).forEach((block, blockIndex) => {
      if (block.type !== 'link' || block.mode !== 'complete') return;
      const before = [{ where: '조건 한 줄', text: block.condition ?? scene.condition }];
      for (const prev of scene.blocks.slice(0, blockIndex)) {
        for (const text of blockTexts(mod, prev)) before.push({ where: `앞 블록 ${prev.id}`, text });
      }
      const entries = blankEntries(block);
      entries.forEach((entry, index) => {
        const answer = entry.blank?.answer;
        if (entry.blank?.leakOk || (answer?.kind !== 'number' && answer?.kind !== 'linear')) return;
        for (const src of [...before, ...visibleInBlock(block, entries, index)]) {
          if (typeof src.text !== 'string' || src.text === '') continue;
          const found = answer.kind === 'number' ? findNumber(src.text, answer, moduleUnits) : findLinear(src.text, answer);
          if (found === null) continue;
          const shown = answer.kind === 'number' ? `${answer.value}${answer.unit ?? ''}` : answer.value;
          out.push({ key: entry.key, where: src.where, found, message: `${entry.key}: 정답 ‘${shown}’이 이 빈칸보다 앞에 보이는 글(${src.where})에 있다 — “${found}”` });
        }
      });
    });
  }
  return out;
}
