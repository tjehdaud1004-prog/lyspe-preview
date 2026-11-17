// 배치 제어: 폭 구간(phone / mid / wide)에 따라 노트를 '아래 시트' 또는 '옆 칸'으로 다룬다.
// CSS 가 모양을 정하고, 여기는 상태(data-* 속성)·초점·접근성(inert, aria-expanded)만 맡는다.
import { h } from './dom.js';
import { BREAKPOINTS, SHEET_STATES, resolveSheetState, isShortLandscapePhone } from '../core/layout.js';

export function createLayout({ root, note, session, rec }) {
  const phoneQuery = window.matchMedia(`(max-width: ${BREAKPOINTS.mid - 0.02}px)`);
  const wideQuery = window.matchMedia(`(min-width: ${BREAKPOINTS.wide}px)`);
  let sheet = 'closed';
  let name = 'wide';
  let wasShort = false; // 지난 apply 때 '낮은 가로 화면'이었는가(회전하면 시트 단추 목록을 다시 정한다)
  let started = false; // 첫 apply 는 시작 상태를 정하는 것이라 구간 '바뀜'으로 세지 않는다

  const noteButton = h('button', { type: 'button', class: 'btn', 'aria-controls': 'note', 'aria-expanded': 'false', onClick: () => toggle() }, '노트');
  const sizeButtons = {
    half: h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => setSheet('half') }, '반 높이'),
    full: h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => setSheet('full') }, '전체 높이'),
  };
  const closeButton = h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => setSheet('closed', { focus: noteButton }) }, '닫기');
  const foldButton = h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => toggle() }, '노트 접기');

  const shortLandscape = () => isShortLandscapePhone(window.innerWidth, window.innerHeight);

  function apply() {
    const prevName = name;
    name = phoneQuery.matches ? 'phone' : wideQuery.matches ? 'wide' : 'mid';
    root.dataset.layout = name;
    let open;
    if (name === 'phone') {
      // 높이가 낮은 가로 화면(휴대폰 가로)에서는 '반 높이' 시트가 너무 낮아 쓸 수 없으므로 전체 높이로 연다.
      sheet = resolveSheetState(sheet, window.innerWidth, window.innerHeight);
      wasShort = shortLandscape();
      open = sheet !== 'closed';
      root.dataset.sheet = sheet;
      root.dataset.note = '';
      note.el.hidden = false;
      note.el.inert = !open; // 닫힌 시트는 탭 순서·화면 읽기에서 빠진다
      for (const k of ['half', 'full']) sizeButtons[k].setAttribute('aria-pressed', String(sheet === k));
      note.controls.replaceChildren(...(shortLandscape() ? [sizeButtons.full, closeButton] : [sizeButtons.half, sizeButtons.full, closeButton]));
    } else {
      const collapsed = session.settings.noteCollapsed;
      open = !collapsed;
      delete root.dataset.sheet;
      root.dataset.note = collapsed ? 'collapsed' : 'open';
      note.el.hidden = collapsed;
      note.el.inert = false;
      note.controls.replaceChildren(foldButton);
    }
    noteButton.setAttribute('aria-expanded', String(open));
    note.resizeInk();
    if (started && name !== prevName) rec.layout(layoutInfo()); // 구간이 바뀔 때마다 한 건(시작 때는 app 이 남긴다)
  }

  function setSheet(state, { focus = null } = {}) {
    if (!SHEET_STATES.includes(state)) return;
    const wasClosed = sheet === 'closed';
    sheet = resolveSheetState(state, window.innerWidth, window.innerHeight);
    apply();
    if (state === 'closed') focus?.focus();
    else if (wasClosed) { note.el.querySelector('#note-title')?.focus({ preventScroll: true }); rec.noteOpen(note.mode()); }
  }

  function toggle() {
    if (name === 'phone') setSheet(sheet === 'closed' ? 'half' : 'closed', { focus: noteButton });
    else {
      const collapsed = !session.settings.noteCollapsed;
      session.updateSettings({ noteCollapsed: collapsed });
      apply();
      if (!collapsed) { note.el.querySelector('#note-title')?.focus({ preventScroll: true }); rec.noteOpen(note.mode()); }
      else noteButton.focus();
    }
  }

  // 학습 기록 layout 이벤트 재료. sheet 는 휴대폰 구간에서만 있다.
  function layoutInfo() {
    const pointer = window.matchMedia('(pointer: coarse)').matches ? 'coarse' : window.matchMedia('(pointer: fine)').matches ? 'fine' : 'none';
    const info = { w: window.innerWidth, h: window.innerHeight, pointer, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
    if (name === 'phone') info.sheet = sheet;
    return info;
  }

  note.el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && name === 'phone' && sheet !== 'closed' && !e.defaultPrevented) {
      e.preventDefault();
      setSheet('closed', { focus: noteButton });
    }
  });
  const orientation = window.matchMedia('(orientation: landscape)');
  for (const q of [phoneQuery, wideQuery, orientation]) q.addEventListener('change', apply);
  // 보험: 일부 환경에서는 미디어 쿼리 change 이벤트가 늦게 오므로, 폭이 바뀔 때 구간이 달라졌는지 직접 다시 확인한다.
  // 휴대폰 구간에서 가로↔세로가 바뀌어 시트 높이 상태를 다시 정해야 하는 경우도 여기서 잡는다.
  const currentName = () => (phoneQuery.matches ? 'phone' : wideQuery.matches ? 'wide' : 'mid');
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (currentName() !== name || (name === 'phone' && (resolveSheetState(sheet, window.innerWidth, window.innerHeight) !== sheet || shortLandscape() !== wasShort))) apply(); }).observe(document.documentElement);
  }

  apply();
  started = true;
  return { noteButton, apply, isPhone: () => name === 'phone', sheetState: () => (name === 'phone' ? sheet : null), setSheet, layoutInfo };
}
