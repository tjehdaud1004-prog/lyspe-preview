// 글 단위를 '끝맺음 단위(한 문장)'로 가른다 — 줄바꿈 규칙의 판정(SPEC_LINES_AND_IMAGE.md 1). 순수 함수, DOM 도 시계도 모른다.
// 돌려주는 조각들을 이으면(join('')) 원문과 정확히 같다: 문장 뒤의 공백도 앞 문장에 붙어 있다. 그래서 표시 일정(core/reveal-plan.js)의 글자 수 · 시각은 그대로다.
// 제작 판단(근거 없음): 마침표 · 물음표 · 느낌표로 끝나고 뒤에 공백이 오면 한 문장이 끝난다. 쉼표 · 이음말 · 괄호에서는 끊지 않는다.
// 끝으로 보지 않는 것:
//  - 수 안의 점(3.5)·붙어 있는 점(a.b) — 점 바로 뒤가 공백이 아니면 끝이 아니다
//  - 줄임표(… · ...) — 문장이 이어지는 것으로 본다
//  - 글 단위 첫머리의 번호(1. 2.)
//  - 열린 따옴표 · 괄호 안의 점
//  - 문장 한가운데서 열렸다 닫힌 따옴표 · 괄호 안에서 끝난 점(그는 "안녕." 하고 말했다.)
//  - 따옴표로 시작한 문장이 인용을 받는 말(라고 · 하고 · 라며 …)로 이어질 때
const OPEN = new Map([['(', ')'], ['（', '）'], ['[', ']'], ['「', '」'], ['『', '』'], ['“', '”'], ['‘', '’']]);
const CLOSE_BRACKETS = new Set([')', '）', ']', '」', '』']);
const CLOSE_QUOTES = new Set(['”', '’', '"', "'"]);
const QUOTE_CONTINUES = /^(?:이?라고|이?라며|이?라는|하고|하며|하는|라|고|며)(?=\s|[.,]|$)/;
const TERMINATORS = /[.?!…]/;

export function splitSentences(text) {
  const src = String(text ?? '');
  const out = [];
  const stack = []; // 열린 { close, mid } — mid: 문장 한가운데서 열렸는가
  let start = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (OPEN.has(c)) { stack.push({ close: OPEN.get(c), mid: src.slice(start, i).trim() !== '' }); i += 1; continue; }
    if (c === '"') { // 곧은 따옴표는 열린 것이 있으면 닫는 것, 아니면 여는 것
      if (stack.at(-1)?.close === '"') stack.pop(); else stack.push({ close: '"', mid: src.slice(start, i).trim() !== '' });
      i += 1; continue;
    }
    if (stack.length > 0 && c === stack.at(-1).close) { stack.pop(); i += 1; continue; }
    if (!TERMINATORS.test(c)) { i += 1; continue; }

    // 끝맺음 부호 묶음(?! · ... · …)과 바로 붙은 닫는 따옴표 · 괄호
    let j = i;
    while (j < src.length && TERMINATORS.test(src[j])) j += 1;
    const run = src.slice(i, j);
    let last = null;
    while (j < src.length && stack.length > 0 && (src[j] === stack.at(-1).close)) { last = stack.pop(); j += 1; }
    // 여는 것이 이 글 단위 밖에 있던 짝 없는 닫는 글자도 문장 끝에 붙은 것으로 삼킨다
    while (j < src.length && stack.length === 0 && (CLOSE_QUOTES.has(src[j]) || CLOSE_BRACKETS.has(src[j])) && src[j] !== '"' && src[j] !== "'") j += 1;
    const ellipsis = run.includes('…') || /^\.{2,}$/.test(run) || /\.{3,}/.test(run);
    const sentenceSoFar = src.slice(start, i);
    const listNumber = run === '.' && /^\s*\d+$/.test(sentenceSoFar);
    const spaceAfter = j >= src.length || /\s/.test(src[j]);
    let ends = !ellipsis && !listNumber && spaceAfter && stack.length === 0;
    if (ends && last !== null) {
      const isQuote = !CLOSE_BRACKETS.has(last.close);
      if (last.mid) ends = false; // 문장 한가운데서 열린 묶음 안에서 끝난 점 — 같은 문장이 이어진다
      else if (isQuote && QUOTE_CONTINUES.test(src.slice(j).replace(/^\s+/, ''))) ends = false;
    }
    if (!ends) { i = Math.max(j, i + 1); continue; }
    while (j < src.length && /\s/.test(src[j])) j += 1;
    if (j >= src.length) break; // 마지막 문장 — 아래에서 한 번에 담는다
    out.push(src.slice(start, j));
    start = j;
    i = j;
  }
  if (start < src.length || out.length === 0) out.push(src.slice(start));
  return out;
}

// 글 단위 하나를 어떻게 가를까: 블록의 breaks 가 'none' 이면 한 덩어리(지금처럼), 아니면 문장마다.
export const sentencePartsOf = (block, text) => (block?.breaks === 'none' ? [String(text)] : splitSentences(text));
