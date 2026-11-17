// 모듈의 종류와 종류별 서명 (정본). 플레이어가 읽는 사본은 LySpe/player/public/js/data/kinds.mjs 이고 두 파일은 같은 바이트여야 한다(시험이 대조한다).
// 순수 함수, 의존 없음 — 모듈 자료(json)만 읽고 엔진의 다른 파일을 가져오지 않는다. 명세: LySpe/player/SPEC_KINDS.md 0·1·6절.
//
// "종류마다 흐름이 달라야 더 잘 배운다"는 가설이다. 이름과 한 줄은 하는 일만 적고 효과를 약속하지 않는다.
//
// 서명을 자료에서 세는 법(명세가 정하지 않은 곳의 해석)
//   · 채점 문항 = check 블록 하나 / problem·transfer 의 부분 하나 / link 의 빈칸 하나 / round 의 문항 하나.
//   · 표지 칸(fresh edge whatIf explain evidence summary criterion stance contrast gate)은 그 문항 자신이나 그것이 든 블록에 true(또는 값)로 적혀 있으면 켜진 것으로 센다.
//     form·pair·bucket·edge(sort 문항)는 round 문항에만, pair 는 review 문항에도 본다.
//   · '쓴 차례' = 장면 차례대로, 장면 안에서는 블록 차례대로.

export const KINDS = Object.freeze([
  Object.freeze({ id: 'pairs', name: '떠올려 붙여 두기', line: '짧게 보고, 가린 채 떠올립니다.' }),
  Object.freeze({ id: 'discern', name: '가려내기', line: '섞여 있는 것을 하나씩 가려 봅니다.' }),
  Object.freeze({ id: 'relate', name: '왜 그런지 따져 보기', line: '먼저 예상하고, 표와 그래프로 까닭을 따져 봅니다.' }),
  Object.freeze({ id: 'procedure', name: '방법 익히기', line: '다 푼 풀이를 보고, 뒤 단계부터 넘겨받아 풉니다.' }),
  Object.freeze({ id: 'fluency', name: '빠르고 정확하게', line: '이미 풀 줄 아는 것을 짧게 여러 판 풉니다.' }),
  Object.freeze({ id: 'weave', name: '엮어 풀기', line: '여러 단계를 이어 한 문제를 풉니다.' }),
  Object.freeze({ id: 'read', name: '글 읽어내기', line: '글을 곁에 두고 근거를 짚으며 읽습니다.' }),
]);

export const KIND_IDS = Object.freeze(KINDS.map((k) => k.id));

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const isText = (v) => typeof v === 'string' && v.trim() !== '';

/** 플레이어가 모듈을 열 때 부른다. 문제가 없으면 null, 있으면 화면에 보일 글. */
export function checkKind(mod) {
  const list = KIND_IDS.join(', ');
  if (!isObj(mod)) return '모듈 자료가 올바른 꼴이 아닙니다.';
  if (mod.kind === undefined || mod.kind === null) return `이 모듈에는 종류(kind)가 적혀 있지 않습니다. 다음 가운데 하나여야 합니다: ${list}`;
  if (typeof mod.kind !== 'string' || !KIND_IDS.includes(mod.kind)) return `알 수 없는 종류(kind) '${String(mod.kind).slice(0, 40)}' 입니다. 다음 가운데 하나여야 합니다: ${list}`;
  return null;
}

// ---------- 자료 훑기 ----------

/** 쓴 차례의 블록: { block, scene, sceneIndex, pos } */
function flatBlocks(mod) {
  const out = [];
  arr(mod.scenes).forEach((scene, sceneIndex) => {
    arr(scene?.blocks).forEach((block) => { if (isObj(block)) out.push({ block, scene, sceneIndex, pos: out.length }); });
  });
  return out;
}

