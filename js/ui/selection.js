// 본문에서 문장을 고르면 '노트에 붙이기' / '이 문장 도움'을 한 줄로 보여 준다.
// 고른 글은 단추를 누르는 순간 선택이 풀려도 쓸 수 있게 따로 쥐고 있고, 일정 시간 뒤 스스로 사라진다.
import { h } from './dom.js';

const HIDE_DELAY_MS = 6000;
const PREVIEW_CHARS = 48;

export function createSelectionBar({ flow, note, help }) {
  let current = null;
  let hideTimer = null;

  const quote = h('p', { class: 'selection-quote' });
  const pasteBtn = h('button', { type: 'button', class: 'btn', onClick: () => { if (current) note.pasteQuote(current.text); document.getSelection()?.removeAllRanges(); hide(); } }, '노트에 붙이기');
  const helpBtn = h('button', {
    type: 'button', class: 'btn', 'aria-expanded': 'false', 'aria-controls': 'help-drawer',
    onClick: () => { if (current) help.open({ blockId: current.blockId, helpKey: current.blockId, unitIndex: current.unitIndex, selectedText: current.text, opener: helpBtn }); },
  }, '이 문장 도움');
  const closeBtn = h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => hide() }, '닫기');
  const el = h('div', { class: 'selection-bar', role: 'region', 'aria-label': '고른 문장', hidden: true }, quote, h('div', { class: 'selection-actions' }, pasteBtn, helpBtn, closeBtn));

  function hide() {
    clearTimeout(hideTimer);
    el.hidden = true;
    current = null;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!el.matches(':focus-within, :hover')) hide(); else scheduleHide(); }, HIDE_DELAY_MS);
  }

  document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    const text = sel ? sel.toString().replace(/\s+/g, ' ').trim() : '';
    if (!sel || sel.isCollapsed || text === '') { if (current) scheduleHide(); return; }
    const anchor = sel.anchorNode?.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
    if (!(anchor instanceof Element) || !flow.contains(anchor)) return; // 노트·설정 등 본문 밖은 무시
    const blockEl = anchor.closest('[data-block-id]');
    if (!blockEl) return;
    const unit = anchor.closest('.unit');
    clearTimeout(hideTimer);
    current = { text, blockId: blockEl.dataset.blockId, unitIndex: unit ? Number(unit.dataset.unit) : undefined };
    quote.textContent = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
    el.hidden = false;
  });

  return { el, hide };
}
