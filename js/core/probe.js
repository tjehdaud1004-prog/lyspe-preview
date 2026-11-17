// 본문 밖에서 도움 없이 푸는 문항 묶음. 순수 로직 — DOM·저장소·시계를 모른다(시각은 인자로 받는다).
//
//  pre     : 모듈을 시작하기 전에 푸는 선수지식 문항(module.preCheck). 아직 아무것도 읽지 않았을 때만 권한다.
//  delayed : 모듈을 끝낸 뒤 며칠이 지나 다시 열었을 때 푸는 문항(module.delayedCheck). 본문을 다시 보기 전에 권한다.
//
// 둘 다 권하기만 한다 — 건너뛸 수 있고, 건너뛰어도 모듈은 그대로 쓸 수 있다.
// 문항마다 답은 한 번뿐이고(재시도 없음) 힌트·풀이가 없다. 모르면 '모르겠다'가 답이 된다.
// 맞았는지는 묶음을 다 푼 뒤에 한꺼번에 알려 준다(앞 문항의 정오가 뒤 문항의 답에 섞이지 않게).
// 시험이나 평가가 아니며 점수를 만들지 않는다. 화면이 알 수 없는 것: 종이·계산기·다른 사람의 도움, 다른 탭에서 본 내용.
import { grade, isAutoGraded, matchMisconception } from './answer.js';

export const PROBE_KINDS = ['pre', 'delayed'];
export const PROBE_RESULTS = ['correct', 'wrong', 'unknown'];
export const PROBE_STATUSES = ['started', 'declined', 'done', 'na']; // na: 권할 때가 지났다(이미 본문을 본 뒤 '처음부터'를 누른 경우의 pre)
export const MAX_PROBE_ITEMS = 5; // 짧은 묶음으로 두기 위한 상한. 근거 없는 출발점이다.

export const DAY_MS = 86_400_000;
// 끝낸 뒤 며칠이 지나야 '다시 풀어 보기'를 권하는가 — 모듈이 afterDays 를 주지 않았을 때의 값. 근거 없는 출발점이다.
// 조사에서 시간이 지난 뒤의 검사를 1주 뒤([C20]·[C21])와 1개월 뒤([C16])에 본 실험이 있으나(모두 대조 일치),
// 그것은 그 연구들이 고른 간격이지 '며칠이 맞다'를 견준 결과가 아니다(parts/17_measurement.md).
export const DEFAULT_AFTER_DAYS = 7;
export const MAX_AFTER_DAYS = 365;

export const PROBE_LABELS = Object.freeze({ correct: '맞음', wrong: '틀림', unknown: '모르겠다', none: '답하지 않음' });

