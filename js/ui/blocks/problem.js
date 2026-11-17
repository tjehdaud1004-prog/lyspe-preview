// 문제(problem)와 전이 문제(transfer): 여러 부분으로 이루어지며, 도움 사다리는 문제 전체가 공유한다.
import { h, uid } from '../dom.js';
import { isResolved } from '../../core/progress.js';
import { conditionFor } from '../../core/module.js';
import { createGradedItem } from './graded-item.js';
import { helpButton, skipButton } from './help-button.js';
import { isUnaidedBlock, explanationHeld } from '../../core/unaided.js';
import { createUnaidedUi } from './unaided.js';
import { createSkipReveal } from './skip-reveal.js';

export function renderProblem(ctx, block) {
  const transfer = block.type === 'transfer';
  const keyOf = (part) => `${block.id}#${part.id}`;
  // 도움 없이 먼저 하는 자리(block.unaided): 모든 부분에 첫 답이 남기 전에는 힌트·풀이·오개념 설명이 열리지 않는다(core/unaided.js).
  const unaided = isUnaidedBlock(block) ? { locked: () => explanationHeld(ctx.mod, ctx.session.progress, block.id) } : null;
  const items = block.parts.map((part) => {
    const labelId = uid('part-');
    const item = createGradedItem(ctx, { key: keyOf(part), helpKey: block.id, answer: part.answer, misconceptions: part.misconceptions, labelId, label: part.label, unaided, skipNote: false, fixedOrder: part.fixedOrder === true });
    return { part, item, labelId };
  });
  const condition = conditionFor(ctx.mod, block.id);
  const first = unaided && createUnaidedUi(ctx, block);
  const reveal = createSkipReveal(ctx, block, { locked: () => Boolean(unaided?.locked()) }); // 건너뛴 부분의 정답과 풀이(접힘)

  const el = h('div', { class: `block block-problem${transfer ? ' block-transfer' : ''}`, dataset: { blockId: block.id } },
    h('p', { class: 'eyebrow', text: transfer ? '다른 상황으로 옮기기' : '문제' }),
    first && first.notice,
    first && first.offers,
    h('p', { class: 'prompt', text: block.prompt }),
    condition && h('p', { class: 'condition-line' }, h('span', { class: 'tag', text: '조건' }), ` ${condition}`),
    h('ol', { class: 'parts' }, ...items.map(({ part, item, labelId }) =>
      h('li', { class: 'part' }, h('p', { class: 'part-label', id: labelId, text: part.label }), item.el))),
    reveal.el,
    h('div', { class: 'block-actions' },
      helpButton(ctx, { blockId: block.id, helpKey: block.id }),
      first && first.unknownBtn,
      first ? first.skipBtn : skipButton(ctx, block.parts.map(keyOf), '이 문제 건너뛰기')));

  return {
    el, blockId: block.id,
    resolved: () => block.parts.every((p) => isResolved(ctx.session.progress, keyOf(p), block.id)),
    refresh: () => { items.forEach(({ item }) => item.refresh()); first?.refresh(); reveal.refresh(); },
    focus: () => items[0].item.focus(),
  };
}
