// 복습 회차. 순수 로직 — DOM·시계를 모른다(시각은 인자로 받는다). 언제 복습하는지는 data/review.mjs, 이 파일은 '한 회차를 어떻게 푸는가'와 그 상태다.
//
// 한 회차: 문항을 하나씩 묻는다(힌트 없음). 맞히면 그 회차에서 뺀다. 틀리거나 '모르겠다'면 풀이(feedback)를 보이고 남은 문항 뒤로 보내 다시 묻는다.
// 남은 문항이 그것 하나뿐이면 다시 묻지 않고 그 회차를 끝낸다 — 방금 본 풀이를 그대로 옮겨 적는 것을 맞힘으로 세지 않기 위해서다. 그 문항은 '이번에 못 맞힘'(session.unresolved)으로 남고, 다음 회차에 다시 나온다(묶음 돌리기 core/round.js 와 같은 규칙).
// 한 문항은 한 회차에 최대 3번까지 묻고, 3번째도 틀리면 풀이를 보인 채 뺀다.
// 중간에 나가면 '하다 만 회차'로 남고, 다시 열면 남은 문항부터 잇는다.
// 조사가 말한 것: 틀린 문항을 정답 확인 뒤 다시 풀어 한 번 맞히면 그 회차에서 빼는 것이 낫거나 같았고, 맞힌 직후 같은 문항을 연달아 다시 맞히는 것은 이득이 없었다.
// 첫 학습 성적에 따라 복습 시점을 앞당기거나 미루는 근거는 없다 — 그래서 성적은 일정에 쓰지 않고, 문항 순서(지난 회차에서 놓친 목표 먼저)에만 쓴다.
// 아래 숫자(최대 3번·문항 수 상한)는 모두 근거 없는 출발점이다. 점수를 만들지 않는다.
//
// core/module.js 가 이 파일을 부르므로(검증) module.js 를 되돌아 부르지 않는다. 본문 진행에서 놓친 목표를 구하는 일은 core/review-plan.js 에 있다.
import { isAutoGraded } from './answer.js';
import { gradeProbe } from './probe.js';
import { keys } from './storage.js';
import { MAX_REVIEW_STEP, dayLabelKo, localDate, parseDate } from '../data/review.mjs';

export const REVIEW_RESULTS = ['correct', 'wrong', 'unknown'];
export const MAX_ASKS = 3;        // 한 문항을 한 회차에 묻는 횟수의 상한. 근거 없는 출발점이다.
export const MAX_REVIEW_ITEMS = 8; // 한 회차를 짧게 두려는 상한(약 8분 안팎). 근거 없는 출발점이다.
export const MAX_REVIEW_MINUTES = 60;
export const REVIEW_LABELS = Object.freeze({ correct: '맞음', wrong: '틀림', unknown: '모르겠다' });

