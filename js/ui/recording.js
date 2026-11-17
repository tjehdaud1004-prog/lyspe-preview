// 학습 기록 연결(DOM 쪽): 저장 링·조립기를 만들고, 입력·탭 가림·창 닫힘을 조립기에 알리고,
// 처음 열 때의 안내 한 줄·동의 바꾸기·내보내기·지우기를 맡는다.
// 모든 것은 이 기기 안에서만 일어난다 — 서버로 보내는 길은 없다(내보내기는 Blob 으로 파일을 내려받는 것뿐이다).
import { h } from './dom.js';
import { keys } from '../core/storage.js';
import { createEventStore, toJsonLines } from '../core/eventstore.js';
import { createTelemetry, sanitizeConsent, newRandomKey } from '../core/telemetry.js';

const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'input'];
const FLUSH_EVERY_MS = 3000;
export const NOTICE_TEXT = '기본은 꺼짐입니다. 켜면 푸는 시간·시도 결과·도움 사용 같은 기록만 이 기기에 남기고, 노트와 서술형 답의 글은 남기지 않으며 어디로도 보내지 않습니다.';

// 시작 전 문항 안내와 한 장으로 합친 카드에 싣는 기록 안내의 요점(짧게). 받는 동의는 같다: 기본 꺼짐, 켜면 이 기기 안에만.
export const NOTICE_SHORT = '학습 기록(선택)은 기본 꺼짐입니다. 켜면 푸는 시간·결과 같은 기록만 이 기기에 남고, 어디로도 보내지 않습니다. 설정에서 언제든 바꿉니다.';

export function createRecording({ mod, storage, storageOk, onOpenSettings, onNoticeDone }) {
  const consent = sanitizeConsent(readJson(storage.read(keys.consent())));
  const store = createEventStore({ storage, eventsKey: keys.events(mod.id), metaKey: keys.recmeta(mod.id) });

  // 학습자 키: 기록이 켜져 있을 때만 처음 필요해지는 순간 만든다(기기에서 만든 무작위 값, 계정과 무관).
  let memoryKey = null;
  const learnerKey = () => {
    const saved = storage.read(keys.learnerKey());
    if (typeof saved === 'string' && /^[0-9a-f]{32}$/.test(saved)) return saved;
    memoryKey ??= newRandomKey();
    storage.write(keys.learnerKey(), memoryKey);
    return memoryKey;
  };
  const sessionId = `s${newRandomKey(undefined, 6)}`; // 탭을 열 때마다 새로

  const rec = createTelemetry({ mod, store, learnerKey, sessionId, consent });

  function persistConsent() { storage.write(keys.consent(), JSON.stringify({ v: 1, ...consentState })); }
  let consentState = { ...consent };

  // ---- 시계에 입력·가림을 알린다
  let attached = false;
  function attach() {
    if (attached) return;
    attached = true;
    for (const type of INPUT_EVENTS) document.addEventListener(type, () => rec.input(), { passive: true, capture: true });
    window.addEventListener('scroll', () => rec.input(), { passive: true, capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { rec.hide(); store.flush(); } else rec.show();
    });
    window.addEventListener('pagehide', () => { rec.sessionEnd('unload'); store.flush(); });
    let lastFlush = performance.now();
    setInterval(() => {
      rec.tick();
      const t = performance.now();
      if (store.dirty && t - lastFlush >= FLUSH_EVERY_MS) { lastFlush = t; store.flush(); }
    }, 1000);
  }

  // ---- 안내 한 줄: 모듈 진행을 막지 않는다(포커스를 빼앗지 않고, 닫지 않아도 계속할 수 있다).
  const notice = h('section', { class: 'rec-notice', 'aria-labelledby': 'rec-notice-title', hidden: consentState.noticeSeen });
  function renderNotice() {
    notice.hidden = consentState.noticeSeen;
    notice.replaceChildren(
      h('p', { class: 'rec-notice-text' }, h('strong', { id: 'rec-notice-title', text: '학습 기록(선택) ' }), NOTICE_TEXT),
      h('div', { class: 'rec-notice-actions' },
        h('button', { type: 'button', class: 'btn', dataset: { action: 'record-on' }, onClick: () => api.setRecord(true, { fromNotice: true }) }, '기록 켜기'),
        h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => { const wasSeen = consentState.noticeSeen; consentState.noticeSeen = true; persistConsent(); renderNotice(); if (!wasSeen) onNoticeDone?.(); } }, '계속 끄기'),
        h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => onOpenSettings?.() }, '설정')));
  }
  renderNotice();

  const api = {
    rec, store, notice,
    persistent: storageOk,
    get consent() { return { ...consentState }; },
    // 기록 시작: 켜져 있으면 이번 방문의 session_start·module_open·layout 을 남긴다.
    start(beginInfo) {
      rec.setBeginInfo(beginInfo);
      attach();
      rec.begin();
    },
    // 동의 스위치. 켜면 지금부터 남기고, 끄면 그 뒤로 남기지 않는다(이미 남은 것은 '기록 지우기'로 지운다).
    setRecord(on, { fromNotice = false } = {}) {
      if (!on && rec.recording) { rec.noteFlush(); store.flush(); } // 끄기 직전까지의 묶음은 이미 허락받은 기록이다
      const noticeWasSeen = consentState.noticeSeen;
      consentState = sanitizeConsent({ ...consentState, record: on, noticeSeen: consentState.noticeSeen || fromNotice || true });
      persistConsent();
      rec.setConsent({ record: consentState.record, questionText: consentState.questionText });
      renderNotice();
      if (!noticeWasSeen) onNoticeDone?.(); // 처음 안내가 이 선택으로 닫혔다 — 다음 차례(시작 전 문항 · 본문)를 연다
      return consentState.record;
    },
    // 시작 전 문항 안내와 합친 카드에서 단추를 눌렀다: 안내를 본 것으로 하고 고른 동의를 저장한다(기록 안내 띠의 '기록 켜기'·'계속 끄기'와 같은 결과).
    // 다음 차례(시작 전 문항·본문)는 그 카드가 이미 열고 있으므로 onNoticeDone 을 부르지 않는다.
    acknowledgeNotice({ record }) {
      consentState = sanitizeConsent({ ...consentState, record: record === true, noticeSeen: true });
      persistConsent();
      rec.setConsent({ record: consentState.record, questionText: consentState.questionText });
      renderNotice();
      return consentState.record;
    },
    // '질문 글도 남기기' 스위치. 연결된 서비스가 없으면 켜지지 않는다(sanitizeConsent). 기록이 꺼져 있어도 켜지지 않는다.
    setQuestionText(on) {
      consentState = sanitizeConsent({ ...consentState, questionText: on });
      persistConsent();
      rec.setConsent({ record: consentState.record, questionText: consentState.questionText });
      return consentState.questionText;
    },
    // 내보내기: JSON Lines 파일을 Blob 으로 만들어 내려받는다. 외부 전송이 아니다.
    exportFile() {
      store.flush();
      const text = toJsonLines(store.all());
      const blob = new Blob([text], { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `lyon-${mod.id}-events.jsonl` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return { lines: store.count, bytes: blob.size };
    },
    // 기록 지우기: 이 모듈의 이벤트를 모두 지운다. 지운 직후의 건수는 0이다.
    clearRecords() {
      rec.noteFlush();
      store.clear();
    },
  };
  return api;
}

function readJson(text) {
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}
