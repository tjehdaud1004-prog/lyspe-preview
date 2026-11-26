// 진행 상태 기계와 직렬화. 순수 함수 — 상태를 받아 새 상태를 돌려준다.
//
// 문항 상태 전이:  untried → wrong* → correct | hinted-correct | solution-seen
//   · 정답을 낼 때 그 순간의 도움 수준으로 결과가 굳는다(힌트를 썼으면 hinted-correct, 풀이를 봤으면 solution-seen).
//   · 풀이를 보고 나서 맞힌 것도 solution-seen 으로 남긴다('풀이 본 뒤'). 틀린 횟수만으로는 도움 여부를 바꾸지 않는다.
//   · skipped 는 건너뜀 표시이며, 나중에 맞히면 그 결과가 우선한다.
//   · written 은 자유 서술(자기 점검) 문항 — 채점하지 않으므로 맞고 틀림이 없다.
import { gradables } from './module.js';
import { sanitizeFirst } from './unaided.js';
import { sanitizeProbes } from './probe.js';
import { sanitizeSkip, skippedScenes } from './skip.js';
import { sanitizeRounds } from './round.js';
import { sanitizeOpener } from './opener.js';
import { isShuffleSeed } from './shuffle.js';
import { sanitizeFolded } from './fold.js';

export const VERSION = 1;
export const PHASES = ['reading', 'final', 'summary'];
const VIAS = ['correct', 'hinted-correct', 'solution-seen', 'written'];
const MAX_ELAPSED_STEP_MS = 60_000; // 한 번에 더하는 시간의 상한(탭이 오래 숨겨졌다 돌아온 경우 방어)

export const OUTCOME_LABELS = Object.freeze({
  untried: '아직 안 풂',
  wrong: '다시 시도 중',
  correct: '스스로 해결',
  'hinted-correct': '힌트를 본 뒤',
  'solution-seen': '풀이를 본 뒤',
  skipped: '건너뜀',
  written: '직접 적음',
});

export const SCENE_LABELS = Object.freeze({
  self: '스스로',
  hint: '힌트 뒤',
  solution: '풀이 뒤',
  skipped: '건너뜀',
  written: '직접 적음',
  read: '읽음',
  'checked-skip': '확인 뒤 건너뜀', // 건너뛰기 확인(core/skip.js)을 거쳐 건너뛰었고, 그 장면의 문항을 열어 풀지 않았다
});

export function createProgress(moduleId, now = 0) {
  return {
    v: VERSION, moduleId, phase: 'reading', step: 0,
    items: {}, help: {}, predicts: {}, finalAnswer: '',
    elapsedMs: 0, startedAt: now, finishedAt: null,
    first: {},  // '도움 없이 먼저' 자리의 부분별 첫 답(core/unaided.js). 문항 키 → correct|wrong|unknown|skipped|written
    probes: {}, // 본문 밖에서 도움 없이 푼 문항 묶음(core/probe.js). pre·delayed → { status, startedAt, endedAt, daysSince?, answers }
    rounds: {}, // 묶음 돌리기(core/round.js)의 상태. 블록 id → { queue, shown, first, ok, later, missed, left, done, skipped, view }. 옛 저장에는 이 칸이 없다 → {}
    skip: null, // 건너뛰기 확인(core/skip.js). 없으면 null → { status, startedAt, endedAt, answers, verdicts, scenes, decidedAt }
    opener: null, // 여는 카드(core/opener.js). 없으면 null → { status, chosen, result, at, revisit? }. 처음 고른 답을 끝 화면의 다시 보기가 쓴다. 옛 저장에는 이 칸이 없다 → null
    folded: [], // '설명 접고 문항으로'(core/fold.js)로 접은 장면 id. 접은 채 다시 그린다. 옛 저장에는 이 칸이 없다 → []
  };
}

const clone = (s) => structuredClone(s);

export function advance(state, lastIndex) {
  if (state.step >= lastIndex) return state;
  const next = clone(state);
  next.step += 1;
  return next;
}

// 건너뛴 장면을 넘어 읽는 위치를 한 번에 옮긴다(앞으로만).
export function moveTo(state, target, lastIndex) {
  const to = Math.min(target, lastIndex);
  if (!Number.isInteger(to) || to <= state.step) return state;
  const next = clone(state);
  next.step = to;
  return next;
}

// 설명을 접고 그 장면의 첫 문항 걸음으로 옮긴다(앞으로만). 접은 장면 id 를 남긴다.
export function foldScene(state, sceneId, target, lastIndex) {
  const moved = moveTo(state, target, lastIndex);
  if ((state.folded ?? []).includes(sceneId)) return moved;
  const next = moved === state ? clone(state) : moved;
  next.folded = [...(state.folded ?? []), sceneId];
  return next;
}

