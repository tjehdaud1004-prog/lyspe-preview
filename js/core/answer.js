// 답 채점. number·choice·linear·term 은 자동 채점하고, text·expr 는 채점하지 않는 자기 점검이다.
//  - term  : 낱말 하나를 떠올려 적는다. 공백·영문 대소문자·끝의 마침표와 쉼표·한글 조합 방식(NFC/NFD)을 가리지 않고 value 또는 accept 와 글자가 같으면 정답이다.
//            안 맞으면 입력 끝의 조사·맺음말("는", "입니다" …)을 하나 떼고 한 번 더 견준다(termCandidates).
//  - linear: 문자 하나가 들어간 일차식("2000 + 100t") 또는 일차식 두 개를 이은 등식("2000 + 100t = 6000 + 60t").
//  - expr  : 자동 채점 범위 밖의 식(문자 둘 이상, 이차식 등)을 적고 예시 답과 견주는 자리. 일차식이면 linear 를 쓴다.
//
// 결과 형태: { result: 'correct' | 'wrong' | 'invalid' | 'self', value?, feedback?, reason? }
//  - invalid 는 '답으로 읽을 수 없음'(빈칸·형식·단위). 시도 횟수에 세지 않는다.

import { formatNumber } from './format.js';

const THOUSANDS_NUMBER = /^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(.*)$/s;

export function normalizeInput(input) {
  return String(input ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 전각 숫자
    .replace(/[，､]/g, ',')
    .replace(/[．]/g, '.')
    .replace(/[－−–]/g, '-')
    .replace(/　/g, ' ')
    .trim();
}

export function isAutoGraded(answer) {
  return answer?.kind === 'number' || answer?.kind === 'numbers' || answer?.kind === 'choice' || answer?.kind === 'linear' || answer?.kind === 'term';
}

// ---------- 수 여럿(numbers) ----------
// 쉼표 · 띄어쓰기 · 가운뎃점 · 줄바꿈으로 가른 정수 여럿. 음수는 - · −(U+2212) 둘 다(normalizeInput 이 같은 꼴로 만든다).
// 조각 하나라도 정수가 아니면 'format'(틀림으로 세지 않고 형식 안내로 돌려보낸다 — number 와 같게).
const NUMBERS_SEPARATORS = /[\s,·・∙⋅]+/;
const INTEGER_TOKEN = /^[+-]?\d+$/;

export function parseNumbers(input) {
  const s = normalizeInput(input);
  if (s === '') return { ok: false, reason: 'empty' };
  const tokens = s.split(NUMBERS_SEPARATORS).filter((t) => t !== '');
  if (tokens.length === 0 || !tokens.every((t) => INTEGER_TOKEN.test(t))) return { ok: false, reason: 'format' };
  return { ok: true, values: tokens.map(Number) };
}

/** 수 배열 둘이 같은가. unordered 면 차례를 보지 않는다. */
export function sameNumbers(a, b, unordered = false) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  if (!unordered) return a.every((x, i) => x === b[i]);
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((x, i) => x === sb[i]);
}

function gradeNumbers(input, answer, misconceptions) {
  const parsed = parseNumbers(input);
  if (!parsed.ok) return { result: 'invalid', reason: parsed.reason };
  const unordered = answer.unordered === true;
  if (sameNumbers(parsed.values, answer.value, unordered)) return { result: 'correct', value: parsed.values };
  const hit = misconceptions.find((mc) => mc.match?.kind === 'numbers' && sameNumbers(parsed.values, mc.match.value, unordered));
  if (hit) return { result: 'wrong', value: parsed.values, feedback: hit.feedback };
  // 개수가 다르면 정답을 말하지 않고 개수만 알린다.
  const feedback = parsed.values.length !== answer.value.length ? `수가 ${answer.value.length} 개여야 합니다.` : null;
  return { result: 'wrong', value: parsed.values, feedback };
}

