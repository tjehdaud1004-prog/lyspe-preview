// 입력 중 보호: 노트·답 입력에 초점이 있거나 최근 입력이 있거나 필기 중이면 본문이 스스로 움직이면 안 된다.
// (자동 이어가기·글 점진 표시·자동 스크롤이 모두 이 판정을 따른다.)

export const RECENT_INPUT_MS = 4000;

export function isHeld({ focusInInput = false, drawing = false, lastInputAt = null, now = 0 } = {}) {
  if (focusInInput || drawing) return true;
  return lastInputAt !== null && now - lastInputAt < RECENT_INPUT_MS;
}
