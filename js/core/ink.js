// 손글씨 획 처리. 획은 '논리 좌표'(1000 x 750)로 저장하므로 화면 크기·회전이 바뀌어도 다시 그릴 수 있다.
// 캔버스 비율을 4:3 으로 고정해 두었기 때문에 가로·세로가 같은 배율로 변한다.

export const INK_W = 1000;
export const INK_H = 750;
export const MIN_POINT_DISTANCE = 1.2; // 논리 단위. 너무 촘촘한 점은 저장하지 않는다.
const MAX_STROKES = 2000;
const MAX_POINTS = 5000;

const round1 = (n) => Math.round(n * 10) / 10;

export function toInkPoint(clientX, clientY, rect) {
  const x = ((clientX - rect.left) / rect.width) * INK_W;
  const y = ((clientY - rect.top) / rect.height) * INK_H;
  return [round1(Math.min(INK_W, Math.max(0, x))), round1(Math.min(INK_H, Math.max(0, y)))];
}

export function inkScale(cssWidth) { return cssWidth / INK_W; }

export function appendPoint(stroke, point) {
  const last = stroke.pts[stroke.pts.length - 1];
  if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < MIN_POINT_DISTANCE) return false;
  if (stroke.pts.length >= MAX_POINTS) return false;
  stroke.pts.push(point);
  return true;
}

// 불변 갱신: 새 배열을 돌려준다.
export const addStroke = (strokes, stroke) => (stroke.pts.length ? [...strokes, stroke].slice(-MAX_STROKES) : strokes);
export const undoStroke = (strokes) => strokes.slice(0, -1);

export function sanitizeStrokes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw.slice(0, MAX_STROKES)) {
    if (!s || !Array.isArray(s.pts)) continue;
    const pts = [];
    for (const p of s.pts.slice(0, MAX_POINTS)) {
      if (Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
        pts.push([Math.min(INK_W, Math.max(0, p[0])), Math.min(INK_H, Math.max(0, p[1]))]);
      }
    }
    if (pts.length) out.push({ pts });
  }
  return out;
}
