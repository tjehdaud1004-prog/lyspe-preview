// 활동 시간 계산기와 노트 입력 묶음기. 순수 로직 — DOM·타이머를 모른다(시각은 인자로 받는다).
//
// 활동 시간 = 탭이 보이는 시간 중, 입력(포인터·키·스크롤)이 없던 침묵이 기준 시간(IDLE_MS)을 넘긴 뒤의 구간을 뺀 시간.
//  · 기준 시간까지의 침묵은 '읽는 시간'으로 센다(글을 읽는 동안에는 입력이 없다). 넘은 부분만 idle 로 빠진다.
//    그래서 59초 침묵과 61초 침묵의 차이는 2초이지 61초가 아니다(경계에서 값이 튀지 않는다).
//  · idle 이벤트의 ms 는 빠진 길이이므로, 집계기(metrics.time)가 '마지막 이벤트 시각 - 첫 이벤트 시각 - idle 합'으로 활동 시간을 구하면 이 계산기와 같은 값이 된다.
//  · 탭이 가려진 시간은 통째로 뺀다(돌아왔을 때 그 길이를 idle 로 낸다).

// 근거 없는 출발점이다. 사람·과제마다 다를 것이고, 실제 기록에서 침묵 길이의 분포를 본 뒤에 고친다(README 참고).
export const IDLE_MS = 60_000;
// 노트에서 입력이 이만큼 멈추면 한 묶음(note_activity 한 건)으로 닫는다. 이것도 근거 없는 출발점이다.
export const BURST_GAP_MS = 3_000;

export function createActivityClock({ idleMs = IDLE_MS, now = Date.now, onIdle = () => {} } = {}) {
  let visible = true;
  let lastTs = now();       // 시간을 마지막으로 정산한 시각
  let lastInput = lastTs;   // 마지막 입력 시각
  let total = 0;            // 누적 활동 ms
  let pendingIdle = 0;      // 아직 이벤트로 내보내지 않은 빠진 구간
  let hiddenAt = null;
  let idleSignalled = false;

  // [lastTs, t] 를 활동 구간과 빠진 구간으로 가른다.
  function settle(t) {
    if (t <= lastTs) return;
    if (visible) {
      const activeEnd = Math.max(lastTs, Math.min(t, lastInput + idleMs));
      total += activeEnd - lastTs;
      pendingIdle += t - activeEnd;
    }
    lastTs = t;
  }

  function flushIdle() {
    if (pendingIdle > 0) { const ms = Math.round(pendingIdle); pendingIdle = 0; if (ms > 0) onIdle(ms); }
  }

  return {
    // 입력이 있었다. 앞선 침묵이 기준을 넘었다면 그 초과분을 idle 로 낸다.
    input(t = now()) {
      if (!visible) return;
      settle(t);
      flushIdle();
      lastInput = t;
      idleSignalled = false;
    },
    // 지금까지의 활동 시간(ms). 읽기만 하며 idle 이벤트를 내지 않는다.
    active(t = now()) { settle(t); return Math.round(total); },
    // 탭이 가려졌다.
    hide(t = now()) {
      if (!visible) return;
      settle(t);
      flushIdle();
      visible = false;
      hiddenAt = t;
    },
    // 탭이 다시 보인다. 가려져 있던 길이를 idle 로 낸다.
    show(t = now()) {
      if (visible) return;
      const gap = Math.max(0, t - hiddenAt);
      visible = true;
      lastTs = t;
      lastInput = t;
      idleSignalled = false;
      hiddenAt = null;
      if (gap > 0) onIdle(Math.round(gap));
    },
    // 침묵이 기준 시간을 처음 넘은 순간 한 번만 true (session_end 'idle' 을 남길 때 쓴다).
    checkIdle(t = now()) {
      if (!visible || idleSignalled) return false;
      if (t - lastInput >= idleMs) { idleSignalled = true; return true; }
      return false;
    },
    isVisible: () => visible,
    idleMs,
  };
}

// 노트 입력(타이핑 글자 수·획 수)을 입력이 멈춘 뒤 한 건으로 묶는다. 내용은 받지도 않는다 — 개수와 시간뿐이다.
export function createBurst({ gapMs = BURST_GAP_MS, now = Date.now, onFlush = () => {} } = {}) {
  let b = null;
  function flush() {
    if (!b) return;
    const done = b;
    b = null;
    if (done.chars === 0 && done.strokes === 0) return; // 지우기만 한 묶음은 남기지 않는다
    onFlush({ tool: done.tool, chars: done.chars, strokes: done.strokes, activeMs: Math.max(0, Math.round(done.last - done.first)) });
  }
  return {
    add(tool, { chars = 0, strokes = 0 } = {}, t = now()) {
      if (b && (b.tool !== tool || t - b.last >= gapMs)) flush();
      if (!b) b = { tool, chars: 0, strokes: 0, first: t, last: t };
      b.chars += chars;
      b.strokes += strokes;
      b.last = t;
    },
    tick(t = now()) { if (b && t - b.last >= gapMs) flush(); },
    flush,
    discard() { b = null; },
    pending: () => b !== null,
  };
}
