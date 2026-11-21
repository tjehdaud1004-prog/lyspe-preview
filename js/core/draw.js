// 그림이 그려지듯 나오기(K04 A144)의 일정. 순수 함수 — DOM 을 모른다(그리는 쪽은 ui/figure-draw.js).
//
// 뜻 있는 차례로 한 번만, 짧게: 선(축 → 곡선 → 더해진 선)이 먼저, 그 뒤에 칠(점)과 글자. 값은 모두 제작값(근거 없음) —
// design-research '움직임과 기다림'은 움직임을 가장 강한 주의 신호로 보고 진입은 ease-out · 한 번만 · reduced-motion 필수라 했고,
// 그 한도 안에서 사용자의 바람(U-1121d)을 따라 한 그림 약 1.2초로 둔다.
export const DRAW = Object.freeze({
  LINES_MS: 900,   // 선 그리기 전부(차례끼리 겹침 포함)
  FILL_MS: 250,    // 칠 · 글자가 나타나는 시간
  LINE_OVERLAP: 0.2, // 다음 선 차례가 앞 차례의 마지막 20% 와 겹쳐 시작한다
  FILL_OVERLAP: 0.5,
  MIN_SHARE: 0.3,  // 가장 긴 선에 견준 몫의 하한(짧은 선도 눈에 보이게)
  EASE: 'cubic-bezier(0.22, 1, 0.36, 1)', // ease-out
});

// raws: 차례마다의 상대 길이. 겹쳐 가며 이어 놓고 전체가 total 이 되게 늘이고 줄인다. → [{ start, duration }]
function stagger(raws, overlap, total) {
  const starts = [];
  let at = 0;
  for (const r of raws) { starts.push(at); at += r * (1 - overlap); }
  const end = starts[starts.length - 1] + raws[raws.length - 1];
  const k = total / end;
  return raws.map((r, i) => ({ start: starts[i] * k, duration: r * k }));
}

// items: [{ phase: 'line'|'fill', key: number|NaN(차례 표시 없음), len: 선의 길이 }] — 문서 순서.
// 반환: items 와 같은 순서의 [{ start, duration }] (ms) 와 전체 시간.
export function planDraw(items) {
  const out = new Array(items.length);
  let lineEnd = 0;
  const lines = items.map((it, i) => ({ ...it, i })).filter((it) => it.phase === 'line');
  const fills = items.map((it, i) => ({ ...it, i })).filter((it) => it.phase === 'fill');
  const group = (list, keyOf) => {
    const keys = [...new Set(list.map(keyOf))].sort((a, b) => a - b);
    return keys.map((k) => list.filter((it) => keyOf(it) === k));
  };
  if (lines.length) {
    const groups = group(lines, (it) => (Number.isNaN(it.key) ? 0 : it.key)); // 표시 없는 선은 문서 순서 그대로 맨 앞 묶음
    const maxLen = Math.max(...lines.map((it) => it.len), 1e-6);
    const raws = groups.map((g) => Math.max(DRAW.MIN_SHARE, Math.max(...g.map((it) => it.len)) / maxLen));
    const slots = stagger(raws, DRAW.LINE_OVERLAP, DRAW.LINES_MS);
    groups.forEach((g, gi) => g.forEach((it) => { out[it.i] = slots[gi]; }));
    lineEnd = DRAW.LINES_MS;
  }
  if (fills.length) {
    const groups = group(fills, (it) => (Number.isNaN(it.key) ? Infinity : it.key)); // 표시 없는 칠 · 글자(이름표)는 맨 뒤
    const slots = stagger(groups.map(() => 1), DRAW.FILL_OVERLAP, DRAW.FILL_MS);
    groups.forEach((g, gi) => g.forEach((it) => { out[it.i] = { start: lineEnd + slots[gi].start, duration: slots[gi].duration }; }));
  }
  return { slots: out, total: lineEnd + (fills.length ? DRAW.FILL_MS : 0) };
}
