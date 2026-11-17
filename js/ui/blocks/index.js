// 블록 종류 → 그리는 함수. 새 블록 종류는 여기와 core/module.js 의 검증에 더하고, 그 밖에 data/tags.mjs(TAGGED_BLOCK_TYPES), ui/reader.js(blockKindName), ui/help.js(도움 switch), core/check-leak.js·core/link.js(글 모으기)를 본다.
// 글(text)은 단위마다 reader 가 직접 다루므로 여기 없다.
import { renderCheck } from './check.js';
import { renderProblem } from './problem.js';
import { renderLink } from './link.js';
import { renderPredict } from './predict.js';
import { renderFigureBlock } from './figure-block.js';
import { renderAudio } from './audio.js';
import { renderLookback } from './lookback.js';
import { renderRound } from './round.js';
import { renderPassage } from './passage.js';

const RENDERERS = {
  check: renderCheck,
  problem: renderProblem,
  transfer: renderProblem,
  link: renderLink,
  predict: renderPredict,
  figure: renderFigureBlock,
  audio: renderAudio,
  lookback: renderLookback,
  round: renderRound,
  passage: renderPassage,
};

export function renderBlock(ctx, block) {
  const render = RENDERERS[block.type];
  if (!render) throw new Error(`알 수 없는 블록 종류: ${block.type}`);
  return render(ctx, block);
}