// 화면 문구. 한 곳에 모아 두고 시험이 금지어(점수·평가·효과 주장)가 없는지 본다. 복습의 효과를 말하는 문구를 쓰지 않는다 — 사실만 적는다.
export const REVIEW_TEXT = Object.freeze({
  eyebrow: '복습',
  title: (step) => `복습 ${step}회차`,
  offer: (n, minutes) => `복습할 때입니다(약 ${minutes}분, ${n}문제).`,
  offerRule: `시험이 아닙니다. 문제마다 힌트는 없습니다. 틀리거나 모르겠다고 하면 풀이를 보여 드린 뒤 뒤에서 다시 묻고, 한 문제는 한 번의 복습에서 ${MAX_ASKS}번까지 묻습니다.`,
  start: '복습하기',
  resume: '이어서 풀기',
  later: '나중에',
  laterNote: '‘나중에’를 누르면 이번 접속에서는 다시 권하지 않습니다.',
  remaining: (n) => `남은 문제 ${n}개`,
  askNo: (a) => `이 문제를 묻는 것은 ${a}번째입니다(한 번의 복습에서 최대 ${MAX_ASKS}번).`,
  submit: '답 내기',
  unknown: '모르겠다',
  next: '다음 문제',
  finish: '마치기',
  correct: '맞았습니다.',
  redo: '뒤에서 다시 묻습니다.',
  deferred: '남은 문제가 이것 하나뿐이어서 바로 다시 묻지 않습니다. 이번 복습에서는 맞히지 못한 문제로 남깁니다.',
  gaveUp: `${MAX_ASKS}번 물었으므로 풀이를 보여 드리고 이번 복습에서는 뺍니다.`,
  doneTitle: (step) => `복습 ${step}회차를 마쳤습니다`,
  firstTry: (c, n) => `첫 시도에 맞힌 문제: ${c} / ${n}`,
  redone: (m) => (m > 0 ? `다시 물은 문제: ${m}개` : '다시 물은 문제: 없음'),
  unresolvedLine: (n) => `이번에 맞히지 못한 문제: ${n}개`,
  nextLine: (line) => `다음 복습: ${line}`,
  last: '이번이 마지막 복습 회차입니다.',
  noMore: '시험 날짜까지 남은 기간에는 더 정한 복습이 없습니다.',
  leave: '본문 보기',
  noItemsNote: '이 모듈에는 복습 문제가 없습니다. 그날 본문을 다시 보면 됩니다.',
  headNext: (line) => `다음 복습: ${line}`,
  headOpen: (line) => `복습할 수 있습니다: ${line}`,
  headResume: (line) => `이어 하기: ${line}`,
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const clone = (s) => structuredClone(s);

// ---------- 모듈 데이터 ----------

/** module.review. 없거나 형식이 틀리면 null. */
export function reviewDef(mod) {
  const def = mod?.review;
  return isObj(def) && Array.isArray(def.items) && def.items.length > 0 ? def : null;
}

export function reviewItemIds(mod) {
  return new Set((reviewDef(mod)?.items ?? []).map((it) => it?.id));
}

export function reviewMinutes(mod) {
  const m = reviewDef(mod)?.minutes;
  return Number.isInteger(m) && m >= 1 && m <= MAX_REVIEW_MINUTES ? m : null;
}

// core/module.js 의 validateModule 이 자기 검사 함수(checkAnswer·checkGrading·checkItemTags)와 id 중복 검사(claim)를 넘겨 부른다.
// 문항 형식은 delayedCheck 와 같되 feedback(틀렸을 때 보일 풀이)이 필수이고 goal(skipCheck 의 목표 id)을 둘 수 있다.
export function validateReview(mod, errors, { claim, checkAnswer, checkGrading, checkItemTags, idPattern }) {
  const def = mod.review;
  if (def === undefined) return;
  if (!isObj(def)) { errors.push('review: 객체여야 한다'); return; }
  if (!Number.isInteger(def.minutes) || def.minutes < 1 || def.minutes > MAX_REVIEW_MINUTES) errors.push(`review.minutes 는 1~${MAX_REVIEW_MINUTES} 사이의 정수(분)`);
  if (!Array.isArray(def.items) || def.items.length < 1 || def.items.length > MAX_REVIEW_ITEMS) { errors.push(`review.items 는 1~${MAX_REVIEW_ITEMS}개`); return; }
  const goalIds = new Set((Array.isArray(mod.skipCheck?.goals) ? mod.skipCheck.goals : []).map((g) => g?.id));
  def.items.forEach((item, i) => {
    const w = `review.items[${i}]`;
    if (!isObj(item)) { errors.push(`${w}: 객체여야 한다`); return; }
    if (!isStr(item.id) || !idPattern.test(item.id)) errors.push(`${w}: id 형식 오류`);
    else claim(item.id, w);
    if (!isStr(item.prompt)) errors.push(`${w}: prompt 필요`);
    checkItemTags(item, w, errors, null); // 문항은 장면 밖이라 focus 포함 검사가 없다
    if (checkAnswer(item.answer, `${w}.answer`, errors)) {
      if (!isAutoGraded(item.answer)) errors.push(`${w}: 복습 문항은 number|choice|linear|term 만 쓴다(채점할 수 있어야 한다)`);
      checkGrading(item.answer, item.misconceptions, w, errors);
    }
    if (item.hints !== undefined) errors.push(`${w}: 복습 문항에는 hints 를 둘 수 없다(틀렸을 때 보일 feedback 만 쓴다)`);
    if (!isStr(item.feedback)) errors.push(`${w}: feedback(틀렸을 때 보일 풀이) 필요`);
    if (item.goal !== undefined) {
      if (!isStr(item.goal)) errors.push(`${w}: goal 은 skipCheck 의 목표 id 문자열`);
      else if (!goalIds.has(item.goal)) errors.push(`${w}: goal '${item.goal}' 은 skipCheck.goals 에 없는 목표`);
    }
  });
}

export const gradeReview = gradeProbe;

// ---------- 문항 순서 ----------

/** 지난 회차(없으면 본문)에서 첫 시도에 틀렸거나 힌트를 본 목표(missedGoals)의 문항 먼저, 나머지는 정의 순서. 같은 무리 안에서는 정의 순서를 지킨다. */
export function orderItems(def, missedGoals = []) {
  const missed = new Set(missedGoals);
  const items = def.items;
  const first = items.filter((it) => it.goal !== undefined && missed.has(it.goal));
  const rest = items.filter((it) => !(it.goal !== undefined && missed.has(it.goal)));
  return [...first, ...rest].map((it) => it.id);
}

// ---------- 저장 상태 ----------

// { v:1, enabled, timeOfDay, done:[{step, doneAt, firstTry:{correct,total}, missedGoals:[]}], session, planned, lastActiveAt }
//  session : 하다 만 회차 { step, queue:[문항 id], asked:{id: 횟수}, first:{id: 첫 응답}, unresolved:[문항 id], startedAt, lateDays }
//            unresolved : 남은 것이 그것 하나뿐이어서 다시 묻지 않고 '이번에 못 맞힘'으로 남긴 문항(옛 저장에는 없다 → [])
//  planned : 마지막으로 알린 일정 { extId, sig } — 같은 내용이면 review_planned 를 다시 남기지 않는다
//  lastActiveAt : 끝까지 하지 않은 모듈을 마지막으로 연 시각(이어 하기 일정의 기준)
export function emptyReviewState() {
  return { v: 1, enabled: true, timeOfDay: null, done: [], session: null, planned: null, lastActiveAt: null };
}

const nonNegInt = (v, max = 9999) => (Number.isInteger(v) && v >= 0 ? Math.min(v, max) : 0);

/** 저장된 값을 거른다. 깨진 값은 처음 상태로. itemIds: reviewItemIds(mod). */
export function sanitizeReview(raw, itemIds = new Set()) {
  const s = emptyReviewState();
  if (!isObj(raw) || raw.v !== 1) return s;
  s.enabled = raw.enabled !== false;
  s.timeOfDay = typeof raw.timeOfDay === 'string' && /^([01]\d|2[0-3]):(00|30)$/.test(raw.timeOfDay) ? raw.timeOfDay : null;
  const seen = new Set();
  if (Array.isArray(raw.done)) {
    for (const d of raw.done) {
      if (!isObj(d) || !Number.isInteger(d.step) || d.step < 1 || d.step > MAX_REVIEW_STEP || seen.has(d.step) || !Number.isFinite(d.doneAt)) continue;
      seen.add(d.step);
      const ft = isObj(d.firstTry) ? d.firstTry : {};
      const total = nonNegInt(ft.total, MAX_REVIEW_ITEMS);
      s.done.push({
        step: d.step, doneAt: d.doneAt,
        firstTry: { correct: Math.min(nonNegInt(ft.correct, MAX_REVIEW_ITEMS), total), total },
        missedGoals: Array.isArray(d.missedGoals) ? d.missedGoals.filter(isStr).map((g) => g.slice(0, 64)).slice(0, 8) : [],
      });
    }
    s.done.sort((a, b) => a.step - b.step);
  }
  const se = raw.session;
  if (isObj(se) && Number.isInteger(se.step) && se.step >= 1 && se.step <= MAX_REVIEW_STEP && !seen.has(se.step) && Array.isArray(se.queue)) {
    const queue = se.queue.filter((id) => itemIds.has(id));
    const asked = {}, first = {};
    if (isObj(se.asked)) for (const [id, n] of Object.entries(se.asked)) if (itemIds.has(id) && Number.isInteger(n) && n >= 1) asked[id] = Math.min(n, MAX_ASKS);
    if (isObj(se.first)) for (const [id, r] of Object.entries(se.first)) if (itemIds.has(id) && REVIEW_RESULTS.includes(r)) first[id] = r;
    // 큐는 중복 없이. 큐가 비었는데 물은 기록이 있으면 마지막 답과 마침 사이에 닫힌 것이므로 남긴다(마침만 하면 된다).
    const unresolved = Array.isArray(se.unresolved) ? [...new Set(se.unresolved.filter((id) => itemIds.has(id)))] : [];
    s.session = queue.length > 0 || Object.keys(asked).length > 0 ? { step: se.step, queue: [...new Set(queue)], asked, first, unresolved, startedAt: Number.isFinite(se.startedAt) ? se.startedAt : 0, lateDays: nonNegInt(se.lateDays, 3650) } : null;
  }
  if (isObj(raw.planned) && isStr(raw.planned.extId) && typeof raw.planned.sig === 'string') s.planned = { extId: raw.planned.extId.slice(0, 120), sig: raw.planned.sig.slice(0, 120) };
  s.lastActiveAt = Number.isFinite(raw.lastActiveAt) ? raw.lastActiveAt : null;
  return s;
}

/** 저장소와 이어 둔 상태. storage 는 core/storage.js 의 createStorage 결과(읽기·쓰기가 try/catch 로 감싸여 있다). */
export function createReviewStore({ storage, mod }) {
  const key = keys.review(mod.id);
  const ids = reviewItemIds(mod);
  let state;
  try { state = sanitizeReview(JSON.parse(storage.read(key)), ids); } catch { state = emptyReviewState(); }
  return {
    get state() { return state; },
    // fn: 상태 → 새 상태. 같은 객체를 돌려주면 아무것도 하지 않는다.
    update(fn) {
      const next = fn(state);
      if (next === state) return;
      state = next;
      storage.write(key, JSON.stringify(state));
    },
  };
}

// ---------- 한 회차의 상태 전이 ----------

/** 회차를 시작한다. 같은 회차의 하다 만 상태가 있으면 그대로 이어 간다. 이미 끝낸 회차이면 바꾸지 않는다. */
export function startSession(state, def, step, { missedGoals = [], now = 0, lateDays = 0 } = {}) {
  if (state.done.some((d) => d.step === step)) return state;
  if (state.session?.step === step) return state;
  const next = clone(state);
  next.session = { step, queue: orderItems(def, missedGoals), asked: {}, first: {}, unresolved: [], startedAt: now, lateDays: Math.max(0, Math.floor(lateDays)) };
  return next;
}

/** 지금 묻는 문항(큐의 맨 앞). 없으면 null. */
export function currentItem(def, state) {
  const id = state.session?.queue[0];
  return def.items.find((it) => it.id === id) ?? null;
}

/**
 * 지금 문항에 답한다. 맞으면 뺀다. 틀리거나 '모르겠다'면 3번 미만일 때 뒤로 보내고(남은 문항이 그것뿐이면 바로 다시), 3번째이면 빼면서 풀이를 보인다.
 * 남은 문항이 그것 하나뿐이면(사이를 둘 수 없으면) 다시 묻지 않고 '이번에 못 맞힘'으로 남긴 채 끝낸다.
 * 돌려주는 것: { state, attempt(이 문항을 몇 번째로 물었는가), removed(맞히거나 3번 물어 큐에서 뺐는가), exhausted(3번째도 틀려 풀이를 보이고 뺐는가), deferred(홀로 남아 다시 묻지 않고 못 맞힘으로 남겼는가) }.
 * 지금 문항이 아니거나 결과가 모르는 값이면 바꾸지 않는다.
 */
export function answerSession(state, itemId, result) {
  const se = state.session;
  if (!se || se.queue[0] !== itemId || !REVIEW_RESULTS.includes(result)) return { state, attempt: 0, removed: false, exhausted: false, deferred: false };
  const next = clone(state);
  const s = next.session;
  const attempt = (s.asked[itemId] ?? 0) + 1;
  s.asked[itemId] = attempt;
  if (s.first[itemId] === undefined) s.first[itemId] = result;
  s.queue.shift();
  const removed = result === 'correct' || attempt >= MAX_ASKS;
  const deferred = !removed && s.queue.length === 0;
  if (deferred) s.unresolved = [...new Set([...(s.unresolved ?? []), itemId])];
  else if (!removed) s.queue.push(itemId);
  return { state: next, attempt, removed, exhausted: result !== 'correct' && attempt >= MAX_ASKS, deferred };
}

export const sessionDone = (state) => state.session !== null && state.session.queue.length === 0;

/** 회차의 사실: 첫 시도에 맞힌 수, 물은 횟수 전체, 다시 물은 문항 수, 첫 시도에 틀렸거나 모른다고 한 목표. */
export function summarizeSession(def, session) {
  const items = def.items;
  const firstTryCorrect = items.filter((it) => session.first[it.id] === 'correct').length;
  const askedTotal = Object.values(session.asked).reduce((a, b) => a + b, 0);
  const redone = Object.values(session.asked).filter((n) => n > 1).length;
  const missedGoals = [...new Set(items.filter((it) => it.goal !== undefined && session.first[it.id] !== undefined && session.first[it.id] !== 'correct').map((it) => it.goal))];
  return { total: items.length, firstTryCorrect, asked: askedTotal, redone, unresolved: (session.unresolved ?? []).length, missedGoals, lateDays: session.lateDays };
}

/** 큐가 빈 회차를 끝낸 것으로 기록한다(다음 회차의 문항 순서에 쓸 missedGoals 도 남긴다). 끝낼 수 없으면 바꾸지 않는다. */
export function finishSession(state, def, now = 0) {
  if (!sessionDone(state)) return { state, summary: null };
  const summary = summarizeSession(def, state.session);
  const next = clone(state);
  next.done = [...next.done.filter((d) => d.step !== state.session.step), {
    step: state.session.step, doneAt: now, firstTry: { correct: summary.firstTryCorrect, total: summary.total }, missedGoals: summary.missedGoals,
  }].sort((a, b) => a.step - b.step);
  next.session = null;
  return { state: next, summary: { ...summary, step: state.session.step } };
}

/** '처음부터' 뒤: 끝낸 회차·하다 만 회차·일정 기록을 지운다. 복습 받기 여부와 고른 시각은 남긴다. */
export function resetForRestart(state) {
  const next = emptyReviewState();
  next.enabled = state.enabled;
  next.timeOfDay = state.timeOfDay;
  return next;
}

// ---------- 일정을 글로 ----------

/** '내일' 같은 말은 오늘·내일일 때만 쓴다. */
function dayWords(date, nowTs, tz) {
  const today = parseDate(localDate(nowTs, tz));
  const p = parseDate(date);
  if (!today || !p) return dayLabelKo(date);
  if (p.dayNo === today.dayNo) return '오늘';
  if (p.dayNo === today.dayNo + 1) return '내일';
  return dayLabelKo(date);
}

/** 한 줄: "10월 9일(금) 19:30 · 약 8분". 이어 하기와 오늘·내일은 말로 쓴다. */
export function scheduleLine(item, { minutes = null, now = 0, tz = 0 } = {}) {
  const when = `${item.kind === 'resume' ? dayWords(item.date, now, tz) : dayLabelKo(item.date)} ${item.time}`;
  return minutes ? `${when} · 약 ${minutes}분` : when;
}

/** 일정 구역의 이름표: "첫 복습", "2번째 복습", "이어 하기". */
export function scheduleLabel(item) {
  if (item.kind === 'resume') return '이어 하기';
  return item.step === 1 ? '첫 복습' : `${item.step}번째 복습`;
}
