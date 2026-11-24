// 노트 패널: 타이핑 / 손글씨 / 종이에 쓰는 중. 모듈 단위로 저장된다.
// 종이는 시스템이 내용을 볼 수 없다 — 그래서 '쓰는 중'이라는 선택만 기록하고, 종이 위 풀이를 했다고 표시하지 않는다.
import { h, uid } from './dom.js';
import { setMode, setText, setStrokes, appendQuote, NOTE_MODES } from '../core/notes.js';
import { createInk } from './ink.js';
import { askConfirm } from './dialog.js';

const MODE_LABELS = { type: '타이핑', ink: '손글씨', paper: '종이에 쓰는 중' };

export function createNote({ session, guard, toast, rec }) {
  const ids = Object.fromEntries(NOTE_MODES.map((m) => [m, { tab: uid('note-tab-'), panel: uid('note-panel-') }]));
  let timer = null;
  let typedLen = session.notes.text.length; // 학습 기록용: 글자 수가 늘어난 만큼만 센다(내용은 보지 않는다)

  const controls = h('div', { class: 'note-controls' });
  const condition = h('p', { class: 'note-condition', id: 'note-condition', hidden: true });

  const textarea = h('textarea', {
    class: 'input input-text note-text', rows: 10, lang: 'ko', id: uid('note-text-'),
    placeholder: '여기에 메모를 적습니다.',
    onInput: () => {
      guard.markInput(); clearTimeout(timer); timer = setTimeout(saveText, 350);
      const len = textarea.value.length;
      if (len > typedLen) rec.noteTyped(len - typedLen);
      typedLen = len;
    },
    onBlur: () => { saveText(); rec.noteFlush(); },
  });
  textarea.value = session.notes.text;
  function saveText() {
    clearTimeout(timer);
    if (textarea.value !== session.notes.text) session.updateNotes((n) => setText(n, textarea.value), { silent: true });
  }

  const ink = createInk({
    getStrokes: () => session.notes.strokes,
    setStrokes: (strokes) => {
      const before = session.notes.strokes.length;
      session.updateNotes((n) => setStrokes(n, strokes), { silent: true });
      if (strokes.length > before) rec.noteStroked(strokes.length - before); // 획 수만 센다(좌표는 기록하지 않는다)
    },
    onDrawing: (value) => guard.setDrawing(value),
    askClear: async () => (await askConfirm({ title: '손글씨를 모두 지울까요?', body: '이 모듈 노트의 손글씨 획이 모두 지워지고, 되돌릴 수 없습니다.', okLabel: '모두 지우기', danger: true })).ok,
  });

  const paperSince = h('p', { class: 'small' });
  const paperPanel = h('div', { class: 'paper' },
    h('p', { class: 'paper-lead', text: '종이에 쓰는 중입니다.' }),
    h('p', { text: '이 화면은 종이에 쓴 내용을 볼 수 없습니다. 그래서 종이에서 한 계산이나 생각은 한 것으로 표시하지 않습니다.' }),
    h('p', { text: '답은 문항의 입력칸에 적어야 기록됩니다. 종이에 쓴 것을 나중에 보고 싶으면 사진이나 메모는 직접 보관해 주세요.' }),
    paperSince,
    h('button', { type: 'button', class: 'btn', onClick: () => select('type', { focus: true }) }, '종이 쓰기 끝내기'));

  const panels = {
    type: h('div', { class: 'note-panel', role: 'tabpanel', id: ids.type.panel, 'aria-labelledby': ids.type.tab },
      h('label', { class: 'sr-only', for: textarea.id, text: '타이핑 노트' }), textarea),
    ink: h('div', { class: 'note-panel', role: 'tabpanel', id: ids.ink.panel, 'aria-labelledby': ids.ink.tab }, ink.el),
    paper: h('div', { class: 'note-panel', role: 'tabpanel', id: ids.paper.panel, 'aria-labelledby': ids.paper.tab }, paperPanel),
  };
  const tabs = Object.fromEntries(NOTE_MODES.map((m) => [m, h('button', {
    type: 'button', role: 'tab', class: 'tab', id: ids[m].tab, 'aria-controls': ids[m].panel,
    onClick: () => select(m),
    onKeydown: (e) => {
      const i = NOTE_MODES.indexOf(m);
      const move = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (move === undefined && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      const nextMode = e.key === 'Home' ? NOTE_MODES[0] : e.key === 'End' ? NOTE_MODES[NOTE_MODES.length - 1] : NOTE_MODES[(i + move + NOTE_MODES.length) % NOTE_MODES.length];
      select(nextMode, { focus: true });
    },
  }, MODE_LABELS[m])]));

  const el = h('aside', { class: 'note', id: 'note', 'aria-labelledby': 'note-title' },
    h('div', { class: 'note-head' }, h('h2', { class: 'note-title', id: 'note-title', tabindex: '-1', text: '노트' }), controls),
    condition,
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': '노트 쓰는 방법' }, ...NOTE_MODES.map((m) => tabs[m])),
    h('div', { class: 'note-body' }, panels.type, panels.ink, panels.paper));

  function select(mode, { focus = false } = {}) {
    const changed = session.notes.mode !== mode;
    session.updateNotes((n) => setMode(n, mode, session.now()), { silent: true });
    if (changed) { rec.noteFlush(); rec.noteOpen(mode); }
    render();
    if (focus) tabs[mode].focus();
    if (mode === 'ink') ink.resize();
  }

  function render() {
    const { mode, paperSince: since } = session.notes;
    for (const m of NOTE_MODES) {
      const on = m === mode;
      tabs[m].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[m].tabIndex = on ? 0 : -1;
      panels[m].hidden = !on;
    }
    paperSince.textContent = since ? `시작한 때: ${new Date(since).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}` : '';
    if (mode === 'ink') requestAnimationFrame(() => ink.resize());
  }

  render();

  return {
    el, controls,
    setCondition(text) {
      condition.hidden = !text;
      condition.replaceChildren(h('span', { class: 'tag', text: '지금 문항 조건' }), ` ${text}`);
    },
    // 본문에서 고른 문장을 타이핑 노트에 붙인다. 화면 전환·스크롤은 하지 않는다(필기를 끊지 않기 위해).
    pasteQuote(text) {
      session.updateNotes((n) => appendQuote(n, text), { silent: true });
      textarea.value = session.notes.text;
      typedLen = textarea.value.length; // 붙이기는 입력으로 세지 않는다(note_attach 로 따로 남는다)
      rec.noteAttach();
      toast.show('타이핑 노트 끝에 붙였습니다.');
    },
    redrawInk: () => ink.redraw(),
    resizeInk: () => ink.resize(),
    reload() { textarea.value = session.notes.text; typedLen = textarea.value.length; render(); ink.redraw(); },
    mode: () => session.notes.mode,
  };
}
