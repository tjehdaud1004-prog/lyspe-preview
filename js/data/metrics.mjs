// LySpe 학습 기록 집계 — 이벤트 배열에서 질문별 답의 재료를 만든다.
// 모든 수치는 표본 수(n)와 함께 낸다. n 이 minN 보다 작으면 값을 내지 않는다(적은 기록으로 결론을 내지 않기 위해).
// 여기서 나오는 것은 사용 기록이다. 학습 효과가 아니다.
// byTag 는 "어느 종류의 일에서 첫 답이 많이 틀리는가"를 보는 재료이고, 학습자 개인의 능력 진단이 아니다(parts/03 [E11][E23]).

import { validateEvent } from './schema.mjs';

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const rate = (num, den, minN) => (den >= minN ? { value: num / den, n: den } : { value: null, n: den });
const stat = (xs, minN) => (xs.length >= minN ? { median: median(xs), n: xs.length } : { median: null, n: xs.length });
const groupBy = (xs, key) => {
  const m = new Map();
  for (const x of xs) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};

/** 형식이 맞는 이벤트만 시간순으로. 버린 건수도 돌려준다. */
export function clean(events) {
  const ok = [];
  let rejected = 0;
  for (const e of events) (validateEvent(e).length ? rejected++ : ok.push(e));
  ok.sort((a, b) => a.ts - b.ts);
  return { events: ok, rejected };
}

/** Q. 어디에서 특히 어려워했는가 — 블록별. */
export function difficultyByBlock(events, { minN = 5 } = {}) {
  const out = {};
  for (const [block, evs] of groupBy(events.filter((e) => e.block), (e) => e.block)) {
    const byLearner = groupBy(evs, (e) => e.learner);
    let first = 0, firstWrong = 0, helped = 0, solution = 0, reached = 0;
    const activeMs = [];
    const misconceptions = {};
    for (const [, le] of byLearner) {
      reached++;
      const attempts = le.filter((e) => e.type === 'attempt' && e.data.result !== 'self_checked' && e.data.result !== 'skipped' && e.data.result !== 'unknown');
      if (attempts.length) {
        first++;
        if (attempts[0].data.result === 'wrong') firstWrong++;
        activeMs.push(attempts.reduce((s, a) => s + a.data.activeMs, 0));
      }
      if (le.some((e) => e.type === 'help_open')) helped++;
      if (le.some((e) => e.type === 'help_open' && e.data.kind === 'solution')) solution++;
      for (const a of attempts) if (a.data.misconceptionId) misconceptions[a.data.misconceptionId] = (misconceptions[a.data.misconceptionId] || 0) + 1;
    }
    out[block] = {
      learners: reached,
      firstAttemptWrong: rate(firstWrong, first, minN),
      helpOpened: rate(helped, reached, minN),
      solutionOpened: rate(solution, reached, minN),
      activeMsToFinish: stat(activeMs, minN),
      misconceptions,
      contentFlags: evs.filter((e) => e.type === 'content_flag').length,
      revisits: evs.filter((e) => e.type === 'unit_revisit').length,
    };
  }
  return out;
}

/** Q. 주로 하는 질문은 무엇인가 / 어떨 때 AI 에게 가장 많이 묻는가. */
export function questions(events) {
  const qs = events.filter((e) => e.type === 'ai_question');
  const count = (key) => Object.fromEntries([...groupBy(qs, key)].map(([k, v]) => [k, v.length]));
  const bucket = (n) => (n === 0 ? '시도 전' : n === 1 ? '1번 틀린 뒤' : n === 2 ? '2번 틀린 뒤' : '3번 이상 틀린 뒤');
  return {
    total: qs.length,
    byType: count((e) => e.data.qType),
    byScope: count((e) => e.data.scope),
    byTier: count((e) => String(e.data.tier)),
    byBlock: count((e) => e.block || '(블록 밖)'),
    byMoment: count((e) => bucket(e.data.afterAttempts)),
    withSelectedText: qs.filter((e) => e.data.selectedText).length,
    helpfulRate: (() => {
      const fb = events.filter((e) => e.type === 'ai_feedback');
      return { value: fb.length ? fb.filter((e) => e.data.helpful).length / fb.length : null, n: fb.length };
    })(),
  };
}

/** Q. 어떨 때 학습을 중단하는가 — 끝내지 못한 학습자가 마지막으로 있던 블록과 그 직전 상황. */
export function dropoff(events, { now, staleMs = 7 * 24 * 3600 * 1000 } = {}) {
  const lastBlock = {};
  const context = { afterWrong: 0, afterHelp: 0, whileReading: 0, other: 0 };
  let finished = 0, stopped = 0, stillActive = 0;
  for (const [, evs] of groupBy(events, (e) => `${e.learner}|${e.module}`)) {
    if (evs.some((e) => e.type === 'module_finish')) { finished++; continue; }
    const last = evs[evs.length - 1];
    if (now !== undefined && now - last.ts < staleMs) { stillActive++; continue; }   // 최근에 본 사람은 '중단'으로 세지 않는다
    stopped++;
    const lastWithBlock = [...evs].reverse().find((e) => e.block);
    const b = lastWithBlock ? lastWithBlock.block : '(시작 전)';
    lastBlock[b] = (lastBlock[b] || 0) + 1;
    const tail = [...evs].reverse().find((e) => ['attempt', 'help_open', 'unit_shown', 'unit_done', 'ai_question'].includes(e.type));
    if (!tail) context.other++;
    else if (tail.type === 'attempt' && tail.data.result === 'wrong') context.afterWrong++;
    else if (tail.type === 'help_open' || tail.type === 'ai_question') context.afterHelp++;
    else if (tail.type === 'unit_shown' || tail.type === 'unit_done') context.whileReading++;
    else context.other++;
  }
  return { finished, stopped, stillActive, lastBlock, context };
}

