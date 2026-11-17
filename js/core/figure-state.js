// 그림 블록의 지금 상태(값을 가리는가, 어떤 텍스트 대체를 쓰는가). 규칙은 core/reveal.js, 여기는 진행 상태와 잇는다.
import { gradables } from './module.js';
import { itemOutcome } from './progress.js';
import { figureMasked, figureAltText } from './reveal.js';

export function figureState(mod, block, progress) {
  let outcome = null;
  if (typeof block.revealAfter === 'string') {
    const target = gradables(mod).find((g) => g.key === block.revealAfter);
    if (target) outcome = itemOutcome(progress, target.key, target.helpKey);
  }
  const masked = figureMasked(block, outcome);
  return { masked, alt: figureAltText(block, masked) };
}
