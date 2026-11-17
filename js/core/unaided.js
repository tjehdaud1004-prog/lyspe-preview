// '도움 없이 먼저' 자리의 규칙. 순수 함수 — 진행 상태를 받아 새 상태나 판정을 돌려준다. DOM 을 모른다.
//
// 문제(problem)·전이 문제(transfer) 블록에 unaided: true 가 있으면:
//  · 그 문제의 모든 부분에 첫 답이 남기 전에는 힌트·풀이가 열리지 않는다(잠금).
//  · 첫 답은 부분마다 한 번만 남는다: 제출한 답의 정오(correct | wrong), 서술형이면 written,
//    '모르겠다'(unknown), 답 없이 건너뜀(skipped). 그 뒤의 재시도·도움은 기존 문항 기록(items·help)에 따로 남는다.
//  · 막혔을 때 '모르겠다'를 누르면 아직 첫 답이 없는 부분이 모두 unknown 으로 남고 잠금이 풀린다(가두지 않는다).
//  · 잠겨 있는 동안에는 틀린 답에 붙는 오개념 설명과 서술형 부분의 예시 답도 미룬다 — 둘 다 도움이고,
//    다른 부분의 답이나 풀이 방법을 드러내는 문장이 있다. 맞았는지 틀렸는지는 바로 알려 준다.
//
// 이 자리가 재는 것은 '이 문제의 힌트·풀이를 열기 전에 낸 답'이다. 앞의 본문을 다시 보았는지,
// 종이·계산기·다른 사람의 도움은 화면이 알 수 없다. 시험이나 평가가 아니며 점수를 만들지 않는다.
import { findBlock } from './module.js';

export const FIRST_RESULTS = ['correct', 'wrong', 'unknown', 'skipped', 'written'];

export const FIRST_LABELS = Object.freeze({
  correct: '맞음',
  wrong: '틀림',
  unknown: '모르겠다',
  skipped: '건너뜀',
  written: '직접 적음',
  none: '기록 없음',
});

// 화면 문구(한 곳에 모아 둔다 — 시험이 '평가가 아님'을 알리는지 본다).
export const UNAIDED_NOTICE = '도움 없이 먼저 해 보는 자리입니다. 시험이나 평가가 아닙니다. 모든 칸에 한 번씩 답하면 힌트와 풀이가 열립니다.';
export const UNAIDED_LOCKED_MESSAGE = '먼저 한 번 풀어 본 뒤에 열립니다. 막혔으면 ‘모르겠다’를 누르면 열립니다.';
export const UNAIDED_OPEN_MESSAGE = '모든 칸에 첫 답을 남겼습니다. 이제 ‘도움’에서 힌트와 풀이를 열 수 있고, 틀린 칸은 다시 풀 수 있습니다.';
export const UNAIDED_UNKNOWN_NOTE = '‘모르겠다’로 남겼습니다. 이제 도움을 열 수 있고, 지금 답해도 됩니다.';
export const UNAIDED_SAMPLE_HELD_NOTE = '예시 답은 모든 칸에 첫 답을 남긴 뒤에 보입니다.';
export const UNAIDED_SUMMARY_NOTE = '첫 답은 그 문제의 힌트와 풀이를 열기 전에 처음 낸 답입니다. 그 뒤에 다시 풀어 맞힌 것은 위의 장면별 상태에 따로 적혀 있습니다. 점수가 아닙니다. 앞의 본문을 다시 보았는지, 종이나 계산기를 썼는지는 이 화면이 알 수 없습니다.';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function isUnaidedBlock(block) {
  return (block?.type === 'problem' || block?.type === 'transfer') && block.unaided === true;
}

export const partKeys = (block) => block.parts.map((p) => `${block.id}#${p.id}`);

export function firstOf(state, key) {
  return state.first?.[key] ?? null;
}

// 첫 답이 남았다고 보는 조건. 이 규칙이 생기기 전에 저장된 진행(first 가 없는데 이미 풀었거나 건너뛴 문항)은
// 첫 답을 되살릴 수 없으므로 '남은 것'으로 쳐서 잠그지 않는다 — 풀 수 없는 칸 때문에 도움이 영영 잠기는 일을 막는다.
function settled(state, key) {
  if (firstOf(state, key)) return true;
  const rec = state.items?.[key];
  return Boolean(rec && (rec.attempts > 0 || rec.solved || rec.skipped));
}

