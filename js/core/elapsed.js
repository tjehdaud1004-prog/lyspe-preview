// 정리 화면에 보이는 시간의 재료. 순수 로직 — 타이머·DOM 을 모른다.
//
// 학습 기록의 활동 시간과 같은 정의를 쓴다(core/activity.js 의 계산기 하나를 함께 읽는다):
// 탭이 보이는 시간 중, 입력(포인터·키·스크롤)이 없던 침묵이 IDLE_MS 를 넘긴 뒤의 구간을 뺀 시간.
// 그래서 자리를 비우고 탭만 켜 둔 시간은 기준 시간까지만 들어간다.
// 기록 동의와는 무관하다 — 계산기는 기록이 꺼져 있어도 돌고, 여기서는 아무것도 저장하지 않는다.
import { IDLE_MS } from './activity.js';
import { formatDuration } from './format.js';

// active: 지금까지의 활동 시간(ms)을 돌려주는 함수(조립기의 activeNow). 늘어나기만 하는 값이어야 한다.
export function createElapsedMeter({ active }) {
  let last = active();
  return {
    // 마지막으로 부른 뒤 늘어난 활동 시간. counting 이 false 면 그 구간은 버린다(정리 화면·본문 밖 문항 묶음).
    take(counting = true) {
      const cur = active();
      const delta = Math.max(0, cur - last);
      last = cur;
      return counting ? delta : 0;
    },
  };
}

// 정리 화면의 시간 문장. 무엇을 뺀 시간인지 함께 말한다.
export function elapsedSentence(ms, idleMs = IDLE_MS) {
  return `활동 시간은 ${formatDuration(ms)}입니다. 입력이 ${formatDuration(idleMs)} 넘게 없던 구간은 ${formatDuration(idleMs)}까지만 세고, 탭이 가려진 시간은 세지 않았습니다. 시간은 보여 주기만 하고 평가하지 않습니다.`;
}
