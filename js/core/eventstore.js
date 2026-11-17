// 학습 기록 저장 링: 모듈 하나의 이벤트를 기기 안(localStorage)에만 둔다. 서버로 보내지 않는다.
//  · 상한(MAX_EVENTS)을 넘으면 오래된 것부터 버리고, 버린 건수를 따로 센다(dropped).
//  · 저장이 막혀도(용량 초과·접근 불가) 화면은 계속 동작한다 — 메모리에는 계속 쌓고, 저장 실패 상태만 알린다.
//  · 쓰기는 모아서 한다(append 는 메모리만, flush 가 저장소에 쓴다). 호출하는 쪽이 주기적으로 flush 한다.
// storage 는 core/storage.js 의 래퍼({read, write, remove})다.

export const MAX_EVENTS = 5000;
const TRIM_ON_FAILURE = 0.25; // 쓰기에 실패하면 가장 오래된 이 비율을 버리고 다시 시도한다
const MAX_TRIMS = 8;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function createEventStore({ storage, eventsKey, metaKey, max = MAX_EVENTS, now = Date.now }) {
  let events = [];
  const raw = storage.read(eventsKey);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) events = parsed.filter(isObj);
    } catch { events = []; }
  }
  let meta = { v: 1, dropped: 0, activeMs: 0, lastSeen: null };
  const rawMeta = storage.read(metaKey);
  if (rawMeta !== null) {
    try {
      const m = JSON.parse(rawMeta);
      if (isObj(m) && m.v === 1) {
        meta = {
          v: 1,
          dropped: Number.isInteger(m.dropped) && m.dropped >= 0 ? m.dropped : 0,
          activeMs: Number.isFinite(m.activeMs) && m.activeMs >= 0 ? m.activeMs : 0,
          lastSeen: Number.isFinite(m.lastSeen) ? m.lastSeen : null,
        };
      }
    } catch { /* 깨진 보조 정보는 버린다 */ }
  }
  const lastSeenAtLoad = meta.lastSeen; // 이번 방문이 시작되기 전에 마지막으로 본 시각(gapMs 계산용)
  let dirty = false;
  let persistOk = true;

  function trimToMax() {
    if (events.length > max) {
      const over = events.length - max;
      events.splice(0, over);
      meta.dropped += over;
    }
  }
  trimToMax();

  function writeAll() {
    const okEvents = storage.write(eventsKey, JSON.stringify(events));
    const okMeta = storage.write(metaKey, JSON.stringify(meta));
    return okEvents && okMeta;
  }

  return {
    append(event) {
      events.push(event);
      meta.lastSeen = now();
      trimToMax();
      dirty = true;
    },
    // 활동 시간 누적(모듈 전체, 여러 방문에 걸친 합). 기록이 켜져 있는 동안의 시간만 센다.
    addActive(ms) {
      if (ms > 0) { meta.activeMs += ms; dirty = true; }
    },
    resetActive() { meta.activeMs = 0; dirty = true; },
    // 저장소에 쓴다. 실패하면 오래된 것을 덜어 내며 몇 번 다시 시도하고, 그래도 안 되면 메모리에만 둔다.
    flush() {
      if (!dirty) return persistOk;
      let ok = writeAll();
      // 저장소가 아예 막힌 것(접근 불가)과 공간이 모자란 것(용량 초과)을 구분한다: 작은 값조차 못 쓰면 막힌 것이라
      // 메모리의 기록을 덜어 내지 않는다(덜어 내도 소용이 없다).
      const reachable = ok || (storage.write(`${metaKey}.probe`, '1') && storage.remove(`${metaKey}.probe`));
      for (let i = 0; !ok && reachable && i < MAX_TRIMS && events.length > 0; i += 1) {
        const drop = Math.max(1, Math.ceil(events.length * TRIM_ON_FAILURE));
        events.splice(0, drop);
        meta.dropped += drop;
        ok = writeAll();
      }
      persistOk = ok;
      if (ok) dirty = false;
      return ok;
    },
    // '기록 지우기': 이 모듈의 이벤트·보조 정보를 모두 지운다.
    clear() {
      events = [];
      meta = { v: 1, dropped: 0, activeMs: 0, lastSeen: null };
      dirty = false;
      storage.remove(eventsKey);
      storage.remove(metaKey);
      persistOk = true;
    },
    all: () => events.slice(),
    get count() { return events.length; },
    get dropped() { return meta.dropped; },
    get activeMs() { return meta.activeMs; },
    get lastSeenAtLoad() { return lastSeenAtLoad; },
    get persistOk() { return persistOk; },
    get dirty() { return dirty; },
    max,
  };
}

// JSON Lines: 한 줄에 이벤트 한 건. 마지막 줄도 줄바꿈으로 끝낸다. 줄 수 = 이벤트 수.
export function toJsonLines(events) {
  return events.map((e) => JSON.stringify(e)).join('\n') + (events.length > 0 ? '\n' : '');
}
