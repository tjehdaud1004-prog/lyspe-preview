// 모듈 단위 노트(타이핑·손글씨·종이 선택). 시스템은 종이에 쓴 내용을 모르므로 'paper' 는 선택 표시일 뿐이다.
import { sanitizeStrokes } from './ink.js';

export const NOTE_MODES = ['type', 'ink', 'paper'];
const MAX_TEXT = 20000;

export function createNotes() {
  return { v: 1, mode: 'type', text: '', strokes: [], paperSince: null };
}

export function sanitizeNotes(raw) {
  const n = createNotes();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1) return n;
  if (NOTE_MODES.includes(raw.mode)) n.mode = raw.mode;
  if (typeof raw.text === 'string') n.text = raw.text.slice(0, MAX_TEXT);
  n.strokes = sanitizeStrokes(raw.strokes);
  n.paperSince = Number.isFinite(raw.paperSince) ? raw.paperSince : null;
  if (n.mode !== 'paper') n.paperSince = null;
  return n;
}

export function setMode(notes, mode, now = 0) {
  if (!NOTE_MODES.includes(mode) || notes.mode === mode) return notes;
  return { ...notes, mode, paperSince: mode === 'paper' ? now : null };
}

export const setText = (notes, text) => ({ ...notes, text: String(text).slice(0, MAX_TEXT) });
export const setStrokes = (notes, strokes) => ({ ...notes, strokes });

// 본문에서 고른 문장을 타이핑 노트 끝에 인용으로 붙인다.
export function appendQuote(notes, quote) {
  const q = String(quote).replace(/\s+/g, ' ').trim();
  if (q === '') return notes;
  const gap = notes.text === '' ? '' : notes.text.endsWith('\n') ? '\n' : '\n\n';
  return setText(notes, `${notes.text}${gap}“${q}”\n`);
}
