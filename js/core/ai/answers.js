// 학습 전담 AI 연결부가 '정답 값'을 다루는 곳. 순수 함수 — DOM 을 모른다.
//  · 요청을 만들 때: 아직 풀지 않은 문항의 정답이 요청 글(힌트·오개념 피드백)에 섞여 나가지 않게 거른다.
//  · 응답을 받았을 때: 아직 풀지 않은 문항의 정답이 응답 글에 들어 있는지 본다(정답 누출 막기).
// 비교 규칙은 작성 점검(core/check-leak.js)과 같다: 숫자는 쉼표·단위 표기 차이를 무시하고, 다른 단위가 붙은 수는 다른 양으로 본다.
// 기계로 못 잡는 것: 낱말로 쓴 수("사천 원"), 식의 항 순서를 바꾼 것("60t + 6000"), 뜻으로 답을 알려 주는 말. 그래서 이 검사는 마지막 방어선이 아니라 한 겹이다.
import { gradables } from '../module.js';
import { isAutoGraded, normalizeInput, normalizeTerm } from '../answer.js';
import { numberTokens, moduleUnits } from '../check-leak.js';

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// 식 비교용: 공백·곱셈 기호·천 단위 쉼표·마이너스 모양 차이를 지운다.
const compactExpr = (s) => String(s ?? '').replace(/(?<=\d),(?=\d{3}(?!\d))/g, '').replace(/[−–－]/g, '-').replace(/[\s×·*]/g, '');

// 이 블록의 채점 대상 가운데 도움을 구하는 대상. itemKey 가 있으면 그 칸 하나, 없으면 블록의 모든 칸(없으면 빈 배열).
export function targetsOf(mod, blockId, itemKey) {
  const all = gradables(mod).filter((g) => g.blockId === blockId);
  if (itemKey) {
    const one = all.filter((g) => g.key === itemKey);
    if (one.length > 0) return one;
  }
  return all;
}

// 답을 말해도 되는 칸: 이미 풀었거나 풀이를 열었다(건너뜀은 아니다).
export function answerOpen(progress, g) {
  return progress?.items?.[g.key]?.solved === true || progress?.help?.[g.helpKey]?.solution === true;
}

// 아직 답을 말하면 안 되는 칸들: 이 블록에서 자동 채점하는 칸 가운데 answerOpen 이 아닌 것(다른 칸의 답도 지킨다).
export function protectedOf(mod, progress, blockId) {
  return gradables(mod).filter((g) => g.blockId === blockId && isAutoGraded(g.answer) && !answerOpen(progress, g));
}

export function attemptsIn(mod, progress, blockId) {
  return gradables(mod).filter((g) => g.blockId === blockId).reduce((s, g) => s + Math.max(0, Math.round(Number(progress?.items?.[g.key]?.attempts) || 0)), 0);
}

// 글 하나에 이 정답이 들어 있는가. units 는 moduleUnits(mod).
export function containsAnswer(text, answer, units = []) {
  const s = normalizeInput(text); // 전각 숫자·쉼표를 반각으로
  if (s === '' || !answer) return false;
  if (answer.kind === 'number') {
    for (const t of numberTokens(s)) {
      if (Math.abs(t.value - Math.abs(answer.value)) > (answer.tolerance ?? 0) + 1e-9) continue;
      if (isStr(answer.unit)) {
        const own = [answer.unit, ...(answer.unitAliases ?? [])];
        const follows = units.find((u) => t.rest.startsWith(u));
        if (follows !== undefined && !own.includes(follows)) continue; // 다른 단위가 붙은 수 = 다른 양
      }
      return true;
    }
    return false;
  }
  if (answer.kind === 'choice') {
    const label = answer.options?.find((o) => o.id === answer.value)?.label;
    return isStr(label) && squash(s).includes(squash(label));
  }
  if (answer.kind === 'term') {
    const squashed = normalizeTerm(s);
    return [answer.value, ...(answer.accept ?? [])].map(normalizeTerm).some((f) => f !== '' && squashed.includes(f));
  }
  if (answer.kind === 'linear') {
    const want = compactExpr(answer.value);
    return want !== '' && compactExpr(s).includes(want);
  }
  return false;
}

// 글 하나가 지켜야 할 칸 가운데 하나의 정답이라도 담고 있는가.
export function leaksAny(text, guarded, units) {
  return guarded.some((g) => containsAnswer(text, g.answer, units));
}

export { moduleUnits };