// "1,000원", " 1000 ", "１０００", "t=50" 을 모두 숫자로 읽는다. 쉼표는 천 단위 묶음만 인정한다("20,00" 은 오입력으로 본다).
export function parseNumber(input, answer = {}) {
  let s = normalizeInput(input);
  if (s === '') return { ok: false, reason: 'empty' };
  s = s.replace(/^[A-Za-z]\s*=\s*/, '');
  const m = THOUSANDS_NUMBER.exec(s);
  if (!m) return { ok: false, reason: 'format' };
  const value = Number(m[1].replace(/,/g, ''));
  const unit = m[2].trim();
  if (unit !== '') {
    const allowed = [answer.unit, ...(answer.unitAliases ?? [])].filter(Boolean);
    if (allowed.includes(unit)) return { ok: true, value };
    return { ok: false, reason: /^[가-힣A-Za-z]+$/.test(unit) ? 'unit' : 'format' };
  }
  return { ok: true, value };
}

function gradeNumber(input, answer, misconceptions) {
  const parsed = parseNumber(input, answer);
  if (!parsed.ok) return { result: 'invalid', reason: parsed.reason };
  const tol = (answer.tolerance ?? 0) + 1e-9;
  if (Math.abs(parsed.value - answer.value) <= tol) return { result: 'correct', value: parsed.value };
  const hit = misconceptions.find((mc) => mc.match?.kind === 'number' && Math.abs(parsed.value - mc.match.value) <= 1e-9);
  return { result: 'wrong', value: parsed.value, feedback: hit?.feedback ?? null };
}

function gradeChoice(input, answer, misconceptions) {
  const id = String(input ?? '');
  if (id === '') return { result: 'invalid', reason: 'empty' };
  if (!answer.options.some((o) => o.id === id)) return { result: 'invalid', reason: 'format' };
  if (id === answer.value) return { result: 'correct', value: id };
  const hit = misconceptions.find((mc) => mc.match?.kind === 'choice' && mc.match.value === id);
  return { result: 'wrong', value: id, feedback: hit?.feedback ?? null };
}

// ---------- 낱말(term) ----------
// 견주기 전에 양쪽을 같은 꼴로 만든다: NFC → 모든 공백(전각 포함) 제거 → 영문 소문자 → 끝의 마침표·쉼표 떼기. 뜻이 같은 다른 낱말을 알아보지는 않는다(accept 에 적은 것만).
export function normalizeTerm(input) {
  return String(input ?? '')
    .normalize('NFC')
    .replace(/[\s　]+/g, '')
    .toLowerCase()
    .replace(/[.,．，。、]+$/u, '');
}

const termForms = (answer) => [answer.value, ...(Array.isArray(answer.accept) ? answer.accept : [])].map(normalizeTerm).filter((s) => s !== '');

// 학습자가 낱말에 조사·맺음말을 붙여 적어도("공차는", "공차입니다") 낱말을 아는 것이다. 먼저 적은 그대로 견주고, 안 맞으면 끝의 맺음말 하나를 떼고 다시 견준다.
// 떼는 것은 학습자가 적은 글뿐이다(value·accept·오개념의 match.value 는 떼지 않는다). 맺음말마다 한 번만 떼고(되풀이하지 않는다), 뗀 뒤가 비면 떼지 않는다.
export const TERM_ENDINGS = Object.freeze(['입니다', '이에요', '이예요', '예요', '이다', '이요', '임', '요', '은', '는', '이', '가', '을', '를', '다']);

/** 학습자 입력 → 견줄 꼴의 차례: [그대로, 끝의 맺음말을 하나 뗀 꼴 …]. 입력이 비면 []. */
export function termCandidates(input) {
  const norm = normalizeTerm(String(input ?? '').normalize('NFC').trim());
  if (norm === '') return [];
  const out = [norm];
  for (const end of TERM_ENDINGS) {
    if (!norm.endsWith(end)) continue;
    const rest = norm.slice(0, -end.length);
    if (rest !== '' && !out.includes(rest)) out.push(rest);
  }
  return out;
}

// 오개념 맞추기도 같은 차례로(그대로 → 하나 떼고). 몇 번째인지, 없으면 -1.
function termMisconceptionAt(candidates, misconceptions) {
  for (const c of candidates) {
    const at = misconceptions.findIndex((mc) => mc.match?.kind === 'term' && normalizeTerm(mc.match.value) === c);
    if (at >= 0) return at;
  }
  return -1;
}

