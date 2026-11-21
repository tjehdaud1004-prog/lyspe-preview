// 한 단위의 점진 표시. 이미 나온 글은 남고(되돌리지 않고), 정지·재개·즉시 펼치기를 지원한다.
// 스크린리더에는 처음부터 단위 전체 글이 들어 있는 숨은 영역을 주고, 눈에 보이는 조각은 aria-hidden 으로 가린다
// — 글자마다 읽히지 않게 하려는 것이다. 끝나면 일반 문단으로 정리한다.
// 일정(어느 조각이 언제 나타나고 언제 '다 나타남'이 되는가)은 core/reveal-plan.js 의 커서가 정한다 — 여기는 그것을 그대로 따른다.
// 나타나는 도중에 단위·속도가 바뀌면 남은 글부터 새 값으로 이어 간다(이미 나온 글은 그대로).
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

export function createTyper({ el, text, parts = [text], getSpeed, getUnit = () => 'char', isHeld, onTick, onStateChange, ramp, gap }) {
  const cursor = createRevealCursor({ text, getUnit, getSpeed, ...(ramp ? { ramp } : {}), gap }); // ramp·gap: 장면의 첫 글(K04 A143)
  const multi = parts.length > 1;
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

  const state = () => ({ done, paused, held, early });
  const notify = () => onStateChange?.(state());

  function complete() {
    clearTimeout(timer);
    timer = null;
    done = true;
    held = false;
    el.classList.remove('is-typing');
    fillText(el, text, parts);
    notify();
  }

  // 나온 조각을 문장 경계에 맞춰 나눠 담는다. 문장 칸(span.sent)은 그 문장의 첫 글자가 나올 때 만든다(안 나온 문장의 자리가 미리 비어 있지 않게).
  // back: 조합 중인 앞 차례(타자)의 글자 수 — 지우고 새 차례를 쓴다(새 글자로 붙지 않는다).
  function write(piece, back = 0) {
    if (back > 0) { lastNode.data = lastNode.data.slice(0, -back); sentUsed -= back; }
    if (!multi) { node.data += piece; lastNode = node; return; }
    let rest = piece;
    while (rest !== '') {
      if (sentUsed === parts[sentIndex].length) { sentIndex += 1; sentUsed = 0; }
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
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
  }

  function tick() {
    timer = null;
    if (done || paused) return;
    if (isHeld()) { // 입력 중에는 글이 스스로 나오지 않는다
      if (!held) { held = true; notify(); }
      schedule(HELD_RETRY_MS);
      return;
    }
    if (held) { held = false; notify(); }
    const step = cursor.next();
    if (step === null) { complete(); return; } // 마지막 조각의 몫까지 머문 뒤 '다 나타남'
    write(step.piece, step.back);
    onTick?.();
    schedule(step.waitMs);
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
    resume() { if (done || !paused) return; paused = false; notify(); schedule(0); },
    finish() { if (!done) { early = true; complete(); } },
    state,
  };
}
