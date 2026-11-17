// 건너뛴 문항에 정답과 풀이를 닿게 한다(SPEC_KINDS.md 8절의 결함 1).
// '건너뛰기'를 누르면 문항 상태는 skipped 가 되는데, 지금까지는 그 뒤에 정답과 풀이를 볼 길이 도움 서랍의 '풀이 보기'뿐이었고
// 그것은 상태를 '풀이를 본 뒤'로 바꾼다. 여기서 정하는 것은 상태를 바꾸지 않고 보이는 접힌 '정답과 풀이 보기'의 내용이다.
// 순수 판정이다 — 그리기는 ui/blocks/skip-reveal.js, 열었다는 기록은 help_open{kind:'skipped_solution'}.
import { answerText } from './answer.js';
import { itemOutcome } from './progress.js';

export const SKIP_REVEAL_TEXT = Object.freeze({
  note: '건너뛰었습니다. 정답과 풀이는 아래에 있습니다.',
  open: '정답과 풀이 보기',
  answerHead: '정답',
  solutionHead: '풀이',
});

/**
 * 건너뛴 채 풀지 않은 문항(check)이나 부분(problem·transfer)의 정답과 풀이. 없으면 null.
 * 돌려주는 것: { rows: [{ key, label(문제의 부분 제목, 확인 문항은 null), text(정답을 글로) }], solution }.
 * 건너뛴 뒤 맞힌 것, 풀이를 이미 연 것(도움 서랍에서 본 것)은 뺀다.
 */
export function skippedReveal(block, progress) {
  if (block?.type === 'check') {
    if (itemOutcome(progress, block.id, block.id) !== 'skipped') return null;
    return { rows: [{ key: block.id, label: null, text: answerText(block.answer) }], solution: block.solution ?? '' };
  }
  if (block?.type === 'problem' || block?.type === 'transfer') {
    const rows = block.parts
      .filter((p) => itemOutcome(progress, `${block.id}#${p.id}`, block.id) === 'skipped')
      .map((p) => ({ key: `${block.id}#${p.id}`, label: p.label, text: answerText(p.answer) }));
    return rows.length === 0 ? null : { rows, solution: block.solution ?? '' };
  }
  return null;
}
