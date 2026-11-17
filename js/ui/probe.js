// 본문 밖에서 도움 없이 푸는 문항 묶음의 화면: 시작하기 전(pre)과 끝낸 뒤 며칠 지나(delayed).
// 권하는 카드 → 문항 하나씩(답은 한 번, 힌트·풀이 없음, '모르겠다' 가능) → 다 푼 뒤 결과 한꺼번에.
// 언제 권하고 무엇이 남는지는 core/probe.js 의 규칙이다. 여기는 보여 주고 누른 것을 전할 뿐이다.
import { h, uid } from './dom.js';
import { hasProgress } from '../core/progress.js';
import { invalidMessage } from '../core/answer.js';
import {
  probeDef, gateFor, delayedStatus, startProbe, answerProbe, finishProbe, closeProbe, nextProbeItem, gradeProbe, summarizeProbe,
  PROBE_TEXT, PROBE_RULE_TEXT, PROBE_LABELS,
} from '../core/probe.js';
import { createAnswerField } from './blocks/answer-field.js';
import { optionOrder } from '../core/shuffle.js';

// merged: 처음 여는 모듈이라 기록 안내도 이 카드 한 장에 합쳐 보인다 — { text, acknowledge(record) } (app.js 가 준다). 시작 전 문항이 없는 모듈은 합치지 않는다(기록 안내만 한 장).
export function createProbeGate({ mod, session, rec, announce, onOpen, onClose }) {
  const el = h('section', { class: 'probe', 'aria-labelledby': 'probe-title', hidden: true, dataset: { gate: 'probe' } });
  const setStage = (stage) => { el.dataset.stage = stage; if (active) el.dataset.kind = active.kind; };
  let active = null;          // { kind, daysSince }
  let merged = null;          // 기록 안내를 합친 카드일 때의 { text, acknowledge }(이 카드를 닫기 전까지)
  const explained = new Map(); // 이번 방문에서 틀린 답에 맞은 오개념 설명(문항 id → 글). 저장하지 않는다.

  const def = () => probeDef(mod, active.kind);
  const text = () => PROBE_TEXT[active.kind];
  const log = (action) => rec.probe({ kind: active.kind, action, items: def().items.length, daysSince: active.daysSince });
  const head = (title) => [h('p', { class: 'eyebrow', text: '도움 없이 풀어 보기' }), h('h2', { id: 'probe-title', class: 'probe-title', tabindex: '-1', text: title })];
  const focusTitle = () => el.querySelector('#probe-title')?.focus({ preventScroll: false });

  function close() {
    const kind = active?.kind ?? null;
    active = null;
    el.hidden = true;
    el.replaceChildren();
    onClose?.(kind);
  }

  // 합친 카드: 고른 동의를 저장하고, 권했다는 기록('offered')을 그 뒤에 남긴다(기록을 켠 사람의 기록에도 권함이 남도록).
  let recordBox = null;
  function settleNotice() {
    if (!merged) return;
    const { acknowledge } = merged;
    merged = null;
    acknowledge(recordBox?.checked === true);
    log('offered');
  }

  function decline() {
    settleNotice();
    session.update((s) => closeProbe(s, active.kind, session.now(), 'declined', { daysSince: active.daysSince }));
    log('declined');
    close();
  }

  function start() {
    settleNotice();
    session.update((s) => startProbe(s, active.kind, session.now(), { daysSince: active.daysSince }));
    log('started');
    renderNext({ focus: true });
  }

  function renderOffer({ resume }) {
    const n = def().items.length;
    setStage('offer');
    el.replaceChildren(
      ...head(text().title),
      h('p', { class: 'probe-lead', text: text().offer(n, active.daysSince ?? 0) }),
      // 규칙 설명은 '자세히'로 접는다(K04 A123 D — 문구는 그대로, 접기만). 카드에는 한 문장과 단추 둘이 먼저 보인다.
      h('details', { class: 'probe-more' },
        h('summary', { text: '자세히' }),
        ...(def().intro ? [h('p', { class: 'probe-intro', text: def().intro })] : []),
        h('p', { class: 'small', text: PROBE_RULE_TEXT })),
      ...(merged ? [h('div', { class: 'probe-record' },
        h('p', { class: 'small', text: merged.text }),
        h('label', { class: 'probe-record-row' }, recordBox = h('input', { type: 'checkbox', dataset: { action: 'record-on' } }), h('span', { text: '학습 기록 켜기(선택)' })))] : []),
      h('div', { class: 'probe-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', dataset: { action: 'start' }, onClick: () => start() }, resume ? '이어서 풀기' : text().start),
        h('button', { type: 'button', class: 'btn btn-quiet', dataset: { action: 'decline' }, onClick: () => decline() }, text().decline)));
  }

  function renderNext({ focus = false } = {}) {
    const item = nextProbeItem(mod, session.progress, active.kind);
    if (!item) {
      session.update((s) => finishProbe(s, active.kind, session.now()));
      log('finished');
      renderDone({ focus });
      return;
    }
    const items = def().items;
    const labelId = uid('probe-q-');
    const feedback = h('div', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
    const order = optionOrder(mod, session.progress, `${active.kind}/${item.id}`, item);
    const field = createAnswerField(item.answer, { labelId, label: item.prompt, order, onEnter: () => submit(), onInput: () => feedback.replaceChildren() });

    function record(result, misconceptionIndex = -1) {
      if (misconceptionIndex >= 0) explained.set(item.id, item.misconceptions[misconceptionIndex].feedback);
      session.update((s) => answerProbe(s, active.kind, item.id, result));
      rec.probeAnswer({ kind: active.kind, item: item.id, result, misconceptionIndex, daysSince: active.daysSince, shownOrder: order ?? undefined });
      announce('답을 남겼습니다.');
      renderNext({ focus: true });
    }
    function submit() {
      const r = gradeProbe(item, field.getValue());
      if (r.result === 'invalid') { feedback.replaceChildren(h('p', { class: 'msg msg-invalid', text: invalidMessage(r.reason, item.answer) })); return; }
      record(r.result, r.misconceptionIndex);
    }

    setStage('question');
    el.replaceChildren(
      ...head(`${text().title} — 문제 ${items.indexOf(item) + 1} / ${items.length}`),
      h('p', { class: 'prompt', id: labelId, dataset: { itemId: item.id }, text: item.prompt }),
      h('div', { class: 'item' }, field.el, feedback),
      h('p', { class: 'small', text: '답은 한 번만 낼 수 있습니다. 힌트와 풀이는 없습니다.' }),
      h('div', { class: 'probe-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', dataset: { action: 'submit' }, onClick: () => submit() }, '답 내기'),
        h('button', { type: 'button', class: 'btn', dataset: { action: 'dontknow' }, onClick: () => record('unknown') }, '모르겠다'),
        h('button', { type: 'button', class: 'btn btn-quiet', dataset: { action: 'stop' }, onClick: () => decline() }, '그만 풀기')));
    if (focus) focusTitle();
  }

  function renderDone({ focus = false } = {}) {
    const s = summarizeProbe(mod, session.progress, active.kind);
    setStage('done');
    el.replaceChildren(
      ...head(text().title),
      h('p', { class: 'probe-lead', text: text().done }),
      h('ol', { class: 'probe-results' }, ...s.rows.map((row) => h('li', { class: 'probe-result' },
        h('p', { class: 'probe-result-prompt', text: row.prompt }),
        h('p', {}, h('span', { class: 'tag', text: '내 답' }), ' ', h('span', { class: 'outcome', dataset: { outcome: row.result === 'correct' ? 'correct' : 'skipped' }, text: PROBE_LABELS[row.result] })),
        explained.has(row.id) && h('p', { class: 'msg msg-why', text: explained.get(row.id) }),
        row.solution && h('p', { class: 'probe-solution' }, h('span', { class: 'tag', text: '풀이' }), ` ${row.solution}`)))),
      h('div', { class: 'probe-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', dataset: { action: 'leave' }, onClick: () => close() }, text().leave)));
    if (focus) focusTitle();
  }

  // gate: { kind, resume, daysSince? } — core/probe.js 의 gateFor 결과와 같은 모양.
  // direct: 학습자가 정리 화면에서 직접 시작을 눌렀다 — 권하는 카드를 건너뛰고 첫 문항으로 간다.
  function open(gate, { direct = false, notice = null } = {}) {
    if (!probeDef(mod, gate.kind)) return false;
    active = { kind: gate.kind, daysSince: gate.kind === 'delayed' ? gate.daysSince : undefined };
    explained.clear();
    el.hidden = false;
    onOpen?.(gate.kind);
    if (direct) { start(); return true; }
    merged = gate.kind === 'pre' && notice ? notice : null;
    if (!merged) log('offered');
    renderOffer({ resume: gate.resume === true });
    return true;
  }

  return {
    el,
    isOpen: () => active !== null,
    // 화면을 처음 열 때: 권할 묶음이 있으면 연다(본문보다 먼저). 열었으면 true.
    // notice: 처음 여는 모듈의 기록 안내를 이 카드와 합칠 때 { text, acknowledge }.
    // noPre: 여는 카드(core/opener.js)가 있는 모듈이라 시작 전 문항을 따로 권하지 않는다(며칠 뒤 문항은 그대로).
    openAtLoad({ notice = null, noPre = false } = {}) {
      const gate = gateFor(mod, session.progress, session.now(), { started: hasProgress(session.progress) || noPre });
      return gate ? open(gate, { notice }) : false;
    },
    // 처음 열 때 권할 것이 시작 전 문항(pre)인가 — 그렇다면 기록 안내를 그 카드와 합친다.
    offersPreAtLoad() {
      return gateFor(mod, session.progress, session.now(), { started: hasProgress(session.progress) })?.kind === 'pre';
    },
    // 정리 화면에서 '다시 풀어 보기'를 직접 시작한다(때가 됐고 아직 끝내지 않았을 때만).
    openDelayed() {
      const st = delayedStatus(mod, session.progress, session.now());
      if (!['due', 'declined', 'started'].includes(st.state)) return false;
      return open({ kind: 'delayed', resume: st.state === 'started', daysSince: session.progress.probes?.delayed?.daysSince ?? st.daysSince }, { direct: true });
    },
    // '처음부터'를 누른 경우처럼 아무것도 남기지 않고 닫는다.
    cancel() { if (active) { merged = null; active = null; el.hidden = true; el.replaceChildren(); } },
  };
}