/** Q. 평균 학습 시간, 나아가는 속도, 모듈을 소비하는 시간. 활동 시간만 쓴다(idle 은 기록 단계에서 빠져 있다). */
export function time(events, { minN = 5 } = {}) {
  const finish = events.filter((e) => e.type === 'module_finish');
  const sessions = groupBy(events, (e) => e.session);
  const sessionMs = [];
  for (const [, evs] of sessions) {
    const idle = evs.filter((e) => e.type === 'idle').reduce((s, e) => s + e.data.ms, 0);
    sessionMs.push(Math.max(0, evs[evs.length - 1].ts - evs[0].ts - idle));
  }
  const units = events.filter((e) => e.type === 'unit_done');
  const shown = new Map(events.filter((e) => e.type === 'unit_shown').map((e) => [`${e.session}|${e.block}`, e]));
  const cpm = { typing: [], instant: [] };
  // shownMs 가 있는 단위만: 나타나는 데 걸린 시간 / 다 나타난 뒤 넘기기까지 / 다 나타난 뒤 기준 읽기 속도
  const shownMs = { typing: [], instant: [] };
  const afterShownMs = { typing: [], instant: [] };
  const cpmAfter = { typing: [], instant: [] };
  for (const u of units) {
    const s = shown.get(`${u.session}|${u.block}`);
    if (s && u.data.activeMs > 0 && cpm[s.data.mode]) cpm[s.data.mode].push(s.data.chars / (u.data.activeMs / 60000));
    if (s && u.data.shownMs !== undefined && shownMs[s.data.mode]) {
      const after = Math.max(0, u.data.activeMs - u.data.shownMs);
      shownMs[s.data.mode].push(u.data.shownMs);
      afterShownMs[s.data.mode].push(after);
      if (after > 0) cpmAfter[s.data.mode].push(s.data.chars / (after / 60000));
    }
  }
  const perLearnerSessions = [...groupBy(events.filter((e) => e.type === 'session_start'), (e) => `${e.learner}|${e.module}`)].map(([, v]) => v.length);
  const gaps = events.filter((e) => e.type === 'session_start' && e.data.gapMs !== undefined).map((e) => e.data.gapMs);
  return {
    moduleActiveMs: stat(finish.map((e) => e.data.activeMs), minN),
    sessionActiveMs: stat(sessionMs, minN),
    sessionsToFinish: stat(perLearnerSessions, minN),
    gapBetweenSessionsMs: stat(gaps, minN),
    readingCharsPerMin: { typing: stat(cpm.typing, minN), instant: stat(cpm.instant, minN) },   // 나타나는 시간이 섞인 값(activeMs 전체 기준)
    unitShownMs: { typing: stat(shownMs.typing, minN), instant: stat(shownMs.instant, minN) },                 // 나타나는 데 걸린 시간(shownMs 가 기록된 단위만)
    unitAfterShownMs: { typing: stat(afterShownMs.typing, minN), instant: stat(afterShownMs.instant, minN) }, // 다 나타난 뒤 '계속'까지(activeMs - shownMs)
    readingCharsPerMinAfterShown: { typing: stat(cpmAfter.typing, minN), instant: stat(cpmAfter.instant, minN) }, // 다 나타난 뒤 시간만으로 잰 읽기 속도
    expandedEarly: rate(units.filter((e) => e.data.expandedEarly).length, units.length, minN),   // 타이핑을 기다리지 않고 펼친 비율
  };
}

/** 도움 뒤에 스스로 풀었는가 — 도움을 연 뒤의 다음 시도 결과. (AI 를 쓰는 동안의 정답률과 도움 없는 수행을 구분하기 위한 재료) */
export function afterHelp(events, { minN = 5 } = {}) {
  let n = 0, correct = 0;
  for (const [, evs] of groupBy(events.filter((e) => e.block), (e) => `${e.learner}|${e.block}`)) {
    const i = evs.findIndex((e) => e.type === 'help_open' && e.data.kind !== 'solution');
    if (i < 0) continue;
    const next = evs.slice(i + 1).find((e) => e.type === 'attempt');
    if (!next) continue;
    n++;
    if (next.data.result === 'correct' && !next.data.solutionSeen) correct++;
  }
  return { nextAttemptCorrect: rate(correct, n, minN) };
}

/** 노트·표시 방식 등 선택의 분포. */
export function choices(events) {
  const count = (xs, key) => Object.fromEntries([...groupBy(xs, key)].map(([k, v]) => [k, v.length]));
  return {
    noteTool: count(events.filter((e) => e.type === 'note_open'), (e) => e.data.tool),
    displayMode: count(events.filter((e) => e.type === 'unit_shown'), (e) => e.data.mode),
    settingChanges: count(events.filter((e) => e.type === 'setting_change'), (e) => `${e.data.key}:${e.data.from}→${e.data.to}`),
    revisitVia: count(events.filter((e) => e.type === 'unit_revisit'), (e) => e.data.via ?? 'end'),
    predictWritten: events.filter((e) => e.type === 'predict_written').length,
    pointer: count(events.filter((e) => e.type === 'layout'), (e) => e.data.pointer),
  };
}

