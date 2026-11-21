// 그림이 그려지듯 나오기(K04 A144 · 2판 A146)의 일정. 순수 함수 — DOM 을 모른다(그리는 쪽은 ui/figure-draw.js).
//
// 선 · 글자 · 칠을 가르지 않고 한 줄의 차례로 그린다. 시간은 고정 총시간이 아니라 요소마다의 길이로(선은 길이, 글자는 글자 수).
// 값은 모두 제작값(근거 없음) — design-research c04 의 '한 번만 · ease-out · reduced-motion' 중 한 그림 1.2초 상한만 사용자 바람(U-1121d · f)으로 내려놓았다.
export const DRAW = Object.freeze({
  LINE_SPEED: 700,       // 선: viewBox 단위/초
  LINE_MIN_MS: 250,
  LINE_MAX_MS: 800,
  CHAR_MS: 70,           // 글자 하나
  TEXT_MIN_MS: 200,
  TEXT_MAX_MS: 900,
  FILL_MS: 200,          // 테두리 없는 칠(점)이 나타나는 시간
  FILL_SHARE: 0.4,       // 칠 · 테두리 도형: 칠은 시간의 뒤 40% 에서 0 → 1
  GROUP_OVERLAP: 0.15,   // 다음 묶음은 앞 묶음의 끝 15% 와 겹쳐 시작
  MAX_TOTAL_MS: 6000,    // 한 그림 전체 상한(넘으면 비율로 줄임)
  PEN: 'cubic-bezier(0.4, 0, 0.6, 1)', // 거의 고른 속도 — 펜이 지나가는 느낌
  EASE: 'cubic-bezier(0.22, 1, 0.36, 1)', // ease-out(칠 · 점 나타나기만)
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 요소 하나가 혼자 그려질 때의 시간(ms). type: 'line'(선) | 'shape'(칠 + 테두리) | 'text' | 'fill'(테두리 없는 칠). size: 선 · 테두리 길이 또는 글자 수.
export function naturalMs(type, size) {
  if (type === 'text') return clamp(size * DRAW.CHAR_MS, DRAW.TEXT_MIN_MS, DRAW.TEXT_MAX_MS);
  if (type === 'fill') return DRAW.FILL_MS;
  return clamp((size / DRAW.LINE_SPEED) * 1000, DRAW.LINE_MIN_MS, DRAW.LINE_MAX_MS);
}

// items: [{ type, key: number|NaN(차례 표시 없음), size }] — 문서 순서.
// 차례: data-draw 가 하나라도 있으면 그 수의 작은 것부터 묶음(표시 없는 요소는 바로 앞 요소의 차례를 따른다, 맨 앞이면 0), 하나도 없으면 문서 순서대로 하나씩.
// 다음 묶음은 앞 묶음 끝 15% 와 겹쳐 시작. 전체가 6초를 넘으면 비율로 줄인다. → { slots: [{ start, duration }](items 와 같은 순서), total }
export function planDraw(items) {
  const slots = new Array(items.length);
  if (!items.length) return { slots: [], total: 0 };
  const marked = items.some((it) => !Number.isNaN(it.key));
  let prev = 0;
  const keys = items.map((it, i) => {
    if (!marked) return i;
    prev = Number.isNaN(it.key) ? prev : it.key;
    return prev;
  });
  const order = [...new Set(keys)].sort((a, b) => a - b);
  let at = 0;
  let total = 0;
  for (const k of order) {
    const idx = keys.map((kk, i) => (kk === k ? i : -1)).filter((i) => i >= 0);
    const dur = idx.map((i) => naturalMs(items[i].type, items[i].size));
    for (let j = 0; j < idx.length; j += 1) slots[idx[j]] = { start: at, duration: dur[j] };
    const groupDur = Math.max(...dur);
    total = Math.max(total, at + groupDur);
    at += groupDur * (1 - DRAW.GROUP_OVERLAP);
  }
  const k = total > DRAW.MAX_TOTAL_MS ? DRAW.MAX_TOTAL_MS / total : 1;
  return { slots: slots.map((s) => ({ start: s.start * k, duration: s.duration * k })), total: total * k };
}
