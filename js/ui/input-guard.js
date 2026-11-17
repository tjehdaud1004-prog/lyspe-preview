// 입력 중 보호의 상태 수집: 초점·최근 입력·필기 중 여부를 모아 core/guard.js 의 판정에 넘긴다.
import { isHeld } from '../core/guard.js';

const TEXT_FIELD = 'input[type="text"], input[type="search"], input:not([type]), textarea, [contenteditable="true"]';

export function createInputGuard({ now = () => Date.now(), doc = document } = {}) {
  let lastInputAt = null;
  let drawing = false;

  // 초점은 이벤트로 추적하지 않고 묻는 순간의 activeElement 를 본다 — 창이 비활성일 때도 틀리지 않는다.
  const focusInInput = () => doc.activeElement instanceof Element && doc.activeElement.matches(TEXT_FIELD);

  // 이벤트를 놓친 경우를 위한 보험: 입력칸에서 키가 눌리면 최근 입력으로 친다.
  doc.addEventListener('keydown', (e) => { if (e.target instanceof Element && e.target.matches(TEXT_FIELD)) lastInputAt = now(); });

  return {
    markInput() { lastInputAt = now(); },
    setDrawing(value) { drawing = value; if (!value) lastInputAt = now(); },
    held() { return isHeld({ focusInInput: focusInInput(), drawing, lastInputAt, now: now() }); },
  };
}
