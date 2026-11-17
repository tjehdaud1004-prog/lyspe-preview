// 여는 카드의 화면(core/opener.js): 본문 앞 첫 카드 하나. 상황 그림이 먼저 혼자 보이고, 곧 질문과 보기가 나온다. 고르면 맞다 · 틀리다를 말하지 않고 '시작' 단추가 나온다.
// 끝 화면의 다시 보기 카드(openerRevisitCard)는 같은 그림과 질문을 다시 보이고, 이번에는 정답과 까닭을 보인다.
// 언제 보이고 무엇이 남는지는 core/opener.js 의 규칙이고, 여기는 보여 주고 누른 것을 전할 뿐이다.
import { h, uid } from './dom.js';
import { renderFigure } from './figure.js';
import { hasProgress } from '../core/progress.js';
import { optionOrder } from '../core/shuffle.js';
import {
  openerDef, openerGateFor, openerBypassesGates, openerRevisitFor, gradeOpener, optionLabel, answerOpener, revisitOpener, closeOpener, OPENER_TEXT,
} from '../core/opener.js';

const REVEAL_MS = 900; // 그림이 먼저 혼자 보이는 시간(움직임을 줄이는 설정이면 바로 보인다)

// 보기 단추들(고르기 하나). order: 보기를 보일 차례(id 배열) 또는 null. 고르면 onPick(id).
function choiceButtons(def, { labelId, order, onPick }) {
  const shown = Array.isArray(order) ? order.map((id) => def.answer.options.find((o) => o.id === id)).filter(Boolean) : def.answer.options;
  const buttons = shown.map((o) => h('button', {
    type: 'button', class: 'btn opener-choice', 'aria-pressed': 'false', dataset: { action: 'opener-choice', value: o.id }, onClick: () => onPick(o.id),
  }, o.label));
  const lock = (pickedId) => buttons.forEach((b) => { b.disabled = true; const on = b.dataset.value === pickedId; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('is-picked', on); });
  return { el: h('div', { class: 'opener-choices', role: 'group', 'aria-labelledby': labelId }, buttons), lock };
}

export function createOpenerGate({ mod, session, rec, announce, onOpen, onClose }) {
  const el = h('section', { class: 'probe opener-gate', 'aria-label': '시작 전 질문', hidden: true, dataset: { gate: 'opener' } });
  let active = false;
  let merged = null;    // 기록 안내를 합친 카드일 때의 { text, acknowledge }
  let settled = false;  // 안내를 본 것으로 저장했는가
  let recordBox = null;
  let timer = null;

  // 기록 동의를 저장한다(처음 답이 기록되기 전에 — 같은 카드에서 기록을 켠 사람의 첫 답이 버려지지 않게). 그 뒤 체크를 바꾸면 곧바로 다시 저장한다.
  function settleNotice() {
    if (!merged || settled) return;
    settled = true;
    merged.acknowledge(recordBox?.checked === true);
  }

  function close(kind) {
    active = false;
    merged = null;
    settled = false;
    clearTimeout(timer);
    el.hidden = true;
    el.replaceChildren();
    onClose?.(kind);
  }

  function render() {
    const def = openerDef(mod);
    const labelId = uid('opener-q-');
    const order = optionOrder(mod, session.progress, 'opener', def);
    let answered = false;

    const start = h('button', { type: 'button', class: 'btn btn-primary', hidden: true, dataset: { action: 'start' }, onClick: () => { settleNotice(); close('start'); } }, OPENER_TEXT.start);
    const note = h('p', { class: 'small opener-note', text: def.note ?? OPENER_TEXT.note });
    const choices = choiceButtons(def, {
      labelId, order,
      onPick(id) {
        if (answered) return;
        answered = true;
        settleNotice();
        const r = gradeOpener(mod, id);
        session.update((s) => answerOpener(s, id, r.result, session.now()));
        rec.openerAnswer({ chosen: id, result: r.result, misconceptionIndex: r.misconceptionIndex, shownOrder: order ?? undefined });
        choices.lock(id);
        start.hidden = false;
        el.dataset.stage = 'answered';
        announce(`답을 남겼습니다. ${note.textContent}`);
        start.focus({ preventScroll: true });
      },
    });
    const skipLink = h('button', { type: 'button', class: 'btn btn-quiet opener-skip', dataset: { action: 'skip-link' }, onClick: () => {
      settleNotice();
      session.update((s) => closeOpener(s, 'skipped', session.now()));
      close('link');
    } }, OPENER_TEXT.skipLink);
    // 기록 안내(동의 글 + 체크)는 '자세히' 안에 둔다(문구는 그대로, 접기만). 체크를 바꾸면 곧바로 저장한다.
    const more = merged && h('details', { class: 'probe-more opener-more' },
      h('summary', { dataset: { action: 'opener-more' }, text: OPENER_TEXT.more }),
      h('div', { class: 'probe-record' },
        h('p', { class: 'small', text: merged.text }),
        h('label', { class: 'probe-record-row' }, recordBox = h('input', { type: 'checkbox', dataset: { action: 'record-on' }, onChange: () => merged?.acknowledge(recordBox.checked === true) }), h('span', { text: '학습 기록 켜기(선택)' }))));

    const question = h('div', { class: 'opener-question', hidden: true },
      h('p', { class: 'prompt', id: labelId, dataset: { itemId: 'opener' }, text: def.prompt }),
      choices.el, note, start);
    const foot = h('div', { class: 'opener-foot', hidden: true }, skipLink, more);
    el.replaceChildren(h('div', { class: 'opener-figure' }, renderFigure(mod.figures[def.figure], def.alt, { base: `modules/${mod.id}/` })), question, foot);
    el.dataset.stage = 'figure';

    const reveal = () => {
      if (!active) return;
      question.hidden = false;
      foot.hidden = false;
      el.dataset.stage = 'question';
      rec.openerShown();
      announce('질문이 나왔습니다.');
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) reveal();
    else timer = setTimeout(reveal, REVEAL_MS);
  }

  return {
    el,
    isOpen: () => active,
    // 이 모듈의 처음 화면에서 여는 카드를 보일 차례인가(본문을 읽은 흔적이 없고 이 카드를 거친 적이 없다).
    offersAtLoad: () => openerGateFor(mod, session.progress, { started: hasProgress(session.progress) }),
    // 여는 카드가 있는 모듈은 시작 전 문항 · 건너뛰기 확인을 따로 열지 않는다('이미 아는 내용이면' 줄로 들어간 뒤는 지금의 흐름 그대로).
    bypassesGates: () => openerBypassesGates(mod, session.progress),
    // notice: 처음 여는 모듈의 기록 안내를 이 카드의 '자세히'에 합칠 때 { text, acknowledge }.
    openAtLoad({ notice = null } = {}) {
      if (!this.offersAtLoad()) return false;
      active = true;
      merged = notice;
      settled = false;
      el.hidden = false;
      render();
      onOpen?.();
      return true;
    },
    // '처음부터'를 누른 경우처럼 아무것도 남기지 않고 닫는다.
    cancel() { if (active) { active = false; merged = null; settled = false; clearTimeout(timer); el.hidden = true; el.replaceChildren(); } },
  };
}

