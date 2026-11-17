// 모듈 목록 화면(주소에 ?m= 이 없을 때). 종류를 data/kinds.mjs 의 차례로 묶어 보이고, 모듈마다 '내 상태'를 저장소에서 읽어 적는다.
// 순수한 부분(groupByKind, moduleStatus)은 DOM 없이 시험한다(tests/home.test.js). 이 화면은 저장소를 읽기만 한다 — 진행·복습 기록을 바꾸지 않는다.
import { h, clear, uid } from './dom.js';
import { KINDS } from '../data/kinds.mjs';
import { keys } from '../core/storage.js';
import { VERSION as PROGRESS_VERSION, hasProgress } from '../core/progress.js';
import { sanitizeReview } from '../core/review.js';
import { defaultSettings, sanitizeSettings } from '../core/settings.js';
import { planReviews, canOpen, localDate, validExamDate } from '../data/review.mjs';
import { createEmergencyDisclosure } from './emergency.js';

export const PREVIEW_NOTE = '아직 학습자가 써 본 적이 없는 시험판입니다. 어느 방식이 더 잘 배워지는지는 확인되지 않았습니다.';
export const STATUS_LABELS = Object.freeze({ new: '시작 전', doing: '하는 중', done: '끝냄', review: '복습할 것 있음' });
export const EMPTY_KIND_TEXT = '아직 모듈이 없습니다.';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

/** 목록 줄들 → 종류 차례(KINDS)대로 묶음. 같은 종류 안에서는 order(없으면 맨 뒤), 같으면 id 차례. 모르는 종류의 줄은 버린다. */
export function groupByKind(lines) {
  const list = Array.isArray(lines) ? lines.filter((l) => isObj(l) && typeof l.id === 'string') : [];
  const rank = (l) => (Number.isFinite(l.order) ? l.order : Infinity);
  return KINDS.map((kind) => ({
    kind,
    modules: list.filter((l) => l.kind === kind.id).sort((a, b) => (rank(a) === rank(b) ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : rank(a) - rank(b))),
  }));
}

/** needs 의 id → 제목(목록에 없으면 id 그대로). */
export function needsTitles(line, lines) {
  const byId = new Map((Array.isArray(lines) ? lines : []).map((l) => [l.id, l.title]));
  return (Array.isArray(line.needs) ? line.needs : []).map((id) => byId.get(id) ?? id);
}

/**
 * 한 모듈의 '내 상태'. 저장된 글(없으면 null)만 받는 순수 함수.
 *  progressText : keys.progress(id) 의 값   reviewText : keys.review(id) 의 값   settingsText : keys.settings() 의 값
 *  → 'new' 시작 전 | 'doing' 하는 중 | 'done' 끝냄 | 'review' 복습할 것 있음(끝냈고, 복습 받기가 켜져 있고, 열 수 있는 복습 회차가 있다)
 * 복습 문항이 실제로 있는지는 이 줄만으로는 알 수 없다 — 모듈의 서명이 복습 문항 3개 이상을 요구하므로 있는 것으로 본다.
 */
export function moduleStatus({ id, progressText, reviewText = null, settingsText = null, now = Date.now(), tz = 0 }) {
  const raw = progressText === null || progressText === undefined ? null : parse(progressText);
  if (!isObj(raw) || raw.v !== PROGRESS_VERSION || raw.moduleId !== id) return 'new';
  const state = { step: Number.isInteger(raw.step) ? raw.step : 0, phase: typeof raw.phase === 'string' ? raw.phase : 'reading', items: isObj(raw.items) ? raw.items : {}, help: isObj(raw.help) ? raw.help : {}, predicts: isObj(raw.predicts) ? raw.predicts : {} };
  if (!Number.isFinite(raw.finishedAt)) return hasProgress(state) ? 'doing' : 'new';

  const review = sanitizeReview(reviewText === null ? null : parse(reviewText));
  if (!review.enabled) return 'done';
  const exam = sanitizeSettings(settingsText === null ? null : parse(settingsText), defaultSettings()).examDate;
  const examDate = typeof exam === 'string' && validExamDate(exam, localDate(now, tz)) ? exam : undefined;
  const item = planReviews({ completedAt: raw.finishedAt, done: review.done, examDate, timeOfDay: review.timeOfDay ?? undefined, tzOffsetMin: tz }).items[0];
  return item && item.kind === 'review' && canOpen(item, now, tz) ? 'review' : 'done';
}

