// 건너뛰기 확인의 화면: 권하는 카드 → 문항 하나씩(답은 한 번, 힌트·풀이 없음, '모르겠다' 가능) → 다 푼 뒤 결과와 선택.
// ui/probe.js 와 같은 모양이다. 언제 권하고 무엇이 남는지는 core/skip.js 의 규칙이고, 여기는 보여 주고 누른 것을 전할 뿐이다.
import { h } from './dom.js';
import { hasProgress } from '../core/progress.js';
import { invalidMessage } from '../core/answer.js';
import { probeDef } from '../core/probe.js';
import {
  skipDef, skipGateFor, skipBlockedByPre, startSkip, answerSkip, finishSkip, closeSkip, decideSkip, nextSkipItem, skipCounts,
  eligibleScenes, gradeSkip, summarizeSkip, SKIP_TEXT, SKIP_RULE_TEXT, SKIP_LABELS,
} from '../core/skip.js';
import { createAnswerField } from './blocks/answer-field.js';
import { optionOrder } from '../core/shuffle.js';

// next: 모듈 머리의 next 가 가리키는 다음 사슬 모듈 { id, title, go() } 또는 null(없으면 ‘건너뛰고 다음으로’ 단추가 없다).
export function createSkipGate({ mod, session, rec, announce, onOpen, onClose, next = null }) {
  const el = h('section', { class: 'probe skip-gate', 'aria-labelledby': 'skip-title', hidden: true, dataset: { gate: 'skip' } });
  let active = false;
  const explained = new Map(); // 이번 방문에서 틀린 답에 맞은 오개념 설명(문항 id → 글). 저장하지 않는다.

  const goals = () => skipDef(mod).goals;
  const totalItems = () => goals().reduce((s, g) => s + g.items.length, 0);
  const log = (action, reason) => rec.skipCheck({ action, goals: goals().length, items: totalItems(), reason });
  const head = (title) => [h('p', { class: 'eyebrow', text: SKIP_TEXT.eyebrow }), h('h2', { id: 'skip-title', class: 'probe-title', tabindex: '-1', text: title })];
  const focusTitle = () => el.querySelector('#skip-title')?.focus({ preventScroll: false });

  function close() {
    active = false;
    el.hidden = true;
    el.replaceChildren();
    onClose?.('skip');
  }

  function decline() {
    session.update((s) => closeSkip(s, session.now(), 'declined'));
    log('declined');
    close();
  }

  function start() {
    session.update((s) => startSkip(s, session.now()));
    log('started');
    renderNext({ focus: true });
  }

  function renderOffer() {
    const def = skipDef(mod);
    el.dataset.stage = 'offer';
    el.replaceChildren(
      ...head(SKIP_TEXT.title),
      h('p', { class: 'probe-lead', text: SKIP_TEXT.offer(totalItems()) }),
      // 규칙 설명은 '자세히'로 접는다(K04 A123 D — 문구는 그대로, 접기만).
      h('details', { class: 'probe-more' },
        h('summary', { text: '자세히' }),
        ...(def.intro ? [h('p', { class: 'probe-intro', text: def.intro })] : []),
        h('p', { class: 'small', text: SKIP_RULE_TEXT }),
        h('p', { class: 'small', text: SKIP_TEXT.provisional })),
      h('div', { class: 'probe-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', dataset: { action: 'start' }, onClick: () => start() }, session.progress.skip?.status === 'started' ? SKIP_TEXT.resume : SKIP_TEXT.start),
        h('button', { type: 'button', class: 'btn btn-quiet', dataset: { action: 'decline' }, onClick: () => decline() }, SKIP_TEXT.decline)));
  }

  function renderNext({ focus = false } = {}) {
    const next = nextSkipItem(mod, session.progress);
    if (!next) { finish(focus); return; }
    const { goal, item } = next;
    const counts = skipCounts(mod, session.progress);
    const labelId = `skip-q-${item.id}`;
    const feedback = h('div', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
    const order = optionOrder(mod, session.progress, `skip/${item.id}`, item);
    const field = createAnswerField(item.answer, { labelId, label: item.prompt, order, onEnter: () => submit(), onInput: () => feedback.replaceChildren() });

    function record(result, misconceptionIndex = -1) {
      if (misconceptionIndex >= 0) explained.set(item.id, item.misconceptions[misconceptionIndex].feedback);
      session.update((s) => answerSkip(s, item.id, result));
      rec.skipAnswer({ goal: goal.id, item: item.id, result, misconceptionIndex, shownOrder: order ?? undefined });
      announce('답을 남겼습니다.');
      renderNext({ focus: true });
    }
    function submit() {
      const r = gradeSkip(item, field.getValue());
      if (r.result === 'invalid') { feedback.replaceChildren(h('p', { class: 'msg msg-invalid', text: invalidMessage(r.reason, item.answer) })); return; }
      record(r.result, r.misconceptionIndex);
    }

    el.dataset.stage = 'question';
    el.replaceChildren(
      ...head(`${SKIP_TEXT.title} — ${SKIP_TEXT.progress(counts.asked + 1, counts.max)}`),
      h('p', { class: 'skip-goal' }, h('span', { class: 'tag', text: '지금 확인하는 목표' }), ` ${goal.label}`),
      h('p', { class: 'prompt', id: labelId, dataset: { itemId: item.id }, text: item.prompt }),
      h('div', { class: 'item' }, field.el, feedback),
      h('p', { class: 'small', text: SKIP_TEXT.itemRule }),
      h('div', { class: 'probe-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', dataset: { action: 'submit' }, onClick: () => submit() }, SKIP_TEXT.submit),
        h('button', { type: 'button', class: 'btn', dataset: { action: 'dontknow' }, onClick: () => record('unknown') }, SKIP_TEXT.unknown),
        h('button', { type: 'button', class: 'btn btn-quiet', dataset: { action: 'stop' }, onClick: () => decline() }, SKIP_TEXT.stop)));
    if (focus) focusTitle();
  }

  // 다 물었다: 판정을 채우고 목표마다 한 건씩 남긴 뒤 결과를 보인다.
  function finish(focus) {
    session.update((s) => finishSkip(mod, s, session.now()));
    const rec0 = session.progress.skip;
    for (const g of goals()) {
      const asked = g.items.filter((it) => rec0.answers[it.id] !== undefined).length;
      rec.skipVerdict({ goal: g.id, verdict: rec0.verdicts[g.id], correct: g.items.filter((it) => rec0.answers[it.id] === 'correct').length, asked, total: g.items.length });
    }
    log('finished');
    renderResult({ focus });
  }

  function renderResult({ focus = false } = {}) {
    const sum = summarizeSkip(mod, session.progress);
    const eligible = eligibleScenes(mod, session.progress);
    const noteOf = (id) => sum.goals.flatMap((g) => g.scenes).find((s) => s.id === id);
    const boxes = new Map(); // 장면 id → 체크 상자
    const pick = eligible.length > 0 && h('fieldset', { class: 'skip-pick' },
      h('legend', { class: 'small', text: '건너뛸 장면 고르기(고르지 않으면 본문에서 봅니다)' }),
      ...eligible.map((id) => {
        const box = h('input', { type: 'checkbox', checked: true, id: `skip-pick-${id}` });
        boxes.set(id, box);
        return h('label', { class: 'skip-pick-row', for: `skip-pick-${id}` }, box, ` ${SKIP_TEXT.scenePick(noteOf(id))}`);
      }));

    function begin(skipChosen) {
      const choices = {};
      for (const id of eligible) choices[id] = skipChosen && boxes.get(id)?.checked ? 'skip' : 'view';
      session.update((s) => decideSkip(mod, s, choices, session.now()));
      for (const id of eligible) rec.skipDecision({ sceneId: id, choice: choices[id] });
      close();
    }

    // 모든 목표를 통과해 가르치는 장면을 건너뛰게 되는 자리에서만, 이 모듈을 통째로 건너뛰고 다음 사슬 모듈로 갈 수 있다(모듈 머리의 next).
    const canSkipModule = Boolean(next) && eligible.length > 0 && sum.goals.length > 0 && sum.goals.every((g) => g.verdict === 'pass');
    function skipModule() {
      const choices = {};
      for (const id of eligible) choices[id] = 'skip';
      session.update((s) => decideSkip(mod, s, choices, session.now()));
      for (const id of eligible) rec.skipDecision({ sceneId: id, choice: 'skip' });
      rec.skipModule({ to: next.id });
      session.flush();
      next.go();
    }

    el.dataset.stage = 'result';
    el.replaceChildren(
      ...head(SKIP_TEXT.title),
      h('p', { class: 'probe-lead', text: SKIP_TEXT.done }),
      h('ol', { class: 'probe-results' }, ...sum.goals.map((g) => {
        const okScenes = g.scenes.filter((s) => s.eligible);
        const blocked = g.verdict === 'pass' ? g.scenes.filter((s) => !s.eligible) : [];
        return h('li', { class: 'probe-result' },
          h('p', { class: 'probe-result-prompt', text: g.label }),
          h('p', { class: 'msg msg-why' },
            g.verdict === 'pass' ? [SKIP_TEXT.pass, okScenes.length > 0 ? ` ${SKIP_TEXT.passScenes(okScenes)}` : '', ...blocked.map((s) => ` ${SKIP_TEXT.needOther(s)}`)].join('') : SKIP_TEXT.insufficient),
          h('ul', { class: 'skip-rows' }, ...g.rows.map((row) => h('li', {},
            h('p', { class: 'probe-result-prompt', text: row.prompt }),
            h('p', {}, h('span', { class: 'tag', text: '내 답' }), ' ', h('span', { class: 'outcome', dataset: { outcome: row.result === 'correct' ? 'correct' : row.result === 'not_asked' ? 'checked-skip' : 'skipped' }, text: SKIP_LABELS[row.result] })),
            explained.has(row.id) && h('p', { class: 'msg msg-why', text: explained.get(row.id) }),
            row.solution && row.result !== 'not_asked' && h('p', { class: 'probe-solution' }, h('span', { class: 'tag', text: '풀이' }), ` ${row.solution}`)))));
      })),
      ...(pick ? [pick] : []),
      canSkipModule && h('p', { class: 'small', text: SKIP_TEXT.skipModuleNote(next.title) }),
      h('p', { class: 'small', text: SKIP_TEXT.provisional }),
      h('div', { class: 'probe-actions' },
        eligible.length > 0
          ? [h('button', { type: 'button', class: 'btn btn-primary', dataset: { action: 'skip-and-start' }, onClick: () => begin(true) }, SKIP_TEXT.skipAndStart),
            h('button', { type: 'button', class: 'btn', dataset: { action: 'view-all' }, onClick: () => begin(false) }, SKIP_TEXT.viewAll)]
          : h('button', { type: 'button', class: 'btn btn-primary', dataset: { action: 'begin' }, onClick: () => begin(false) }, SKIP_TEXT.begin),
        canSkipModule && h('button', { type: 'button', class: 'btn', dataset: { action: 'skip-module' }, onClick: () => skipModule() }, SKIP_TEXT.skipModule)));
    if (focus) focusTitle();
  }

  // gate: core/skip.js 의 skipGateFor 결과 { resume, stage }.
  function open(gate) {
    if (!skipDef(mod)) return false;
    active = true;
    explained.clear();
    el.hidden = false;
    onOpen?.('skip');
    if (gate.stage === 'offer') { log('offered'); renderOffer(); } else if (gate.stage === 'items') renderNext(); else renderResult();
    return true;
  }

  return {
    el,
    isOpen: () => active,
    // 시작 전 문항을 다 푼 뒤에도, 화면을 처음 열 때도 부른다. 권할 것이 있으면 열고 true.
    // 시작 전 문항에서 틀리거나 모르는 것이 있으면 권하지 않고(na 로 닫고) 그 사실을 한 번 남긴다.
    openAtLoad() {
      const state = session.progress;
      const started = hasProgress(state);
      const gate = skipGateFor(mod, state, { started });
      if (gate) return open(gate);
      if (skipDef(mod) && !started && !Number.isFinite(state.finishedAt) && !state.skip && probeDef(mod, 'pre') && skipBlockedByPre(mod, state)) {
        session.update((s) => closeSkip(s, session.now(), 'na'));
        log('not_offered', 'pre_miss');
      }
      return false;
    },
    // '처음부터'를 누른 경우처럼 아무것도 남기지 않고 닫는다.
    cancel() { if (active) { active = false; el.hidden = true; el.replaceChildren(); } },
  };
}
