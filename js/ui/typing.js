// 한 단위의 점진 표시. 이미 나온 글은 남고(되돌리지 않고), 정지·재개·즉시 펼치기를 지원한다.
// 스크린리더에는 처음부터 단위 전체 글이 들어 있는 숨은 영역을 주고, 눈에 보이는 조각은 aria-hidden 으로 가린다
// — 글자마다 읽히지 않게 하려는 것이다. 끝나면 일반 문단으로 정리한다.
// 일정(어느 조각이 언제 나타나고 언제 '다 나타남'이 되는가)은 core/reveal-plan.js 의 커서가 정한다 — 여기는 그것을 그대로 따른다.
// 나타나는 도중에 단위·속도가 바뀌면 남은 글부터 새 값으로 이어 간다(이미 나온 글은 그대로).
// 문장마다 멈춤(stopAtSentences, K04 A180): 한 문장이 끝나면 문(gate)에 서서 next() 를 기다린다. finishSentence() 는 지금 문장까지만, finish() 는 단위 전체를 채운다.
import { createRevealCursor } from '../core/reveal-plan.js';
import { h } from './dom.js';

const HELD_RETRY_MS = 250;

// 문장 줄바꿈(K04 A126): parts 는 글을 문장별로 가른 조각들(이으면 text 와 같다 — core/sentences.js). 조각이 둘 이상이면 문장마다 줄을 바꿔 보인다.
// 보이는 꼴만 바꾼다 — 어느 글자가 언제 나타나는가는 core/reveal-plan.js 의 커서가 그대로 정한다.
export const sentenceSpan = (text) => h('span', { class: 'sent', text });

// 다 나온(또는 바로 보이는) 글을 el 에 채운다. 문장이 하나면 지금처럼 글 한 덩어리.
export function fillText(el, text, parts = [text]) {
  if (parts.length < 2) el.textContent = text;
  else el.replaceChildren(...parts.map(sentenceSpan));
}