function gradeTerm(input, answer, misconceptions) {
  const typed = String(input ?? '').normalize('NFC').trim();
  const candidates = termCandidates(typed);
  if (candidates.length === 0) return { result: 'invalid', reason: 'empty' };
  const forms = termForms(answer);
  if (candidates.some((c) => forms.includes(c))) return { result: 'correct', value: typed };
  const hit = misconceptions[termMisconceptionAt(candidates, misconceptions)];
  return { result: 'wrong', value: typed, feedback: hit?.feedback ?? null };
}

// ---------- 일차식(linear) ----------
// 식을 다항식의 계수 배열 [상수, 1차, 2차, …]로 읽어 계수끼리 견준다. 그래서 항의 순서, 곱셈 기호를 썼는지,
// 쉼표·공백·전각 문자는 채점에 영향을 주지 않는다. 정답은 1차 이하지만 입력의 차수가 높으면 '틀린 답'으로 읽는다.

const MAX_DEGREE = 6;
const EXPR_NUMBER = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/;

export function normalizeExpr(input) {
  return String(input ?? '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 전각 영문·숫자·기호
    .replace(/[，､]/g, ',')
    .replace(/[−–—]/g, '-')
    .replace(/[×✕✖·⋅∙]/g, '*')
    .replace(/[÷∕]/g, '/')
    .replace(/[\s　]+/g, ' ')
    .trim();
}

const trimPoly = (p) => { const q = p.slice(); while (q.length > 0 && Math.abs(q[q.length - 1]) < 1e-12) q.pop(); return q; };
const addPoly = (a, b) => trimPoly(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0)));
const scalePoly = (a, k) => trimPoly(a.map((c) => c * k));
function mulPoly(a, b) {
  if (a.length === 0 || b.length === 0) return [];
  if (a.length + b.length - 2 > MAX_DEGREE) throw new Error('format');
  const out = new Array(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => { out[i + j] += x * y; }));
  return trimPoly(out);
}
const near = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
const samePoly = (a, b) => a.length === b.length && a.every((c, i) => near(c, b[i]));

// 문자열 → 토큰. 문항이 정한 문자(대소문자 무시) 말고 다른 글자가 있으면 reason 'variable'.
// 문자가 x 가 아닐 때의 x 는 곱셈 기호로 읽는다(휴대폰 자판에서 × 대신 흔히 친다).
function tokenizeExpr(s, variable) {
  const v = variable.toLowerCase();
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ') { i += 1; continue; }
    if (ch >= '0' && ch <= '9') {
      const m = EXPR_NUMBER.exec(s.slice(i));
      i += m[0].length; // 천 단위가 아닌 쉼표("20,00")나 끝이 잘린 소수("3.")는 남은 쉼표·점이 아래에서 'format' 이 된다
      tokens.push({ t: 'num', v: Number(m[0].replace(/,/g, '')) });
      continue;
    }
    if ('+-*/()'.includes(ch)) { tokens.push({ t: ch }); i += 1; continue; }
    if (/[A-Za-z]/.test(ch)) {
      const lower = ch.toLowerCase();
      if (lower === v) tokens.push({ t: 'var' });
      else if (lower === 'x') tokens.push({ t: '*' });
      else return { reason: 'variable' };
      i += 1;
      continue;
    }
    return { reason: 'format' };
  }
  return { tokens };
}

