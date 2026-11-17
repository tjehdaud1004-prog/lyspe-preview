// 묶음 돌리기(round 블록): 문항을 한 번에 하나씩 보이고 곧 알려 주는 짧은 묶음. 세 방식 — recall(떠올려 적기)·sort(갈래 고르기)·drill(짧은 문항 판).
// 줄을 어떻게 돌리고 언제 다시 묻는지는 core/round.js 가 정한다. 여기는 보여 주고 누른 것을 전할 뿐이고, 상태는 진행 저장(progress.rounds)이 들고 있어
// 새로 고쳐도 같은 문항에서 이어진다. drill 을 푸는 동안에는 시계·남은 시간·빠르기를 보이지 않는다(걸린 시간은 판이 끝난 뒤에만).
import { h, uid } from '../dom.js';
import { invalidMessage, answerText } from '../../core/answer.js';
import { setRound } from '../../core/progress.js';
import {
  ROUND_TEXT, createRoundState, currentItem, viewedItem, answerRound, ackRound, skipRound, judgeRound, roundSummary, roundIsDone, gateResult, drillRows, requeueOf,
} from '../../core/round.js';
import { createAnswerField } from './answer-field.js';
import { optionOrder } from '../../core/shuffle.js';
import { helpButton } from './help-button.js';

const seconds = (ms) => String(Math.round(ms / 100) / 10);

