// 묶음 돌리기(round 블록)의 순수 로직. DOM 도 시계도 모른다 — 걸린 시간은 밖에서 재어 인자로 넘긴다.
//
// 문항을 한 번에 하나씩 묻고, 틀리거나 '모르겠다'면 gap 개의 다른 문항 뒤에 다시 넣는다(한 문항은 많아야 max 번).
// 남은 문항이 그것 하나뿐이면 다시 묻지 않고 '다음에 다시'로 남긴다 — 방금 본 정답을 그대로 옮겨 적는 것을 맞힘으로 세지 않기 위해서다.
// drill 은 다시 묻지 않는다(requeue 를 적었을 때만 따른다). 아래 숫자(gap 2·max 3)는 근거 없는 출발점이다 — 복습 회차(core/review.js)와 같다.
//
// 상태(진행 저장의 rounds[블록 id])
//   queue   남은 줄(맨 앞이 지금 문항)         shown  문항별 나온 횟수          first  문항별 첫 답 correct|wrong|dontknow
//   ok      맞힌 문항 → 맞힌 번째의 걸린 시간(ms)  later  '다음에 다시'로 남긴 문항   missed 많이 물었는데 못 맞힌 문항
//   left    묶음을 건너뛰어 남은 문항           done   줄이 다 돌았다             skipped 건너뛰어 끝났다
//   view    방금 낸 답의 결과를 보는 중 { id, result, n, then } — '다음'을 눌러 확인하기 전까지 있다(새로 고침해도 같은 결과 화면으로 돌아온다)
import { grade } from './answer.js';

export const ROUND_MODES = Object.freeze(['recall', 'sort', 'drill']);
export const ROUND_RESULTS = Object.freeze(['correct', 'wrong', 'dontknow']);
export const REQUEUE_DEFAULT = Object.freeze({ gap: 2, max: 3 });
export const GAP_RANGE = Object.freeze([1, 5]);
export const MAX_RANGE = Object.freeze([2, 4]);
export const ITEM_RANGE = Object.freeze([3, 40]);
export const BUCKET_RANGE = Object.freeze([2, 4]);
const THENS = ['none', 'again', 'later', 'missed'];
const MAX_MS = 3_600_000;
const MAX_SHOWN = 99;