// 토큰 → 계수 배열. 숫자 바로 뒤의 문자·괄호는 곱셈으로 읽는다(100t, 3(t + 1)). 나눗셈은 0 이 아닌 수로만.
function parseTokens(tokens) {
  let pos = 0;
  const peek = () => tokens[pos]?.t;
  const fail = () => { throw new Error('format'); };
  function primary() {
    const tok = tokens[pos];
    if (!tok) fail();
    pos += 1;
    if (tok.t === 'num') return trimPoly([tok.v]);
    if (tok.t === 'var') return [0, 1];
    if (tok.t === '(') {
      const inner = sum();
      if (peek() !== ')') fail();
      pos += 1;
      return inner;
    }
    return fail();
  }
  function unary() {
    if (peek() === '-') { pos += 1; return scalePoly(unary(), -1); }
    if (peek() === '+') { pos += 1; return unary(); }
    return primary();
  }
  function product() {
    let left = unary();
    for (;;) {
      const t = peek();
      if (t === '*') { pos += 1; left = mulPoly(left, unary()); }
      else if (t === '/') {
        pos += 1;
        const d = unary();
        if (d.length !== 1) fail(); // 0 이나 문자가 든 식으로는 나누지 않는다
        left = scalePoly(left, 1 / d[0]);
      } else if (t === 'var' || t === '(') left = mulPoly(left, primary());
      else return left;
    }
  }
  function sum() {
    let left = product();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[pos].t;
      pos += 1;
      const right = product();
      left = addPoly(left, op === '+' ? right : scalePoly(right, -1));
    }
    return left;
  }
  const out = sum();
  if (pos !== tokens.length) fail();
  return out;
}

// 식 하나(등호 없음)를 계수 배열로. 읽을 수 없으면 { ok:false, reason: 'empty'|'format'|'variable' }.
export function parseExpr(text, variable) {
  const s = normalizeExpr(text);
  if (s === '') return { ok: false, reason: 'empty' };
  const { tokens, reason } = tokenizeExpr(s, variable);
  if (!tokens) return { ok: false, reason };
  try { return { ok: true, poly: parseTokens(tokens) }; } catch { return { ok: false, reason: 'format' }; }
}

// 모듈에 적힌 정답·오개념 문자열 → 변 목록(식이면 1개, 등식이면 2개). 읽을 수 없으면 null.
export function linearSides(value, variable) {
  if (typeof value !== 'string' || typeof variable !== 'string' || !/^[A-Za-z]$/.test(variable)) return null;
  const parts = normalizeExpr(value).split('=');
  if (parts.length > 2) return null;
  const sides = parts.map((p) => parseExpr(p, variable));
  return sides.every((s) => s.ok) ? sides.map((s) => s.poly) : null;
}

export const isLinearEquation = (answer) => typeof answer?.value === 'string' && answer.value.includes('=');

// 식 앞에 붙인 '이름'(정답이 등식이 아닐 때만 읽는다): 영문자 하나(변수와 다른 것) · 영문자 하나 + 붙은 첨자(aₙ, a_n, a_{n}, an, a1, a₁) ·
// f(n) 꼴(괄호 안은 문항의 문자) · 문항의 label 과 공백을 빼고 같은 글. 수나 식(2, 2n, n+1)은 이름이 아니다.
const squash = (t) => String(t).replace(/[\s　]+/g, '').toLowerCase();
function isLinearName(name, answer) {
  const compact = squash(name);
  if (answer.label && compact === squash(answer.label)) return true;
  const variable = answer.variable.toLowerCase();
  if (/^[a-z]$/.test(compact)) return compact !== variable;
  if (/^[a-z](?:_\{?[a-z0-9]+\}?|[a-z0-9]|[₀-₉ₐ-ₜ])$/.test(compact)) return true;
  return compact === `${compact[0]}(${variable})` && /^[a-z]$/.test(compact[0]);
}

// 학습자 입력 → 변 목록. 끝에 붙인 단위("… 원", "… (원)")와 식 앞의 이름("C = …")은 떼고 읽는다.
export function parseLinear(input, answer) {
  let s = normalizeExpr(input);
  if (s === '') return { ok: false, reason: 'empty' };
  for (const unit of [answer.unit, ...(answer.unitAliases ?? [])].filter(Boolean)) {
    const tail = [`(${unit})`, unit].find((t) => s.endsWith(t));
    if (tail) { s = s.slice(0, -tail.length).trim(); break; }
  }
  let parts = s.split('=').map((p) => p.trim());
  if (isLinearEquation(answer)) {
    if (parts.length === 1) return { ok: false, reason: 'equation' };
    if (parts.length > 2) return { ok: false, reason: 'format' };
  } else if (parts.length > 1) {
    if (parts.length !== 2 || !isLinearName(parts[0], answer)) return { ok: false, reason: 'expression' };
    parts = [parts[1]];
  }
  const sides = parts.map((p) => parseExpr(p, answer.variable));
  const bad = sides.find((x) => !x.ok);
  if (bad) return { ok: false, reason: bad.reason === 'empty' ? 'format' : bad.reason };
  return { ok: true, sides: sides.map((x) => x.poly) };
}