/** 저장소에서 읽어 모듈마다 상태를 돌려준다. { [id]: 'new'|'doing'|'done'|'review' } */
export function readStatuses(lines, storage, { now = Date.now(), tz = -new Date().getTimezoneOffset() } = {}) {
  const settingsText = storage.read(keys.settings());
  return Object.fromEntries((Array.isArray(lines) ? lines : []).filter((l) => isObj(l) && typeof l.id === 'string').map((l) => [l.id, moduleStatus({
    id: l.id, progressText: storage.read(keys.progress(l.id)), reviewText: storage.read(keys.review(l.id)), settingsText, now, tz,
  })]));
}

// ---------- 화면 ----------

function radioGroup({ legend, name, options, current, onChange }) {
  return h('fieldset', { class: 'setting' },
    h('legend', { text: legend }),
    h('div', { class: 'radio-row' }, ...options.map((o) => h('label', { class: 'choice choice-inline' },
      h('input', { type: 'radio', name, value: String(o.value), checked: o.value === current, onChange: () => onChange(o.value) }),
      h('span', { text: o.label })))));
}

// 목록 화면의 설정: 모듈 없이 바꿀 수 있는 것(화면 색·글자 크기)만. 나머지는 모듈 안의 '설정'에서 바꾼다. 설정은 모듈 공통이라 같은 저장 칸을 쓴다.
function createHomeSettings({ storage, applySettings }) {
  const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'home-settings-title' });
  const load = () => sanitizeSettings(parse(storage.read(keys.settings())), defaultSettings());
  function render() {
    const s = load();
    const set = (patch) => { const next = { ...s, ...patch }; storage.write(keys.settings(), JSON.stringify(next)); applySettings(next); render(); };
    clear(dialog).append(h('div', { class: 'dialog-body' },
      h('h2', { class: 'dialog-title', id: 'home-settings-title', text: '설정' }),
      radioGroup({ legend: '화면 색', name: 'theme', current: s.theme, onChange: (v) => set({ theme: v }),
        options: [{ value: 'system', label: '기기 설정 따르기' }, { value: 'light', label: '밝게' }, { value: 'dark', label: '어둡게' }] }),
      radioGroup({ legend: '글자 크기', name: 'fontScale', current: s.fontScale, onChange: (v) => set({ fontScale: Number(v) }),
        options: [{ value: 1, label: '보통' }, { value: 1.15, label: '크게' }, { value: 1.3, label: '아주 크게' }] }),
      h('p', { class: 'small', text: '글이 나타나는 방식, 학습 기록, 복습 일정 같은 설정은 모듈 안의 ‘설정’에서 바꿉니다.' }),
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onClick: () => dialog.close(), text: '닫기' }))));
  }
  document.body.append(dialog);
  return { open() { render(); dialog.showModal(); } };
}

/** 목록 화면을 root 에 그린다. lines: index.json 의 줄들. */
export function showHome({ root, lines, storage, applySettings }) {
  const statuses = readStatuses(lines, storage);
  const settings = createHomeSettings({ storage, applySettings });
  const sections = groupByKind(lines).map(({ kind, modules }) => {
    const headId = uid('kind-');
    return h('section', { class: 'kind', 'aria-labelledby': headId },
      h('h2', { class: 'kind-name', id: headId, text: kind.name }),
      h('p', { class: 'small kind-line', text: kind.line }),
      modules.length === 0
        ? h('p', { class: 'small kind-empty', text: EMPTY_KIND_TEXT })
        : h('ul', { class: 'module-list' }, ...modules.map((m) => {
          const before = needsTitles(m, lines);
          return h('li', {},
            h('a', { class: 'module-card', href: `?m=${encodeURIComponent(m.id)}` },
              h('span', { class: 'card-title', text: m.title }),
              h('span', { class: 'module-question small', text: m.centralQuestion }),
              h('span', { class: 'module-meta' },
                h('span', { class: 'status', 'data-status': statuses[m.id], text: `내 상태: ${STATUS_LABELS[statuses[m.id]]}` }),
                before.length > 0 && h('span', { class: 'small', text: `먼저: ${before.join(', ')}` }))));
        })));
  });

  const topbar = h('header', { class: 'topbar' },
    h('p', { class: 'brand', text: 'LySpe' }),
    h('p', { class: 'topbar-title', text: '학습 모듈' }),
    h('div', { class: 'topbar-actions' }, h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => settings.open() }, '설정')));
  const main = h('main', { class: 'reader home', id: 'main', tabindex: '-1' },
    h('header', { class: 'home-head' },
      h('h1', { class: 'module-title', text: 'LySpe 학습 모듈 · 시험판' }),
      h('p', { class: 'home-note' }, h('strong', { text: PREVIEW_NOTE }))),
    ...sections,
    h('div', { class: 'home-foot' }, createEmergencyDisclosure()));
  clear(root).append(h('div', { class: 'layout' }, topbar, h('div', { class: 'columns' }, main)));
  document.title = 'LySpe 학습 모듈 · 시험판';
}
