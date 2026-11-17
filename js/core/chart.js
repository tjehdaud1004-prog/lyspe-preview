// 직선 그래프의 기하(좌표 계산). 그리기는 ui/figure.js 가 맡고, 여기는 숫자만 다룬다 — 시험 가능.
import { formatNumber } from './format.js';

export function evalLine(series, x) {
  return series.intercept + series.slope * x;
}

// 두 직선 y = b1 + m1 x, y = b2 + m2 x 의 교점. 평행이면 null.
export function intersection(s1, s2) {
  if (s1.slope === s2.slope) return null;
  const x = (s2.intercept - s1.intercept) / (s1.slope - s2.slope);
  return { x, y: evalLine(s1, x) };
}

// size: 그려질 CSS 픽셀 크기. 글자가 줄어들지 않도록 viewBox 를 쓰지 않고 실제 크기로 계산한다.
export function linesGeometry(spec, { width, height }) {
  const narrow = width < 480;
  // 위쪽 여백에는 범례와 세로축 이름이, 오른쪽 여백에는 직선 끝 글자가 들어간다.
  const margin = { l: narrow ? 58 : 70, r: 30, t: 62, b: 52 };
  const plot = { x0: margin.l, y0: margin.t, x1: width - margin.r, y1: height - margin.b };
  const px = (x) => plot.x0 + (x / spec.xMax) * (plot.x1 - plot.x0);
  const py = (y) => plot.y1 - (y / spec.yMax) * (plot.y1 - plot.y0);
  return {
    width, height, plot,
    xTicks: spec.xTicks.map((v) => ({ v, px: px(v), label: formatNumber(v) })),
    yTicks: spec.yTicks.map((v) => ({ v, py: py(v), label: formatNumber(v) })),
    series: spec.series.map((s) => ({
      id: s.id, label: s.label,
      x1: px(0), y1: py(evalLine(s, 0)),
      x2: px(spec.xMax), y2: py(evalLine(s, spec.xMax)),
    })),
    marks: (spec.marks ?? []).map((m) => {
      const y = evalLine(spec.series[0], m.x);
      return { x: m.x, y, px: px(m.x), py: py(y), label: m.label, text: `${m.x}, ${formatNumber(y)}` };
    }),
  };
}

// 점 그래프(points)의 기하. 축은 def.x·def.y 의 { min, max, step }, 계열마다 점 1~12개. 선(guide: 'line')은 점을 이은 길잡이일 뿐 값을 뜻하지 않는다.
// 계열은 색만으로 가르지 않는다: 점 모양(원·네모·세모)이 다르다. 모양 이름은 범례와 시험이 쓴다.
export const POINT_SHAPES = Object.freeze(['circle', 'square', 'triangle']);

export function axisTicks(axis) {
  const out = [];
  const n = Math.round((axis.max - axis.min) / axis.step);
  for (let k = 0; k <= n; k += 1) {
    const v = Math.round((axis.min + k * axis.step) * 1e9) / 1e9;
    if (v <= axis.max + 1e-9) out.push(v);
  }
  return out;
}

// 수직선(def.numberLine: true): 세로축 없이 계열마다 가로 줄 하나(위에서 아래로 쓴 차례). 점은 그 줄 위에 놓이고 y 는 쓰지 않는다.
// 줄마다 가로축 꼴의 눈금과 숫자를 달고, 눈금 간격이 좁으면(375 폭) 숫자를 건너뛴다(0 은 늘 남긴다).
export const NUMBERLINE_ROW = 72;
export function numberLineGeometry(spec, { width }) {
  const plot = { x0: 28, x1: width - 28 };
  const px = (x) => plot.x0 + ((x - spec.x.min) / (spec.x.max - spec.x.min)) * (plot.x1 - plot.x0);
  const values = axisTicks(spec.x);
  const gap = values.length > 1 ? px(values[1]) - px(values[0]) : plot.x1 - plot.x0;
  const every = Math.max(1, Math.ceil(30 / Math.max(gap, 1))); // 숫자 하나가 약 30px 는 차지한다
  const anchor = Math.max(0, values.indexOf(0)); // 0 이 있으면 0 에서 세어 건너뛴다(0 은 늘 남는다)
  const xTicks = values.map((v, k) => ({ v, px: px(v), label: formatNumber(v), zero: v === 0, showLabel: (k - anchor) % every === 0 }));
  const rows = spec.series.map((s, i) => {
    const top = 8 + i * NUMBERLINE_ROW;
    return { id: s.id, label: s.label, labelY: top + 14, lineY: top + 40, tickLabelY: top + 58 };
  });
  const height = 8 + rows.length * NUMBERLINE_ROW + 26;
  return {
    numberLine: true, width, height, plot, xTicks, rows,
    series: spec.series.map((s, i) => ({
      id: s.id, label: s.label, shape: POINT_SHAPES[i % POINT_SHAPES.length], guide: s.guide === 'line',
      points: s.points.map((pt) => ({ x: pt[0], px: px(pt[0]), py: rows[i].lineY, text: formatNumber(pt[0]) })),
    })),
  };
}

export function pointsGeometry(spec, { width, height }) {
  if (spec.numberLine === true) return numberLineGeometry(spec, { width });
  const narrow = width < 480;
  const margin = { l: narrow ? 58 : 70, r: 24, t: 40, b: 52 };
  const plot = { x0: margin.l, y0: margin.t, x1: width - margin.r, y1: height - margin.b };
  const px = (x) => plot.x0 + ((x - spec.x.min) / (spec.x.max - spec.x.min)) * (plot.x1 - plot.x0);
  const py = (y) => plot.y1 - ((y - spec.y.min) / (spec.y.max - spec.y.min)) * (plot.y1 - plot.y0);
  return {
    width, height, plot,
    xTicks: axisTicks(spec.x).map((v) => ({ v, px: px(v), label: formatNumber(v) })),
    yTicks: axisTicks(spec.y).map((v) => ({ v, py: py(v), label: formatNumber(v) })),
    series: spec.series.map((s, i) => ({
      id: s.id, label: s.label, shape: POINT_SHAPES[i % POINT_SHAPES.length], guide: s.guide === 'line',
      points: s.points.map(([x, y]) => ({ x, y, px: px(x), py: py(y), text: `${formatNumber(x)}, ${formatNumber(y)}` })),
    })),
  };
}
