// 채점 대상 하나(확인 문항·문제의 각 부분·연결 빈칸)의 입력·제출·피드백. 상태는 session 이 들고, 여기는 보여 주기만 한다.
import { h, uid } from '../dom.js';
import { grade, invalidMessage, choiceLabel, matchMisconception, isAutoGraded } from '../../core/answer.js';
import { itemOutcome, OUTCOME_LABELS } from '../../core/progress.js';
import { submitAttempt, triedChoices, isTriedChoice, remainingChoices, wrongChoiceMessage, solvedBadge, showsExplanation, REPEAT_CHOICE_MESSAGE, WRONG_MESSAGE } from '../../core/tries.js';
import { createAnswerField } from './answer-field.js';
import { optionOrder } from '../../core/shuffle.js';
import { isFirstTry, noteFirst, firstOf, UNAIDED_UNKNOWN_NOTE, UNAIDED_SAMPLE_HELD_NOTE } from '../../core/unaided.js';

const BADGE_OUTCOMES = ['correct', 'hinted-correct', 'solution-seen'];

// explain: 이 문항만의 풀이 글(선택). 한 번 이상 틀린 뒤 맞혔을 때 '왜 이 답인가'로 보여 준다(core/tries.js showsExplanation).
// unaided: '도움 없이 먼저' 자리의 문항이면 { locked: () => boolean }(도움이 아직 잠겨 있는가), 아니면 null. 규칙은 core/unaided.js.
// fixedOrder: 보기 섞기를 켠 모듈에서도 이 문항의 보기는 섞지 않는다(core/shuffle.js).
// skipNote: 건너뛴 문항에 '건너뛰었습니다. 원하면 지금 답해도 됩니다.'를 이 칸 안에 붙일 것인가(확인 문항·문제는 블록 쪽 ‘정답과 풀이 보기’가 그 자리를 맡아 false).
export function createGradedItem(ctx, { key, helpKey, answer, misconceptions = [], labelId, label = '', explain = null, unaided = null, skipNote = true, fixedOrder = false }) {
  const { session } = ctx;
  const order = optionOrder(session.mod, session.progress, key, { answer, fixedOrder }); // 학습자에게 보일 보기 차례(섞지 않으면 null)
  let message = null; // { kind: 'ok' | 'wrong' | 'invalid', text, extra }
  let lastSignature = '';

  const field = createAnswerField(answer, {
    labelId, label, order,
    onEnter: () => submit(),
    onInput: () => {
      ctx.guard.markInput();
      if (message?.kind === 'invalid') { message = null; render(); }
    },
  });
  const submitBtn = h('button', { type: 'button', class: 'btn btn-primary', dataset: { action: 'submit' }, onClick: () => submit() }, answer.kind === 'text' || answer.kind === 'expr' ? '적었습니다' : '제출');
  const badge = h('span', { class: 'outcome', hidden: true });
  const feedback = h('div', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
  const compare = h('div', { class: 'compare', hidden: true });
  const el = h('div', { class: 'item', dataset: { key } }, field.el, h('div', { class: 'item-actions' }, submitBtn, badge), feedback, compare);

  function submit() {
    const value = field.getValue();
    // 보기 문항: 이미 틀린 것으로 확인된 보기는 다시 낼 수 없다(시도로 세지 않는다).
    if (isTriedChoice(session.progress.items[key], answer, value)) {
      message = { kind: 'invalid', text: REPEAT_CHOICE_MESSAGE };
      render();
      return;
    }
    const r = grade(value, answer, misconceptions);
    if (r.result === 'invalid') {
      message = { kind: 'invalid', text: invalidMessage(r.reason, answer) };
      render();
      return;
    }
    if (r.result === 'wrong') {
      const text = answer.kind === 'choice' ? wrongChoiceMessage(remainingChoices(session.progress.items[key], answer).length - 1) : WRONG_MESSAGE;
      message = { kind: 'wrong', text, extra: r.feedback };
    } else if (r.result === 'correct') {
      message = { kind: 'ok', text: '맞았습니다.' };
    } else {
      message = { kind: 'ok', text: '적은 답을 저장했습니다. 이 답은 채점하지 않습니다.' };
    }
    // 도움 없이 먼저 하는 자리: 이 부분의 첫 답이면 그 결과를 재시도·도움과 따로 남긴다(한 번뿐).
    const firstTry = unaided !== null && isFirstTry(session.progress, key, helpKey);
    session.update((s) => {
      const next = submitAttempt(s, { key, helpKey, result: r.result === 'self' ? 'self' : r.result, value: String(value), answer });
      return firstTry ? noteFirst(next, key, r.result === 'self' ? 'written' : r.result) : next;
    });
    // 학습 기록: 답의 값·글은 남기지 않는다(결과·횟수·도움 수준·걸린 활동 시간뿐). 등록된 오개념이면 그 번호만 남는다.
    ctx.rec.attempt({ key, helpKey, result: r.result, progress: session.progress, misconceptionIndex: r.result === 'wrong' ? matchMisconception(answer, r.value, misconceptions) : -1, unaided: unaided === null ? undefined : firstTry ? 'first' : 'after', shownOrder: order ?? undefined });
    ctx.announce(r.result === 'wrong' ? '아직 맞지 않습니다.' : '제출했습니다.');
  }

  function render() {
    const state = session.progress;
    const outcome = itemOutcome(state, key, helpKey);
    const rec = state.items[key];
    const solved = Boolean(rec?.solved);
    const graded = isAutoGraded(answer);

    // 입력칸: 푼 문항은 잠그고, 아니면 마지막 입력을 복원한다(처음 그릴 때만 — 입력 중인 글을 덮어쓰지 않는다).
    if (!el.dataset.restored) {
      el.dataset.restored = '1';
      if (rec?.last) field.setValue(rec.last);
    }
    field.setDisabled(solved && graded);
    field.setTried(triedChoices(rec, answer));
    submitBtn.disabled = solved && graded;
    el.classList.toggle('is-solved', solved && graded);

    badge.hidden = !(BADGE_OUTCOMES.includes(outcome) && solved);
    badge.textContent = solvedBadge(rec, outcome, OUTCOME_LABELS[outcome] ?? '');
    badge.dataset.outcome = outcome;

    // 피드백 영역은 내용이 실제로 바뀔 때만 다시 만든다 — 다른 문항이 바뀔 때마다 읽어 주는 일이 없도록.
    const lines = [];
    if (message) {
      lines.push([`msg-${message.kind}`, message.text]);
      // 도움이 잠겨 있는 동안에는 오개념 설명도 미룬다(설명은 도움이다). 잠금이 풀리면 나타난다.
      if (message.extra && !unaided?.locked()) lines.push(['msg-why', message.extra]);
    }
    // 풀이 글도 도움이다 — 도움 없이 먼저 하는 자리에서는 잠금이 풀린 뒤에 보인다.
    if (graded && explain && showsExplanation(rec, outcome) && !unaided?.locked()) lines.push(['msg-why', `왜 이 답인가: ${explain}`]);
    if (!solved && outcome === 'solution-seen') lines.push(['msg-note', '풀이를 열어 보았습니다. 이어서 답을 적어 볼 수 있습니다.']);
    else if (!solved && outcome === 'skipped') { if (skipNote) lines.push(['msg-note', '건너뛰었습니다. 원하면 지금 답해도 됩니다.']); }
    else if (!solved && !message && outcome === 'wrong') lines.push(['msg-note', `이전에 ${rec.wrong}번 시도했습니다.`]);
    else if (!solved && !message && unaided !== null && firstOf(state, key) === 'unknown') lines.push(['msg-note', UNAIDED_UNKNOWN_NOTE]);
    const held = Boolean(unaided?.locked()); // 도움이 잠겨 있는 동안에는 서술형의 예시 답도 미룬다(예시 답은 풀이의 일부다)
    if (held && !graded && solved) lines.push(['msg-note', UNAIDED_SAMPLE_HELD_NOTE]);
    const signature = JSON.stringify(lines);
    if (signature !== lastSignature) {
      lastSignature = signature;
      feedback.replaceChildren(...lines.map(([cls, text]) => h('p', { class: `msg ${cls}`, text })));
    }

    // 자유 서술: 내 답과 예시 답을 나란히 — 맞고 틀림을 가리지 않는다.
    const showCompare = !graded && solved && rec.last && !held;
    compare.hidden = !showCompare;
    if (showCompare) {
      const mine = answer.kind === 'choice' ? choiceLabel(answer, rec.last) : rec.last;
      compare.replaceChildren(
        h('div', { class: 'compare-col' }, h('p', { class: 'compare-head', text: '내 답' }), h('p', { class: 'compare-body', text: mine })),
        h('div', { class: 'compare-col' }, h('p', { class: 'compare-head', text: '예시 답' }), h('p', { class: 'compare-body', text: answer.sample })),
        h('p', { class: 'compare-note', text: '두 답을 나란히 놓고 빠진 것이 있는지 스스로 살펴봅니다.' }));
    }
  }

  render();
  return { el, key, helpKey, refresh: render, focus: () => field.focus() };
}

export function newLabelId() { return uid('lbl-'); }
