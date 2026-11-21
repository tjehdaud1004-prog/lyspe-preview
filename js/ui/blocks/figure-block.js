import { h } from '../dom.js';
import { createFigure } from '../figure.js';
import { figureState } from '../../core/figure-state.js';
import { MASKED_NOTE, REVEALED_NOTE } from '../../core/reveal.js';

// 그림 블록. revealAfter 가 있으면 그 문항이 풀리기 전에는 표시점의 값을 가리고, 풀리면 다시 그린다(규칙: core/reveal.js).
export function renderFigureBlock(ctx, block) {
  const def = ctx.mod.figures[block.figure];
  let state = figureState(ctx.mod, block, ctx.session.progress);
  const figure = createFigure(def, state.alt, { masked: state.masked, base: `modules/${ctx.mod.id}/`, inline: true });
  // 안내 줄을 알림 영역(aria-live)으로 둔다: 값이 열리면 이 줄의 글이 바뀐다. 화면 읽기 프로그램이 실제로 읽는지는 확인하지 못했다.
  const note = block.revealAfter ? h('p', { class: 'small fig-note', role: 'status', 'aria-live': 'polite', text: state.masked ? MASKED_NOTE : REVEALED_NOTE }) : null;
  const el = h('div', { class: 'block block-figure', dataset: { blockId: block.id } }, figure.el, note);
  return {
    el, blockId: block.id, resolved: () => true,
    drawIn: () => figure.drawIn?.() ?? null, // 그려지듯 나오기(reader.js 가 처음 나올 때 한 번 부른다)
    refresh() {
      if (!block.revealAfter) return;
      const next = figureState(ctx.mod, block, ctx.session.progress);
      if (next.masked === state.masked) return;
      state = next;
      figure.update({ alt: state.alt, masked: state.masked });
      note.textContent = state.masked ? MASKED_NOTE : REVEALED_NOTE;
    },
    focus() {},
  };
}