// ---------- 도움 없는 수행 ----------
// 아래 셋은 '도움 없이 낸 첫 답'을 센다. 모든 비율의 n 은 학습자 수다 — 한 사람이 일곱 칸에 답해도 표본은 1이다.
// 기록에 없는 것: 앞의 본문을 다시 보았는지, 종이·계산기·다른 사람의 도움. 그래서 '혼자 풀 수 있다'의 증거가 아니라 그 재료다.

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const share = (xs, minN) => (xs.length >= minN ? { value: mean(xs), n: xs.length } : { value: null, n: xs.length });
const isUnaidedFirst = (e) => e.type === 'attempt' && e.data.unaided === 'first' && Boolean(e.block) && e.data.result !== 'self_checked';
const countOf = (xs, v) => xs.filter((x) => x === v).length;
// 시간순 이벤트에서 키마다 가장 이른 결과 하나만 남긴다(처음부터 다시 해서 '첫 답'이 두 번 남은 경우 앞의 것이 첫 답이다).
function earliest(evs, key) {
  const m = new Map();
  for (const e of evs) { const k = key(e); if (!m.has(k)) m.set(k, e.data.result); }
  return m;
}

/** Q. 도움 없이 먼저 풀어 본 자리에서 첫 답이 어땠는가 — 블록별.
 *  첫 답 = 그 문제의 힌트·풀이가 열리기 전에 그 부분에 처음 낸 답(correct | wrong | unknown '모르겠다' | skipped 건너뜀). 서술형 부분은 뺀다.
 *  correctShare: 학습자마다 '첫 답 가운데 맞은 비율'을 구해 평균한 값. unknownShare·skippedShare 도 같은 방식이다.
 *  byPart: 부분별로 첫 답이 맞은 비율과 '모르겠다' 비율(n = 그 부분에 첫 답을 남긴 학습자 수). */
export function unaidedFirst(events, { minN = 5 } = {}) {
  const out = {};
  for (const [block, evs] of groupBy(events.filter(isUnaidedFirst), (e) => e.block)) {
    const correct = [], unknown = [], skipped = [];
    const parts = new Map();
    for (const [, le] of groupBy(evs, (e) => e.learner)) {
      const first = earliest(le, (e) => e.data.part ?? '');
      const rs = [...first.values()];
      correct.push(countOf(rs, 'correct') / rs.length);
      unknown.push(countOf(rs, 'unknown') / rs.length);
      skipped.push(countOf(rs, 'skipped') / rs.length);
      for (const [part, r] of first) { if (!parts.has(part)) parts.set(part, []); parts.get(part).push(r); }
    }
    out[block] = {
      learners: correct.length,
      correctShare: share(correct, minN),
      unknownShare: share(unknown, minN),
      skippedShare: share(skipped, minN),
      byPart: Object.fromEntries([...parts].map(([part, rs]) => [part, { correct: rate(countOf(rs, 'correct'), rs.length, minN), unknown: rate(countOf(rs, 'unknown'), rs.length, minN) }])),
    };
  }
  return out;
}

/** Q. 앞에서 힌트·풀이를 연 적이 있는 사람과 없는 사람의 도움 없는 첫 답 — 블록별 교차표.
 *  helped = 그 블록의 첫 답을 내기 전에 이 모듈에서 힌트나 풀이를 한 번이라도 연 학습자.
 *  인과가 아니다. 도움을 연 사람은 처음부터 그 내용을 더 어려워했을 수 있다(고른 사람의 차이). 두 칸의 차이를 도움의 효과로 읽지 않는다. */
export function priorHelpVsUnaided(events, { minN = 5 } = {}) {
  const cells = {};
  for (const [, evs] of groupBy(events, (e) => `${e.learner}|${e.module}`)) {
    for (const [block, be] of groupBy(evs.filter(isUnaidedFirst), (e) => e.block)) {
      const start = evs.indexOf(be[0]);
      const helped = evs.slice(0, start).some((e) => e.type === 'help_open' && (e.data.kind === 'hint' || e.data.kind === 'solution'));
      const rs = [...earliest(be, (e) => e.data.part ?? '').values()];
      cells[block] ??= { helped: [], notHelped: [] };
      cells[block][helped ? 'helped' : 'notHelped'].push(countOf(rs, 'correct') / rs.length);
    }
  }
  return {
    note: '교차표다. 인과가 아니다 — 도움을 연 사람과 열지 않은 사람은 처음부터 다를 수 있다.',
    byBlock: Object.fromEntries(Object.entries(cells).map(([block, c]) => [block, { helped: { correctShare: share(c.helped, minN) }, notHelped: { correctShare: share(c.notHelped, minN) } }])),
  };
}

/** Q. 모듈을 시작하기 전(pre)과 끝낸 뒤 며칠 지나(delayed) 도움 없이 푼 문항 묶음의 결과.
 *  답은 문항마다 한 번뿐이다(재시도·힌트·풀이 없음). 같은 학습자가 같은 문항에 두 번 답했으면 앞의 것만 센다.
 *  권한 것을 건너뛴 사람, 며칠 뒤 다시 오지 않은 사람은 비율에 들어 있지 않다 — 답한 사람만의 값이라 치우칠 수 있다. */
