// 그림이 다음 문항의 답을 미리 보여 주지 않게 하는 규칙. DOM 을 모른다.
//
// 그림 블록에 revealAfter(채점 대상 키)를 두면, 그 문항이 풀리기 전에는
//  · 직선 그래프 표시점의 세로 값을 MASK 로 가리고(가로 값과 이름은 그대로)
//  · 텍스트 대체는 alt(값을 뺀 글)를 쓴다.
// 문항이 풀리면(맞혔거나 풀이를 열었으면) 값을 보이고 텍스트 대체를 altAfter 로 바꾼다.
// 건너뛴 것만으로는 열지 않는다 — 건너뛴 문항은 나중에 답할 수 있어서, 열면 그 답이 그림에 적혀 있게 된다.
import { formatNumber } from './format.js';

export const MASK = '?';
export const MASKED_NOTE = `‘${MASK}’로 가린 값은 이어지는 문항을 풀거나 그 풀이를 열면 표시됩니다.`;
export const REVEALED_NOTE = '가려 두었던 값이 그림에 표시되었습니다.'; // 맞혔을 때와 풀이를 열었을 때 모두 쓰므로 '풀어서'라고 하지 않는다

// outcome: core/progress.js itemOutcome() 의 결과. 답이 이미 학습자 앞에 나온 상태만 '열림'으로 본다.
const OPEN_OUTCOMES = ['correct', 'hinted-correct', 'solution-seen', 'written'];
export function isRevealedBy(outcome) {
  return OPEN_OUTCOMES.includes(outcome);
}

// 이 그림 블록이 지금 값을 가려야 하는가. outcome 은 revealAfter 가 가리키는 문항의 결과.
export function figureMasked(block, outcome) {
  return typeof block?.revealAfter === 'string' && !isRevealedBy(outcome);
}

export function figureAltText(block, masked) {
  return !masked && typeof block.altAfter === 'string' ? block.altAfter : block.alt;
}

// 표시점 옆에 적는 둘째 줄: "50분, 7,000원" 또는 가린 동안 "50분, ?원".
export function markValueText(def, mark, masked = false) {
  return `${mark.x}${def.xUnit ?? ''}, ${masked ? MASK : formatNumber(mark.y)}${def.yUnit ?? ''}`;
}

// 형식 검증. grads: core/module.js gradables(mod) 의 결과(순환 가져오기를 피하려고 밖에서 받는다).
export function checkRevealFields(mod, grads) {
  const errors = [];
  const byKey = new Map(grads.map((g) => [g.key, g]));
  for (const scene of mod.scenes) {
    for (const block of scene.blocks) {
      if (block.type !== 'figure') continue;
      const where = `figure ${block.id}`;
      if (block.revealAfter === undefined) {
        if (block.altAfter !== undefined) errors.push(`${where}: altAfter 는 revealAfter 와 함께만 쓴다`);
        continue;
      }
      const target = byKey.get(block.revealAfter);
      if (!target) { errors.push(`${where}: revealAfter '${block.revealAfter}' 가 채점 대상 키가 아니다`); continue; }
      if (target.answer.kind !== 'number' && target.answer.kind !== 'choice') errors.push(`${where}: revealAfter 는 자동 채점 문항(number|choice)만 가리킬 수 있다`);
      if (typeof block.altAfter !== 'string' || block.altAfter.trim() === '') errors.push(`${where}: revealAfter 를 쓰면 altAfter(문항을 푼 뒤의 텍스트 대체)가 필요하다`);
      const def = mod.figures?.[block.figure];
      if (def && !(def.kind === 'lines' && (def.marks ?? []).length > 0)) errors.push(`${where}: revealAfter 는 표시점(marks)이 있는 직선 그래프에만 쓴다 — 가릴 값이 없다`);
    }
  }
  return errors;
}