/** 블록 하나 속의 채점 문항들: { node, block }. node = 문항 자신(check 는 블록 자신). */
function gradedOf(block) {
  switch (block.type) {
    case 'check': return [{ node: block, block }];
    case 'problem': case 'transfer': return arr(block.parts).filter(isObj).map((node) => ({ node, block }));
    case 'link': return arr(block.steps).filter(isObj).flatMap((step) => (isObj(step.blank) ? [step.blank] : arr(step.blanks)).filter(isObj).map((node) => ({ node, block })));
    case 'round': return arr(block.items).filter(isObj).map((node) => ({ node, block }));
    default: return [];
  }
}
const flag = (u, name) => u.node[name] === true || u.block[name] === true;
const answerKind = (u) => (isObj(u.node.answer) ? u.node.answer.kind : undefined);

const rounds = (flat) => flat.filter((f) => f.block.type === 'round').map((f) => f.block);
const unitsOf = (flat) => flat.filter((f) => f.block.type === 'text').reduce((n, f) => n + arr(f.block.units).length, 0);
const count = (list, pred) => list.filter(pred).length;

// ---------- 공통 ----------

function commonFailures(mod, flat, add) {
  const delayed = arr(mod.delayedCheck?.items).length;
  if (delayed < 2) add(`며칠 뒤 문항(delayedCheck)이 2개 이상이어야 하는데 ${delayed}개`);
  const review = arr(mod.review?.items).length;
  if (review < 3) add(`복습 문항(review)이 3개 이상이어야 하는데 ${review}개`);
  const lastScene = arr(mod.scenes).length - 1;
  const inLast = flat.filter((f) => f.sceneIndex === lastScene);
  const freshGraded = inLast.some((f) => f.block.type === 'transfer' || gradedOf(f.block).some((u) => flag(u, 'fresh')));
  if (!freshGraded) add('마지막 장면에 fresh: true 인 채점 문항(또는 transfer 블록)이 하나 이상 있어야 하는데 없음');
}

// ---------- 종류별 ----------

function pairsFailures(mod, flat, add) {
  const pairs = arr(mod.pairs);
  if (pairs.length < 4 || pairs.length > 12) add(`pairs 가 4개 이상 12개 이하여야 하는데 ${pairs.length}개`);
  const badEntries = count(pairs, (p) => !isObj(p) || !isText(p.id) || !isText(p.term) || !isText(p.meaning));
  if (badEntries > 0) add(`pairs 의 항목은 id·term·meaning 이 모두 글이어야 하는데 ${badEntries}개가 그렇지 않음`);
  const ids = pairs.filter(isObj).map((p) => p.id);
  if (new Set(ids).size !== ids.length) add('pairs 의 id 가 서로 달라야 하는데 겹치는 것이 있음');

  const rs = rounds(flat);
  const recall = rs.filter((r) => r.mode === 'recall');
  const gapOk = count(recall, (r) => (r.requeue?.gap ?? 2) >= 2);
  if (gapOk < 2) add(`requeue.gap 이 2 이상인 recall 묶음이 2개 이상이어야 하는데 ${gapOk}개`);

  const seen = new Map(ids.map((id) => [id, 0]));
  for (const r of rs) for (const it of arr(r.items)) if (isObj(it) && seen.has(it.pair)) seen.set(it.pair, seen.get(it.pair) + 1);
  const few = [...seen].filter(([, n]) => n < 3).map(([id, n]) => `${id}(${n}번)`);
  if (few.length > 0) add(`모든 pairs 항목이 round 문항의 pair 로 3번 이상 나와야 하는데 ${few.length}개가 모자람: ${few.join(', ')}`);

  let adjacent = 0;
  for (const r of rs) { const items = arr(r.items); for (let i = 1; i < items.length; i += 1) if (isObj(items[i]) && isObj(items[i - 1]) && items[i].pair !== undefined && items[i].pair === items[i - 1].pair) adjacent += 1; }
  if (adjacent > 0) add(`같은 pair 가 한 묶음 안에서 잇달아 놓이면 안 되는데 ${adjacent}곳에서 잇달아 놓임`);

  const recallItems = recall.flatMap((r) => arr(r.items)).filter(isObj);
  const termCount = count(recallItems, (it) => it.answer?.kind === 'term');
  if (termCount * 3 < recallItems.length) add(`recall 문항의 3분의 1 이상이 term 답이어야 하는데 ${recallItems.length}개 가운데 ${termCount}개`);

  const units = unitsOf(flat);
  const roundItems = rs.reduce((n, r) => n + arr(r.items).length, 0);
  if (units > roundItems) add(`본문 글 단위 수가 round 문항 수 이하여야 하는데 글 단위 ${units}개, round 문항 ${roundItems}개`);

  const referenced = new Set(arr(mod.review?.items).filter(isObj).map((it) => it.pair).filter((id) => seen.has(id)));
  if (referenced.size * 3 < pairs.length * 2) add(`복습 문항이 pairs 의 3분의 2 이상을 pair 로 가리켜야 하는데 ${pairs.length}개 가운데 ${referenced.size}개`);
}