// 화면 문구. 한 곳에 모아 두고 시험이 '평가가 아님·건너뛸 수 있음'을 알리는지 본다.
export const PROBE_RULE_TEXT = '문제마다 답은 한 번만 낼 수 있고 힌트와 풀이는 없습니다. 모르면 ‘모르겠다’를 누르면 됩니다. 맞았는지는 다 풀고 나서 한꺼번에 알려 줍니다.';
export const PROBE_TEXT = Object.freeze({
  pre: Object.freeze({
    title: '시작하기 전에 풀어 보기 (선택)',
    offer: (n) => `이 모듈을 시작하기 전에 ${n}문제를 도움 없이 먼저 풀어 볼 수 있습니다. 시험이나 평가가 아니며, 건너뛰어도 모듈은 그대로 볼 수 있습니다.`,
    start: '풀어 보기',
    decline: '건너뛰고 시작하기',
    leave: '본문 시작하기',
    done: '첫 답을 모두 남겼습니다. 아래는 이 화면이 본 결과이고 점수가 아닙니다. 틀렸거나 모르는 문제가 있어도 모듈은 그대로 볼 수 있습니다.',
  }),
  delayed: Object.freeze({
    title: '다시 풀어 보기 (선택)',
    offer: (n, days) => `이 모듈을 끝까지 본 지 ${days}일이 지났습니다. 본문을 다시 보기 전에, 수나 상황을 바꾼 ${n}문제를 도움 없이 풀어 볼 수 있습니다. 시험이나 평가가 아니며, 건너뛰어도 됩니다.`,
    start: '풀어 보기',
    decline: '건너뛰기',
    leave: '본문 보기',
    done: '답을 모두 남겼습니다. 아래는 이 화면이 본 결과이고 점수가 아닙니다. 본문을 다시 보며 풀이를 확인할 수 있습니다.',
  }),
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const clone = (s) => structuredClone(s);

// ---------- 모듈 데이터 ----------

// 묶음 정의. 없거나 형식이 틀리면 null.
export function probeDef(mod, kind) {
  const def = kind === 'pre' ? mod?.preCheck : kind === 'delayed' ? mod?.delayedCheck : null;
  return isObj(def) && Array.isArray(def.items) && def.items.length > 0 ? def : null;
}

export function probeItemIds(mod) {
  const ids = (kind) => new Set((probeDef(mod, kind)?.items ?? []).map((item) => item.id));
  return { pre: ids('pre'), delayed: ids('delayed') };
}

export function afterDaysOf(mod) {
  const d = probeDef(mod, 'delayed')?.afterDays;
  return Number.isInteger(d) && d >= 1 && d <= MAX_AFTER_DAYS ? d : DEFAULT_AFTER_DAYS;
}

// 형식 검사. core/module.js 의 validateModule 이 자기 검사 함수(checkAnswer·checkGrading)와 id 중복 검사(claim)를 넘겨 부른다.
export function validateProbes(mod, errors, { claim, checkAnswer, checkGrading, checkItemTags, idPattern }) {
  for (const [field, kind] of [['preCheck', 'pre'], ['delayedCheck', 'delayed']]) {
    const def = mod[field];
    if (def === undefined) continue;
    if (!isObj(def)) { errors.push(`${field}: 객체여야 한다`); continue; }
    if (def.intro !== undefined && !isStr(def.intro)) errors.push(`${field}.intro 는 문자열`);
    if (kind === 'delayed') {
      if (def.afterDays !== undefined && !(Number.isInteger(def.afterDays) && def.afterDays >= 1 && def.afterDays <= MAX_AFTER_DAYS)) errors.push(`${field}.afterDays 는 1~${MAX_AFTER_DAYS} 사이의 정수(날수)`);
    } else if (def.afterDays !== undefined) {
      errors.push(`${field}: afterDays 는 delayedCheck 에서만 쓴다`);
    }
    if (!Array.isArray(def.items) || def.items.length < 1 || def.items.length > MAX_PROBE_ITEMS) { errors.push(`${field}.items 는 1~${MAX_PROBE_ITEMS}개`); continue; }
    def.items.forEach((item, i) => {
      const w = `${field}.items[${i}]`;
      if (!isObj(item)) { errors.push(`${w}: 객체여야 한다`); return; }
      if (!isStr(item.id) || !idPattern.test(item.id)) errors.push(`${w}: id 형식 오류`);
      else claim(item.id, w);
      if (!isStr(item.prompt)) errors.push(`${w}: prompt 필요`);
      checkItemTags(item, w, errors, null); // 문항은 장면 밖이라 focus 포함 검사가 없다
      if (checkAnswer(item.answer, `${w}.answer`, errors)) {
        if (!isAutoGraded(item.answer)) errors.push(`${w}: 도움 없이 푸는 문항은 number|choice|linear|term 만 쓴다(채점할 수 있어야 한다)`);
        checkGrading(item.answer, item.misconceptions, w, errors);
      }
      // 이 묶음에는 도움이 없다. 힌트를 적어 두면 쓰이지 않는 데이터가 된다.
      if (item.hints !== undefined) errors.push(`${w}: 도움 없이 푸는 문항에는 hints 를 둘 수 없다(다 푼 뒤 보여 줄 solution 만 쓴다)`);
      if (item.solution !== undefined && !isStr(item.solution)) errors.push(`${w}: solution 은 문자열`);
    });
  }
}

// ---------- 날짜 ----------

// 두 시각 사이에 지난 날수(24시간 단위, 내림). 시계가 거꾸로 갔거나 값이 없으면 0.
export function daysBetween(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

// 화면에 적는 날짜(기기의 현지 날짜). 로캘 의존 서식을 쓰지 않는다.
export function dayLabel(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// 정리 화면에 적는 '다시 풀어 보기' 안내 한 줄. 상태(delayedStatus 결과)마다 사실만 말한다. 풀 문항이 없으면 빈 문자열.
export function delayedLine(mod, status) {
  const n = probeDef(mod, 'delayed')?.items.length ?? 0;
  switch (status.state) {
    case 'waiting': return `다시 풀어 보기(선택): 끝까지 본 뒤 ${status.afterDays}일이 지나(${dayLabel(status.dueAt)} 이후) 이 모듈을 다시 열면, 본문을 보기 전에 수나 상황을 바꾼 ${n}문제를 도움 없이 풀어 보기를 권합니다. 이 화면은 알림을 보내지 않으므로 그때 직접 다시 열어야 합니다.`;
    case 'due':
    case 'declined': return `다시 풀어 보기(선택): 끝까지 본 지 ${status.daysSince}일이 지났습니다. 수나 상황을 바꾼 ${n}문제를 도움 없이 풀어 볼 수 있습니다. 시험이나 평가가 아닙니다.`;
    case 'started': return '다시 풀어 보기(선택): 풀다가 멈춘 문제가 있습니다. 이어서 풀 수 있습니다.';
    case 'done': return '다시 풀어 보기: 끝까지 본 뒤 시간이 지나 도움 없이 다시 푼 결과입니다. 점수가 아닙니다.';
    default: return '';
  }
}

// '다시 풀어 보기'의 상태.
//  none       : 모듈에 delayedCheck 가 없다
//  unfinished : 아직 끝까지 보지 않았다
//  waiting    : 끝냈지만 afterDays 가 지나지 않았다(dueAt 이후에 권한다)
//  due        : 지났고 아직 풀지도 건너뛰지도 않았다 → 다시 열 때 권한다
//  started    : 풀다가 나갔다 → 다시 열 때 이어서 권한다
//  declined   : 권했는데 건너뛰었다 → 다시 권하지 않는다(정리 화면에서 직접 시작할 수는 있다)
//  done       : 풀었다
export function delayedStatus(mod, state, now) {
  const afterDays = afterDaysOf(mod);
  if (!probeDef(mod, 'delayed')) return { state: 'none', afterDays, daysSince: 0, dueAt: null };
  const finishedAt = state.finishedAt;
  if (!Number.isFinite(finishedAt)) return { state: 'unfinished', afterDays, daysSince: 0, dueAt: null };
  const dueAt = finishedAt + afterDays * DAY_MS;
  const daysSince = daysBetween(finishedAt, now);
  const status = state.probes?.delayed?.status;
  if (status === 'done' || status === 'declined' || status === 'started') return { state: status, afterDays, daysSince, dueAt };
  return { state: now >= dueAt ? 'due' : 'waiting', afterDays, daysSince, dueAt };
}

// 화면을 열 때 본문보다 먼저 보여 줄 묶음. 없으면 null.
// started: 본문을 읽은 흔적이 있는가(core/progress.js 의 hasProgress).
export function gateFor(mod, state, now, { started = false } = {}) {
  const delayed = delayedStatus(mod, state, now);
  if (delayed.state === 'due' || delayed.state === 'started') return { kind: 'delayed', resume: delayed.state === 'started', daysSince: state.probes?.delayed?.daysSince ?? delayed.daysSince };
  if (probeDef(mod, 'pre') && !started && !Number.isFinite(state.finishedAt)) {
    const status = state.probes?.pre?.status;
    if (status === undefined) return { kind: 'pre', resume: false };
    if (status === 'started') return { kind: 'pre', resume: true };
  }
  return null;
}

// ---------- 상태 전이 ----------

const blank = () => ({ status: 'started', startedAt: 0, endedAt: null, answers: {} });

// 풀기 시작. 이미 시작했으면 그대로(이어 풀기), 끝냈으면 바꾸지 않는다.
export function startProbe(state, kind, now = 0, { daysSince } = {}) {
  if (!PROBE_KINDS.includes(kind)) return state;
  const cur = state.probes?.[kind];
  if (cur?.status === 'done' || cur?.status === 'started') return state;
  const next = clone(state);
  const rec = { ...blank(), startedAt: now, answers: { ...(cur?.answers ?? {}) } };
  if (Number.isFinite(daysSince)) rec.daysSince = Math.max(0, Math.floor(daysSince));
  next.probes = { ...(next.probes ?? {}), [kind]: rec };
  return next;
}

// 문항 하나의 답. 한 번만 남는다(재시도 없음).
export function answerProbe(state, kind, itemId, result) {
  const cur = state.probes?.[kind];
  if (cur?.status !== 'started' || !PROBE_RESULTS.includes(result) || cur.answers[itemId] !== undefined) return state;
  const next = clone(state);
  next.probes[kind].answers[itemId] = result;
  return next;
}

export function finishProbe(state, kind, now = 0) {
  const cur = state.probes?.[kind];
  if (cur?.status !== 'started') return state;
  const next = clone(state);
  next.probes[kind].status = 'done';
  next.probes[kind].endedAt = now;
  return next;
}

// 건너뛰기(declined) 또는 권할 때가 지남(na). 이미 낸 답은 남긴다. 끝낸 묶음은 바꾸지 않는다.
export function closeProbe(state, kind, now = 0, status = 'declined', { daysSince } = {}) {
  if (!PROBE_KINDS.includes(kind) || !['declined', 'na'].includes(status)) return state;
  const cur = state.probes?.[kind];
  if (cur?.status === 'done' || cur?.status === status) return state;
  const next = clone(state);
  const rec = { ...blank(), startedAt: now, ...(cur ?? {}), status, endedAt: now };
  if (rec.daysSince === undefined && Number.isFinite(daysSince)) rec.daysSince = Math.max(0, Math.floor(daysSince));
  next.probes = { ...(next.probes ?? {}), [kind]: rec };
  return next;
}

// 다음에 풀 문항(아직 답이 없는 첫 문항). 다 답했으면 null.
export function nextProbeItem(mod, state, kind) {
  const answers = state.probes?.[kind]?.answers ?? {};
  return (probeDef(mod, kind)?.items ?? []).find((item) => answers[item.id] === undefined) ?? null;
}

// 답 채점. invalid 는 '답으로 읽을 수 없음'(빈칸·형식)이며 답으로 남기지 않는다.
export function gradeProbe(item, input) {
  const r = grade(input, item.answer, item.misconceptions ?? []);
  if (r.result === 'invalid') return { result: 'invalid', reason: r.reason, misconceptionIndex: -1 };
  if (r.result === 'correct') return { result: 'correct', misconceptionIndex: -1 };
  return { result: 'wrong', misconceptionIndex: matchMisconception(item.answer, r.value, item.misconceptions ?? []) };
}

// 정리용: 문항별 결과와 개수. status 는 묶음의 상태(없으면 null).
export function summarizeProbe(mod, state, kind) {
  const def = probeDef(mod, kind);
  if (!def) return null;
  const rec = state.probes?.[kind] ?? null;
  const counts = { correct: 0, wrong: 0, unknown: 0, none: 0 };
  const rows = def.items.map((item, i) => {
    const result = rec?.answers?.[item.id] ?? 'none';
    counts[result] += 1;
    return { id: item.id, no: i + 1, prompt: item.prompt, result, solution: item.solution ?? null };
  });
  return { kind, status: rec?.status ?? null, daysSince: rec?.daysSince ?? null, rows, counts, total: rows.length };
}

// ---------- 저장 데이터 거르기 ----------

// itemIds: probeItemIds(mod) 결과. 모듈에 없는 문항·모르는 값은 버린다.
export function sanitizeProbes(raw, itemIds) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const kind of PROBE_KINDS) {
    const v = raw[kind];
    if (!isObj(v) || !PROBE_STATUSES.includes(v.status)) continue;
    const rec = {
      status: v.status,
      startedAt: Number.isFinite(v.startedAt) ? v.startedAt : 0,
      endedAt: Number.isFinite(v.endedAt) ? v.endedAt : null,
      answers: {},
    };
    if (Number.isInteger(v.daysSince) && v.daysSince >= 0) rec.daysSince = v.daysSince;
    if (isObj(v.answers)) {
      for (const [id, result] of Object.entries(v.answers)) {
        if (itemIds?.[kind]?.has(id) && PROBE_RESULTS.includes(result)) rec.answers[id] = result;
      }
    }
    out[kind] = rec;
  }
  return out;
}
