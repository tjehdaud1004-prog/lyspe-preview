// 끝 화면의 '복습 일정' 구역: 다음 복습의 날짜·시각·분량, 그 뒤 예상 날짜, 시각 고르기, 복습 받지 않기 스위치, 이미 한 회차.
// 사실만 적는다 — 복습의 효과나 점수를 말하지 않는다. 언제 복습하는지의 규칙은 data/review.mjs, 저장과 기록은 core/review-plan.js.
import { h, uid } from './dom.js';
import { dayLabelKo, snapTime, validTime, TIME_STEP_MIN, MAX_REVIEW_STEP } from '../data/review.mjs';
import { REVIEW_TEXT } from '../core/review.js';

export const SCHEDULE_TEXT = Object.freeze({
  title: '복습 일정',
  previewNote: '앞 복습을 한 날에 따라 달라집니다.',
  timeLabel: '복습 시각',
  timeHint: `${TIME_STEP_MIN}분 단위로 고릅니다. 고르지 않으면 모듈을 끝낸 시각을 30분 단위로 내린 시각입니다. 시각은 권하는 것이고 잠그는 것이 아닙니다. 예정일 당일부터 복습할 수 있습니다.`,
  timeDefault: '기본 시각으로',
  off: '복습 받지 않기',
  offHint: '켜면 복습 일정과 복습 기록, 일정 내보내기가 모두 멈춥니다. 언제든 다시 받을 수 있습니다.',
  disabled: '복습 받기를 껐습니다. 복습 일정과 기록, 일정 내보내기가 멈춰 있습니다.',
  enable: '복습 받기 켜기',
  noItems: REVIEW_TEXT.noItemsNote,
  unfinished: '모듈을 끝까지 하면 복습 일정이 생깁니다.',
  allDone: `정해진 복습 ${MAX_REVIEW_STEP}회차를 모두 했습니다.`,
  noMore: REVIEW_TEXT.noMore,
  startNow: '지금 복습하기',
  doneRow: (d) => `복습 ${d.step}회차: ${dayLabelKo(d.date)} 했음 · 첫 시도에 맞힌 문제 ${d.firstTry.correct} / ${d.firstTry.total}`,
});

/** 이미 한 회차의 줄(날짜는 기기의 지역 날짜). */
export function doneRows(planner) {
  return planner.state.done.map((d) => SCHEDULE_TEXT.doneRow({ ...d, date: planner.dateOf(d.doneAt) }));
}

/**
 * 일정 구역. 스스로 다시 그린다(시각·스위치를 바꾸면 일정이 바뀌므로).
 *  planner: core/review-plan.js   onStart: '지금 복습하기'(없으면 단추를 두지 않는다)   onChange: 일정이 바뀌었을 때(머리말 한 줄을 다시 그리게)
 *  withTitle: 구역 제목(h3)을 붙일지
 */
export function scheduleBox({ planner, onStart, onChange, withTitle = true }) {
  const box = h('div', { class: 'schedule' });

  function render() {
    const plan = planner.compute();
    const timeId = uid('review-time-');
    const offId = uid('review-off-');
    const nodes = [withTitle && h('h4', { class: 'measure-sub', text: SCHEDULE_TEXT.title })];

    if (!plan.enabled) {
      nodes.push(
        h('p', { class: 'measure-line', text: SCHEDULE_TEXT.disabled }),
        h('div', { class: 'end-actions' }, h('button', { type: 'button', class: 'btn', onClick: () => { planner.setEnabled(true); changed(); } }, SCHEDULE_TEXT.enable)));
      box.replaceChildren(...nodes.filter(Boolean));
      return;
    }

    const rows = doneRows(planner);
    if (plan.item) {
      nodes.push(h('p', { class: 'measure-line' }, h('strong', { text: `${planner.label(plan.item)}: ` }), planner.line(plan.item)));
      if (plan.preview.length > 0) {
        nodes.push(h('p', { class: 'small', text: `그 뒤 예상: ${plan.preview.map((p) => dayLabelKo(p.date)).join(' · ')} — ${SCHEDULE_TEXT.previewNote}` }));
      }
      if (!plan.hasReviewItems && plan.item.kind === 'review') nodes.push(h('p', { class: 'small', text: SCHEDULE_TEXT.noItems }));
      if (onStart && plan.canOpen && plan.hasReviewItems && plan.item.kind === 'review') {
        nodes.push(h('div', { class: 'end-actions' }, h('button', { type: 'button', class: 'btn', dataset: { action: 'review-start' }, onClick: () => onStart?.() }, SCHEDULE_TEXT.startNow)));
      }
    } else if (planner.state.done.length >= MAX_REVIEW_STEP) {
      nodes.push(h('p', { class: 'measure-line', text: SCHEDULE_TEXT.allDone }));
    } else {
      nodes.push(h('p', { class: 'measure-line', text: plan.finished ? SCHEDULE_TEXT.noMore : SCHEDULE_TEXT.unfinished }));
    }
    if (rows.length > 0) nodes.push(h('ul', { class: 'review-done' }, ...rows.map((t) => h('li', { class: 'small', text: t }))));

    const input = h('input', {
      type: 'time', id: timeId, class: 'input input-time', step: String(TIME_STEP_MIN * 60), value: planner.state.timeOfDay ?? plan.item?.time ?? '',
      onChange: (e) => {
        const snapped = snapTime(e.target.value);
        if (snapped === null || !validTime(snapped)) { e.target.value = planner.state.timeOfDay ?? plan.item?.time ?? ''; return; }
        planner.setTimeOfDay(snapped);
        changed();
      },
    });
    nodes.push(
      h('div', { class: 'setting' },
        h('label', { for: timeId, class: 'setting-label', text: SCHEDULE_TEXT.timeLabel }), ' ', input, ' ',
        planner.state.timeOfDay !== null && h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => { planner.setTimeOfDay(null); changed(); } }, SCHEDULE_TEXT.timeDefault),
        h('p', { class: 'small', text: SCHEDULE_TEXT.timeHint })),
      h('div', { class: 'setting' },
        h('label', { class: 'check-row', for: offId },
          h('input', { type: 'checkbox', role: 'switch', id: offId, checked: false, onChange: (e) => { if (e.target.checked) { planner.setEnabled(false); changed(); } } }),
          h('span', { text: SCHEDULE_TEXT.off })),
        h('p', { class: 'small', text: SCHEDULE_TEXT.offHint })));
    box.replaceChildren(...nodes.filter(Boolean));
  }

  function changed() { render(); onChange?.(); }

  render();
  return { el: box, render };
}

/** 끝 화면에 더하는 노드들(measureSections 와 같은 모양). 복습 일정이 없는 모듈이어도 일정 구역은 나온다. */
export function reviewSections({ planner, onStart, onChange }) {
  const { el } = scheduleBox({ planner, onStart, onChange });
  return [h('div', { class: 'measure' }, el)];
}