// 같은 답인가: 식은 계수가 같으면, 등식은 두 변이 (좌우를 바꿔도) 각각 같으면.
export function sameSides(a, b) {
  if (a.length !== b.length) return false;
  if (a.length === 1) return samePoly(a[0], b[0]);
  return (samePoly(a[0], b[0]) && samePoly(a[1], b[1])) || (samePoly(a[0], b[1]) && samePoly(a[1], b[0]));
}

// 등식 둘이 '옮겨 정리하면 같은 등식'인가: (좌변 − 우변)이 서로 0 이 아닌 상수 배.
function sameEquationRearranged(a, b) {
  const d = addPoly(a[0], scalePoly(a[1], -1));
  const e = addPoly(b[0], scalePoly(b[1], -1));
  if (d.length === 0 || d.length !== e.length) return false;
  const k = d[d.length - 1] / e[e.length - 1];
  return samePoly(d, scalePoly(e, k));
}

function matchLinearMisconception(sides, answer, misconceptions) {
  return misconceptions.findIndex((mc) => {
    if (mc.match?.kind !== 'linear') return false;
    const target = linearSides(mc.match.value, answer.variable);
    return target !== null && sameSides(sides, target);
  });
}

function gradeLinear(input, answer, misconceptions) {
  const target = linearSides(answer.value, answer.variable);
  if (!target) return { result: 'invalid', reason: 'unsupported' };
  const parsed = parseLinear(input, answer);
  if (!parsed.ok) return { result: 'invalid', reason: parsed.reason };
  const value = normalizeExpr(input);
  if (sameSides(parsed.sides, target)) return { result: 'correct', value };
  // 등식 칸에 이미 옮겨 정리한 등식(예: 40t = 4,000)을 적은 경우: 틀린 답이 아니라 '이 칸이 묻는 모양이 아님'으로 돌려준다.
  if (target.length === 2 && sameEquationRearranged(parsed.sides, target)) return { result: 'invalid', reason: 'rearranged' };
  const hit = misconceptions[matchLinearMisconception(parsed.sides, answer, misconceptions)];
  return { result: 'wrong', value, feedback: hit?.feedback ?? null };
}

// 식 입력칸 옆에 둘 기호 단추(휴대폰 자판에서 찾기 번거로운 것). 등식 문항에만 등호가 들어간다.
export function linearKeys(answer) {
  return [answer.variable, '+', '−', '×', ...(isLinearEquation(answer) ? ['='] : [])];
}

export function grade(input, answer, misconceptions = []) {
  switch (answer?.kind) {
    case 'number': return gradeNumber(input, answer, misconceptions);
    case 'numbers': return gradeNumbers(input, answer, misconceptions);
    case 'choice': return gradeChoice(input, answer, misconceptions);
    case 'linear': return gradeLinear(input, answer, misconceptions);
    case 'term': return gradeTerm(input, answer, misconceptions);
    case 'text':
    case 'expr': {
      const text = String(input ?? '').trim();
      return text === '' ? { result: 'invalid', reason: 'empty' } : { result: 'self', value: text };
    }
    default: return { result: 'invalid', reason: 'unsupported' };
  }
}

