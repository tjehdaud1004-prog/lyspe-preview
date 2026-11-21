// 그림 블록: 표(HTML table)와 직선 그래프(인라인 SVG). 모듈 데이터의 figures 정의를 그린다.
import { h, svg, clear, uid } from './dom.js';
import { linesGeometry, pointsGeometry, POINT_SHAPES } from '../core/chart.js';
import { markValueText } from '../core/reveal.js';
import { loadInlineSvg, drawSvg } from './figure-draw.js';

function renderTable(def) {
  const head = def.columns.map((c, i) => h('th', { scope: 'col', text: c || (i === 0 ? '구분' : '') }));
  const rows = def.rows.map((row) => h('tr', {},
    h('th', { scope: 'row', text: row[0] }),
    ...row.slice(1).map((cell) => h('td', { text: cell }))));
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'fig-table' }, h('caption', { text: def.caption }), h('thead', {}, h('tr', {}, ...head)), h('tbody', {}, ...rows)));
}

function drawLines(host, def, alt, labelId, masked = false) {
  const width = Math.max(260, Math.round(host.clientWidth || 320));
  const height = Math.round(Math.min(360, Math.max(240, width * 0.68)));
  const g = linesGeometry(def, { width, height });
  const { plot } = g;
  const kids = [];

  for (const t of g.yTicks) {
    kids.push(svg('line', { class: 'chart-grid', x1: plot.x0, x2: plot.x1, y1: t.py, y2: t.py }));
    kids.push(svg('text', { class: 'chart-tick', x: plot.x0 - 8, y: t.py + 4, 'text-anchor': 'end', text: t.label }));
  }
  for (const t of g.xTicks) {
    kids.push(svg('line', { class: 'chart-grid chart-grid-x', x1: t.px, x2: t.px, y1: plot.y0, y2: plot.y1 }));
    kids.push(svg('text', { class: 'chart-tick', x: t.px, y: plot.y1 + 18, 'text-anchor': 'middle', text: t.label }));
  }
  kids.push(svg('line', { class: 'chart-axis', x1: plot.x0, x2: plot.x1, y1: plot.y1, y2: plot.y1 }));
  kids.push(svg('line', { class: 'chart-axis', x1: plot.x0, x2: plot.x0, y1: plot.y0, y2: plot.y1 }));
  kids.push(svg('text', { class: 'chart-label', x: (plot.x0 + plot.x1) / 2, y: height - 10, 'text-anchor': 'middle', text: def.xLabel }));
  kids.push(svg('text', { class: 'chart-label', x: plot.x0, y: plot.y0 - 12, 'text-anchor': 'start', text: def.yLabel }));

  // 선은 색만으로 구별하지 않는다: 실선/점선으로도 다르게 하고, 위쪽 범례와 선 끝의 글자로 이름을 붙인다.
  g.series.forEach((s, i) => {
    kids.push(svg('line', { class: `chart-line chart-line-${i}`, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 }));
    kids.push(svg('text', { class: `chart-series chart-series-${i}`, x: s.x2 + 7, y: s.y2 + 5, 'text-anchor': 'start', text: s.id }));
  });
  let legendX = plot.x0;
  g.series.forEach((s, i) => {
    kids.push(svg('line', { class: `chart-line chart-line-${i}`, x1: legendX, y1: 14, x2: legendX + 30, y2: 14 }));
    kids.push(svg('text', { class: `chart-series chart-series-${i}`, x: legendX + 36, y: 19, 'text-anchor': 'start', text: s.label }));
    legendX += 36 + s.label.length * 12 + 14;
  });
  for (const m of g.marks) {
    kids.push(svg('line', { class: 'chart-guide', x1: m.px, x2: m.px, y1: m.py, y2: plot.y1 }));
    kids.push(svg('line', { class: 'chart-guide', x1: plot.x0, x2: m.px, y1: m.py, y2: m.py }));
    kids.push(svg('circle', { class: 'chart-mark', cx: m.px, cy: m.py, r: 6 }));
    // 두 줄 글을 교점의 '왼쪽 위'에 둔다: 오른쪽 위로는 가파른 직선이, 왼쪽 아래로는 다른 직선이 지나가지만
    // 왼쪽 위(두 직선 모두의 위쪽)는 비어 있다. 줄을 나눠 좁은 화면에서도 그림 밖으로 나가지 않게 한다.
    const lines = [m.label, markValueText(def, m, masked)]; // masked: 관련 문항을 풀기 전에는 세로 값을 가린다(core/reveal.js)
    lines.forEach((text, i) => kids.push(svg('text', { class: 'chart-mark-label', x: m.px - 12, y: m.py - 32 + i * 18, 'text-anchor': 'end', text })));
  }
  const root = svg('svg', { class: 'chart', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-labelledby': labelId }, ...kids);
  clear(host).append(root);
}

// 점 하나의 모양: 원·네모·세모. 같은 모양을 범례의 작은 그림에도 쓴다.
function pointMark(shape, cx, cy, r, cls) {
  if (shape === 'square') return svg('rect', { class: cls, x: cx - r, y: cy - r, width: r * 2, height: r * 2 });
  if (shape === 'triangle') return svg('polygon', { class: cls, points: `${cx},${cy - r - 1} ${cx + r + 1},${cy + r} ${cx - r - 1},${cy + r}` });
  return svg('circle', { class: cls, cx, cy, r });
}

// 점 그래프: 점 모양과 색을 함께 써서 계열을 가르고, 점을 잇는 옅은 선은 읽기 쉽게 한 길잡이일 뿐이라 범례 아래에 그렇게 적는다.
// 수직선: 세로축·세로 눈금·세로 격자 없이, 계열마다 가로 줄 하나. 계열 이름은 줄 위 왼쪽에 쓴다.
function drawNumberLine(host, def, labelId, width) {
  const g = pointsGeometry(def, { width, height: 0 });
  const { plot, height } = g;
  const kids = [];
  g.rows.forEach((row, i) => {
    kids.push(svg('text', { class: 'chart-label chart-row-label', x: plot.x0, y: row.labelY, 'text-anchor': 'start', text: row.label }));
    kids.push(svg('line', { class: 'chart-axis', x1: plot.x0, x2: plot.x1, y1: row.lineY, y2: row.lineY }));
    for (const t of g.xTicks) {
      kids.push(svg('line', { class: `chart-numline-tick${t.zero ? ' chart-numline-zero' : ''}`, x1: t.px, x2: t.px, y1: row.lineY - 6, y2: row.lineY + 6 }));
      if (t.showLabel) kids.push(svg('text', { class: `chart-tick${t.zero ? ' chart-tick-zero' : ''}`, x: t.px, y: row.tickLabelY, 'text-anchor': 'middle', text: t.label }));
    }
    const s = g.series[i];
    if (s.guide) kids.push(svg('polyline', { class: `chart-guide-line chart-guide-line-${i}`, points: s.points.map((p) => `${p.px},${p.py}`).join(' ') }));
  });
  g.series.forEach((s, i) => s.points.forEach((p) => {
    const mark = pointMark(s.shape, p.px, p.py, 6, `chart-point chart-point-${i}`);
    mark.append(svg('title', { text: def.hideValues === true ? s.label : `${s.label}: ${p.text}` })); // hideValues: 점의 값을 읽는 문항에서 마우스를 올리거나 길게 눌러 답이 보이지 않게
    kids.push(mark);
  }));
  kids.push(svg('text', { class: 'chart-label', x: (plot.x0 + plot.x1) / 2, y: height - 6, 'text-anchor': 'middle', text: def.x.label }));
  clear(host).append(svg('svg', { class: 'chart chart-numberline', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-labelledby': labelId }, ...kids));
}

function drawPoints(host, def, labelId) {
  const width = Math.max(260, Math.round(host.clientWidth || 320));
  if (def.numberLine === true) { drawNumberLine(host, def, labelId, width); return; }
  const height = Math.round(Math.min(340, Math.max(230, width * 0.62)));
  const g = pointsGeometry(def, { width, height });
  const { plot } = g;
  const kids = [];
  for (const t of g.yTicks) {
    kids.push(svg('line', { class: 'chart-grid', x1: plot.x0, x2: plot.x1, y1: t.py, y2: t.py }));
    kids.push(svg('text', { class: 'chart-tick', x: plot.x0 - 8, y: t.py + 4, 'text-anchor': 'end', text: t.label }));
  }
  for (const t of g.xTicks) {
    kids.push(svg('line', { class: 'chart-grid chart-grid-x', x1: t.px, x2: t.px, y1: plot.y0, y2: plot.y1 }));
    kids.push(svg('text', { class: 'chart-tick', x: t.px, y: plot.y1 + 18, 'text-anchor': 'middle', text: t.label }));
  }
  kids.push(svg('line', { class: 'chart-axis', x1: plot.x0, x2: plot.x1, y1: plot.y1, y2: plot.y1 }));
  kids.push(svg('line', { class: 'chart-axis', x1: plot.x0, x2: plot.x0, y1: plot.y0, y2: plot.y1 }));
  kids.push(svg('text', { class: 'chart-label', x: (plot.x0 + plot.x1) / 2, y: height - 10, 'text-anchor': 'middle', text: def.x.label }));
  kids.push(svg('text', { class: 'chart-label', x: plot.x0, y: plot.y0 - 14, 'text-anchor': 'start', text: def.y.label }));
  g.series.forEach((s, i) => {
    if (s.guide) kids.push(svg('polyline', { class: `chart-guide-line chart-guide-line-${i}`, points: s.points.map((p) => `${p.px},${p.py}`).join(' ') }));
  });
  g.series.forEach((s, i) => s.points.forEach((p) => {
    const mark = pointMark(s.shape, p.px, p.py, 5.5, `chart-point chart-point-${i}`);
    mark.append(svg('title', { text: def.hideValues === true ? s.label : `${s.label}: ${p.text}` }));
    kids.push(mark);
  }));
  clear(host).append(svg('svg', { class: 'chart', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-labelledby': labelId }, ...kids));
}

export function renderFigure(def, alt, opts) { return createFigure(def, alt, opts).el; }

// 나중에 고칠 수 있는 그림: update({ alt, masked }) 로 텍스트 대체와 '값 가리기'를 바꾼다.
// base: 모듈 폴더의 주소(modules/<id>/) — image 꼴의 src 가 그 폴더 안의 상대 경로다.
export function createFigure(def, alt, { masked = false, base = '', inline = false } = {}) {
  if (def.kind === 'image') {
    // 진짜 그림 파일. 대체 글은 하나로 둔다(같은 글을 두 번 읽지 않게): <img> 는 alt, 인라인 SVG 는 role="img" 의 aria-label.
    // inline: 같은 출처 SVG 를 받아 문서에 넣는다(안의 선을 움직이려고 — K04 A144). 받기에 실패하면 <img>.
    let label = alt ?? def.alt;
    const mkImg = () => h('img', { class: 'fig-image', src: base + def.src, alt: label, decoding: 'async' });
    const cap = def.caption ? h('figcaption', { class: 'fig-caption', text: def.caption }) : null;
    let node = inline ? null : mkImg();
    const host = inline ? h('div', { class: 'fig-image-host' }) : null;
    const place = (n) => { node = n; host.replaceChildren(n); };
    const ready = inline
      ? loadInlineSvg(base + def.src, { alt: label }).then((s) => place(s), () => place(mkImg()))
      : Promise.resolve();
    return {
      el: h('figure', { class: 'figure figure-image' }, host ?? node, cap),
      update(next) {
        if (next.alt === undefined) return;
        label = next.alt;
        if (node?.localName === 'img') node.alt = label; else node?.setAttribute('aria-label', label);
      },
      // 그리기: { finish(), done } — 그릴 수 없으면(인라인이 아님 · 받기 실패) done 이 바로 끝난다.
      drawIn() {
        if (!inline) return null;
        let skip = false;
        let run = null;
        const done = ready.then(() => { if (skip || node?.localName !== 'svg') return undefined; run = drawSvg(node); return run.finished; });
        return { finish() { skip = true; run?.finish(); }, done };
      },
    };
  }
  const labelId = uid('fig-alt-');
  const caption = h('p', { class: 'fig-alt sr-only', id: labelId, text: alt });
  if (def.kind === 'table') {
    const wrap = renderTable(def);
    wrap.setAttribute('aria-describedby', labelId);
    return { el: h('figure', { class: 'figure' }, wrap, caption), update(next) { if (next.alt !== undefined) caption.textContent = next.alt; } };
  }
  if (def.kind === 'points') {
    const host = h('div', { class: 'chart-host' });
    const legend = h('ul', { class: 'chart-legend', 'aria-label': '범례' }, ...def.series.map((s, i) => {
      const mark = svg('svg', { class: 'chart-legend-mark', width: 20, height: 20, viewBox: '0 0 20 20', 'aria-hidden': 'true' });
      mark.append(pointMark(POINT_SHAPES[i % POINT_SHAPES.length], 10, 10, 6, `chart-point chart-point-${i}`));
      return h('li', { class: 'chart-legend-item' }, mark, h('span', { text: s.label }));
    }));
    const guided = def.series.some((s) => s.guide === 'line');
    const note = guided ? h('p', { class: 'small fig-guide-note', text: '점을 잇는 옅은 선은 읽기 쉽게 그은 길잡이입니다. 선 위의 다른 곳이 값을 뜻하지는 않습니다.' }) : null;
    const el = h('figure', { class: 'figure figure-points' }, host, legend, note, caption);
    let lastWidth = 0;
    const redraw = () => {
      const w = Math.round(host.clientWidth);
      if (w === 0 || w === lastWidth) return;
      lastWidth = w;
      drawPoints(host, def, labelId);
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(redraw).observe(host);
    queueMicrotask(redraw);
    return { el, update(next) { if (next.alt !== undefined) caption.textContent = next.alt; } };
  }
  const host = h('div', { class: 'chart-host' });
  const title = h('figcaption', { class: 'fig-caption', text: def.title });
  const el = h('figure', { class: 'figure' }, title, host, caption);
  // 폭이 바뀌면(회전·창 크기) 글자 크기를 유지한 채 다시 그린다.
  let lastWidth = 0;
  const redraw = () => {
    const w = Math.round(host.clientWidth);
    if (w === 0 || w === lastWidth) return;
    lastWidth = w;
    drawLines(host, def, alt, labelId, masked);
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(redraw).observe(host);
  queueMicrotask(redraw);
  return {
    el,
    update(next) {
      if (next.alt !== undefined) caption.textContent = next.alt;
      if (next.masked !== undefined && next.masked !== masked) { masked = next.masked; lastWidth = 0; redraw(); }
    },
  };
}
