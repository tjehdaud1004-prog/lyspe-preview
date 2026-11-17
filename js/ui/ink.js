// 손글씨 캔버스. 포인터 이벤트 하나로 마우스·터치·펜을 모두 받는다.
// 획은 논리 좌표(core/ink.js)로 저장하고, 크기가 바뀌면 저장된 획에서 다시 그린다 — 화면 회전·창 크기 변경에도 남는다.
import { h } from './dom.js';
import { INK_W, INK_H, toInkPoint, appendPoint, addStroke, undoStroke, inkScale } from '../core/ink.js';

const LINE_LOGICAL = 3.2; // 논리 단위의 선 굵기
const MIN_LINE_PX = 1.8;  // 작은 화면에서도 이보다 가늘어지지 않게

export function createInk({ getStrokes, setStrokes, onDrawing, askClear }) {
  const canvas = h('canvas', {
    class: 'ink-canvas', role: 'img',
    'aria-label': '손글씨 영역입니다. 손가락, 마우스, 펜으로 쓸 수 있습니다. 키보드로 적으려면 타이핑 탭을 사용하세요.',
  });
  const wrap = h('div', { class: 'ink-wrap' }, canvas);
  const undoBtn = h('button', { type: 'button', class: 'btn', onClick: () => undo() }, '되돌리기');
  const clearBtn = h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => clearAll() }, '전체 지우기');
  const count = h('span', { class: 'small ink-count', 'aria-live': 'polite' });
  const el = h('div', { class: 'ink' }, h('div', { class: 'ink-tools' }, undoBtn, clearBtn, count), wrap);

  let current = null;
  let activePointer = null;
  let scale = 0;

  const ctx = () => canvas.getContext('2d');
  const color = () => getComputedStyle(canvas).color;

  function style(c) {
    c.strokeStyle = color();
    c.fillStyle = color();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = Math.max(LINE_LOGICAL, MIN_LINE_PX / (scale || 1));
  }

  function drawStroke(c, stroke) {
    const pts = stroke.pts;
    style(c);
    if (pts.length === 1) {
      c.beginPath();
      c.arc(pts[0][0], pts[0][1], c.lineWidth / 2, 0, Math.PI * 2);
      c.fill();
      return;
    }
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 1) c.lineTo(pts[i][0], pts[i][1]);
    c.stroke();
  }

  function redraw() {
    if (canvas.width === 0) return;
    const c = ctx();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.setTransform(canvas.width / INK_W, 0, 0, canvas.width / INK_W, 0, 0);
    scale = inkScale(wrap.clientWidth);
    for (const s of getStrokes()) drawStroke(c, s);
    if (current) drawStroke(c, current);
    refreshButtons();
  }

  function resize() {
    const width = wrap.clientWidth;
    if (width === 0) return; // 숨겨진 탭이면 보일 때 다시 온다
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(width * (INK_H / INK_W) * dpr);
    redraw();
  }

  function refreshButtons() {
    const n = getStrokes().length;
    undoBtn.disabled = n === 0;
    clearBtn.disabled = n === 0;
    count.textContent = n === 0 ? '아직 쓴 획이 없습니다.' : `획 ${n}개`;
  }

  function undo() {
    setStrokes(undoStroke(getStrokes()));
    redraw();
  }

  async function clearAll() {
    if (getStrokes().length === 0) return;
    if (await askClear()) { setStrokes([]); redraw(); }
  }

  function endStroke() {
    if (!current) return;
    setStrokes(addStroke(getStrokes(), current));
    current = null;
    activePointer = null;
    onDrawing(false);
    redraw();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (activePointer !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    activePointer = e.pointerId;
    current = { pts: [toInkPoint(e.clientX, e.clientY, canvas.getBoundingClientRect())] };
    onDrawing(true);
    const c = ctx();
    c.setTransform(canvas.width / INK_W, 0, 0, canvas.width / INK_W, 0, 0);
    drawStroke(c, current);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer || !current) return;
    const events = typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length ? e.getCoalescedEvents() : [e];
    const c = ctx();
    c.setTransform(canvas.width / INK_W, 0, 0, canvas.width / INK_W, 0, 0);
    style(c);
    for (const ev of events) {
      const rect = canvas.getBoundingClientRect();
      const prev = current.pts[current.pts.length - 1];
      const next = toInkPoint(ev.clientX, ev.clientY, rect);
      if (appendPoint(current, next)) {
        c.beginPath();
        c.moveTo(prev[0], prev[1]);
        c.lineTo(next[0], next[1]);
        c.stroke();
      }
    }
  });

  for (const type of ['pointerup', 'pointercancel']) {
    canvas.addEventListener(type, (e) => { if (e.pointerId === activePointer) endStroke(); });
  }
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(wrap);
  refreshButtons();

  return { el, redraw, resize, undo };
}
