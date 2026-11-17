// 사용자 설정. 표시 방식·속도·나타나는 단위는 설계값으로 잠그지 않고 사용자가 바꾼다.
import { SPEEDS, TEXT_UNITS, DEFAULT_TEXT_UNIT } from './segment.js';
import { FLOW_VIEWS, DEFAULT_FLOW_VIEW } from './sceneview.js';
import { parseDate } from '../data/review.mjs';

export const DISPLAY_MODES = ['typing', 'instant'];
export const THEMES = ['system', 'light', 'dark'];
export const FONT_SCALES = [1, 1.15, 1.3];

// 움직임 줄이기를 켠 사람의 기본값은 즉시 표시다(저장된 선택이 있으면 그것이 우선).
// unit(나타나는 단위)은 점진 표시일 때만 쓰인다. 기본 어절 — 어느 단위가 더 낫다는 근거는 아직 없고, 바꿔 가며 비교할 수 있게 둔다.
// view(본문 보기 방식)는 기본 '장면별로 보기'; '이어서 쌓기'(긴 스크롤)는 선택이다. 저장된 선택이 있으면 그것이 우선.
export function defaultSettings({ reducedMotion = false } = {}) {
  return {
    display: reducedMotion ? 'instant' : 'typing',
    unit: DEFAULT_TEXT_UNIT,
    view: DEFAULT_FLOW_VIEW,
    speed: 'normal',
    autoContinue: false,
    theme: 'system',
    fontScale: 1,
    noteCollapsed: true, // 노트는 처음에는 접힌 채(K04 A123 — 본문까지 화면이 한 번에 하나). 저장된 값이 있으면 그 값을 따른다
    examDate: null, // 시험 날짜(선택, 'YYYY-MM-DD'). 모듈 공통이라 설정에 둔다. 복습 간격을 줄이는 데만 쓴다(data/review.mjs)
  };
}

export function sanitizeSettings(raw, defaults) {
  const s = { ...defaults };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return s;
  if (DISPLAY_MODES.includes(raw.display)) s.display = raw.display;
  if (TEXT_UNITS.includes(raw.unit)) s.unit = raw.unit;
  if (FLOW_VIEWS.includes(raw.view)) s.view = raw.view;
  if (Object.hasOwn(SPEEDS, raw.speed)) s.speed = raw.speed;
  if (typeof raw.autoContinue === 'boolean') s.autoContinue = raw.autoContinue;
  if (THEMES.includes(raw.theme)) s.theme = raw.theme;
  if (FONT_SCALES.includes(raw.fontScale)) s.fontScale = raw.fontScale;
  if (typeof raw.noteCollapsed === 'boolean') s.noteCollapsed = raw.noteCollapsed;
  if (raw.examDate === null || parseDate(raw.examDate) !== null) s.examDate = raw.examDate ?? null;
  return s;
}

// 설정 바뀜 → setting_change 재료(모든 값은 문자열). 시험 날짜는 기록에 남기지 않는다(복습 일정 기록도 있는지만 남긴다).
const UNRECORDED = ['examDate'];
export function diffSettings(prev, next) {
  const out = [];
  for (const key of Object.keys(next)) {
    if (UNRECORDED.includes(key)) continue;
    if (prev[key] !== next[key]) out.push({ key, from: String(prev[key]), to: String(next[key]) });
  }
  return out;
}