export function probes(events, { minN = 5 } = {}) {
  const out = {};
  for (const kind of ['pre', 'delayed']) {
    const evs = events.filter((e) => (e.type === 'probe' || e.type === 'probe_answer') && e.data.kind === kind);
    const learnersWho = (action) => new Set(evs.filter((e) => e.type === 'probe' && e.data.action === action).map((e) => e.learner)).size;
    const answers = evs.filter((e) => e.type === 'probe_answer');
    const correct = [], unknown = [], days = [];
    for (const [, le] of groupBy(answers, (e) => e.learner)) {
      const rs = [...earliest(le, (e) => e.data.item).values()];
      correct.push(countOf(rs, 'correct') / rs.length);
      unknown.push(countOf(rs, 'unknown') / rs.length);
      if (le[0].data.daysSince !== undefined) days.push(le[0].data.daysSince);
    }
    const byItem = {};
    for (const [item, ie] of groupBy(answers, (e) => e.data.item)) {
      const rs = [...earliest(ie, (e) => e.learner).values()];
      const misconceptions = {};
      for (const e of ie) if (e.data.misconceptionId) misconceptions[e.data.misconceptionId] = (misconceptions[e.data.misconceptionId] || 0) + 1;
      byItem[item] = { correct: rate(countOf(rs, 'correct'), rs.length, minN), unknown: rate(countOf(rs, 'unknown'), rs.length, minN), misconceptions };
    }
    out[kind] = {
      offered: learnersWho('offered'), started: learnersWho('started'), declined: learnersWho('declined'), finished: learnersWho('finished'),
      answered: correct.length,
      correctShare: share(correct, minN),
      unknownShare: share(unknown, minN),
      daysSince: stat(days, minN),
      byItem,
    };
  }
  return out;
}

// ---------- 건너뛰기 확인 ----------
// 건너뛰기의 이득은 입증되지 않았다 — 이 집계는 '건너뛴 사람이 뒤에서 어떻게 했는지'를 보는 재료다.
// 학습자마다 하나씩 센다(표본 n = 학습자 수). 무리는 학습자가 스스로 갈라진 것이라 차이를 건너뛰기의 효과로 읽을 수 없다.
// 건너뛴 뒤의 수행은 이미 있는 기록이 잰다: 본문의 '도움 없이 먼저' 첫 답(attempt.unaided === 'first')과 며칠 뒤 문항(probe_answer.kind === 'delayed').
// 목표와의 연결은 이벤트에 없고 모듈 자료의 goals 연결(data/goals.mjs 의 goalIndex)로 붙인다.

export const SKIPS_NOTE = '무리는 학습자가 스스로 갈라진 것이라 차이를 건너뛰기의 효과로 읽을 수 없다. 사람 수가 적으면 큰 차이만 보인다. “건너뛰어도 성과가 유지된다”는 이 규모로 보일 수 없으므로 ‘아직 모름’으로 적는다.';
const SKIP_PATHS = ['skipped', 'passed_viewed', 'insufficient', 'declined', 'not_offered', 'none'];

// 시간순 이벤트에서 키마다 가장 이른 이벤트 하나.
function earliestEvents(evs, key) {
  const m = new Map();
  for (const e of evs) { const k = key(e); if (!m.has(k)) m.set(k, e); }
  return m;
}

