// 연결 단계(link): 구하려는 것·알고 있는 것을 먼저 보이고, 단계 카드를 '앞 결과 → 다음 입력' 화살표로 잇는다.
//  show     : 모든 단계의 결과와 이유를 보여 준다.
//  complete : 빈칸이 있는 단계는 그 칸을 학습자가 채운다. 무엇을 언제 보이고 가리는지는 core/link.js 의 linkView 가 정한다
//             (앞 단계의 빈칸이 남으면 뒤 단계 잠금, 결과 칸을 풀기 전에는 결과·이유 숨김, 이유 칸은 결과를 보인 채로 묻는다).
//             이 파일은 그 판정을 화면에 옮기기만 한다 — 규칙을 여기서 다시 만들지 않는다.
import { h, svg, uid } from '../dom.js';
import { isResolved } from '../../core/progress.js';
import { blankEntries, linkView, linkStage } from '../../core/link.js';
import { createGradedItem } from './graded-item.js';
import { helpButton, skipButton } from './help-button.js';

const EYEBROW = {
  show: '연결해서 풀기 (연결 보기)',
  complete: '연결해서 풀기 (빈칸 채우기)',
  build: '연결해서 풀기 (스스로 세우기)',
};

function arrow(nextLabel) {
  const icon = svg('svg', { class: 'arrow-icon', width: 20, height: 28, viewBox: '0 0 20 28', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: 'M10 2 V22 M4 16 L10 23 L16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return h('div', { class: 'arrow' }, icon, h('span', { class: 'arrow-text' }, '이 단계의 결과가 다음 단계의 입력이 된다 → ', h('strong', { text: nextLabel })));
}

export function renderLink(ctx, block) {
  const complete = block.mode === 'complete';
  const entries = complete ? blankEntries(block) : [];
  const isDone = (key) => isResolved(ctx.session.progress, key, key);
  const items = new Map(); // 빈칸 키 → 채점 항목

  const stepEls = block.steps.map((step, i) => {
    const n = i + 1;
    const labelId = uid('link-');
    const resultBody = h('div', { class: 'result' });
    const whyBody = h('div', { class: 'why' });
    const gives = () => h('p', { class: 'step-gives' }, h('span', { class: 'tag', text: '결과' }), ' ', h('span', { class: 'math', text: step.gives }));
    const why = () => h('p', { class: 'step-why' }, h('span', { class: 'tag tag-why', text: '이유' }), ` ${step.why}`);

    const blankEls = entries.filter((e) => e.stepIndex === i).map(({ key, blank }) => {
      const promptId = uid('link-q-');
      const item = createGradedItem(ctx, { key, helpKey: key, answer: blank.answer, misconceptions: blank.misconceptions, labelId: promptId, label: blank.prompt, fixedOrder: blank.fixedOrder === true });
      items.set(key, item);
      return {
        field: blank.field,
        el: h('div', { class: 'blank', dataset: { field: blank.field } },
          h('p', { class: 'blank-prompt', id: promptId, text: blank.prompt }),
          item.el,
          h('div', { class: 'block-actions' }, helpButton(ctx, { blockId: block.id, helpKey: key, itemKey: key, label: '이 칸 도움' }))),
      };
    });
    // 카드 안의 순서: 제목 → 빈칸들(적힌 차례) → 이유. 결과 글은 결과 칸 바로 아래에 둔다(결과 칸이 없으면 제목 아래).
    const hasGivesBlank = blankEls.some((b) => b.field === 'gives');
    const body = h('div', { class: 'step-body' },
      h('p', { class: 'step-label', id: labelId, text: `${n}단계. ${step.label}` }),
      !hasGivesBlank && resultBody,
      blankEls.map((b) => (b.field === 'gives' ? [b.el, resultBody] : b.el)),
      whyBody);
    const lockedNote = h('p', { class: 'step-locked', text: `${n}단계. 앞 단계의 빈칸을 채우면 열립니다.` });
    const next = i < block.steps.length - 1 ? arrow(block.steps[i + 1].label) : null;

    const shown = { gives: null, why: null };
    const apply = (view) => {
      body.hidden = view.locked;
      lockedNote.hidden = !view.locked;
      blankEls.forEach((b, bi) => { b.el.hidden = view.blanks[bi].state === 'waiting' || view.blanks[bi].state === 'locked'; });
      // 글은 보임 여부가 바뀔 때만 다시 만든다 — 다른 칸이 바뀔 때마다 화면 읽기 프로그램이 다시 읽지 않게.
      if (shown.gives !== view.showGives) { shown.gives = view.showGives; resultBody.replaceChildren(...(view.showGives ? [gives()] : [])); }
      if (shown.why !== view.showWhy) { shown.why = view.showWhy; whyBody.replaceChildren(...(view.showWhy ? [why()] : [])); }
      if (next) next.hidden = !view.showArrow;
    };

    const card = h('li', { class: `link-step${blankEls.length > 0 ? ' has-blank' : ''}`, dataset: { stepId: step.id } },
      h('div', { class: 'step-card' },
        h('div', { class: 'step-head' }, h('span', { class: 'step-no', 'aria-hidden': 'true', text: String(n) }), h('div', { class: 'step-main' }, lockedNote, body))),
      next);
    return { card, apply };
  });

  const render = () => {
    const view = linkView(block, isDone);
    stepEls.forEach((s, i) => s.apply(view[i]));
    return view;
  };
  render();

  const allKeys = entries.map((e) => e.key);
  const el = h('div', { class: 'block block-link', dataset: { blockId: block.id, stage: linkStage(block) } },
    h('p', { class: 'eyebrow', text: EYEBROW[linkStage(block)] }),
    h('dl', { class: 'goal' },
      h('div', { class: 'goal-row' }, h('dt', { text: '구하려는 것' }), h('dd', { text: block.goal })),
      h('div', { class: 'goal-row' }, h('dt', { text: '알고 있는 것' }), h('dd', { class: 'math', text: block.given }))),
    h('ol', { class: 'chain' }, ...stepEls.map((s) => s.card)),
    complete && h('div', { class: 'block-actions' }, skipButton(ctx, allKeys, '남은 빈칸 건너뛰기')));

  return {
    el, blockId: block.id,
    resolved: () => allKeys.every(isDone),
    refresh: () => { items.forEach((item) => item.refresh()); render(); },
    focus: () => {
      const active = linkView(block, isDone).flatMap((v) => v.blanks).find((b) => b.state === 'active');
      if (active) items.get(active.key).focus();
    },
  };
}
