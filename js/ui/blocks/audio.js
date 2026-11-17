// 음성 블록은 스키마에만 예약돼 있다(v0 미구현). 재생 없이 '준비 중' 표시와 대본만 보여 준다.
import { h } from '../dom.js';

export function renderAudio(ctx, block) {
  const el = h('div', { class: 'block block-audio', dataset: { blockId: block.id } },
    h('p', { class: 'eyebrow', text: '음성 (준비 중)' }),
    h('p', { class: 'small', text: '이 플레이어는 아직 음성을 재생하지 않습니다. 대본을 글로 보여 줍니다.' }),
    h('p', { class: 'unit', text: block.transcript }));
  return { el, blockId: block.id, resolved: () => true, refresh() {}, focus() {} };
}