/** Q. 건너뛰기를 권했을 때 누가 확인을 풀었고, 어느 목표에서 근거가 모였고, 건너뛴 사람이 뒤의 문항에서 어땠는가. index = goalIndex(mod) (data/goals.mjs). */
export function skips(events, index, { minN = 5 } = {}) {
  const sorted = [...events].sort((a, b) => a.ts - b.ts); // 안정 정렬
  const current = (e) => e.module === index.module && e.moduleVersion === index.moduleVersion;
  const evs = sorted.filter(current);
  const versionMismatch = sorted.length - evs.length;
  const goalIds = Object.keys(index.goals);
  const byLearner = groupBy(evs, (e) => e.learner);

  // 퍼널: 학습자 수.
  const whoDid = (action) => new Set(evs.filter((e) => e.type === 'skip_check' && e.data.action === action).map((e) => e.learner)).size;
  const funnel = { offered: whoDid('offered'), started: whoDid('started'), declined: whoDid('declined'), finished: whoDid('finished'), notOffered: whoDid('not_offered') };

  // 목표별: 물은 학습자 수, 판정, 문항별 첫 응답.
  const byGoal = {};
  for (const g of goalIds) {
    const answers = evs.filter((e) => e.type === 'skip_answer' && e.data.goal === g);
    const verdicts = [...earliestEvents(evs.filter((e) => e.type === 'skip_verdict' && e.data.goal === g), (e) => e.learner).values()];
    const items = {};
    for (const itemId of index.goals[g].items) {
      const firsts = [...earliestEvents(answers.filter((e) => e.data.item === itemId), (e) => e.learner).values()];
      items[itemId] = {
        correct: rate(firsts.filter((e) => e.data.result === 'correct').length, firsts.length, minN),
        unknown: rate(firsts.filter((e) => e.data.result === 'unknown').length, firsts.length, minN),
        activeMs: stat(firsts.map((e) => e.data.activeMs), minN),
      };
    }
    byGoal[g] = {
      asked: new Set(answers.map((e) => e.learner)).size,
      verdicts: verdicts.length,
      pass: rate(verdicts.filter((e) => e.data.verdict === 'pass').length, verdicts.length, minN),
      items,
    };
  }

  // 학습자 한 명의 길과 그가 건너뛴 장면.
  const info = new Map();
  for (const [learner, le] of byLearner) {
    const decisions = le.filter((e) => e.type === 'skip_decision');
    const skippedScenes = new Set(decisions.filter((e) => e.data.choice === 'skip').map((e) => e.data.sceneId));
    const did = (action) => le.some((e) => e.type === 'skip_check' && e.data.action === action);
    let path = 'none';
    if (skippedScenes.size > 0) path = 'skipped';
    else if (decisions.length > 0) path = 'passed_viewed';
    else if (did('finished')) path = 'insufficient';
    else if (did('declined')) path = 'declined';
    else if (did('not_offered')) path = 'not_offered';
    info.set(learner, { path, skippedScenes });
  }

  // 뒤의 첫 답. 본문: 부분(블록#부분)마다 가장 이른 attempt(서술형은 뺀다). 며칠 뒤: 문항마다 가장 이른 probe_answer.
  const bodyFirst = (le) => [...earliestEvents(le.filter((e) => e.type === 'attempt' && e.data.result !== 'self_checked'), (e) => `${e.block}#${e.data.part ?? ''}`).entries()];
  const delayedFirst = (le) => [...earliestEvents(le.filter((e) => e.type === 'probe_answer' && e.data.kind === 'delayed'), (e) => e.data.item).entries()];
  const correctShareOf = (pairs) => countOf(pairs.map(([, e]) => e.data.result), 'correct') / pairs.length;

  const paths = {};
  for (const p of SKIP_PATHS) {
    const members = [...info].filter(([, v]) => v.path === p).map(([learner]) => learner);
    const finishes = members.map((l) => byLearner.get(l).find((e) => e.type === 'module_finish')).filter(Boolean);
    const bodyShares = members.map((l) => bodyFirst(byLearner.get(l).filter((e) => e.data.unaided === 'first' && e.type === 'attempt'))).filter((x) => x.length > 0).map(correctShareOf);
    const delayedShares = members.map((l) => delayedFirst(byLearner.get(l))).filter((x) => x.length > 0).map(correctShareOf);
    paths[p] = {
      learners: members.length,
      finished: finishes.length,
      moduleActiveMs: stat(finishes.map((e) => e.data.activeMs), minN),
      unaidedFirstCorrect: share(bodyShares, minN),
      delayedCorrect: share(delayedShares, minN),
      returned: members.filter((l) => byLearner.get(l).some((e) => e.type === 'skip_return')).length,
    };
  }

  // 핵심: 목표에 연결된 뒤 문항의 첫 답을 세 무리로 나눠 본다.
  const followup = {};
  for (const g of goalIds) {
    const linked = Object.entries(index.followups).filter(([, list]) => list.includes(g)).map(([key]) => key);
    const bodyKeys = new Set(linked.filter((k) => k.includes('#')));
    const delayedKeys = new Set(linked.filter((k) => !k.includes('#')));
    const groups = { passSkipped: [], passViewed: [], insufficient: [] };
    for (const [learner, le] of byLearner) {
      const verdict = le.find((e) => e.type === 'skip_verdict' && e.data.goal === g)?.data.verdict;
      if (verdict === 'pass') groups[[...info.get(learner).skippedScenes].some((s) => index.goals[g].scenes.includes(s)) ? 'passSkipped' : 'passViewed'].push(learner);
      else if (verdict === 'insufficient') groups.insufficient.push(learner);
    }
    const side = (keys, firstOf) => {
      if (keys.size === 0) return { noFollowup: true };
      const out = {};
      const pairsOf = {};
      for (const [name, members] of Object.entries(groups)) {
        const rows = members.map((l) => ({ l, pairs: firstOf(byLearner.get(l)).filter(([k]) => keys.has(k.endsWith('#') ? k.slice(0, -1) : k)) })).filter((r) => r.pairs.length > 0);
        pairsOf[name] = rows;
        out[name] = { learners: rows.length, correct: share(rows.map((r) => correctShareOf(r.pairs)), minN) };
      }
      out.missedAfterSkip = pairsOf.passSkipped.filter((r) => r.pairs.some(([, e]) => e.data.result === 'wrong' || e.data.result === 'unknown')).length;
      return out;
    };
    const body = side(bodyKeys, bodyFirst);
    const delayed = side(delayedKeys, delayedFirst);
    followup[g] = { noFollowup: linked.length === 0, body, delayed };
  }

  return { note: SKIPS_NOTE, versionMismatch, learners: byLearner.size, funnel, byGoal, paths, followup };
}

// ---------- 복습 ----------
// 복습 회차(data/review.mjs)가 정해졌고, 시작했고, 끝났는가, 얼마나 늦었는가, 첫 시도에 몇 문항을 맞혔는가. 회차(step)마다 학습자 한 명을 한 번만 센다(같은 회차를 처음부터 다시 했으면 앞의 것).
// 회차별 차이를 복습의 효과로 읽을 수 없다: 뒤 회차까지 오는 사람은 스스로 갈라진 무리이고, 한 기기에는 한 사람의 기록만 남는다. 여기서 나오는 것은 사용 기록이다.

export const REVIEWS_NOTE = '회차별 차이를 복습의 효과로 읽을 수 없다. 뒤 회차까지 오는 사람은 스스로 갈라진 무리이고, 한 기기에는 한 사람의 기록만 남는다. 사람 수가 적으면 큰 차이만 보인다.';
const REVIEW_STEPS = [1, 2, 3];