// stopAtSentences(K04 A180): 켜면 한 문장이 끝날 때마다 문(gate)에서 멈추고(타이머 없음), next() 가 다음 문장을 잇는다.
// 문장이 하나뿐인 글은 문이 없다. 마지막 문장 끝은 문이 아니라 '다 나타남'.
export function createTyper({ el, text, parts = [text], getSpeed, getUnit = () => 'char', isHeld, onTick, onStateChange, ramp, gap, stopAtSentences = false }) {
  const cursor = createRevealCursor({ text, getUnit, getSpeed, ...(ramp ? { ramp } : {}), gap }); // ramp·gap: 장면의 첫 글(K04 A143)
  const multi = parts.length > 1;
  const stop = stopAtSentences && multi;
  let gated = false; // 한 문장이 끝나 다음 문장 앞에서 기다리는 중
  let passing = false; // next() 가 문을 열었다 — 다음 쓰기가 문장 경계를 넘는다
  let carry = null;  // 문에서 못 쓴 조각 { piece, back, waitMs } — next() 뒤에 쓴다
  let sentIndex = 0; // 지금 글자를 받는 문장
  let sentUsed = 0;  // 그 문장에서 이미 쓴 글자 수
  let typedEl = null;
  let sentNodes = [];
  let timer = null;
  let paused = false;
  let done = false;
  let held = false;
  let early = false; // 다 나타나기 전에 '바로 펼치기'로 끝냈는가
  let node = null;
  let lastNode = null; // 마지막으로 글을 쓴 글 노드 — 조합 중인 음절을 그 자리에서 고쳐 쓴다

  const state = () => ({ done, paused, held, early, gated, sentence: sentIndex }); // sentence: 지금(문에서는 방금 끝난) 문장 번호, 0부터
  const notify = () => onStateChange?.(state());

  function complete() {
    clearTimeout(timer);
    timer = null;
    done = true;
    held = false;
    gated = false;
    carry = null;
    el.classList.remove('is-typing');
    fillText(el, text, parts);
    notify();
  }

  // 나온 조각을 문장 경계에 맞춰 나눠 담는다. 문장 칸(span.sent)은 그 문장의 첫 글자가 나올 때 만든다(안 나온 문장의 자리가 미리 비어 있지 않게).
  // back: 조합 중인 앞 차례(타자)의 글자 수 — 지우고 새 차례를 쓴다(새 글자로 붙지 않는다).
  // 문(stop)에서 문장 끝을 넘는 조각은 끝까지만 쓰고, 못 쓴 나머지를 돌려준다(없으면 '').
  function write(piece, back = 0) {
    if (back > 0) { lastNode.data = lastNode.data.slice(0, -back); sentUsed -= back; }
    if (!multi) { node.data += piece; lastNode = node; return ''; }
    let rest = piece;
    while (rest !== '') {
      if (sentUsed === parts[sentIndex].length) {
        if (stop && !passing && sentIndex < parts.length - 1) return rest;
        passing = false;
        sentIndex += 1; sentUsed = 0;
      }
      if (sentNodes[sentIndex] === undefined) {
        sentNodes[sentIndex] = document.createTextNode('');
        const span = h('span', { class: 'sent' }, sentNodes[sentIndex]);
        typedEl.querySelector('.is-writing')?.classList.remove('is-writing');
        span.classList.add('is-writing');
        typedEl.append(span);
      }
      const take = rest.slice(0, parts[sentIndex].length - sentUsed);
      sentNodes[sentIndex].data += take;
      lastNode = sentNodes[sentIndex];
      sentUsed += take.length;
      rest = rest.slice(take.length);
    }
    return '';
  }

  // 지금 문장을 다 썼고 뒤에 문장이 남았는가(문 바로 앞)
  const atEdge = () => stop && sentUsed === parts[sentIndex].length && sentIndex < parts.length - 1;

  function gate() {
    clearTimeout(timer);
    timer = null;
    gated = true;
    held = false;
    typedEl.querySelector('.is-writing')?.classList.remove('is-writing'); // 서 있는 동안 커서는 없다(▼ 가 대신한다)
    notify();
  }

  // 조각 하나를 쓴다. 문장 끝에 걸리면 못 쓴 나머지를 carry 에 두고 문에 선다 — true 를 돌려준다.
  function put(step) {
    const rest = write(step.piece, step.back);
    if (rest === '') return false;
    carry = { piece: rest, back: 0, waitMs: step.waitMs };
    return true;
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
  }

  function tick() {
    timer = null;
    if (done || paused || gated) return;
    if (isHeld()) { // 입력 중에는 글이 스스로 나오지 않는다
      if (!held) { held = true; notify(); }
      schedule(HELD_RETRY_MS);
      return;
    }
    if (held) { held = false; notify(); }
    const step = carry ?? cursor.next();
    carry = null;
    if (step === null) { complete(); return; } // 마지막 조각의 몫까지 머문 뒤 '다 나타남'
    const blocked = put(step);
    onTick?.();
    if (blocked) { gate(); return; }
    // 문장이 막 끝났으면 그 조각의 머묾을 건너뛰고 곧바로 문을 본다(자판 차례는 음절이 끝나야 하므로 그대로 둔다)
    schedule(atEdge() && getUnit() !== 'keys' ? 0 : step.waitMs);
  }

  return {
    start() {
      el.textContent = '';
      el.classList.add('is-typing');
      node = document.createTextNode('');
      typedEl = h('span', { class: multi ? 'typed typed-sentences' : 'typed', 'aria-hidden': 'true' }, multi ? null : node);
      el.append(h('span', { class: 'sr-only', text }), typedEl);
      if (cursor.done()) { complete(); return; }
      if (cursor.leadMs() > 0) schedule(cursor.leadMs()); else tick(); // 장면 첫 글자 앞의 틈(커서만 깜빡인다)
      notify();
    },
    pause() { if (done || paused) return; paused = true; clearTimeout(timer); timer = null; notify(); },
    resume() { if (done || !paused) return; paused = false; notify(); if (!gated) schedule(0); },
    // 문에서 다음 문장을 잇는다(문에 서 있지 않으면 아무 일도 하지 않는다).
    next() {
      if (done || !gated) return;
      gated = false;
      passing = true;
      notify();
      if (!paused) tick();
    },
    // 바로 펼치기(한 문장): 지금 문장 끝까지만 채우고 문에 선다. 마지막 문장이면 단위가 다 나타난다. 문에 서 있으면 아무 일도 없다.
    finishSentence() {
      if (done || gated) return;
      early = true;
      clearTimeout(timer);
      timer = null;
      for (;;) {
        const step = carry ?? cursor.next();
        carry = null;
        if (step === null) { complete(); return; }
        if (put(step)) { gate(); return; }
      }
    },
    // 바로 펼치기(단위 전체): 접기 · 건너뛰기 · 설정 바꿈이 부른다.
    finish() { if (!done) { early = true; complete(); } },
    state,
  };
}
