// 본문 한 단위를 '표시 조각'으로 자른다. 순수 함수 — DOM 을 모른다.
//
// 조각 규칙(왜): 한글은 자모 조합을 흉내 내지 않고 '완성 글자' 하나가 가장 작은 조각이다.
// 영문 단어·숫자·수식(예: "2,000 + 100t = 5,000 + 40t")은 중간에 끊기면 읽을 수 없으므로 통째로 한 조각이다.
// 공백·줄바꿈은 앞 조각에 붙인다 — 공백만 따로 나타나면 화면이 '멈춘 듯' 보이기 때문이다.
//
// 나타나는 단위(설정): 글자 / 어절(띄어쓰기 단위) / 문장. 큰 단위는 글자 조각을 이어 붙여 만들므로
// 수식 토큰은 어느 단위에서도 쪼개지지 않는다. 이어 붙인 조각의 지연은 안에 든 글자 조각 지연의 합이라서
// 지연 합(totalDuration)은 단위와 무관하다 — 속도 설정은 단위와 독립이다. 실제 표시기가 '다 나타남'을 언제로 치는가
// (마지막 조각의 몫까지 머문 뒤)와 조각별 나타나는 시각은 core/reveal-plan.js 의 일정이 정한다.

export const SPEEDS = Object.freeze({ slow: 90, normal: 45, fast: 18 }); // 글자 조각당 ms
export const SPEED_LABELS = Object.freeze({ slow: '느림', normal: '보통', fast: '빠름' });

export const TEXT_UNITS = Object.freeze(['keys', 'char', 'word', 'sentence']);
export const TEXT_UNIT_LABELS = Object.freeze({ keys: '타자', char: '글자', word: '어절', sentence: '문장' });
export const DEFAULT_TEXT_UNIT = 'keys';

const OPERAND = String.raw`[A-Za-z0-9][A-Za-z0-9.,]*`;
const OPERATOR = String.raw`[+\-=×÷*/^<>≤≥]`;
// 피연산자 (공백? 연산자 공백? 피연산자)* 형태. 한글이 끼면 거기서 끝난다.
const TOKEN = new RegExp(`${OPERAND}(?:[ ]?${OPERATOR}[ ]?${OPERAND})*`, 'y');

// 가장 작은 조각(글자·수식 토큰). 공백은 앞 조각에 붙는다.
function charPieces(src) {
  const pieces = [];
  let i = 0;
  while (i < src.length) {
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    let end = m ? i + m[0].length : i + String.fromCodePoint(src.codePointAt(i)).length;
    while (end < src.length && /\s/.test(src[end])) end += 1;
    pieces.push(src.slice(i, end));
    i = end;
  }
  return pieces;
}

const endsWithSpace = (piece) => /\s$/.test(piece);
// 문장 끝: 마침표·물음표·느낌표·말줄임표(뒤에 닫는 따옴표·괄호가 올 수 있다) 또는 줄바꿈.
const SENTENCE_END = /[.?!…]["'”’)\]」』]*$/;
function endsSentence(buf) {
  const body = buf.replace(/\s+$/, '');
  return SENTENCE_END.test(body) || /\n/.test(buf.slice(body.length));
}

// 글자 조각들을 이어 붙이다가 ends(지금까지 쌓은 글, 방금 조각) 가 참이면 거기서 끊는다.
function group(pieces, ends) {
  const out = [];
  let buf = '';
  for (const p of pieces) {
    buf += p;
    if (ends(buf, p)) { out.push(buf); buf = ''; }
  }
  if (buf !== '') out.push(buf);
  return out;
}

export function segment(text, unit = 'char') {
  const pieces = charPieces(String(text ?? ''));
  if (unit === 'word') return group(pieces, (_, p) => endsWithSpace(p));
  if (unit === 'sentence') return group(pieces, (buf, p) => endsWithSpace(p) && endsSentence(buf));
  return pieces; // 'char' 와 'keys' — 타자는 조각이 글자와 같고, 한글 음절 안의 자판 차례(keyFrames)만 표시기가 더한다
}

// 타자(keys): 한글 음절 하나가 자판으로 조합되는 차례. 유니코드 표준 계산(가 = 0xAC00 + (초성×21 + 중성)×28 + 종성).
// 예: '각' → ['ㄱ','가','각'], '닭' → ['ㄷ','다','달','닭'](겹받침은 자판 차례대로 ㄹ 다음 ㄱ), '과' → ['ㄱ','고','과'].
// 한글 음절이 아닌 조각(라틴·숫자·기호·수식 토큰)은 [piece] 그대로 — 쪼개지 않는다. 끝 공백은 마지막 차례에만 붙는다.
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JONG_FIRST = [0, 1, 2, 1, 4, 4, 4, 7, 8, 8, 8, 8, 8, 8, 8, 8, 16, 17, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27]; // 종성 → 겹받침의 앞 낱자(홑이면 자기)
const JUNG_FIRST = [0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8, 8, 12, 13, 13, 13, 13, 17, 18, 18, 20]; // 중성 → 겹모음의 앞 낱자(홑이면 자기)
export function keyFrames(piece) {
  const body = piece.replace(/\s+$/, '');
  const ws = piece.slice(body.length);
  const code = body.length === 1 ? body.charCodeAt(0) - 0xAC00 : -1;
  if (code < 0 || code >= 11172) return [piece];
  const l = Math.floor(code / 588);
  const v = Math.floor((code % 588) / 28);
  const t = code % 28;
  const syl = (jung, jong) => String.fromCharCode(0xAC00 + (l * 21 + jung) * 28 + jong);
  const out = [CHO[l]];
  if (JUNG_FIRST[v] !== v) out.push(syl(JUNG_FIRST[v], 0));
  out.push(syl(v, 0));
  if (t !== 0) {
    if (JONG_FIRST[t] !== t) out.push(syl(v, JONG_FIRST[t]));
    out.push(syl(v, t));
  }
  out[out.length - 1] += ws;
  return out;
}

// 문장 끝·쉼표에서 잠깐 쉬어 읽을 틈을 준다(분절 효과를 주장하는 것이 아니라 읽기 리듬용 기본값).
// piece 는 글자 조각(가장 작은 단위)이다. 큰 단위 조각은 pieceDelay 를 쓴다.
export function delayFor(piece, speed = 'normal') {
  const base = SPEEDS[speed] ?? SPEEDS.normal;
  const body = piece.replace(/\s+$/, '');
  const trailingBreak = /\n/.test(piece.slice(body.length));
  let factor = 1;
  if (/[.?!…]$/.test(body)) factor = 6;
  else if (/[,;:]$/.test(body)) factor = 2.5;
  if (trailingBreak) factor = Math.max(factor, 5);
  const lengthFactor = Math.min(3, 1 + Math.max(0, body.length - 1) / 6);
  return Math.round(base * lengthFactor * factor);
}

// 어떤 단위의 조각이든 같은 규칙으로 지연을 구한다: 안에 든 글자 조각 지연의 합(글자 수에 비례).
export function pieceDelay(piece, speed = 'normal') {
  return charPieces(piece).reduce((sum, p) => sum + delayFor(p, speed), 0);
}

export function totalDuration(pieces, speed = 'normal') {
  return pieces.reduce((sum, p) => sum + pieceDelay(p, speed), 0);
}
