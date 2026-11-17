// 화면 폭 구간. css/layout.css 의 미디어 쿼리와 같은 값이어야 한다(tests 가 대조한다).
export const BREAKPOINTS = Object.freeze({ mid: 720, wide: 1024 });
export const SHEET_STATES = ['closed', 'half', 'full'];

// phone: 본문 전체 + 아래 노트 시트 / mid: 접을 수 있는 2단 / wide: 본문·노트 나란히
export function layoutFor(width) {
  if (width < BREAKPOINTS.mid) return 'phone';
  if (width < BREAKPOINTS.wide) return 'mid';
  return 'wide';
}

// 폭 720px 미만이면서 가로가 더 긴 화면(높이가 낮은 휴대폰 가로). 이때 '반 높이' 시트는 너무 낮아 쓸 수 없다.
export function isShortLandscapePhone(width, height) {
  return layoutFor(width) === 'phone' && width > height;
}

// 시트를 열 때(또는 '반 높이'를 고를 때) 실제로 쓸 높이 상태. 낮은 가로 화면에서는 전체 높이로 연다.
export function resolveSheetState(state, width, height) {
  if (state === 'half' && isShortLandscapePhone(width, height)) return 'full';
  return state;
}