/** Q. 복습 회차를 몇 명이 받고 했는가, 예정일보다 얼마나 늦었는가, 첫 시도에 몇 문항을 맞혔는가. */
export function reviews(events, { minN = 5 } = {}) {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const whoDid = (type, pred) => new Set(sorted.filter((e) => e.type === type && pred(e)).map((e) => e.learner)).size;
  const byStep = {};
  for (const step of REVIEW_STEPS) {
    const dones = [...earliestEvents(sorted.filter((e) => e.type === 'review_done' && e.data.step === step), (e) => e.learner).values()];
    const late = dones.map((e) => e.data.lateDays);
    const histogram = {};
    for (const d of late) histogram[d] = (histogram[d] ?? 0) + 1;
    byStep[step] = {
      planned: whoDid('review_planned', (e) => e.data.kind === 'review' && e.data.step === step),
      started: whoDid('review_start', (e) => e.data.step === step),
      done: dones.length,
      lateDays: { ...stat(late, minN), counts: late.length >= minN ? histogram : {} },
      firstTryCorrect: stat(dones.map((e) => e.data.firstTryCorrect), minN),
      firstTryShare: share(dones.filter((e) => e.data.items > 0).map((e) => e.data.firstTryCorrect / e.data.items), minN),
      asked: stat(dones.map((e) => e.data.asked), minN),
    };
  }
  return { note: REVIEWS_NOTE, resumePlanned: whoDid('review_planned', (e) => e.data.kind === 'resume'), byStep };
}

// ---------- 묶음 돌리기 ----------
// round_item(문항 하나를 낸 것)과 round_done(묶음 하나를 마친 것)에서 센다. 이벤트의 block 이 묶음 블록 id 다.
// 학습자마다 문항의 첫 답(n 이 가장 작은 것)과 나온 횟수(가장 큰 n)를 하나씩 센다. 사용 기록이며 학습 효과가 아니다.

export const ROUNDS_NOTE = '묶음 돌리기의 사용 기록이다. 어느 문항에서 첫 답이 많이 틀리는지, 몇 번씩 나오는지를 보는 재료이고 학습 효과가 아니다. 판 사이의 차이를 연습의 효과로 읽을 수 없다. 사람 수가 적으면 값을 내지 않는다.';

/** Q. 묶음의 문항마다 첫 답이 맞았는가·몇 번 나왔는가, drill 판은 차례대로 정확도와 걸린 시간이 어떤가. */
export function rounds(events, { minN = 5 } = {}) {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const byBlock = {};
  for (const [block, evs] of groupBy(sorted.filter((e) => e.type === 'round_item' && e.block), (e) => e.block)) {
    const items = {};
    for (const [item, ie] of groupBy(evs, (e) => e.data.item)) {
      const firsts = [], shown = [];
      for (const [, le] of groupBy(ie, (e) => e.learner)) {
        firsts.push((le.find((e) => e.data.n === 1) ?? le[0]).data.result === 'correct' ? 1 : 0);
        shown.push(Math.max(...le.map((e) => e.data.n)));
      }
      items[item] = { learners: firsts.length, firstCorrect: rate(firsts.reduce((s, x) => s + x, 0), firsts.length, minN), meanShown: share(shown, minN) };
    }
    const dones = [...earliestEvents(sorted.filter((e) => e.type === 'round_done' && e.block === block), (e) => e.learner).values()];
    byBlock[block] = { mode: evs[0].data.mode, done: dones.length, skipped: dones.filter((e) => e.data.skipped > 0).length, items };
  }
  // drill 판: 처음 나온 때가 이른 순서대로 1판, 2판 …
  const drillDones = sorted.filter((e) => e.type === 'round_done' && e.data.mode === 'drill' && e.block);
  const drills = [];
  for (const [block, de] of groupBy(drillDones, (e) => e.block)) {
    const one = [...earliestEvents(de, (e) => e.learner).values()].filter((e) => e.data.skipped === 0 && e.data.items > 0);
    drills.push({
      ts: de[0].ts, block, done: one.length,
      firstCorrectShare: share(one.map((e) => e.data.firstCorrect / e.data.items), minN),
      medianCorrectMs: stat(one.map((e) => e.data.medianCorrectMs).filter((x) => Number.isFinite(x)), minN),
    });
  }
  drills.sort((a, b) => a.ts - b.ts);
  return { note: ROUNDS_NOTE, byBlock, drills: drills.map(({ ts, ...rest }, i) => ({ order: i + 1, ...rest })) };
}