export function renderRound(ctx, block) {
  const { session, rec } = ctx;
  const sort = block.mode === 'sort';
  const drill = block.mode === 'drill';
  const bucketOf = (id) => block.buckets?.find((b) => b.id === id);
  const getState = () => session.progress.rounds?.[block.id] ?? createRoundState(block);

  const body = h('div', { class: 'round-body' });
  const actions = h('div', { class: 'block-actions' });
  const el = h('div', { class: `block block-round block-round-${block.mode}`, dataset: { blockId: block.id } },
    h('p', { class: 'eyebrow', text: ROUND_TEXT.eyebrow[block.mode] }),
    h('p', { class: 'prompt', text: block.prompt }),
    body, actions);

  let signature = '';
  let stage = 'question';       // question | feedback | done — 숫자 키가 어느 때 듣는지 알려 준다
  let mark = 0;                 // 지금 문항이 보인 때의 활동 시간
  let markKey = '';
  let lastFeedback = null;      // 방금 낸 오답에 붙은 오개념 설명(새로 고치면 사라진다)
  let focusWanted = false;
  let viaKeyboard = false;
  let field = null;
  let currentFocus = null;
  let shownOrder = null;        // 지금 문항의 보기 차례(보기 섞기를 켠 모듈의 고르는 문항만) — round_item 기록에 더한다
  let gateStayed = false;       // ‘그래도 계속’을 누른 뒤. 문턱을 지나 다른 걸음에 있어도 단추는 더 남지 않는다

  const activeNow = () => (typeof rec.activeNow === 'function' ? rec.activeNow() : Date.now());

  function persist(next) {
    session.update((s) => setRound(s, block.id, next));
  }

  // 답 하나를 낸다. result: correct | wrong | dontknow
  function commit(item, result, extra = {}) {
    const state = getState();
    const out = answerRound(block, state, item.id, result, { ms: activeNow() - mark });
    if (out.n === 0) return;
    lastFeedback = extra.feedback ?? null;
    focusWanted = viaKeyboard || el.contains(document.activeElement);
    persist(out.state);
    rec.roundItem({ blockId: block.id, item: item.id, n: out.n, result, ms: activeNow() - mark, mode: block.mode, pair: item.pair, bucket: sort ? item.bucket : undefined, chosen: extra.chosen, shownOrder: shownOrder ?? undefined });
    if (out.state.done && !state.done) rec.roundDone({ blockId: block.id, mode: block.mode, summary: roundSummary(block, out.state) });
    if (result === 'correct' && drill) ctx.announce(ROUND_TEXT.correct); // 드릴은 곧 다음 문항이라 결과 화면이 없다 — 읽는 프로그램에는 따로 알린다
    viaKeyboard = false;
  }

  function next() {
    focusWanted = true;
    persist(ackRound(getState()));
  }

  function skipAll() {
    const state = getState();
    const out = skipRound(block, state);
    if (out.state === state) return;
    focusWanted = true;
    persist(out.state);
    if (!state.done) rec.roundDone({ blockId: block.id, mode: block.mode, summary: roundSummary(block, out.state) });
    ctx.announce(ROUND_TEXT.resolved);
  }

  // ---------- 문항 ----------

  function renderQuestion(state) {
    stage = 'question';
    const item = currentItem(block, state);
    const key = `${item.id}:${state.shown[item.id] ?? 0}`;
    if (key !== markKey) { markKey = key; mark = activeNow(); }
    const cueId = uid('cue-');
    const notice = h('div', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
    shownOrder = sort ? null : optionOrder(session.mod, session.progress, `${block.id}/${item.id}`, item);
    const kids = [
      h('p', { class: 'small round-count', text: ROUND_TEXT.remaining(state.queue.length) }),
      h('p', { class: 'round-cue', id: cueId, dataset: { itemId: item.id }, text: item.cue }),
    ];
    const unknownBtn = h('button', { type: 'button', class: 'btn', dataset: { action: 'dontknow' }, onClick: (e) => { viaKeyboard = e.detail === 0; commit(item, 'dontknow'); } }, ROUND_TEXT.unknown);
    if (sort) {
      const pick = (bucket) => commit(item, judgeRound(block, item, bucket.id).result, { chosen: bucket.id });
      const buttons = block.buckets.map((b, i) => h('button', {
        type: 'button', class: 'btn round-bucket', dataset: { bucket: b.id }, 'aria-keyshortcuts': String(i + 1),
        onClick: (e) => { viaKeyboard = e.detail === 0; pick(b); },
      }, h('span', { class: 'round-bucket-no', text: `${i + 1}` }), h('span', { text: b.label })));
      kids.push(
        h('div', { class: 'round-buckets', role: 'group', 'aria-labelledby': cueId }, ...buttons),
        h('p', { class: 'small', text: ROUND_TEXT.bucketHint(block.buckets.length) }),
        h('div', { class: 'item-actions' }, unknownBtn), notice);
      field = null;
      currentFocus = () => buttons[0];
    } else {
      const submit = () => {
        const r = judgeRound(block, item, field.getValue());
        if (r.result === 'invalid') { notice.replaceChildren(h('p', { class: 'msg msg-invalid', text: invalidMessage(r.reason, item.answer) })); return; }
        commit(item, r.result, { feedback: r.feedback });
      };
      field = createAnswerField(item.answer, { labelId: cueId, label: item.cue, order: shownOrder, onEnter: () => { viaKeyboard = true; submit(); }, onInput: () => { ctx.guard.markInput(); notice.replaceChildren(); } });
      kids.push(
        h('div', { class: 'item' }, field.el),
        h('div', { class: 'item-actions' }, h('button', { type: 'button', class: 'btn btn-primary', dataset: { action: 'submit' }, onClick: (e) => { viaKeyboard = e.detail === 0; submit(); } }, ROUND_TEXT.submit), unknownBtn),
        notice);
      currentFocus = () => (item.answer.kind === 'choice' ? field.el.querySelector('input') : field.el.querySelector('input, textarea'));
    }
    body.dataset.stage = 'question';
    body.replaceChildren(...kids);
  }

  // ---------- 결과 ----------

  function renderFeedback(state) {
    stage = 'feedback';
    field = null;
    const view = state.view;
    const item = viewedItem(block, state);
    const right = view.result === 'correct';
    const lines = [h('p', { class: 'round-cue', dataset: { itemId: item.id }, text: item.cue })];
    lines.push(h('p', { class: `msg ${right ? 'msg-ok' : 'msg-wrong'}`, role: 'status', text: right ? ROUND_TEXT.correct : view.result === 'dontknow' ? ROUND_TEXT.dontknow : ROUND_TEXT.wrong }));
    if (right) {
      if (item.why) lines.push(h('details', { class: 'round-why' }, h('summary', { text: ROUND_TEXT.whyOpen }), h('p', { text: item.why })));
    } else {
      if (lastFeedback) lines.push(h('p', { class: 'msg msg-why', text: lastFeedback }));
      lines.push(h('p', { class: 'round-answer' }, h('span', { class: 'tag', text: sort ? ROUND_TEXT.correctBucket : ROUND_TEXT.correctAnswer }), ` ${sort ? bucketOf(item.bucket)?.label ?? item.bucket : answerText(item.answer)}`));
      if (item.why) lines.push(h('p', { class: 'round-why-line' }, h('span', { class: 'tag', text: ROUND_TEXT.why }), ` ${item.why}`));
      const rq = requeueOf(block);
      if (view.then === 'again') lines.push(h('p', { class: 'small', text: ROUND_TEXT.again }));
      else if (view.then === 'later') lines.push(h('p', { class: 'small', text: ROUND_TEXT.later }));
      else if (view.then === 'missed') lines.push(h('p', { class: 'small', text: ROUND_TEXT.missed(rq?.max ?? view.n) }));
    }
    const nextBtn = h('button', { type: 'button', class: 'btn btn-primary', dataset: { focusId: 'next', action: 'round-next' }, onClick: () => next() }, state.done ? ROUND_TEXT.finish : ROUND_TEXT.next);
    lines.push(h('div', { class: 'item-actions' }, nextBtn));
    currentFocus = () => nextBtn;
    body.dataset.stage = 'feedback';
    body.replaceChildren(...lines);
  }

  // ---------- 풀림 ----------

  function renderDone(state) {
    stage = 'done';
    field = null;
    const s = roundSummary(block, state);
    const kids = [h('p', {}, h('span', { class: 'outcome', dataset: { outcome: 'correct' }, text: ROUND_TEXT.resolved }))];
    const showTime = drill && (block.timing ?? 'after') === 'after' && !state.skipped;
    if (drill) {
      kids.push(h('p', { class: 'measure-line round-line', role: 'status', text: ROUND_TEXT.drillLine(s.items - s.skipped, s.correct, showTime && s.medianCorrectMs !== null ? seconds(s.medianCorrectMs) : null) }));
    } else {
      kids.push(h('p', { class: 'measure-line round-line', role: 'status', text: ROUND_TEXT.firstLine(s.firstCorrect, s.items, s.reasked) }));
    }
    if (s.skipped > 0) kids.push(h('p', { class: 'small', text: ROUND_TEXT.skippedLine(s.skipped) }));
    if (showTime) {
      const rows = drillRows(ctx.mod, session.progress.rounds);
      if (rows.length > 0) {
        kids.push(h('div', { class: 'table-wrap' }, h('table', { class: 'round-table' },
          h('caption', { text: ROUND_TEXT.tableCaption }),
          h('thead', {}, h('tr', {}, ...ROUND_TEXT.tableCols.map((c) => h('th', { scope: 'col', text: c })))),
          h('tbody', {}, ...rows.map((r) => h('tr', {},
            h('th', { scope: 'row', text: `${ROUND_TEXT.tableRowName(r)}${r.blockId === block.id ? ` ${ROUND_TEXT.tableNow}` : ''}` }),
            h('td', { text: `${r.items}` }),
            h('td', { text: `${r.correct}` }),
            h('td', { text: r.timing === 'none' || r.medianCorrectMs === null ? ROUND_TEXT.tableNone : ROUND_TEXT.tableSeconds(seconds(r.medianCorrectMs)) })))))));
      }
    }
    const again = [...s.laterIds, ...s.missedIds];
    if (again.length > 0) {
      kids.push(h('details', { class: 'round-again' }, h('summary', { text: `${ROUND_TEXT.laterHead} (${again.length})` }),
        h('ul', { class: 'round-list' }, ...again.map((id) => listRow(block.items.find((it) => it.id === id))))));
    }
    if (s.leftIds.length > 0) {
      const d = h('details', { class: 'round-again', open: true }, h('summary', { text: `${ROUND_TEXT.skippedHead} (${s.leftIds.length})` }),
        h('ul', { class: 'round-list' }, ...s.leftIds.map((id) => listRow(block.items.find((it) => it.id === id)))));
      kids.push(d);
    }
    const gate = gateResult(block, state);
    const need = Array.isArray(ctx.mod.needs) ? ctx.mod.needs[0] : undefined;
    if (gate.gate && !gate.passed && typeof need === 'string') {
      const title = ctx.moduleTitle?.(need) ?? need;
      const href = ctx.moduleHref?.(need) ?? `?m=${encodeURIComponent(need)}`;
      kids.push(h('div', { class: 'round-gate', role: 'note' },
        h('p', { text: ROUND_TEXT.gate(title) }),
        gateOpen()
          ? h('div', { class: 'item-actions' },
            h('a', { class: 'btn', href, dataset: { action: 'round-gate-go' } }, ROUND_TEXT.gateGo(title)),
            h('button', { type: 'button', class: 'btn btn-quiet', dataset: { action: 'round-gate-stay' }, onClick: () => { gateStayed = true; ctx.proceed?.(); render(); } }, ROUND_TEXT.gateStay))
          : h('p', { class: 'small', role: 'status', text: ROUND_TEXT.gateStayed })));
    }
    currentFocus = null;
    body.dataset.stage = 'done';
    body.replaceChildren(...kids);
  }

  function listRow(item) {
    const answer = sort ? bucketOf(item.bucket)?.label ?? item.bucket : answerText(item.answer);
    return h('li', {}, h('span', { class: 'round-list-cue', text: item.cue }), ' — ', h('span', { class: 'tag', text: sort ? ROUND_TEXT.correctBucket : ROUND_TEXT.correctAnswer }), ` ${answer}`,
      item.why && h('span', { class: 'small round-list-why', text: ` ${item.why}` }));
  }

  // 문턱 길 두 가지는 이 블록이 지금 걸음일 때만 있다. ‘그래도 계속’을 눌렀거나 이미 지나갔으면 한 줄만 남는다(새로 고쳐도 같다).
  const gateOpen = () => !gateStayed && (ctx.isCurrentBlock?.(block.id) ?? true);

  // ---------- 그리기 ----------

  function render({ force = false } = {}) {
    const state = getState();
    // 끝난 drill 판의 표는 다른 판의 결과도 담으므로 그것이 바뀌면 다시 그린다.
    const sig = JSON.stringify([state, drill && roundIsDone(state) ? drillRows(ctx.mod, session.progress.rounds) : null, gateOpen()]);
    if (sig === signature && !force) return;
    signature = sig;
    const done = roundIsDone(state);
    if (done) renderDone(state);
    else if (state.view) renderFeedback(state);
    else renderQuestion(state);
    // 건너뛰기는 풀림 전에만 있다
    // replaceChildren 은 false 를 글자로 넣으므로 걸러 낸다
    actions.replaceChildren(...[helpButton(ctx, { blockId: block.id, helpKey: block.id }),
      !done && h('button', { type: 'button', class: 'btn btn-quiet', dataset: { action: 'round-skip' }, onClick: () => skipAll() }, ROUND_TEXT.skip)].filter(Boolean));
    if (focusWanted) {
      focusWanted = false;
      const target = currentFocus?.();
      if (target) target.focus({ preventScroll: true });
    }
  }

  // sort 는 숫자 키로도 고른다. 다른 입력칸에 글을 쓰는 중이거나 겹친 창이 열려 있으면 듣지 않는다.
  function onKey(e) {
    if (!el.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (!sort || stage !== 'question' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]') || el.closest('[hidden]')) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
    const no = Number(e.key);
    if (!Number.isInteger(no) || no < 1 || no > block.buckets.length) return;
    const item = currentItem(block, getState());
    if (!item) return;
    e.preventDefault();
    viaKeyboard = true;
    commit(item, judgeRound(block, item, block.buckets[no - 1].id).result, { chosen: block.buckets[no - 1].id });
  }
  document.addEventListener('keydown', onKey);

  render({ force: true });
  return {
    el, blockId: block.id,
    resolved: () => roundIsDone(getState()),
    refresh: () => render(),
    focus: () => currentFocus?.()?.focus({ preventScroll: true }),
  };
}