// 끝 화면의 한 칸: "처음 고른 답: ○○ — 지금 보면 어느 쪽인가요?" 다시 고르게 하고, 고르면 정답과 짧은 까닭을 보인다. 처음 답이 없으면 null.
export function openerRevisitCard({ mod, session, rec, announce = () => {} }) {
  const first = openerRevisitFor(mod, session.progress);
  if (!first) return null;
  const def = openerDef(mod);
  const labelId = uid('opener-rv-');
  const box = h('section', { class: 'opener-revisit', 'aria-label': OPENER_TEXT.revisitTitle, dataset: { stage: 'ask' } });

  function renderDone(pick) {
    const wrong = pick.result === 'wrong';
    const mc = wrong ? (def.misconceptions ?? []).find((m) => m.match?.value === pick.chosen) : null;
    box.dataset.stage = 'done';
    box.replaceChildren(
      h('h3', { class: 'help-sub', text: OPENER_TEXT.revisitTitle }),
      h('p', { class: 'opener-first', text: OPENER_TEXT.revisitFirst(optionLabel(mod, first.chosen)) }),
      h('p', {}, h('span', { class: 'tag', text: OPENER_TEXT.picked }), ' ', h('strong', { text: optionLabel(mod, pick.chosen) })),
      ...(mc ? [h('p', { class: 'msg msg-why', text: mc.feedback })] : []),
      h('p', { class: 'opener-answer', text: OPENER_TEXT.revisitAnswer(optionLabel(mod, def.answer.value)) }),
      h('p', { class: 'opener-why' }, h('span', { class: 'tag', text: OPENER_TEXT.revisitWhy }), ` ${def.solution}`));
  }

  if (first.revisit) { renderDone(first.revisit); return box; }
  const order = optionOrder(mod, session.progress, 'opener/revisit', def);
  const choices = choiceButtons(def, {
    labelId, order,
    onPick(id) {
      const r = gradeOpener(mod, id);
      session.update((s) => revisitOpener(s, id, r.result));
      rec.openerRevisit({ chosen: id, result: r.result, first: first.chosen, firstResult: first.result, shownOrder: order ?? undefined });
      announce('답을 남겼습니다.');
      renderDone({ chosen: id, result: r.result });
    },
  });
  box.replaceChildren(
    h('h3', { class: 'help-sub', text: OPENER_TEXT.revisitTitle }),
    h('p', { class: 'opener-first', text: OPENER_TEXT.revisitFirst(optionLabel(mod, first.chosen)) }),
    h('div', { class: 'opener-figure' }, renderFigure(mod.figures[def.figure], def.alt, { base: `modules/${mod.id}/` })),
    h('p', { class: 'prompt', id: labelId, dataset: { itemId: 'opener-revisit' }, text: def.prompt }),
    choices.el);
  rec.openerShown();
  return box;
}