// 접은 설명을 펼쳤다 — 접은 장면 목록에서 뺀다.
export function unfoldScene(state, sceneId) {
  if (!(state.folded ?? []).includes(sceneId)) return state;
  const next = clone(state);
  next.folded = next.folded.filter((id) => id !== sceneId);
  return next;
}

export function setPhase(state, phase, now = 0) {
  if (!PHASES.includes(phase) || state.phase === phase) return state;
  const next = clone(state);
  next.phase = phase;
  if (phase === 'summary' && next.finishedAt === null) next.finishedAt = now;
  return next;
}

function helpOf(state, helpKey) { return state.help[helpKey] ?? { hints: 0, solution: false }; }

// result: 'correct' | 'wrong' | 'self'(자유 서술). invalid 는 시도로 세지 않으므로 여기 오지 않는다.
export function recordAttempt(state, { key, helpKey, result, value = '' }) {
  const next = clone(state);
  const rec = next.items[key] ?? { wrong: 0, attempts: 0, solved: false, via: null, skipped: false, last: '' };
  rec.attempts += 1;
  rec.last = String(value).slice(0, 2000);
  if (result === 'wrong') {
    if (!rec.solved) rec.wrong += 1;
  } else if (!rec.solved) {
    if (result === 'self') rec.via = 'written';
    else {
      const help = helpOf(next, helpKey);
      rec.via = help.solution ? 'solution-seen' : help.hints > 0 ? 'hinted-correct' : 'correct';
    }
    rec.solved = true;
    rec.skipped = false;
  }
  next.items[key] = rec;
  return next;
}

export function skipItem(state, key) {
  const rec = state.items[key];
  if (rec?.solved) return state;
  const next = clone(state);
  next.items[key] = { wrong: 0, attempts: 0, solved: false, via: null, last: '', ...rec, skipped: true };
  return next;
}

export function useHint(state, helpKey, hintCount) {
  const help = helpOf(state, helpKey);
  if (help.hints >= hintCount) return state;
  const next = clone(state);
  next.help[helpKey] = { ...help, hints: help.hints + 1 };
  return next;
}

export function viewSolution(state, helpKey) {
  const help = helpOf(state, helpKey);
  if (help.solution) return state;
  const next = clone(state);
  next.help[helpKey] = { ...help, solution: true };
  return next;
}

// 다음에 열 수 있는 도움: 힌트 1 → 2 → … → 풀이. 더 없으면 null.
export function nextHelp(state, helpKey, { hints, solution }) {
  const help = helpOf(state, helpKey);
  if (help.hints < hints.length) return { type: 'hint', level: help.hints + 1, of: hints.length };
  if (solution && !help.solution) return { type: 'solution' };
  return null;
}

export function itemOutcome(state, key, helpKey) {
  const rec = state.items[key];
  if (rec?.solved) return rec.via;
  if (helpOf(state, helpKey).solution) return 'solution-seen';
  if (rec?.skipped) return 'skipped';
  if (rec && rec.wrong > 0) return 'wrong';
  return 'untried';
}

export function isResolved(state, key, helpKey) {
  const o = itemOutcome(state, key, helpKey);
  return o !== 'untried' && o !== 'wrong';
}

export function setPredict(state, id, text) {
  const next = clone(state);
  next.predicts[id] = String(text).slice(0, 5000);
  return next;
}

// 묶음 돌리기 한 블록의 상태를 저장한다(core/round.js 가 만든 상태를 그대로 넣는다).
export function setRound(state, blockId, roundState) {
  const next = clone(state);
  next.rounds = { ...(next.rounds ?? {}), [blockId]: roundState };
  return next;
}

export function setFinalAnswer(state, text) {
  const next = clone(state);
  next.finalAnswer = String(text).slice(0, 5000);
  return next;
}

export function addElapsed(state, ms) {
  const add = Math.min(Math.max(0, Number(ms) || 0), MAX_ELAPSED_STEP_MS);
  if (add === 0) return state;
  const next = clone(state);
  next.elapsedMs += add;
  return next;
}