// ---------- 처음 낸 답 (반증 값 내기: player/SPEC_FALSIFY.md) ----------
// 학습자 한 사람이 채점되는 것 하나에 처음 낸 답을 줄 하나로 낸다. 이미 있는 집계는 이 함수를 쓰지 않는다 — 더하기만 한 것이다.
// 줄: { learner, module, run, block, sub, source, result, unaided, misconceptionId?, ms? }
//   run      모듈을 다시 시작할 때마다(module_reset) 하나씩 늘어난다(0 부터). 같은 학습자·같은 것도 run 이 다르면 따로 센다.
//   block    블록 id. 시작 전·며칠 뒤·복습·건너뛰기 확인 문항은 그 문항 id.
//   sub      문제의 부분 id, 연결 빈칸의 단계 id(stepId), 묶음 문항 id. 부분이 없는 것은 null.
//   source   attempt | link_fill | round_item | probe:pre | probe:delayed | skip_check | review
//   result   correct | wrong | unknown | skipped  (자기 점검 self_checked 는 정오가 없어 세지 않는다)
//   unaided  그 첫 답 전에 그 블록(연결 빈칸은 그 칸)의 힌트·풀이를 보지 않았으면 true. 묶음·본문 밖 문항은 도움이 없으므로 늘 true.
//            attempt.unaided 가 있으면 그것을 따르고(first = true, after = false), 없으면 그 attempt 가 남긴 hintsSeen·solutionSeen 으로 가른다.
//   ms       묶음 문항(round_item.ms)에만.
// 같은 (학습자, 모듈, run, source, block, sub) 에 답이 여러 번이면 시간순 첫 번째만 — 묶음에서 다시 나온 문항은 처음 나온 때의 답이다.
// link 블록의 attempt 는 link_fill 과 같은 제출이라 따로 세지 않는다(link_fill 이 있는 블록의 attempt 는 건너뛴다).
const ANSWER_RESULTS = new Set(['correct', 'wrong', 'unknown', 'skipped']);

export function firstAnswers(events) {
  const sorted = [...events].sort((a, b) => a.ts - b.ts); // 안정 정렬 — 같은 시각이면 들어온 순서
  const linkBlocks = new Set(sorted.filter((e) => e.type === 'link_fill' && e.block).map((e) => `${e.module}|${e.block}`));
  const runOf = new Map();       // `${learner}|${module}` → 지금까지의 module_reset 수
  const lastAttempt = new Map(); // `${session}|${block}` → 직전 attempt (link_fill 의 짝)
  const seen = new Set();
  const rows = [];
  const push = (e, run, { source, block, sub, result, unaided, misconceptionId, ms }) => {
    if (!block || !ANSWER_RESULTS.has(result)) return;
    const k = [e.learner, e.module, run, source, block, sub ?? ''].join('\u0001');
    if (seen.has(k)) return;
    seen.add(k);
    const row = { learner: e.learner, module: e.module, run, block, sub: sub ?? null, source, result, unaided };
    if (misconceptionId) row.misconceptionId = misconceptionId;
    if (Number.isFinite(ms)) row.ms = ms;
    rows.push(row);
  };
  const unaidedOf = (d) => (d.unaided === 'first' ? true : d.unaided === 'after' ? false : d.hintsSeen === 0 && d.solutionSeen === false ? true : d.hintsSeen === undefined ? null : false);
  for (const e of sorted) {
    const d = e.data ?? {};
    const who = `${e.learner}|${e.module}`;
    if (e.type === 'module_reset') { runOf.set(who, (runOf.get(who) ?? 0) + 1); continue; }
    const run = runOf.get(who) ?? 0;
    switch (e.type) {
      case 'attempt':
        lastAttempt.set(`${e.session}|${e.block}`, e);
        if (!linkBlocks.has(`${e.module}|${e.block}`)) push(e, run, { source: 'attempt', block: e.block, sub: d.part, result: d.result, unaided: unaidedOf(d), misconceptionId: d.misconceptionId });
        break;
      case 'link_fill': {
        const a = lastAttempt.get(`${e.session}|${e.block}`);
        const paired = a && a.data?.n === d.n ? a.data : null; // 같은 제출의 짝인지 n 으로 확인한다
        push(e, run, { source: 'link_fill', block: e.block, sub: d.stepId, result: d.result, unaided: paired ? unaidedOf(paired) : null, misconceptionId: paired?.misconceptionId });
        break;
      }
      case 'round_item':
        push(e, run, { source: 'round_item', block: e.block, sub: d.item, result: d.result === 'dontknow' ? 'unknown' : d.result, unaided: true, ms: d.ms });
        break;
      case 'probe_answer':
        push(e, run, { source: `probe:${d.kind}`, block: d.item, sub: null, result: d.result, unaided: true, misconceptionId: d.misconceptionId });
        break;
      case 'skip_answer':
        push(e, run, { source: 'skip_check', block: d.item, sub: null, result: d.result, unaided: true, misconceptionId: d.misconceptionId });
        break;
      case 'review_answer':
        push(e, run, { source: 'review', block: d.item, sub: null, result: d.result, unaided: true });
        break;
      default:
    }
  }
  return rows;
}

/** firstAnswers 의 줄 묶음 하나의 요약. n 이 minN 보다 작아도 수는 그대로 내고 small: true 를 붙인다(숨기는 것은 보고하는 쪽의 일).
 *  correctShare·unknownShare 등은 줄 수 n 을 분모로 한 비율(n=0 이면 null). medianMs 는 ms 가 있는 맞힌 줄의 가운데값(없으면 null). */
export function shareOf(rows, { minN = 5 } = {}) {
  const n = rows.length;
  const count = (r) => rows.filter((x) => x.result === r).length;
  const [correct, wrong, unknown, skipped] = ['correct', 'wrong', 'unknown', 'skipped'].map(count);
  const out = {
    n, learners: new Set(rows.map((r) => r.learner)).size,
    correct, wrong, unknown, skipped,
    correctShare: n ? correct / n : null,
    unknownShare: n ? unknown / n : null,
    wrongShare: n ? wrong / n : null,
    skippedShare: n ? skipped / n : null,
    medianMs: median(rows.filter((r) => r.result === 'correct' && Number.isFinite(r.ms)).map((r) => r.ms)),
  };
  if (n < minN) out.small = true;
  return out;
}

