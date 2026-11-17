// 확인 문항: 문항 하나, 도움 사다리는 블록 하나가 가진다.
import { h, uid } from '../dom.js';
import { isResolved } from '../../core/progress.js';
import { createGradedItem } from './graded-item.js';
import { helpButton, skipButton } from './help-button.js';
import { createSkipReveal } from './skip-reveal.js';

export function renderCheck(ctx, block) {
  const labelId = uid('q-');
  const item = createGradedItem(ctx, { key: block.id, helpKey: block.id, answer: block.answer, misconceptions: block.misconceptions, labelId, label: block.prompt, explain: block.solution, skipNote: false, fixedOrder: block.fixedOrder === true });
  const reveal = createSkipReveal(ctx, block); // 건너뛰면 그 자리에 접힌 ‘정답과 풀이 보기’
  const el = h('div', { class: 'block block-check', dataset: { blockId: block.id } },
    h('p', { class: 'eyebrow', text: '확인 문항' }),
    h('p', { class: 'prompt', id: labelId, text: block.prompt }),
    item.el,
    reveal.el,
    h('div', { class: 'block-actions' }, helpButton(ctx, { blockId: block.id, helpKey: block.id }), skipButton(ctx, [block.id])));
  return {
    el, blockId: block.id,
    resolved: () => isResolved(ctx.session.progress, block.id, block.id),
    refresh: () => { item.refresh(); reveal.refresh(); },
    focus: () => item.focus(),
  };
}