const helpUsed = (state, helpKey) => {
  const help = state.help?.[helpKey];
  return Boolean(help && (help.hints > 0 || help.solution));
};

// 지금 내는 답이 이 부분의 '도움 없는 첫 답'인가. 이미 첫 답이 있거나, 옛 저장 데이터처럼 이미 시도했거나 도움을 연 뒤라면 아니다.
export function isFirstTry(state, key, helpKey) {
  return !settled(state, key) && !helpUsed(state, helpKey);
}

// 부분 하나의 첫 답을 남긴다. 이미 있으면 바꾸지 않는다(첫 답은 한 번뿐이다).
export function noteFirst(state, key, result) {
  if (!FIRST_RESULTS.includes(result) || firstOf(state, key)) return state;
  const next = structuredClone(state);
  next.first = { ...(next.first ?? {}), [key]: result };
  return next;
}

// 여러 부분에 같은 첫 답을 남긴다('모르겠다'·건너뜀). 이미 첫 답이 있는 부분은 그대로 둔다.
export function noteFirstAll(state, keys, result) {
  return keys.reduce((acc, key) => noteFirst(acc, key, result), state);
}

// 도움(힌트·풀이)의 잠금 상태. 도움 없이 먼저 하는 블록이 아니면 { unaided: false, locked: false }.
export function helpGate(mod, state, blockId) {
  const block = findBlock(mod, blockId)?.block;
  if (!isUnaidedBlock(block)) return { unaided: false, locked: false, answered: 0, total: 0, pending: [] };
  const keys = partKeys(block);
  const pending = keys.filter((key) => !settled(state, key));
  // 이미 이 문제의 도움을 연 기록이 있으면(옛 저장 데이터) 다시 잠그지 않는다.
  return { unaided: true, locked: pending.length > 0 && !helpUsed(state, block.id), answered: keys.length - pending.length, total: keys.length, pending };
}

// 틀린 답에 붙는 오개념 설명과 서술형 부분의 예시 답을 미루는가: 도움이 잠겨 있는 동안에는 미룬다(정오만 알려 준다).
// 둘 다 도움이다 — 설명은 다른 부분의 답을, 예시 답은 풀이 방법을 드러낸다.
export function explanationHeld(mod, state, blockId) {
  return helpGate(mod, state, blockId).locked;
}

// '모르겠다': 아직 첫 답이 없는 부분을 모두 unknown 으로 남긴다. { state, keys } — keys 는 이번에 새로 남은 부분.
export function markUnknown(mod, state, blockId) {
  const keys = helpGate(mod, state, blockId).pending;
  return { state: noteFirstAll(state, keys, 'unknown'), keys };
}

// 답 없이 건너뛸 때: 아직 첫 답이 없는 부분은 skipped 가 첫 답으로 남는다(건너뜀 표시 자체는 core/progress.js 의 skipItem 이 한다).
export function markSkippedFirst(mod, state, blockId) {
  const keys = helpGate(mod, state, blockId).pending;
  return { state: noteFirstAll(state, keys, 'skipped'), keys };
}

// 정리 화면용: 도움 없이 먼저 해 본 문제마다 부분별 첫 답과 개수.
export function summarizeFirst(mod, state) {
  const rows = [];
  for (const scene of mod.scenes) {
    for (const block of scene.blocks) {
      if (!isUnaidedBlock(block)) continue;
      const counts = { correct: 0, wrong: 0, unknown: 0, skipped: 0, written: 0, none: 0 };
      const parts = block.parts.map((part) => {
        const result = firstOf(state, `${block.id}#${part.id}`) ?? 'none';
        counts[result] += 1;
        return { key: `${block.id}#${part.id}`, label: part.label, result };
      });
      rows.push({ blockId: block.id, sceneId: scene.id, sceneTitle: scene.title, type: block.type, parts, counts, total: parts.length });
    }
  }
  return rows;
}

// 저장 데이터를 거를 때: 모듈에 있는 문항 키와 정해진 결과 값만 남긴다.
export function sanitizeFirst(raw, validKeys) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (validKeys.has(key) && FIRST_RESULTS.includes(value)) out[key] = value;
  }
  return out;
}
