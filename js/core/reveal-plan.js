// 점진 표시의 '일정'. 순수 함수 — DOM 도 시계도 모른다. 표시기(ui/typing.js)는 여기서 나온 일정을 그대로 따른다.
//
// 일정 규칙(왜): 조각 i 는 앞 조각들의 몫(지연)을 다 기다린 뒤 나타나고(첫 조각은 곧바로), 마지막 조각도 자기 몫만큼
// 머문 뒤에야 '다 나타남'(completeAt)이 된다. 조각의 몫 = 안에 든 글자 조각 지연의 합(core/segment.js 의 pieceDelay)이므로
//   completeAt = 글 전체의 글자 조각 지연 합 = 단위(글자·어절·문장)와 무관한 값
// 이다. 단위만 바꿔 견줄 때 시간이 섞이지 않게 하려는 것이다. 한 조각짜리 글(문장 하나인 글 단위의 문장 단위)도 곧바로
// 보이되 '다 나타남'은 그 글의 총 시간 뒤다 — 바로 보이기(instant, 총 시간 0)와 같아지지 않는다.
// 마지막 조각이 '나타나는' 시각(appearAt 의 끝)은 단위마다 다르다(큰 조각일수록 일찍). 같은 것은 completeAt 이다.
import { segment, pieceDelay } from './segment.js';

// 단위가 달라도 completeAt 이 같아야 하는 허용 오차(ms). 조각 지연이 정수 합이라 실제로는 0 이지만 반올림 여유로 둔다.
export const SCHEDULE_TOLERANCE_MS = 1;

// 글 하나의 일정. pieces[i] 는 appearAt[i](ms) 에 나타나고, waits[i] 는 그 뒤 다음 일(다음 조각 또는 완료)까지의 간격이다.
export function planReveal(text, unit = 'char', speed = 'normal') {
  const pieces = segment(String(text ?? ''), unit);
  const waits = pieces.map((p) => pieceDelay(p, speed));
  const appearAt = [];
  let t = 0;
  for (const w of waits) { appearAt.push(t); t += w; }
  return { unit, speed, pieces, waits, appearAt, completeAt: t };
}

// 나타나는 도중에 단위·속도가 바뀌어도 이어 가는 커서. 이미 나온 글은 그대로 두고, 남은 글만 새 단위·속도로 다시 짠다.
// 조각 경계에서만 다시 짜므로(큰 조각도 글자 조각의 합) 수식 토큰이 쪼개지지 않고, 총 시간도 변하지 않는다.
export function createRevealCursor({ text, getUnit = () => 'char', getSpeed = () => 'normal' }) {
  const full = String(text ?? '');
  let shown = 0;
  let k = 0;
  let plan = planReveal(full, getUnit(), getSpeed());
  let replans = 0;
  return {
    done: () => shown >= full.length,
    shown: () => full.slice(0, shown),
    replans: () => replans,
    // 다음 조각을 낸다: { piece, waitMs } — piece 를 보이고 waitMs 뒤에 다음 일을 한다. 다 나왔으면 null.
    next() {
      if (shown >= full.length) return null;
      const unit = getUnit();
      const speed = getSpeed();
      if (unit !== plan.unit || speed !== plan.speed) {
        plan = planReveal(full.slice(shown), unit, speed);
        k = 0;
        replans += 1;
      }
      const piece = plan.pieces[k];
      const waitMs = plan.waits[k];
      k += 1;
      shown += piece.length;
      return { piece, waitMs };
    },
  };
}