// 장면별 요약. 라벨은 가장 많이 도움을 받은 쪽으로 정하고, 세부 개수를 같이 돌려준다.
export function summarize(mod, state) {
  const grads = gradables(mod);
  const skipped = skippedScenes(state);
  return mod.scenes.map((scene) => {
    const counts = { self: 0, hint: 0, solution: 0, skipped: 0, written: 0 };
    let touched = false; // 그 장면의 문항을 하나라도 열어 풀었는가(건너뛴 장면을 나중에 열어 푼 경우)
    for (const g of grads.filter((x) => x.sceneId === scene.id)) {
      const o = itemOutcome(state, g.key, g.helpKey);
      if (o !== 'untried' && o !== 'skipped') touched = true;
      if (o === 'correct') counts.self += 1;
      else if (o === 'hinted-correct') counts.hint += 1;
      else if (o === 'solution-seen') counts.solution += 1;
      else if (o === 'written') counts.written += 1;
      else counts.skipped += 1; // skipped, untried, wrong — 끝까지 봤지만 풀지 않은 것
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    let label = 'read';
    if (counts.skipped > 0) label = 'skipped';
    else if (counts.solution > 0) label = 'solution';
    else if (counts.hint > 0) label = 'hint';
    else if (counts.self > 0) label = 'self';
    else if (counts.written > 0) label = 'written';
    const skippedByCheck = skipped.has(scene.id);
    if (skippedByCheck && !touched) label = 'checked-skip';
    return { sceneId: scene.id, title: scene.title, label, counts, total, skippedByCheck };
  });
}

// ---------- 직렬화·복구 ----------

export function serialize(state) { return JSON.stringify(state); }

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonNegInt = (v, max) => (Number.isInteger(v) && v >= 0 ? Math.min(v, max) : 0);

// 저장 데이터가 깨져 있어도 화면이 죽지 않게: 알 수 없는 키는 버리고, 형식이 틀린 값은 안전한 값으로 바꾼다.
// index: core/module.js 의 moduleIndex(mod) 결과. 복구할 수 없으면 null.
export function deserialize(text, moduleId, index) {
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!isObj(raw) || raw.v !== VERSION || raw.moduleId !== moduleId) return null;
  const s = createProgress(moduleId, Number.isFinite(raw.startedAt) ? raw.startedAt : 0);
  s.step = Math.min(nonNegInt(raw.step, index.stepCount), Math.max(0, index.stepCount - 1));
  s.phase = PHASES.includes(raw.phase) ? raw.phase : 'reading';
  if (s.phase !== 'reading' && s.step < index.stepCount - 1) s.phase = 'reading'; // 끝까지 안 갔는데 끝 화면일 수는 없다
  if (isObj(raw.items)) {
    for (const [key, v] of Object.entries(raw.items)) {
      if (!index.keys.has(key) || !isObj(v)) continue;
      const solved = v.solved === true && VIAS.includes(v.via);
      s.items[key] = {
        wrong: nonNegInt(v.wrong, 9999), attempts: nonNegInt(v.attempts, 9999),
        solved, via: solved ? v.via : null, skipped: v.skipped === true && !solved,
        last: typeof v.last === 'string' ? v.last.slice(0, 2000) : '',
      };
      // 다시 시도 기록(core/tries.js): 이미 틀린 것으로 확인된 보기, 건너뛴 뒤 맞혔는지. 없으면 필드를 만들지 않는다.
      const tried = Array.isArray(v.tried) ? [...new Set(v.tried.filter((t) => typeof t === 'string' && t !== '').map((t) => t.slice(0, 64)))].slice(0, 20) : [];
      if (tried.length > 0) s.items[key].tried = tried;
      if (v.afterSkip === true && solved) s.items[key].afterSkip = true;
    }
  }
  if (isObj(raw.help)) {
    for (const [key, v] of Object.entries(raw.help)) {
      if (!index.helpKeys.has(key) || !isObj(v)) continue;
      s.help[key] = { hints: nonNegInt(v.hints, 20), solution: v.solution === true };
    }
  }
  if (isObj(raw.predicts)) {
    for (const [id, v] of Object.entries(raw.predicts)) {
      if (index.predictIds.has(id) && typeof v === 'string') s.predicts[id] = v.slice(0, 5000);
    }
  }
  if (typeof raw.finalAnswer === 'string') s.finalAnswer = raw.finalAnswer.slice(0, 5000);
  s.elapsedMs = Number.isFinite(raw.elapsedMs) && raw.elapsedMs >= 0 ? Math.min(raw.elapsedMs, 1e9) : 0;
  s.finishedAt = Number.isFinite(raw.finishedAt) ? raw.finishedAt : null;
  s.first = sanitizeFirst(raw.first, index.keys);
  s.probes = sanitizeProbes(raw.probes, index.probeItems);
  s.skip = sanitizeSkip(raw.skip, index.skip);
  s.rounds = sanitizeRounds(raw.rounds, index.rounds ?? new Map()); // 칸이 없는 옛 저장은 {}
  s.opener = sanitizeOpener(raw.opener, index.mod);
  s.folded = sanitizeFolded(raw.folded, index.mod, s.step); // 칸이 없는 옛 저장은 []
  if (isShuffleSeed(raw.shuffleSeed)) s.shuffleSeed = raw.shuffleSeed; // 보기 섞기의 씨앗(core/shuffle.js) — 모듈이 shuffleOptions 를 켠 때만 생긴다
  return s;
}

// 첫 방문과 구분하기 위한 '이어서 보기' 판정: 읽은 흔적이 하나라도 있는가.
export function hasProgress(state) {
  return state.step > 0 || state.phase !== 'reading' || Object.keys(state.items).length > 0
    || Object.keys(state.help).length > 0 || Object.values(state.predicts).some((t) => t !== '') || Object.keys(state.rounds ?? {}).length > 0;
}
