// 여는 카드(opener): 본문 앞 첫 카드 하나 — 상황 그림이 먼저 보이고, 곧 직관으로 답할 핵심 질문과 보기가 나온다(K04 A124 · A125).
// 순수 로직 — DOM · 저장소 · 시계를 모른다. 정답 피드백 없이 처음 고른 답만 진행에 남기고, 끝 화면에서 한 번 더 고르게 한다(그때 정답과 까닭을 보인다).
// 모양(모듈 자료): opener { figure, alt, prompt, answer(choice), misconceptions?, solution, note? } — 문항(check · preCheck 문항)의 고르기 꼴을 그대로 쓴다.
import { grade, matchMisconception } from './answer.js';

export const OPENER_STATUSES = ['answered', 'skipped', 'na']; // answered: 답을 골랐다 · skipped: '이미 아는 내용이면' 줄로 지금의 흐름에 들어갔다 · na: 본문을 본 뒤라 권할 때가 지났다('처음부터')
export const OPENER_RESULTS = ['correct', 'wrong'];
export const MIN_OPENER_OPTIONS = 2;
export const MAX_OPENER_OPTIONS = 4;

// 화면 문구. 한 곳에 모아 두고 시험이 '맞다 · 틀리다를 말하지 않음'을 본다.
export const OPENER_TEXT = Object.freeze({
  note: '틀려도 괜찮아요. 끝에서 다시 봅니다.',
  start: '시작',
  skipLink: '이미 아는 내용이면 — 확인하고 건너뛰기',
  more: '자세히',
  picked: '고른 답',
  revisitTitle: '처음에 고른 답을 다시 봅니다',
  revisitFirst: (label) => `처음 고른 답: ${label} — 지금 보면 어느 쪽인가요?`,
  revisitAnswer: (label) => `정답은 ‘${label}’ 입니다.`,
  revisitWhy: '까닭',
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const clone = (s) => structuredClone(s);

// ---------- 모듈 데이터 ----------

// 정의. 없거나 객체가 아니면 null(형식이 틀린 것은 validateOpener 가 막는다).
export const openerDef = (mod) => (isObj(mod?.opener) ? mod.opener : null);

// 형식 검사. core/module.js 의 validateModule 이 자기 검사 함수(checkAnswer · checkGrading)를 넘겨 부른다.
export function validateOpener(mod, errors, { checkAnswer, checkGrading }) {
  const def = mod.opener;
  if (def === undefined) return;
  if (!isObj(def)) { errors.push('opener: 객체여야 한다'); return; }
  if (!isStr(def.figure) || !isObj(mod.figures?.[def.figure])) errors.push(`opener.figure: 참조한 그림 '${def.figure}' 이 figures 에 없다`);
  if (!isStr(def.alt)) errors.push('opener.alt(그림의 텍스트 대체) 필요');
  if (!isStr(def.prompt)) errors.push('opener.prompt 필요');
  if (!isStr(def.solution)) errors.push('opener.solution(끝 화면에서 정답과 함께 보이는 짧은 까닭) 필요');
  if (def.note !== undefined && !isStr(def.note)) errors.push('opener.note 는 비어 있지 않은 문자열');
  if (def.answer?.kind !== 'choice') { errors.push('opener.answer 는 고르기(choice) 꼴이어야 한다'); return; }
  if (checkAnswer(def.answer, 'opener.answer', errors)) {
    const n = def.answer.options.length;
    if (n < MIN_OPENER_OPTIONS || n > MAX_OPENER_OPTIONS) errors.push(`opener.answer: 보기는 ${MIN_OPENER_OPTIONS}~${MAX_OPENER_OPTIONS}개(지금 ${n}개)`);
    checkGrading(def.answer, def.misconceptions, 'opener', errors);
  }
}

// ---------- 권하기 ----------

// 화면을 처음 열 때 본문보다 먼저 여는 카드를 보일 차례인가: 모듈에 있고, 본문을 읽은 흔적이 없고, 아직 끝내지 않았고, 이 카드를 거친 적이 없다.
export const openerGateFor = (mod, state, { started = false } = {}) => openerDef(mod) !== null && !started && !Number.isFinite(state.finishedAt) && !state.opener;

// 여는 카드가 있는 모듈은 시작 전 문항 · 건너뛰기 확인 카드를 따로 열지 않는다. 다만 '이미 아는 내용이면' 줄로 들어간 사람(skipped)은 지금의 흐름 그대로다.
export const openerBypassesGates = (mod, state) => openerDef(mod) !== null && state.opener?.status !== 'skipped';

// 끝 화면의 다시 보기: 처음 답을 골랐으면 보인다.
export const openerRevisitFor = (mod, state) => (openerDef(mod) !== null && state.opener?.status === 'answered' ? state.opener : null);

// ---------- 채점 ----------

// 고른 보기 id 를 채점한다(결과를 화면에 말하지 않는다 — 기록과 끝 화면의 다시 보기가 쓴다). misconceptionIndex: 등록한 오답에 맞는 번호(없으면 -1).
export function gradeOpener(mod, chosen) {
  const def = openerDef(mod);
  const r = grade(chosen, def.answer, def.misconceptions ?? []);
  if (r.result === 'correct') return { result: 'correct', misconceptionIndex: -1 };
  return { result: 'wrong', misconceptionIndex: matchMisconception(def.answer, r.value, def.misconceptions ?? []) };
}

export const optionLabel = (mod, id) => openerDef(mod)?.answer.options.find((o) => o.id === id)?.label ?? '';

// ---------- 상태 전이 ----------

// 처음 고른 답. 한 번만 남는다.
export function answerOpener(state, chosen, result, now = 0) {
  if (state.opener || !OPENER_RESULTS.includes(result)) return state;
  const next = clone(state);
  next.opener = { status: 'answered', chosen, result, at: now };
  return next;
}

// 끝 화면에서 다시 고른 답. 처음 답이 있고 아직 다시 고르지 않았을 때 한 번만 남는다.
export function revisitOpener(state, chosen, result) {
  if (state.opener?.status !== 'answered' || state.opener.revisit || !OPENER_RESULTS.includes(result)) return state;
  const next = clone(state);
  next.opener.revisit = { chosen, result };
  return next;
}

// '이미 아는 내용이면' 줄로 지금의 흐름에 들어갔다(skipped) 또는 권할 때가 지남(na). 이미 이 카드를 거쳤으면 바꾸지 않는다.
export function closeOpener(state, status, now = 0) {
  if (state.opener || !['skipped', 'na'].includes(status)) return state;
  const next = clone(state);
  next.opener = { status, chosen: null, result: null, at: now };
  return next;
}

// ---------- 저장 데이터 거르기 ----------

// mod 의 opener 에 없는 보기 · 모르는 값은 버린다(없으면 null).
export function sanitizeOpener(raw, mod) {
  const def = openerDef(mod);
  if (!def || !isObj(raw) || !OPENER_STATUSES.includes(raw.status)) return null;
  const ids = new Set(def.answer?.options?.map((o) => o.id) ?? []);
  const out = { status: raw.status, chosen: null, result: null, at: Number.isFinite(raw.at) ? raw.at : 0 };
  if (raw.status === 'answered') {
    if (!ids.has(raw.chosen) || !OPENER_RESULTS.includes(raw.result)) return null;
    out.chosen = raw.chosen;
    out.result = raw.result;
    if (isObj(raw.revisit) && ids.has(raw.revisit.chosen) && OPENER_RESULTS.includes(raw.revisit.result)) out.revisit = { chosen: raw.revisit.chosen, result: raw.revisit.result };
  }
  return out;
}
