// 고정된 지문(passage 블록)의 순수 규칙. DOM 을 모른다.
//
// 지문은 한꺼번에 보이고(조각으로 나타나지 않는다), 문단마다 눈에 보이는 번호([1], [2] …)가 붙는다.
// 같은 장면에서 지문 뒤의 블록을 하는 동안에는 화면에 늘 닿는 '지문 보기' 단추가 있고, 누르면 지문이 겹쳐 뜬다(ui/blocks/passage.js).

// 화면 문구. 효과를 약속하는 말·남과 견주는 말·뇌나 신경 용어를 쓰지 않는다.
export const PASSAGE_TEXT = Object.freeze({
  eyebrow: '지문',
  untitled: '지문',
  open: '지문 보기',
  close: '닫기',
  paraNo: (n) => `[${n}]`,
  closeNote: '닫으면 하던 자리로 돌아갑니다.',
});

/**
 * 이 블록을 하는 동안 다시 볼 수 있는 지문: 이 블록보다 앞에 있는 지문 가운데 가장 가까운 것. 같은 장면의 앞쪽을 먼저 찾고,
 * 없으면 앞 장면들을 뒤에서부터 훑는다. 없으면 null. 지문 블록 자신에는 없다(이미 화면에 있다).
 */
export function passageBefore(mod, blockId) {
  const scenes = mod.scenes ?? [];
  for (let s = 0; s < scenes.length; s += 1) {
    const blocks = scenes[s].blocks ?? [];
    const at = blocks.findIndex((b) => b.id === blockId);
    if (at < 0) continue;
    if (blocks[at].type === 'passage') return null;
    for (let i = at - 1; i >= 0; i -= 1) if (blocks[i].type === 'passage') return blocks[i];
    for (let p = s - 1; p >= 0; p -= 1) {
      const earlier = scenes[p].blocks ?? [];
      for (let i = earlier.length - 1; i >= 0; i -= 1) if (earlier[i].type === 'passage') return earlier[i];
    }
    return null;
  }
  return null;
}

/** 문단에 붙는 번호 글: ['[1]', '[2]', …]. */
export const paragraphLabels = (block) => block.paragraphs.map((_, i) => PASSAGE_TEXT.paraNo(i + 1));