function discernFailures(mod, flat, add) {
  const sorts = rounds(flat).filter((r) => r.mode === 'sort');
  if (sorts.length < 1) add('sort 묶음이 1개 이상이어야 하는데 0개');
  const items = sorts.flatMap((r) => arr(r.items)).filter(isObj);
  if (items.length < 12) add(`sort 문항이 12개 이상이어야 하는데 ${items.length}개`);

  const perBucket = new Map();
  for (const r of sorts) for (const b of arr(r.buckets)) if (isObj(b) && isText(b.id) && !perBucket.has(b.id)) perBucket.set(b.id, 0);
  for (const it of items) if (typeof it.bucket === 'string') perBucket.set(it.bucket, (perBucket.get(it.bucket) ?? 0) + 1);
  if (perBucket.size < 2) add(`갈래가 2개 이상이어야 하는데 ${perBucket.size}개`);
  const thin = [...perBucket].filter(([, n]) => n < 3).map(([id, n]) => `${id}(${n}문항)`);
  if (thin.length > 0) add(`갈래마다 3문항 이상이어야 하는데 ${thin.length}개 갈래가 모자람: ${thin.join(', ')}`);

  let run = 1; let longest = items.length > 0 ? 1 : 0;
  for (let i = 1; i < items.length; i += 1) { run = items[i].bucket === items[i - 1].bucket ? run + 1 : 1; longest = Math.max(longest, run); }
  if (longest >= 3) add(`쓴 차례에서 같은 갈래가 3번 잇달아 나오면 안 되는데 ${longest}번 잇달아 나옴`);

  const edge = count(items, (it) => it.edge === true);
  if (edge < 2) add(`edge: true 문항이 2개 이상이어야 하는데 ${edge}개`);

  const firstSort = flat.findIndex((f) => f.block.type === 'round' && f.block.mode === 'sort');
  const contrast = firstSort >= 0 && flat.slice(0, firstSort).some((f) => f.block.contrast === true);
  if (!contrast) add('첫 sort 묶음 앞에 contrast: true 블록이 있어야 하는데 없음');

  const forms = new Set(items.map((it) => it.form).filter(isText));
  if (forms.size < 2) add(`sort 문항의 form 이 두 가지 이상이어야 하는데 ${forms.size}가지`);

  const criterion = flat.flatMap((f) => gradedOf(f.block)).filter((u) => flag(u, 'criterion') && ['text', 'expr'].includes(answerKind(u))).length;
  if (criterion < 1) add('criterion: true 인 글 답 문항이 하나 있어야 하는데 0개');
}

function relateFailures(mod, flat, add) {
  const firstFigure = flat.findIndex((f) => f.block.type === 'figure');
  if (firstFigure < 0 || !flat.slice(0, firstFigure).some((f) => f.block.type === 'predict')) add('첫 figure 앞에 predict 블록이 있어야 하는데 없음');
  const lookback = count(flat, (f) => f.block.type === 'lookback');
  if (lookback < 1) add('lookback 블록이 하나 이상 있어야 하는데 0개');
  const figures = flat.filter((f) => f.block.type === 'figure');
  if (figures.length < 2) add(`figure 블록이 2개 이상이어야 하는데 ${figures.length}개`);
  const kindOf = (f) => mod.figures?.[f.block.figure]?.kind;
  if (!figures.some((f) => ['points', 'lines'].includes(kindOf(f)))) add('figure 블록 가운데 points 나 lines 그림을 쓰는 것이 하나 이상 있어야 하는데 없음');
  const graded = flat.flatMap((f) => gradedOf(f.block));
  const whatIf = count(graded, (u) => flag(u, 'whatIf'));
  if (whatIf < 2) add(`whatIf: true 채점 문항이 2개 이상이어야 하는데 ${whatIf}개`);
  const explain = count(graded, (u) => flag(u, 'explain'));
  if (explain < 1) add('explain: true 문항이 하나 이상 있어야 하는데 0개');
  const drills = count(rounds(flat), (r) => r.mode === 'drill');
  if (drills > 0) add(`drill 묶음이 없어야 하는데 ${drills}개`);
}

