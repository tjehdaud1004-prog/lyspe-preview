// 복습 일정을 하루 일정 프로그램(루틴 로그)이 읽어 가는 '받은 일정함'에 써 둔다. LySpe 는 쓰기만 한다.
// 같은 출처일 때만 뜻이 있다(Lyza 안의 /lyon/). 따로 띄운 LySpe 에서도 써 두는 것은 해가 없다.
//
// 저장소 키는 모듈의 접두(lyon.v0.)가 아니다 — 두 프로그램이 함께 쓰는 키다.
//   { "v":1, "items": { "<extId>": { extId, source:"lyon", title, date:"YYYY-MM-DD", time:"HH:mm", minutes, done, cancelled, updatedAt:"<ISO>" } } }
// 읽고-고쳐-쓰기를 하되 다른 source 의 항목과 모르는 필드는 건드리지 않는다. 값이 깨져 있으면 { v:1, items:{} } 로 다시 시작한다.
// 실제 알림은 만들지 않는다 — 알림은 하루 일정 프로그램 쪽 일이다.

export const INBOX_KEY = 'lyza.schedule.inbox.v1';
export const INBOX_SOURCE = 'lyon';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 회차마다 하나로 고정된 id. step 0 은 이어 하기. */
export function extIdOf(moduleId, step) {
  return step === 0 ? `lyon-${moduleId}-resume` : `lyon-${moduleId}-r${step}`;
}

/** 모듈 하나가 쓸 수 있는 id 전부(복습 취소 때 쓴다). */
export function allExtIds(moduleId, maxStep = 3) {
  return [0, ...Array.from({ length: maxStep }, (_, i) => i + 1)].map((s) => extIdOf(moduleId, s));
}

export function inboxTitle({ step, moduleTitle, minutes }) {
  return step === 0 ? `이어 하기: ${moduleTitle}` : `복습: ${moduleTitle} (약 ${minutes}분)`;
}

function parseInbox(text) {
  try {
    const raw = JSON.parse(text);
    if (isObj(raw) && raw.v === 1 && isObj(raw.items)) return raw;
  } catch { /* 깨진 값 */ }
  return { v: 1, items: {} };
}

const FIELDS = ['extId', 'source', 'title', 'date', 'time', 'minutes', 'done', 'cancelled'];
const sameFields = (a, b) => FIELDS.every((k) => a[k] === b[k]);

/**
 * 받은 일정함 text 에 항목 하나를 넣거나 고친다. 새 text 를 돌려준다(바꿀 것이 없으면 받은 text 그대로).
 * item: { extId, title, date, time, minutes, done?, cancelled? }
 * 같은 extId 가 다른 source 의 것이면 건드리지 않는다.
 */
export function upsertInbox(text, item, nowIso) {
  const box = parseInbox(text);
  const prev = box.items[item.extId];
  if (isObj(prev) && prev.source !== INBOX_SOURCE) return text;
  const next = {
    ...(isObj(prev) ? prev : {}),
    extId: item.extId, source: INBOX_SOURCE, title: item.title, date: item.date, time: item.time,
    minutes: item.minutes, done: item.done === true, cancelled: item.cancelled === true,
  };
  if (isObj(prev) && typeof text === 'string' && sameFields(prev, next)) return text;
  next.updatedAt = nowIso;
  box.items[item.extId] = next;
  return JSON.stringify(box);
}

/** 이미 있는 LySpe 항목에 cancelled 를 켠다(없는 항목을 새로 만들지 않는다). 이미 끝난(done) 항목은 취소하지 않는다. */
export function cancelInbox(text, extId, nowIso) {
  const box = parseInbox(text);
  const prev = box.items[extId];
  if (!isObj(prev) || prev.source !== INBOX_SOURCE || prev.cancelled === true || prev.done === true) return text;
  box.items[extId] = { ...prev, cancelled: true, updatedAt: nowIso };
  return JSON.stringify(box);
}

/** 이미 있는 LySpe 항목에 done 을 켠다(없는 항목은 만들지 않는다). */
export function finishInbox(text, extId, nowIso) {
  const box = parseInbox(text);
  const prev = box.items[extId];
  if (!isObj(prev) || prev.source !== INBOX_SOURCE || prev.done === true) return text;
  box.items[extId] = { ...prev, done: true, updatedAt: nowIso };
  return JSON.stringify(box);
}

// ---------- 저장소에 쓰기(storage: core/storage.js 의 createStorage 결과) ----------

function apply(storage, fn) {
  const before = storage.read(INBOX_KEY);
  const after = fn(before);
  if (after !== before) storage.write(INBOX_KEY, after);
}

export const writeInbox = (storage, item, nowIso) => apply(storage, (t) => upsertInbox(t, item, nowIso));
export const cancelInboxItems = (storage, extIds, nowIso) => apply(storage, (t) => extIds.reduce((acc, id) => cancelInbox(acc, id, nowIso), t));
export const finishInboxItem = (storage, extId, nowIso) => apply(storage, (t) => finishInbox(t, extId, nowIso));
