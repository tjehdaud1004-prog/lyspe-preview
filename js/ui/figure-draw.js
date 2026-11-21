// image 그림(SVG)을 인라인으로 넣고, 그려지듯 나오게 한다(K04 A144, 일정은 core/draw.js).
// 애니메이션은 Web Animations(element.animate) — CSP 가 style-src 'self' 라 <style> · style 속성 대신 CSSOM 으로만 움직인다.
import { DRAW, planDraw } from '../core/draw.js';
import { uid } from './dom.js';

const SKIP = 'defs, marker, clipPath, mask, pattern, symbol, title, desc';
const SHAPES = 'path, line, polyline, polygon, circle, ellipse, rect';
const WIPE_PAD = '24px'; // 화살촉 같은 선 밖의 것이 잘리지 않게 닦아내기 상자를 넉넉히

// 받은 글을 SVG 요소로. 스크립트 · 이벤트 속성 · 바깥 href 를 지우고, id 는 그림마다 달리 바꿔(같은 마커 id 가 겹치지 않게) 문서에 넣을 수 있게 한다.
export function parseInlineSvg(text, { alt = '', cls = 'fig-image' } = {}) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.querySelector('parsererror')) return null;
  for (const el of [...root.querySelectorAll('script, foreignObject, iframe, object, embed')]) el.remove();
  const prefix = uid('fg');
  const ids = new Map();
  for (const el of root.querySelectorAll('[id]')) ids.set(el.id, `${prefix}-${el.id}`);
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) {
      const name = a.name.toLowerCase();
      if (name.startsWith('on')) { el.removeAttribute(a.name); continue; }
      if ((name === 'href' || name.endsWith(':href')) && !a.value.trim().startsWith('#')) { el.removeAttribute(a.name); continue; }
      if (name === 'id') { a.value = ids.get(a.value) ?? a.value; continue; }
      if (/url\(|^#/.test(a.value)) {
        a.value = a.value.replace(/url\(\s*#([^)\s]+)\s*\)/g, (m, id) => (ids.has(id) ? `url(#${ids.get(id)})` : m)).replace(/^#(.+)$/, (m, id) => (ids.has(id) ? `#${ids.get(id)}` : m));
      }
    }
  }
  const svg = document.importNode(root, true);
  svg.setAttribute('class', cls);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', alt);
  return svg;
}

// 같은 출처의 파일만 받는다. 실패하면 던진다(부른 쪽이 <img> 로 되돌린다).
export async function loadInlineSvg(url, opts) {
  const abs = new URL(url, location.href);
  if (abs.origin !== location.origin) throw new Error('다른 출처');
  const res = await fetch(abs);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const svg = parseInlineSvg(await res.text(), opts);
  if (!svg) throw new Error('SVG 아님');
  return svg;
}

// 그림을 그린다. 차례 표시(data-draw)가 없으면 문서 순서. { finish(), finished } — finish 는 바로 다 보이게 한다.
export function drawSvg(root) {
  const vb = root.viewBox?.baseVal;
  const jobs = [];
  for (const el of root.querySelectorAll(`${SHAPES}, text`)) {
    if (el.closest(SKIP)) continue;
    const cs = getComputedStyle(el);
    const isText = el.localName === 'text';
    const hasFill = isText || cs.fill !== 'none';
    const hasStroke = !isText && cs.stroke !== 'none';
    if (!hasFill && !hasStroke) continue;
    let bb;
    try { bb = el.getBBox(); } catch { continue; }
    if (el.localName === 'rect' && vb && bb.width >= vb.width * 0.9 && bb.height >= vb.height * 0.9) continue; // 바탕 틀은 그대로 둔다
    const stroked = hasStroke && !hasFill;
    const wipe = stroked && (cs.strokeDasharray !== 'none' || cs.markerEnd !== 'none' || cs.markerStart !== 'none' || typeof el.getTotalLength !== 'function');
    const len = stroked && !wipe ? el.getTotalLength() : Math.hypot(bb.width, bb.height);
    jobs.push({ el, bb, phase: stroked ? 'line' : 'fill', how: stroked ? (wipe && Math.max(bb.width, bb.height) >= 2 ? 'wipe' : wipe ? 'fade' : 'dash') : 'fade', len, key: el.hasAttribute('data-draw') ? Number(el.getAttribute('data-draw')) : NaN });
  }
  const { slots } = planDraw(jobs);
  const anims = jobs.map((j, i) => {
    const timing = { delay: slots[i].start, duration: slots[i].duration, easing: DRAW.EASE, fill: 'backwards' };
    if (j.how === 'dash') {
      const L = j.len * 1.01 + 1;
      return j.el.animate([{ strokeDasharray: `${L} ${L}`, strokeDashoffset: L }, { strokeDasharray: `${L} ${L}`, strokeDashoffset: 0 }], timing);
    }
    if (j.how === 'wipe') {
      const p = WIPE_PAD;
      const horizontal = j.bb.width >= j.bb.height;
      const from = horizontal ? `inset(-${p} 100% -${p} -${p})` : `inset(-${p} -${p} 100% -${p})`;
      return j.el.animate([{ clipPath: from }, { clipPath: `inset(-${p})` }], timing);
    }
    return j.el.animate([{ opacity: 0 }, { opacity: 1 }], timing);
  });
  root.setAttribute('data-drawing', 'true');
  const finished = Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => { root.removeAttribute('data-drawing'); root.setAttribute('data-drawn', 'true'); });
  return { finish() { for (const a of anims) { try { a.finish(); } catch { /* 이미 끝남 */ } } }, finished };
}