function procedureFailures(mod, flat, add) {
  const links = flat.filter((f) => f.block.type === 'link' && isText(f.block.procedure));
  const groups = new Map();
  for (const f of links) groups.set(f.block.procedure, [...(groups.get(f.block.procedure) ?? []), f]);
  const biggest = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  if (biggest.length < 3) { add(`같은 procedure 이름의 link 가 3개 이상이어야 하는데 가장 많은 이름에서 ${biggest.length}개`); return; }

  const filled = (block) => count(arr(block.steps), (s) => isObj(s) && (isObj(s.blank) || arr(s.blanks).length > 0));
  const counts = biggest.map((f) => filled(f.block));
  let dropAt = -1;
  for (let i = 1; i < counts.length; i += 1) if (counts[i] < counts[i - 1]) { dropAt = i; break; }
  if (dropAt >= 0) add(`학습자가 채우는 단계 수가 줄지 않아야 하는데 ${dropAt + 1}번째 link 에서 ${counts[dropAt - 1]}개에서 ${counts[dropAt]}개로 줆(차례: ${counts.join(', ')})`);
  if (counts[0] !== 0) add(`첫 link 는 학습자가 채우는 단계가 0개(보기)여야 하는데 ${counts[0]}개`);
  const last = biggest[biggest.length - 1].block;
  const lastSteps = arr(last.steps).length;
  if (counts[counts.length - 1] !== lastSteps) add(`마지막 link 는 학습자가 모든 단계를 채워야 하는데 ${lastSteps}개 가운데 ${counts[counts.length - 1]}개`);
  const noWhy = biggest.reduce((n, f) => n + count(arr(f.block.steps), (s) => !isObj(s) || !isText(s.why)), 0);
  if (noWhy > 0) add(`link 의 모든 단계에 why 가 있어야 하는데 ${noWhy}개 단계에 없음`);

  const lastPos = biggest[biggest.length - 1].pos;
  const after = flat.filter((f) => f.pos > lastPos);
  const problems = count(after, (f) => f.block.type === 'problem');
  if (problems < 1) add('그 link 들 뒤에 problem 이 하나 이상 있어야 하는데 0개');
  const fresh = count(after, (f) => ['problem', 'transfer'].includes(f.block.type) && (f.block.fresh === true || arr(f.block.parts).some((p) => isObj(p) && p.fresh === true)));
  if (fresh < 1) add('그 link 들 뒤에 fresh: true 인 problem 이나 transfer 가 하나 이상 있어야 하는데 0개');
}

function fluencyFailures(mod, flat, add) {
  const needs = arr(mod.needs).length;
  if (needs < 1) add(`needs 가 1개 이상이어야 하는데 ${needs}개`);
  const drills = flat.filter((f) => f.block.type === 'round' && f.block.mode === 'drill');
  const gates = drills.filter((f) => f.block.gate === true);
  if (gates.length !== 1) add(`gate: true 인 drill 이 정확히 하나여야 하는데 ${gates.length}개`);
  else if (gates[0].sceneIndex !== 0) add(`gate: true 인 drill 은 첫 장면에 있어야 하는데 ${gates[0].sceneIndex + 1}번째 장면에 있음`);
  const plain = drills.filter((f) => f.block.gate !== true).map((f) => f.block);
  if (plain.length < 3) add(`gate 가 아닌 drill 이 3개 이상이어야 하는데 ${plain.length}개`);
  const small = plain.filter((r) => arr(r.items).length < 6);
  if (small.length > 0) add(`drill 판마다 6문항 이상이어야 하는데 ${small.length}개 판이 모자람: ${small.map((r) => `${r.id}(${arr(r.items).length}문항)`).join(', ')}`);
  const noTiming = plain.filter((r) => r.timing !== 'after');
  if (noTiming.length > 0) add(`drill 판마다 timing: 'after' 여야 하는데 ${noTiming.length}개 판이 아님`);
  const badAnswers = plain.reduce((n, r) => n + count(arr(r.items), (it) => !['number', 'linear', 'term'].includes(it?.answer?.kind)), 0);
  if (badAnswers > 0) add(`drill 문항의 답은 number·linear·term 이어야 하는데 ${badAnswers}개 문항이 아님`);
  const units = unitsOf(flat);
  if (units > 8) add(`본문 글 단위가 8개 이하여야 하는데 ${units}개`);
}