// 화면 문구는 한 곳에 모은다(시험이 금지어를 지키는지 본다). 효과를 약속하는 말·남과 견주는 말·뇌나 신경 용어·'진단'을 쓰지 않는다.
export const ROUND_TEXT = Object.freeze({
  eyebrow: { recall: '떠올리기', sort: '가르기', drill: '짧은 문항 판' },
  remaining: (n) => `남은 문항 ${n}개`,
  answerLabel: '답',
  submit: '답 내기',
  unknown: '모르겠다',
  next: '다음',
  finish: '끝내기',
  skip: '이 묶음 건너뛰기',
  bucketsLabel: '갈래 고르기',
  bucketHint: (n) => `숫자 키 1~${n} 로도 고를 수 있습니다.`,
  correct: '맞습니다.',
  wrong: '맞지 않습니다.',
  dontknow: '모르겠다고 했습니다.',
  whyOpen: '이유 보기',
  correctAnswer: '정답',
  correctBucket: '정답 갈래',
  chosenBucket: '내가 고른 갈래',
  why: '이유',
  again: '뒤에서 다시 묻습니다.',
  later: '남은 문항이 이것 하나뿐이어서 바로 다시 묻지 않고 ‘다음에 다시’로 남깁니다.',
  missed: (n) => `이 문항은 ${n}번 물었으므로 여기서 멈춥니다.`,
  resolved: '이 묶음을 마쳤습니다',
  firstLine: (m, n, r) => `처음에 맞힌 문항 ${m} / ${n}${r > 0 ? ` · 다시 물은 문항 ${r}개` : ''}`,
  drillLine: (n, m, seconds) => `${n}문항 가운데 ${m}문항 맞음${seconds === null ? '' : ` · 맞힌 문항에서 한 문항에 걸린 시간(가운데 값) ${seconds}초`}`,
  skippedLine: (k) => `건너뛴 문항 ${k}개`,
  laterHead: '다음에 다시 볼 문항',
  skippedHead: '건너뛴 문항의 정답',
  tableCaption: '이 모듈의 짧은 문항 판',
  tableCols: ['판', '문항', '맞음', '걸린 시간(가운데 값)'],
  tableSeconds: (s) => `${s}초`,
  tableNone: '—',
  tableNow: '(지금 판)',
  tableGateRow: '들어가는 판', // 문턱 판(gate)의 줄 이름. 모듈 글은 문턱 뒤의 첫 판을 '첫째 판' 으로 말한다
  tableRowName: (row) => (row.gate ? ROUND_TEXT.tableGateRow : String(row.no)), // 판 이름(번호)은 여기 한곳에서 정한다
  gate: (title) => `이 모듈은 이미 풀 줄 아는 것을 빠르게 만드는 연습입니다. 먼저 해 보기를 권하는 모듈: ‘${title}’`,
  gateGo: (title) => `‘${title}’ 열기`,
  gateStay: '그래도 계속',
  gateStayed: '이어서 합니다.',
  veiled: '앞의 글은 가려 두었습니다. 묶음을 마치면 다시 보입니다.', // 떠올리기 묶음이 진행 중인 동안 같은 장면의 앞 글 자리에 둔다
  help: '이 묶음에는 따로 준비된 도움이 없습니다. 모르면 ‘모르겠다’를 누르면 답을 볼 수 있습니다.',
  sortNeed: '갈래를 하나 골라 주세요.',
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (s) => structuredClone(s);
const clampMs = (ms) => Math.round(Math.min(Math.max(0, Number(ms) || 0), MAX_MS));
const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// 이 묶음이 다시 넣는 규칙. recall·sort 는 기본 { gap 2, max 3 }, drill 은 적었을 때만(없으면 null = 다시 묻지 않는다).
export function requeueOf(block) {
  if (isObj(block.requeue)) return { gap: block.requeue.gap, max: block.requeue.max };
  return block.mode === 'drill' ? null : { ...REQUEUE_DEFAULT };
}

export function createRoundState(block) {
  return { v: 1, queue: block.items.map((it) => it.id), shown: {}, first: {}, ok: {}, later: [], missed: [], left: [], done: false, skipped: false, view: null };
}

export const roundIsDone = (state) => state.done === true && state.view === null;

/** 줄의 맨 앞 문항. 없으면 null. */
export function currentItem(block, state) {
  const id = state.queue[0];
  return block.items.find((it) => it.id === id) ?? null;
}

/** 결과를 보는 중인 문항. 없으면 null. */
export function viewedItem(block, state) {
  return state.view ? block.items.find((it) => it.id === state.view.id) ?? null : null;
}

// ---------- 판정 ----------

/**
 * 입력 하나를 판정한다. recall·drill 은 answer.js 의 채점, sort 는 고른 갈래 id 가 문항의 갈래와 같은가.
 * 돌려주는 것: { result: 'correct'|'wrong'|'invalid', reason?, feedback?, chosen? } — invalid 는 시도로 세지 않는다.
 */
export function judgeRound(block, item, input) {
  if (block.mode === 'sort') {
    const chosen = String(input ?? '');
    if (!(block.buckets ?? []).some((b) => b.id === chosen)) return { result: 'invalid', reason: chosen === '' ? 'empty' : 'format' };
    return { result: chosen === item.bucket ? 'correct' : 'wrong', chosen };
  }
  const r = grade(input, item.answer, item.misconceptions ?? []);
  if (r.result === 'invalid') return { result: 'invalid', reason: r.reason };
  if (r.result === 'correct') return { result: 'correct' };
  return { result: 'wrong', feedback: r.feedback ?? null, value: r.value };
}

// ---------- 상태 전이 ----------

/**
 * 지금 문항(줄의 맨 앞)에 답한다. result: correct | wrong | dontknow, ms: 보인 때부터 낸 때까지의 활동 시간.
 * 돌려주는 것: { state, n(이 문항이 나온 번째, 바뀌지 않았으면 0), outcome: correct | again | later | missed | wrong | none }.
 * 지금 문항이 아니거나, 풀림이거나, 앞 문항의 결과를 아직 확인하지 않았으면(view) 바꾸지 않는다.
 */
export function answerRound(block, state, itemId, result, { ms = 0 } = {}) {
  const noop = { state, n: 0, outcome: 'none' };
  if (!ROUND_RESULTS.includes(result) || state.done || state.view || state.queue[0] !== itemId) return noop;
  const next = clone(state);
  next.queue.shift();
  const n = (next.shown[itemId] ?? 0) + 1;
  next.shown[itemId] = n;
  if (next.first[itemId] === undefined) next.first[itemId] = result;
  const rq = requeueOf(block);
  let then = 'none';
  let outcome;
  if (result === 'correct') {
    next.ok[itemId] = clampMs(ms);
    outcome = 'correct';
  } else if (rq === null) {
    outcome = 'wrong'; // drill: 다시 묻지 않는다
  } else if (n >= rq.max) {
    next.missed.push(itemId);
    then = 'missed';
    outcome = 'missed';
  } else if (next.queue.length === 0) {
    next.later.push(itemId); // 사이를 둘 문항이 없다 — 바로 다시 묻지 않고 '다음에 다시'
    then = 'later';
    outcome = 'later';
  } else {
    next.queue.splice(Math.min(rq.gap, next.queue.length), 0, itemId);
    then = 'again';
    outcome = 'again';
  }
  if (next.queue.length === 0) next.done = true;
  // 드릴에서 맞힌 것은 곧 다음 문항이다(보일 결과가 없다). 그 밖에는 결과를 보인 뒤 '다음'으로 확인한다.
  next.view = result === 'correct' && block.mode === 'drill' ? null : { id: itemId, result, n, then };
  return { state: next, n, outcome };
}

/** 보던 결과를 확인했다('다음'). 줄이 다 돈 뒤라면 이것으로 풀림이 된다. */
export function ackRound(state) {
  if (state.view === null) return state;
  const next = clone(state);
  next.view = null;
  return next;
}

/** 묶음 건너뛰기: 남은 줄이 건너뜀으로 남고 풀림이 된다. 돌려주는 것: { state, count(건너뛴 문항 수) }. 이미 풀림이면 바꾸지 않는다. */
export function skipRound(block, state) {
  const acked = ackRound(state);
  if (acked.done) return { state: acked, count: 0 };
  const next = clone(acked);
  next.left = [...next.queue];
  next.queue = [];
  next.done = true;
  next.skipped = true;
  return { state: next, count: next.left.length };
}

// ---------- 요약 ----------

/**
 * 묶음의 사실. items(전체 문항), firstCorrect(처음에 맞힌 수), presentations(나온 횟수 합), reasked(두 번 이상 나온 문항 수),
 * unresolved(끝내 맞히지 못했고 건너뛰지도 않은 문항 수), skipped(건너뛴 문항 수), correct(맞힌 문항 수), medianCorrectMs(맞힌 문항에서 한 문항에 걸린 시간의 가운데 값, 없으면 null).
 */
export function roundSummary(block, state) {
  const ids = block.items.map((it) => it.id);
  const left = new Set(state.left);
  const okMs = ids.filter((id) => Number.isFinite(state.ok[id])).map((id) => state.ok[id]);
  return {
    items: ids.length,
    firstCorrect: ids.filter((id) => state.first[id] === 'correct').length,
    presentations: ids.reduce((s, id) => s + (state.shown[id] ?? 0), 0),
    reasked: ids.filter((id) => (state.shown[id] ?? 0) > 1).length,
    unresolved: ids.filter((id) => state.ok[id] === undefined && !left.has(id)).length,
    skipped: ids.filter((id) => left.has(id)).length,
    correct: okMs.length,
    medianCorrectMs: median(okMs),
    laterIds: state.later.filter((id) => ids.includes(id)),
    missedIds: state.missed.filter((id) => ids.includes(id)),
    leftIds: state.left.filter((id) => ids.includes(id)),
  };
}

/** 문턱 판(gate) 결과. 맞힌 문항 수가 pass 이상이면 통과. gate 가 아니면 늘 통과(권하는 글을 내지 않는다). */
export function gateResult(block, state) {
  const gate = block.gate === true && block.mode === 'drill';
  const pass = gate && Number.isInteger(block.pass) ? block.pass : null;
  const { correct } = roundSummary(block, state);
  return { gate, pass, correct, passed: pass === null ? true : correct >= pass };
}

const blocksOf = (mod) => (mod.scenes ?? []).flatMap((scene) => scene.blocks ?? []);

/**
 * 같은 모듈의 drill 판 가운데 끝난(건너뛰지 않은) 것을 쓴 차례대로: [{ no, gate, blockId, timing, items, correct, medianCorrectMs }].
 * 문턱 판(gate)은 번호를 세지 않는다(no = 0, gate = true — 줄 이름은 ROUND_TEXT.tableRowName). 그 뒤 판들이 1, 2, 3 … 이다. 문턱 판이 없는 모듈은 첫 drill 판이 1 이다.
 */
export function drillRows(mod, rounds) {
  const out = [];
  let no = 0;
  for (const block of blocksOf(mod)) {
    if (block.type !== 'round' || block.mode !== 'drill') continue;
    const gate = block.gate === true;
    if (!gate) no += 1;
    const state = rounds?.[block.id];
    if (!state || !roundIsDone(state) || state.skipped) continue;
    const s = roundSummary(block, state);
    out.push({ no: gate ? 0 : no, gate, blockId: block.id, timing: block.timing ?? 'after', items: s.items, correct: s.correct, medianCorrectMs: s.medianCorrectMs });
  }
  return out;
}

/**
 * 떠올리기(recall) 묶음이 진행 중인 동안 가리는 것: 같은 장면에서 그 묶음보다 앞에 있는 블록 전부와 장면 머리.
 * 진행 중 = 아직 마치지도 건너뛰지도 않음(저장된 상태가 없으면 아직 시작 전이라 진행 중이다). sort·drill 은 가리지 않는다.
 * 돌려주는 것: [{ sceneId, roundId, blockIds(앞 블록 id 들) }] — 진행 중인 recall 묶음마다 하나. 그 묶음이 화면에 있는지는 부르는 쪽이 가린다.
 */
export function recallVeils(mod, rounds) {
  const out = [];
  for (const scene of mod.scenes ?? []) {
    const blocks = scene.blocks ?? [];
    blocks.forEach((block, at) => {
      if (block.type !== 'round' || block.mode !== 'recall') return;
      const state = rounds?.[block.id];
      if (state && roundIsDone(state)) return;
      out.push({ sceneId: scene.id, roundId: block.id, blockIds: blocks.slice(0, at).map((b) => b.id) });
    });
  }
  return out;
}

/** 장면 하나 안의 묶음을 합쳐 센다(끝 화면의 장면 표). */
export function roundsOfScene(scene, rounds) {
  const out = { rounds: 0, finished: 0, items: 0, firstCorrect: 0 };
  for (const block of scene.blocks ?? []) {
    if (block.type !== 'round') continue;
    out.rounds += 1;
    out.items += block.items.length;
    const state = rounds?.[block.id];
    if (!state) continue;
    if (roundIsDone(state)) out.finished += 1;
    out.firstCorrect += roundSummary(block, state).firstCorrect;
  }
  return out;
}

// ---------- 저장 ----------

/** 모듈의 round 블록 색인: 블록 id → 블록. 진행 저장을 거를 때 쓴다. */
export function roundIndex(mod) {
  const index = new Map();
  for (const block of blocksOf(mod)) if (block.type === 'round') index.set(block.id, block);
  return index;
}

/**
 * 저장된 rounds 를 거른다. 모르는 블록·문항·값은 버리고, 칸이 없으면(옛 저장) {} 를 돌려준다.
 * index: roundIndex(mod). 줄에서 빠진 새 문항(모듈 버전이 바뀐 경우)은 하던 묶음의 줄 끝에 붙인다.
 */
export function sanitizeRounds(raw, index) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    const block = index.get(id);
    if (!block || !isObj(v)) continue;
    const ids = new Set(block.items.map((it) => it.id));
    const list = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => ids.has(x)))] : []);
    const map = (m, ok, conv) => {
      const r = {};
      if (isObj(m)) for (const [k, val] of Object.entries(m)) if (ids.has(k) && ok(val)) r[k] = conv(val);
      return r;
    };
    const s = {
      v: 1,
      queue: list(v.queue),
      shown: map(v.shown, (n) => Number.isInteger(n) && n >= 1, (n) => Math.min(n, MAX_SHOWN)),
      first: map(v.first, (r) => ROUND_RESULTS.includes(r), (r) => r),
      ok: map(v.ok, (ms) => Number.isFinite(ms) && ms >= 0, clampMs),
      later: list(v.later), missed: list(v.missed), left: list(v.left),
      done: v.done === true, skipped: v.skipped === true && v.done === true,
      view: null,
    };
    const w = v.view;
    if (isObj(w) && ids.has(w.id) && ROUND_RESULTS.includes(w.result) && Number.isInteger(w.n) && w.n >= 1 && THENS.includes(w.then)) {
      s.view = { id: w.id, result: w.result, n: Math.min(w.n, MAX_SHOWN), then: w.then };
    }
    if (!s.done) {
      const placed = new Set([...s.queue, ...s.left, ...s.later, ...s.missed, ...Object.keys(s.shown)]);
      for (const it of block.items) if (!placed.has(it.id)) s.queue.push(it.id);
    }
    if (s.done && s.queue.length > 0) { s.done = false; s.skipped = false; }
    if (!s.done && s.queue.length === 0 && s.view === null) s.done = true;
    out[id] = s;
  }
  return out;
}