export function report(rawEvents, opts = {}) {
  const { events, rejected } = clean(rawEvents);
  const out = {
    note: '사용 기록의 집계다. 학습 효과의 증거가 아니다. n 이 작으면 값이 비어 있다.',
    events: events.length, rejected,
    learners: new Set(events.map((e) => e.learner)).size,
    difficultyByBlock: difficultyByBlock(events, opts),
    questions: questions(events),
    dropoff: dropoff(events, opts),
    time: time(events, opts),
    afterHelp: afterHelp(events, opts),
    choices: choices(events),
    unaidedFirst: unaidedFirst(events, opts),
    priorHelpVsUnaided: priorHelpVsUnaided(events, opts),
    probes: probes(events, opts),
  };
  out.reviews = reviews(events, opts);
  out.rounds = rounds(events, opts);
  if (opts.goalIndex) out.skips = skips(events, opts.goalIndex, opts); // 건너뛰기 확인은 모듈의 목표 색인이 있을 때만
  return out;
}

// ---------- 태그별 집계 ----------
// 이벤트에는 태그를 넣지 않는다. 이벤트의 module·moduleVersion·block(probe_answer 는 data.item)을 모듈 자료의 tagIndex 와 맞춰 붙인다.
// 한 항목에 태그가 둘이면 두 태그 모두에 센다 — 그래서 태그별 합이 전체 첫 시도 수와 같지 않다.
// 첫 시도 = (학습자, 항목[, 문제의 부분 | 연결의 단계]) 마다 가장 이른 것. link 블록은 attempt 가 아니라 link_fill(n===1)로 센다
// (같은 제출이 attempt 와 link_fill 둘로 남기 때문 — link_fill 이 있는 블록의 attempt 는 세지 않는다). link 의 activeMs 는 그 link_fill 바로 앞에 남은 같은 블록·세션의 attempt 에서 가져온다.
// result 가 correct → firstCorrect, wrong → firstWrong, 그 밖(skipped·unknown·self_checked 등) → firstOther.
// module 또는 moduleVersion 이 index 와 다른 이벤트는 집계에서 빼고 versionMismatch 로 센다.

/** 태그별 첫 시도 집계. index = tagIndex(mod) (data/tags.mjs). */
export function byTag(events, index) {
  const sorted = [...events].sort((a, b) => a.ts - b.ts); // 안정 정렬 — 같은 시각이면 들어온 순서
  const current = (e) => e.module === index.module && e.moduleVersion === index.moduleVersion;
  const linkBlocks = new Set(sorted.filter((e) => e.type === 'link_fill' && current(e)).map((e) => e.block));
  let versionMismatch = 0;
  const touched = new Set();     // 이벤트가 하나라도 있는 항목
  const helpOpened = {};         // 항목 → help_open 수
  const firsts = new Map();      // `${learner}|${item}|${세부}` → { item, result, activeMs }
  const lastAttempt = new Map(); // `${session}|${block}` → 직전 attempt (link 의 activeMs 짝)
  for (const e of sorted) {
    if (!current(e)) { versionMismatch++; continue; }
    const item = e.type === 'probe_answer' ? e.data.item : e.block;
    if (!item || !index.items[item]) continue;
    touched.add(item);
    if (e.type === 'help_open') { helpOpened[item] = (helpOpened[item] ?? 0) + 1; continue; }
    let sub = null, result, activeMs;
    if (e.type === 'probe_answer') { sub = ''; result = e.data.result; activeMs = e.data.activeMs; }
    else if (e.type === 'attempt') {
      lastAttempt.set(`${e.session}|${item}`, e);
      if (!linkBlocks.has(item)) { sub = e.data.part !== undefined ? `part:${e.data.part}` : ''; result = e.data.result; activeMs = e.data.activeMs; }
    } else if (e.type === 'link_fill' && e.data.n === 1) {
      sub = `step:${e.data.stepId}`; result = e.data.result;
      activeMs = lastAttempt.get(`${e.session}|${item}`)?.data.activeMs;
    }
    if (sub === null) continue;
    const key = `${e.learner}|${item}|${sub}`;
    if (!firsts.has(key)) firsts.set(key, { item, result, activeMs });
  }

  const blank = () => ({ items: 0, firstCorrect: 0, firstWrong: 0, firstOther: 0, helpOpened: 0, activeMs: [] });
  const out = { versionMismatch, work: {}, knowledge: {} };
  const bucket = (kind, tag) => (out[kind][tag] ??= blank());
  for (const [item, info] of Object.entries(index.items)) {
    const tags = [['work', info.work], ['knowledge', info.knowledge]];
    for (const [kind, ids] of tags) {
      for (const id of ids) {
        const b = bucket(kind, id);
        if (touched.has(item)) b.items++;
        b.helpOpened += helpOpened[item] ?? 0;
      }
    }
  }
  for (const f of firsts.values()) {
    const info = index.items[f.item];
    for (const [kind, ids] of [['work', info.work], ['knowledge', info.knowledge]]) {
      for (const id of ids) {
        const b = bucket(kind, id);
        if (f.result === 'correct') b.firstCorrect++; else if (f.result === 'wrong') b.firstWrong++; else b.firstOther++;
        if (Number.isFinite(f.activeMs)) b.activeMs.push(f.activeMs);
      }
    }
  }
  for (const kind of ['work', 'knowledge']) {
    for (const b of Object.values(out[kind])) { b.activeMsMedian = median(b.activeMs); delete b.activeMs; }
  }
  return out;
}
