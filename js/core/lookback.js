// '예상 다시 보기'(lookback) 블록의 규칙. DOM 을 모른다.
//
// 앞에서 예상 적기(predict)에 적은 글을 뒤에서 다시 보여 주고, 그 사이에 알아낸 것과 나란히 놓는다.
// 채점하지 않고, 예상이 맞았는지 틀렸는지 판정하지도 않는다(시스템은 글의 뜻을 읽지 않는다).
// 칸이 비어 있으면 '비어 있다'는 사실만 말한다 — 머릿속으로 무엇을 떠올렸는지, 적었다가 지웠는지는 알 수 없다.
//
// 블록 형식: { type: 'lookback', id, of: '<예상 적기 블록 id>', known: '<지금까지 알아낸 것>', prompt: '<견주어 볼 질문>', promptEmpty?: '<예상을 적지 않았을 때의 질문>' }

export const LOOKBACK_TEXT = Object.freeze({
  eyebrow: '예상 다시 보기',
  mineHead: (sceneNo) => `장면 ${sceneNo}에서 적은 예상`,
  knownHead: '지금까지 알아낸 것',
  emptyLine: (sceneNo) => `장면 ${sceneNo}의 예상 적기 칸이 비어 있습니다. 적지 않아도 괜찮습니다.`,
  defaultPromptEmpty: '그때 머릿속으로 떠올린 생각이 있었다면, 위 내용과 어디가 같고 어디가 다른지 견주어 봅니다.',
  noteLabel: '견주어 보고 알게 된 점을 한 줄로 적어 본다. (선택)',
  footer: '맞고 틀림을 가리지 않습니다. 적은 내용은 이 기기에만 저장되고, 채점하지 않습니다.',
});

// 블록 id → 그 블록이 있는 장면 번호(1부터)와 흐름 속 순서.
function locate(mod, blockId) {
  let order = 0;
  for (let si = 0; si < mod.scenes.length; si += 1) {
    for (const block of mod.scenes[si].blocks) {
      if (block.id === blockId) return { sceneNo: si + 1, order, block };
      order += 1;
    }
  }
  return null;
}

// 화면에 무엇을 보일지. predicts: progress.predicts
export function lookbackView(mod, block, predicts) {
  const source = locate(mod, block.of);
  const sceneNo = source?.sceneNo ?? 1;
  const text = String(predicts?.[block.of] ?? '').trim();
  const written = text !== '';
  return {
    written,
    sceneNo,
    mine: written ? text : null,
    mineHead: LOOKBACK_TEXT.mineHead(sceneNo),
    emptyLine: written ? null : LOOKBACK_TEXT.emptyLine(sceneNo),
    known: block.known,
    prompt: written ? block.prompt : (block.promptEmpty ?? LOOKBACK_TEXT.defaultPromptEmpty),
  };
}

const isStr = (v) => typeof v === 'string' && v.trim() !== '';

// 형식 검증: of 는 이 블록보다 앞에 나온 예상 적기 블록이어야 한다.
export function checkLookbackBlocks(mod) {
  const errors = [];
  for (const scene of mod.scenes) {
    for (const block of scene.blocks) {
      if (block.type !== 'lookback') continue;
      const where = `lookback ${block.id}`;
      if (!isStr(block.known)) errors.push(`${where}: known(지금까지 알아낸 것) 필요`);
      if (!isStr(block.prompt)) errors.push(`${where}: prompt 필요`);
      if (block.promptEmpty !== undefined && !isStr(block.promptEmpty)) errors.push(`${where}: promptEmpty 는 문자열`);
      const source = isStr(block.of) ? locate(mod, block.of) : null;
      if (!source || source.block.type !== 'predict') { errors.push(`${where}: of 가 예상 적기(predict) 블록 id 가 아니다`); continue; }
      if (source.order >= locate(mod, block.id).order) errors.push(`${where}: of 가 가리키는 예상 적기가 이 블록보다 뒤에 있다`);
    }
  }
  return errors;
}
