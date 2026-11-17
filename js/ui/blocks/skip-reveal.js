// 건너뛴 문항의 접힌 ‘정답과 풀이 보기’(SPEC_KINDS.md 8절의 결함 1). 무엇을 보일지는 core/solution-reveal.js 가 정한다.
// 여는 것은 문항 상태를 바꾸지 않는다(건너뜀 그대로) — 도움 서랍의 ‘풀이 보기’와 다르다. 처음 열었을 때만 help_open{kind:'skipped_solution'} 을 남긴다.
import { h } from '../dom.js';
import { skippedReveal, SKIP_REVEAL_TEXT } from '../../core/solution-reveal.js';

// locked: 도움 없이 먼저 하는 자리에서 첫 답이 남기 전에는 정답을 보이지 않는다(core/unaided.js). 건너뛰면 첫 답이 남아 풀리므로 보통은 닫혀 있다.
export function createSkipReveal(ctx, block, { locked = () => false } = {}) {
  const el = h('div', { class: 'skip-reveal', hidden: true });
  let signature = '';
  let reported = false;

  function refresh() {
    const reveal = locked() ? null : skippedReveal(block, ctx.session.progress);
    const next = JSON.stringify(reveal);
    if (next === signature) return; // 다른 문항이 바뀔 때마다 다시 그리지 않는다(열어 둔 것이 닫히지 않게)
    signature = next;
    if (!reveal) { el.hidden = true; el.replaceChildren(); return; }
    const answers = reveal.rows.length === 1 && reveal.rows[0].label === null
      ? [h('p', { class: 'skip-reveal-answer' }, h('span', { class: 'tag', text: SKIP_REVEAL_TEXT.answerHead }), ` ${reveal.rows[0].text}`)]
      : [h('ol', { class: 'skip-reveal-list' }, ...reveal.rows.map((r) => h('li', {}, h('span', { class: 'skip-reveal-label', text: r.label }), ' — ', h('span', { class: 'tag', text: SKIP_REVEAL_TEXT.answerHead }), ` ${r.text}`)))];
    const details = h('details', { class: 'skip-reveal-details' },
      h('summary', { class: 'skip-reveal-summary', dataset: { action: 'reveal-solution' }, text: SKIP_REVEAL_TEXT.open }),
      h('div', { class: 'skip-reveal-body' },
        ...answers,
        reveal.solution && h('div', { class: 'solution' }, h('p', { class: 'tag', text: SKIP_REVEAL_TEXT.solutionHead }), h('p', { text: reveal.solution }))));
    details.addEventListener('toggle', () => {
      if (!details.open || reported) return;
      reported = true;
      ctx.rec.helpOpen({ blockId: block.id, helpKey: block.id, kind: 'skipped_solution', progress: ctx.session.progress });
    });
    el.replaceChildren(h('p', { class: 'msg msg-note', role: 'status', text: SKIP_REVEAL_TEXT.note }), details);
    el.hidden = false;
  }

  refresh();
  return { el, refresh };
}