function weaveFailures(mod, flat, add) {
  const need = (label, n) => { if (n < 1) add(`${label}가 하나 이상 있어야 하는데 0개`); };
  need('predict 블록', count(flat, (f) => f.block.type === 'predict'));
  need('보기 link(mode: show)', count(flat, (f) => f.block.type === 'link' && f.block.mode === 'show'));
  need('채우는 link(mode: complete)', count(flat, (f) => f.block.type === 'link' && f.block.mode === 'complete'));
  need('problem 블록', count(flat, (f) => f.block.type === 'problem'));
  need('transfer 블록', count(flat, (f) => f.block.type === 'transfer'));
}

function readFailures(mod, flat, add) {
  const passages = flat.filter((f) => f.block.type === 'passage');
  const big = count(passages, (f) => arr(f.block.paragraphs).length >= 3);
  if (big < 1) add(`문단 3개 이상인 passage 가 하나 이상 있어야 하는데 ${passages.length}개 가운데 0개`);
  const graded = flat.flatMap((f) => gradedOf(f.block));
  const evidence = count(graded, (u) => flag(u, 'evidence'));
  if (evidence < 3) add(`evidence: true 채점 부분이 3개 이상이어야 하는데 ${evidence}개`);
  const stances = graded.map((u) => u.node.stance ?? u.block.stance).filter((s) => ['stated', 'inferred', 'unknown'].includes(s));
  if (stances.length < 3) add(`stance 문항이 3개 이상이어야 하는데 ${stances.length}개`);
  const missing = ['stated', 'inferred', 'unknown'].filter((s) => !stances.includes(s));
  if (missing.length > 0) add(`stance 문항의 정답으로 stated·inferred·unknown 이 모두 나와야 하는데 ${missing.join('·')} 이 없음`);
  const summary = count(graded, (u) => flag(u, 'summary'));
  if (summary < 1) add('summary: true 문항이 하나 있어야 하는데 0개');

  const lastScene = arr(mod.scenes).length - 1;
  const freshSecond = passages.slice(1).find((f) => f.sceneIndex === lastScene && f.block.fresh === true);
  if (!freshSecond) add('마지막 장면에 fresh: true 인 둘째 passage 가 있어야 하는데 없음');
  else {
    const after = flat.filter((f) => f.sceneIndex === lastScene && f.pos > freshSecond.pos).flatMap((f) => gradedOf(f.block)).length;
    if (after < 2) add(`그 fresh passage 뒤에 채점 문항이 2개 이상이어야 하는데 ${after}개`);
  }
}

const BY_KIND = { pairs: pairsFailures, discern: discernFailures, relate: relateFailures, procedure: procedureFailures, fluency: fluencyFailures, weave: weaveFailures, read: readFailures };

/** 종류의 서명을 본다. { ok, failures } — failures 는 한국어로 무엇이 얼마나 모자란지 적은 글들. 서명 미달은 모듈을 여는 것을 막지 않는다. */
export function kindSignature(mod) {
  const failures = [];
  const add = (text) => failures.push(text);
  const kindProblem = checkKind(mod);
  if (kindProblem) return { ok: false, failures: [kindProblem] };
  const flat = flatBlocks(mod);
  commonFailures(mod, flat, add);
  BY_KIND[mod.kind](mod, flat, add);
  return { ok: failures.length === 0, failures };
}
