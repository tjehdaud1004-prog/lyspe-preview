// '설명 접고 문항으로'(K04 A177)의 순수 로직. 어디에서 단추가 보이고, 무엇을 접고, 어디로 옮기는가 — DOM 은 ui/reader.js 가 맡는다.
// 설명(글 단위)은 모두에게 기본으로 펼쳐지고, 접기는 학습자가 장면마다 그때 고른다(설정으로 기억하지 않는다). 이 길이 이득인지는 기록으로 재야 할 가설이다.
import { flattenSteps } from './module.js';

// 문항으로 치는 블록 종류. figure · passage · predict · lookback · audio 는 문항이 아니다.
export const FOLD_BLOCKS = Object.freeze(['check', 'round', 'problem', 'link', 'transfer']);

export const FOLD_TEXT = Object.freeze({
  fold: '설명 접고 문항으로',
  unfold: '접은 설명 — 펼치기',
});

// 한 장면에서 접을 범위: target = 첫 문항 블록의 걸음 번호, units = 그보다 앞에 있는 글 단위 걸음 번호들. 문항 블록이 없으면 null.
export function foldRange(steps, mod, sceneIndex) {
  const blocks = mod.scenes[sceneIndex]?.blocks ?? [];
  const target = steps.findIndex((st) => st.sceneIndex === sceneIndex && st.kind === 'block' && FOLD_BLOCKS.includes(blocks[st.blockIndex]?.type));
  if (target < 0) return null;
  return { target, units: steps.filter((st) => st.index < target && st.sceneIndex === sceneIndex && st.kind === 'unit').map((st) => st.index) };
}

// 지금 걸음에서 단추를 보일 때의 범위(보이지 않으면 null): 글 단위 걸음이고, 같은 장면의 뒤에 문항 블록이 있고, 아직 접지 않은 장면.
export function foldOffer(steps, mod, index, folded = []) {
  const st = steps[index];
  if (!st || st.kind !== 'unit' || folded.includes(st.sceneId)) return null;
  const range = foldRange(steps, mod, st.sceneIndex);
  return range && index < range.target ? range : null;
}

// 저장 데이터 거르기: 모르는 장면 · 문항이 없는 장면 · 아직 첫 문항에 닿지 않은 장면은 버리고 중복을 없앤다.
export function sanitizeFolded(raw, mod, step) {
  if (!Array.isArray(raw)) return [];
  const steps = flattenSteps(mod);
  const ids = [];
  for (const id of raw) {
    const sceneIndex = mod.scenes.findIndex((sc) => sc.id === id);
    if (sceneIndex < 0 || ids.includes(id)) continue;
    const range = foldRange(steps, mod, sceneIndex);
    if (range && range.units.length > 0 && step >= range.target) ids.push(id);
  }
  return ids;
}
