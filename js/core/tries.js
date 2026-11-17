// 다시 시도의 규칙. 순수 함수 — DOM 을 모른다.
//
//  · 보기 문항: 틀린 것으로 확인된 보기는 진행 상태(items[key].tried)에 남고, 다시 낼 수 없다.
//    그래서 보기가 n개인 문항은 많아야 n번째 제출에서 맞는다 — '맞혔다'만으로는 알고 맞힌 것과 남은 보기를 고른 것을 가를 수 없다.
//  · 그래서 '스스로 해결'(도움 없이 맞힘) 안을 셋으로 가른다:
//      first      첫 제출에 맞힘
//      retried    한 번 이상 틀린 뒤 맞힘
//      after-skip 건너뛴 뒤(뒤 내용을 본 뒤) 돌아와 첫 제출에 맞힘
//    이 구분은 관찰한 제출 기록일 뿐이며, 이해했는지를 뜻하지 않는다.
//  · 다시 시도 사이에 기다리게 하거나 횟수를 막는 규칙은 두지 않았다(근거 없음).
import { recordAttempt, itemOutcome } from './progress.js';
import { gradables } from './module.js';

const MAX_TRIED = 20;

export const TRY_KINDS = ['first', 'retried', 'after-skip'];
export const TRY_LABELS = Object.freeze({ first: '첫 시도', retried: '여러 번 만에', 'after-skip': '건너뛴 뒤' });

export const REPEAT_CHOICE_MESSAGE = '이미 골랐던 보기입니다. 다른 보기를 골라 주세요.';
export const WRONG_MESSAGE = '아직 맞지 않습니다. 다시 시도할 수 있습니다.';
export const RETRIED_SUMMARY_NOTE = '보기 문항은 틀린 보기를 다시 고를 수 없어서, ‘여러 번 만에’ 맞힌 것은 남은 보기에서 고른 결과일 수 있습니다. ‘첫 시도’도 제출 기록일 뿐, 얼마나 이해했는지를 나타내지 않습니다.';

// 이 문항에서 이미 틀린 것으로 확인된 보기 id 들(보기 목록에 있고 정답이 아닌 것만).
export function triedChoices(rec, answer) {
  if (answer?.kind !== 'choice' || !Array.isArray(rec?.tried)) return [];
  const ids = new Set(answer.options.map((o) => o.id));
  return [...new Set(rec.tried)].filter((id) => ids.has(id) && id !== answer.value);
}

export function isTriedChoice(rec, answer, id) {
  return triedChoices(rec, answer).includes(String(id ?? ''));
}

// 아직 고를 수 있는 보기 id 들(보기 순서 그대로).
export function remainingChoices(rec, answer) {
  if (answer?.kind !== 'choice') return [];
  const tried = triedChoices(rec, answer);
  return answer.options.map((o) => o.id).filter((id) => !tried.includes(id));
}

// 보기 문항에서 틀렸을 때의 안내. remaining: 이번 오답을 뺀 뒤 남은 보기 수.
export function wrongChoiceMessage(remaining) {
  if (remaining <= 1) return '이 보기는 맞지 않습니다. 남은 보기는 하나입니다. 고르기 전에, 왜 그 보기가 맞는지 먼저 생각해 보세요.';
  return `이 보기는 맞지 않습니다. 고른 보기는 다시 고를 수 없습니다. 남은 보기 ${remaining}개에서 골라 보세요.`;
}

// 제출 한 번을 진행 상태에 반영한다: recordAttempt 에 더해
//  · 보기 문항의 오답이면 그 보기를 tried 에 남기고
//  · 건너뛴 문항을 맞혔으면 afterSkip 을 남긴다.
// answer 를 주지 않으면 recordAttempt 와 같다. answer 말고 받은 필드는 모두 recordAttempt 에 그대로 넘긴다
// (recordAttempt 가 받는 값이 늘어나도 여기서 떨어뜨리지 않게).
export function submitAttempt(state, { answer = null, ...attempt }) {
  const { key, result, value = '' } = attempt;
  const before = state.items[key];
  const next = recordAttempt(state, attempt);
  const rec = next.items[key]; // recordAttempt 가 새로 만든 사본이라 여기서 고쳐도 원본은 그대로다
  if (before?.solved) return next;
  if (answer?.kind === 'choice' && result === 'wrong') {
    const id = String(value);
    if (answer.options.some((o) => o.id === id) && id !== answer.value) {
      rec.tried = [...new Set([...(Array.isArray(rec.tried) ? rec.tried : []), id])].slice(0, MAX_TRIED);
    }
  }
  if (result === 'correct' && before?.skipped === true) rec.afterSkip = true;
  return next;
}

// 스스로 맞힌 문항의 시도 구분. 스스로 맞힌 것이 아니면(힌트·풀이 뒤, 건너뜀, 아직 안 풂, 자유 서술) null.
export function tryKind(rec, outcome) {
  if (outcome !== 'correct' || !rec?.solved) return null;
  if (rec.wrong > 0) return 'retried';
  return rec.afterSkip === true ? 'after-skip' : 'first';
}

// 문항 옆 배지의 글. 스스로 맞힌 경우에만 시도 구분을 덧붙인다.
export function solvedBadge(rec, outcome, outcomeLabel) {
  const kind = tryKind(rec, outcome);
  if (kind === null) return outcomeLabel;
  if (kind === 'retried') return `${outcomeLabel} · ${rec.wrong + 1}번째 시도`;
  return `${outcomeLabel} · ${TRY_LABELS[kind]}`;
}

// 맞힌 뒤에 '왜 이 답인가'(그 문항의 풀이)를 보일 것인가: 한 번 이상 틀린 뒤 맞혔고, 아직 풀이를 본 적이 없을 때만.
// 첫 시도에 맞힌 학습자에게 긴 설명을 밀어 넣지 않는다.
export function showsExplanation(rec, outcome) {
  return Boolean(rec?.solved) && rec.wrong > 0 && (outcome === 'correct' || outcome === 'hinted-correct');
}

// 장면별 '스스로' 안의 시도 구분 개수: { [sceneId]: { first, retried, 'after-skip' } }
export function summarizeTries(mod, state) {
  const out = {};
  for (const scene of mod.scenes) out[scene.id] = { first: 0, retried: 0, 'after-skip': 0 };
  for (const g of gradables(mod)) {
    const kind = tryKind(state.items[g.key], itemOutcome(state, g.key, g.helpKey));
    if (kind !== null) out[g.sceneId][kind] += 1;
  }
  return out;
}

// 정리 화면 '자세히' 칸에서 '스스로 n' 뒤에 붙이는 글: "(첫 시도 2, 여러 번 만에 1)". 없으면 ''.
export function selfBreakdown(tries) {
  if (!tries) return '';
  const parts = TRY_KINDS.filter((k) => tries[k] > 0).map((k) => `${TRY_LABELS[k]} ${tries[k]}`);
  return parts.length > 0 ? `(${parts.join(', ')})` : '';
}