// 틀린 답이 등록된 오개념의 몇 번째와 맞는지(없으면 -1). 학습 기록의 misconceptionId 를 만드는 재료다.
// value 는 grade() 가 돌려준 value(숫자 또는 보기 id).
export function matchMisconception(answer, value, misconceptions = []) {
  if (answer?.kind === 'number') return misconceptions.findIndex((mc) => mc.match?.kind === 'number' && Math.abs(value - mc.match.value) <= 1e-9);
  if (answer?.kind === 'choice') return misconceptions.findIndex((mc) => mc.match?.kind === 'choice' && mc.match.value === value);
  if (answer?.kind === 'numbers') {
    const values = Array.isArray(value) ? value : parseNumbers(value).values; // grade() 가 돌려준 배열 또는 입력 글
    return values ? misconceptions.findIndex((mc) => mc.match?.kind === 'numbers' && sameNumbers(values, mc.match.value, answer.unordered === true)) : -1;
  }
  if (answer?.kind === 'linear') {
    const parsed = parseLinear(value, answer);
    return parsed.ok ? matchLinearMisconception(parsed.sides, answer, misconceptions) : -1;
  }
  if (answer?.kind === 'term') return termMisconceptionAt(termCandidates(value), misconceptions);
  return -1;
}

export function invalidMessage(reason, answer) {
  if (answer?.kind === 'linear') {
    const v = answer.variable;
    switch (reason) {
      case 'empty': return '답을 먼저 적어 주세요.';
      case 'format': return `숫자와 ${v}, 그리고 +, −, × 기호만 써서 적어 주세요. 단위나 다른 글자는 뺍니다.`;
      case 'variable': return `이 문항에서 쓰는 문자는 ${v} 하나입니다. 다른 글자는 빼고 적어 주세요.`;
      case 'equation': return '등호(=)가 한 번 들어간 등식으로 적어 주세요.';
      case 'expression': return '등호 없이 식만 적어 주세요.';
      case 'rearranged': return '뜻이 같은 등식입니다. 다만 이 칸에는 옮겨서 정리하기 전의 모양, 곧 두 식을 그대로 등호로 이은 식을 적어 주세요.';
      default: return '이 답은 읽을 수 없습니다.';
    }
  }
  if (answer?.kind === 'numbers') return reason === 'empty' ? '답을 먼저 적어 주세요.' : '수만 쉼표로 적어 주세요.';
  switch (reason) {
    case 'empty': return '답을 먼저 적어 주세요.';
    case 'unit': return answer?.unit ? `단위를 확인해 주세요. 이 문항의 단위는 ‘${answer.unit}’입니다.` : '숫자만 적어 주세요.';
    case 'format': return '숫자로 적어 주세요. 예: 1,000 또는 1000';
    default: return '이 답은 읽을 수 없습니다.';
  }
}

// 정답을 글로: 틀렸을 때·건너뛴 뒤에 정답을 보여 줄 때 쓴다. 자기 점검(text·expr)은 예시 답이다.
export function answerText(answer) {
  switch (answer?.kind) {
    case 'number': return `${formatNumber(answer.value)}${answer.unit ? ' ' + answer.unit : ''}`;
    case 'numbers': return answer.value.join(', ');
    case 'choice': return choiceLabel(answer, answer.value);
    case 'linear': return `${answer.label ? answer.label + ' = ' : ''}${answer.value}${answer.unit ? ' ' + answer.unit : ''}`;
    case 'term': return answer.value;
    case 'text':
    case 'expr': return answer.sample ?? '';
    default: return '';
  }
}

// 학습자가 입력한 값을 화면에 다시 보여 줄 때 쓰는 보기 이름.
export function choiceLabel(answer, id) {
  return answer.options.find((o) => o.id === id)?.label ?? String(id);
}

// 답 칸에서 Enter 를 '제출'로 볼 것인가. 한글처럼 글자를 조합하는 입력 중의 Enter 는 조합을 끝내는 키이지 제출이 아니다.
// 규격(UI Events)은 그 keydown 의 isComposing 을 true, keyCode 를 229 로 두라고 하지만 Safari 는 조합을 끝내는 Enter 에서
// isComposing 이 false 로 올 수 있다(research/out/K/K32.md 의 R81-7·R81-9, 대조 VERIFY_K/K32.md). 그래서 둘 다 거른다.
// 한국어 실기기에서 확인한 것은 아니다.
export function submitsOnEnter(e) {
  return e?.key === 'Enter' && e.isComposing !== true && e.keyCode !== 229;
}
