// 복습 한 회차의 화면: 권하는 카드 → 문항 하나씩(힌트 없음, '모르겠다' 가능) → 답마다 맞음/풀이 → 끝난 뒤 사실만(첫 시도에 맞힌 수·다시 물은 수·다음 일정).
// 언제 권하는지는 data/review.mjs, 한 회차의 규칙은 core/review.js, 일정과 저장은 core/review-plan.js 다. 여기는 보여 주고 누른 것을 전할 뿐이다.
// ui/probe.js 와 같은 모양이다(같은 .probe 글꼴·단추 규칙을 쓴다). 복습의 효과를 말하는 문구, 점수, 평가를 쓰지 않는다.
import { h, uid } from './dom.js';
import { invalidMessage } from '../core/answer.js';
import { gradeReview, sessionDone, REVIEW_TEXT, REVIEW_LABELS } from '../core/review.js';
import { MAX_REVIEW_STEP } from '../data/review.mjs';
import { createAnswerField } from './blocks/answer-field.js';

export function createReviewGate({ planner, rec, announce, onOpen, onClose }) {
  const def = planner.def;
  const el = h('section', { class: 'probe review-gate', 'aria-labelledby': 'review-title', hidden: true, dataset: { gate: 'review' } });
  // 머리말 한 줄: 예정일 전이면 '다음 복습: …', 열 수 있는데 이번 접속에서 미뤘으면 '복습할 수 있습니다: …' 와 단추.
  const lineEl = h('p', { class: 'review-line', hidden: true });
  let active = false;
  let postponed = false; // '나중에' — 이 접속 동안만

  const head = (title) => [h('p', { class: 'eyebrow', text: REVIEW_TEXT.eyebrow }), h('h2', { id: 'review-title', class: 'probe-title', tabindex: '-1', text: title })];
  const focusTitle = () => el.querySelector('#review-title')?.focus({ preventScroll: false });
  const stepNo = () => planner.state.session?.step ?? 1;

  function refreshLine() {
    const plan = planner.compute();
    lineEl.replaceChildren();
    if (active || !plan.item) { lineEl.hidden = true; return; }
    const text = planner.line(plan.item);
    if (plan.item.kind === 'resume') lineEl.append(REVIEW_TEXT.headResume(text));
    else if (def && plan.canOpen) {
      lineEl.append(`${REVIEW_TEXT.headOpen(text)} `, h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => openNow() }, REVIEW_TEXT.start));
    } else lineEl.append(REVIEW_TEXT.headNext(text));
    lineEl.hidden = false;
  }

  function close() {
    active = false;
    el.hidden = true;
    el.replaceChildren();
    refreshLine();
    onClose?.('review');
  }

  function later() { postponed = true; close(); }

  function start() {
    const b = planner.begin();
    if (!b) { close(); return; }
    if (b.resume) rec.reviewOpen();
    else rec.reviewStart({ step: stepNo(), lateDays: b.lateDays, items: def.items.length });
    renderNext({ focus: true });
  }

  function renderOffer() {
    const plan = planner.compute();
    const resume = planner.state.session?.step === plan.item?.step;
    el.dataset.stage = 'offer';
    el.replaceChildren(
      ...head(REVIEW_TEXT.title(plan.item?.step ?? 1)),
      h('p', { class: 'probe-lead', text: REVIEW_TEXT.offer(def.items.length, planner.minutes) }),
      h('p', { class: 'small', text: REVIEW_TEXT.offerRule }),
      h('p', { class: 'small', text: REVIEW_TEXT.laterNote }),
      h('div', { class: 'probe-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', dataset: { action: 'start' }, onClick: () => start() }, resume ? REVIEW_TEXT.resume : REVIEW_TEXT.start),
        h('button', { type: 'button', class: 'btn btn-quiet', dataset: { action: 'later' }, onClick: () => later() }, REVIEW_TEXT.later)));
  }

  function renderNext({ focus = false } = {}) {
    if (sessionDone(planner.state)) { finishNow(); return; }
    const item = planner.currentItem();
    if (!item) { close(); return; }
    const se = planner.state.session;
    const labelId = uid('review-q-');
    const feedback = h('div', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
    const order = planner.optionOrder(`review/${item.id}`, item); // 보기 섞기를 켠 모듈만(아니면 null)
    const field = createAnswerField(item.answer, { labelId, label: item.prompt, order, onEnter: () => submit(), onInput: () => feedback.replaceChildren() });

    function submit() {
      const r = gradeReview(item, field.getValue());
      if (r.result === 'invalid') { feedback.replaceChildren(h('p', { class: 'msg msg-invalid', text: invalidMessage(r.reason, item.answer) })); return; }
      record(item, r.result, r.misconceptionIndex, order);
    }

    el.dataset.stage = 'question';
    el.replaceChildren(
      ...head(`${REVIEW_TEXT.title(se.step)} — ${REVIEW_TEXT.remaining(se.queue.length)}`),
      h('p', { class: 'prompt', id: labelId, dataset: { itemId: item.id }, text: item.prompt }),
      h('div', { class: 'item' }, field.el, feedback),
      h('p', { class: 'small', text: REVIEW_TEXT.askNo((se.asked[item.id] ?? 0) + 1) }),
      h('div', { class: 'probe-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', dataset: { action: 'submit' }, onClick: () => submit() }, REVIEW_TEXT.submit),
        h('button', { type: 'button', class: 'btn', dataset: { action: 'dontknow' }, onClick: () => record(item, 'unknown', -1, order) }, REVIEW_TEXT.unknown),
        h('button', { type: 'button', class: 'btn btn-quiet', dataset: { action: 'stop' }, onClick: () => later() }, '그만 풀기(나중에 이어서)')));
    if (focus) focusTitle();
  }

  // 답 하나를 남기고, 맞음 또는 풀이를 보인다. 풀이는 틀리거나 모른다고 했을 때만 나온다.
  function record(item, result, misconceptionIndex, order = null) {
    const r = planner.answer(item.id, result);
    if (r.attempt === 0) return;
    rec.reviewAnswer({ step: stepNo(), item: item.id, attempt: r.attempt, result, shownOrder: order ?? undefined });
    announce('답을 남겼습니다.');
    const done = sessionDone(planner.state);
    const wrong = result !== 'correct';
    el.dataset.stage = 'feedback';
    el.replaceChildren(
      ...head(`${REVIEW_TEXT.title(stepNo())} — ${REVIEW_TEXT.remaining(planner.state.session.queue.length)}`),
      h('p', { class: 'prompt', dataset: { itemId: item.id }, text: item.prompt }),
      h('p', {}, h('span', { class: 'tag', text: '내 답' }), ' ', h('span', { class: 'outcome', dataset: { outcome: wrong ? 'skipped' : 'correct' }, text: REVIEW_LABELS[result] })),
      wrong
        ? h('div', { class: 'feedback' },
          misconceptionIndex >= 0 && h('p', { class: 'msg msg-why', text: item.misconceptions[misconceptionIndex].feedback }),
          h('p', { class: 'probe-solution' }, h('span', { class: 'tag', text: '풀이' }), ` ${item.feedback}`),
          h('p', { class: 'small', text: r.removed ? REVIEW_TEXT.gaveUp : r.deferred ? REVIEW_TEXT.deferred : REVIEW_TEXT.redo }))
        : h('p', { class: 'msg msg-ok', role: 'status', text: REVIEW_TEXT.correct }),
      h('div', { class: 'probe-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', dataset: { action: done ? 'finish' : 'next' }, onClick: () => (done ? finishNow() : renderNext({ focus: true })) }, done ? REVIEW_TEXT.finish : REVIEW_TEXT.next)));
    focusTitle();
  }

  function finishNow() {
    const res = planner.complete();
    if (!res) { close(); return; }
    renderDone(res);
  }

  function renderDone({ summary, next }) {
    const nextLine = next.item
      ? REVIEW_TEXT.nextLine(planner.line(next.item))
      : summary.step >= MAX_REVIEW_STEP ? REVIEW_TEXT.last : REVIEW_TEXT.noMore;
    el.dataset.stage = 'done';
    el.replaceChildren(
      ...head(REVIEW_TEXT.doneTitle(summary.step)),
      h('p', { class: 'probe-lead', text: REVIEW_TEXT.firstTry(summary.firstTryCorrect, summary.total) }),
      h('p', { text: REVIEW_TEXT.redone(summary.redone) }),
      ...(summary.unresolved > 0 ? [h('p', { text: REVIEW_TEXT.unresolvedLine(summary.unresolved) })] : []),
      h('p', { class: 'measure-line', text: nextLine }),
      h('div', { class: 'probe-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', dataset: { action: 'leave' }, onClick: () => close() }, REVIEW_TEXT.leave)));
    focusTitle();
  }

  function open({ direct = false } = {}) {
    if (!def || active) return false;
    active = true;
    el.hidden = false;
    lineEl.hidden = true;
    onOpen?.('review');
    if (direct) start(); else renderOffer();
    return true;
  }

  function openNow() {
    postponed = false;
    if (!planner.openable()) return false;
    return open({ direct: true });
  }

  return {
    el, lineEl, refreshLine, openNow,
    isOpen: () => active,
    // 화면을 처음 열 때: 열 수 있는 복습이 있으면 본문보다 먼저 권한다(며칠 뒤 문항을 먼저 권했다면 그것이 닫힌 뒤에). 권했으면 true.
    openAtLoad() {
      if (postponed || !planner.openable()) return false;
      return open();
    },
    // '처음부터'를 누른 경우처럼 아무것도 남기지 않고 닫는다.
    cancel() { if (active) { active = false; el.hidden = true; el.replaceChildren(); } postponed = false; refreshLine(); },
  };
}
