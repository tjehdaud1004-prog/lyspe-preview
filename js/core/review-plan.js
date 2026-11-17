// 복습 일정 연결: 모듈 진행·설정·복습 상태를 data/review.mjs 의 일정 규칙에 대어 '지금 다음 복습이 언제인가'를 구하고,
// 일정이 정해지거나 바뀔 때 기록(review_planned)과 받은 일정함(core/schedule-out.js)에 반영한다. DOM 을 모른다.
// 복습 받기를 끄면 일정·기록·내보내기가 모두 멈춘다(끄는 순간 이미 내보낸 항목은 cancelled 로 바꾼다).
import { gradables } from './module.js';
import { optionOrder } from './shuffle.js';
import { hasProgress } from './progress.js';
import { reviewDef, reviewMinutes, startSession, finishSession, answerSession, currentItem, resetForRestart, scheduleLine, scheduleLabel, REVIEW_TEXT } from './review.js';
import { INBOX_SOURCE, allExtIds, extIdOf, inboxTitle, writeInbox, cancelInboxItems, finishInboxItem } from './schedule-out.js';
import { planReviews, reviewStatus, canOpen, lateDays, validExamDate, localDate, parseDate } from '../data/review.mjs';
import { goalIndex } from '../data/goals.mjs';

export { INBOX_SOURCE };

const RESUME_MINUTES = 10; // 이어 하기의 분량을 모를 때 일정함에 적는 값. 근거 없는 출발점이다.

/** 본문(문제·전이 문제의 부분)에서 첫 시도에 틀렸거나 힌트·풀이를 본 문항이 속한 목표 id. 첫 회차의 문항 순서에 쓴다. */
export function missedBodyGoals(mod, progress) {
  const followups = goalIndex(mod).followups;
  const missed = new Set();
  for (const g of gradables(mod)) {
    const goals = followups[g.key];
    if (!goals) continue;
    const rec = progress.items?.[g.key];
    const help = progress.help?.[g.helpKey];
    const first = progress.first?.[g.key];
    const hinted = (help?.hints ?? 0) > 0 || help?.solution === true;
    if ((rec?.wrong ?? 0) > 0 || hinted || first === 'wrong' || first === 'unknown') for (const id of goals) missed.add(id);
  }
  return [...missed];
}

/**
 * 복습 일정 관리자.
 *  store      : core/review.js 의 createReviewStore 결과   storage: core/storage.js 의 createStorage 결과(받은 일정함도 이 저장소에 쓴다)
 *  rec        : core/telemetry.js 의 조립기(없어도 된다)   getProgress·getSettings: 지금의 진행·설정을 돌려주는 함수
 *  now·tz     : 시계와 기기의 시간대 오프셋(분). 시험에서는 고정한다.
 */
export function createReviewPlanner({ mod, store, storage, rec, getProgress, getSettings, now = Date.now, tz = () => -new Date().getTimezoneOffset() }) {
  const def = reviewDef(mod);
  const minutes = reviewMinutes(mod);

  const examOf = () => {
    const text = getSettings().examDate;
    // 이미 지난(또는 오늘인) 시험 날짜는 없는 것으로 본다 — 그대로 두면 모든 회차가 '시험일 뒤'가 되어 복습 일정이 통째로 사라진다.
    return typeof text === 'string' && validExamDate(text, localDate(now(), tz())) ? text : null;
  };
  const sigOf = (item, exam) => (item ? `${item.kind}|${item.step}|${item.date}|${item.time}|${item.gapDays}|${exam ? 'exam' : ''}` : '');

  // 끝까지 하지 않은 모듈을 열어 둔 동안은 '마지막으로 연 때'를 갱신한다(이어 하기 일정의 기준).
  function touch() {
    const p = getProgress();
    const st = store.state;
    if (!st.enabled || Number.isFinite(p.finishedAt) || !hasProgress(p)) return;
    store.update((s) => ({ ...s, lastActiveAt: now() }));
  }

  /** 지금 구한 일정(저장하거나 기록하지 않는다). */
  function compute() {
    const st = store.state;
    const p = getProgress();
    const t = tz();
    const base = { enabled: st.enabled, finished: Number.isFinite(p.finishedAt), hasReviewItems: def !== null, minutes, item: null, preview: [], status: null, canOpen: false, exam: examOf(), tz: t };
    if (!st.enabled) return base;
    const finished = Number.isFinite(p.finishedAt);
    const plan = planReviews({
      completedAt: finished ? p.finishedAt : undefined,
      lastActiveAt: !finished && hasProgress(p) ? st.lastActiveAt ?? undefined : undefined,
      done: st.done, examDate: base.exam ?? undefined, timeOfDay: st.timeOfDay ?? undefined, tzOffsetMin: t,
    });
    const item = plan.items[0] ?? null;
    if (!item) return base;
    const at = now();
    return { ...base, item, preview: plan.preview, status: reviewStatus(item, at), canOpen: canOpen(item, at, t) };
  }

  // 일정이 바뀌었으면 받은 일정함과 기록에 반영한다. 같은 내용이면 아무것도 하지 않는다.
  function sync() {
    if (!store.state.enabled) return compute();
    touch();
    const plan = compute();
    const at = now();
    const iso = new Date(at).toISOString();
    const prev = store.state.planned;
    const extId = plan.item ? extIdOf(mod.id, plan.item.step) : null;
    // 앞의 일정이 사라지거나 다른 항목으로 바뀌었다: 이어 하기가 복습으로 바뀐 것은 '끝남', 그 밖은 '취소'.
    if (prev && prev.extId !== extId) {
      if (prev.extId.endsWith('-resume') && extId) finishInboxItem(storage, prev.extId, iso);
      else cancelInboxItems(storage, [prev.extId], iso);
    }
    // 복습 문제가 없는 모듈의 복습 일정은 LySpe 안에서만 보인다(받은 일정함에는 쓰지 않는다). 이어 하기는 문제와 상관없다.
    // 모듈을 끝냈으면 이어 하기 항목은 끝난 것이다(LySpe 의 기록이 지워졌어도 일정함에 남은 것을 닫는다).
    if (plan.finished) finishInboxItem(storage, extIdOf(mod.id, 0), iso);
    if (plan.item && (def || plan.item.kind === 'resume')) {
      writeInbox(storage, {
        extId, title: inboxTitle({ step: plan.item.step, moduleTitle: mod.title, minutes }),
        // 예정일이 지난 일정은 오늘 날짜로 내보낸다 — 하루 일정 프로그램의 '오늘' 목록에 보이도록(LySpe 안의 예정일·늦은 날수는 그대로다).
        date: plan.item.date < localDate(at, plan.tz) ? localDate(at, plan.tz) : plan.item.date, time: plan.item.time, minutes: minutes ?? RESUME_MINUTES, done: false, cancelled: false,
      }, iso);
    }
    const sig = sigOf(plan.item, plan.exam !== null);
    if (plan.item && prev?.sig !== sig) {
      rec?.reviewPlanned({ step: plan.item.step, kind: plan.item.kind, date: plan.item.date, time: plan.item.time, gapDays: plan.item.gapDays, basis: plan.item.basis, examDate: plan.exam !== null });
    }
    if ((prev?.sig ?? '') !== sig || (prev?.extId ?? null) !== extId) {
      store.update((s) => ({ ...s, planned: plan.item ? { extId, sig } : null }));
    }
    return plan;
  }

  return {
    def, minutes, compute, sync,
    /** 복습 문항의 보기를 보일 차례(보기 섞기를 켠 모듈만, 아니면 null — core/shuffle.js). */
    optionOrder: (key, item) => optionOrder(mod, getProgress(), key, item),
    get state() { return store.state; },
    line(item = compute().item) { return item ? scheduleLine(item, { minutes: item.kind === 'review' ? minutes : null, now: now(), tz: tz() }) : ''; },
    label: scheduleLabel,

    /** 복습 받기를 켜거나 끈다. 끄면 받은 일정함의 항목을 취소로 바꾸고 일정·기록을 멈춘다. */
    setEnabled(on) {
      if (store.state.enabled === on) return;
      if (!on) cancelInboxItems(storage, allExtIds(mod.id), new Date(now()).toISOString());
      store.update((s) => ({ ...s, enabled: on, planned: on ? s.planned : null, session: on ? s.session : null }));
      if (on) sync();
    },
    /** 예정 시각을 고른다(null 이면 모듈을 끝낸 시각을 30분 단위로 내린 값). */
    setTimeOfDay(text) {
      if (store.state.timeOfDay === text) return;
      store.update((s) => ({ ...s, timeOfDay: text }));
      sync();
    },

    /** 이번 접속에서 열 수 있는 복습 회차(문항이 있고, 예정일 당일 0시 이후). 없으면 null. */
    openable() {
      const plan = compute();
      if (!def || !plan.item || plan.item.kind !== 'review' || !plan.canOpen) return null;
      return plan;
    },
    /** 회차를 시작한다(하다 만 회차가 있으면 이어 간다). 돌려주는 값 { resume, lateDays, plan }. */
    begin() {
      const plan = this.openable();
      if (!plan) return null;
      const st = store.state;
      const resume = st.session?.step === plan.item.step;
      const late = lateDays(plan.item, now(), plan.tz);
      store.update((s) => startSession(s, def, plan.item.step, { missedGoals: plan.item.step === 1 ? missedBodyGoals(mod, getProgress()) : (s.done.find((d) => d.step === plan.item.step - 1)?.missedGoals ?? []), now: now(), lateDays: late }));
      return { resume, lateDays: store.state.session?.lateDays ?? late, plan };
    },
    /** 지금 묻는 문항. */
    currentItem: () => (def ? currentItem(def, store.state) : null),
    /** 지금 문항에 답한다(answerSession). 지금 문항이 아니면 attempt 0. */
    answer(itemId, result) {
      const r = answerSession(store.state, itemId, result);
      if (r.attempt > 0) store.update(() => r.state);
      return r;
    },
    /** 큐가 빈 회차를 끝낸다. 받은 일정함의 그 회차를 done 으로 하고 다음 회차를 잡는다. 돌려주는 값 { summary, next }. */
    complete() {
      const { state, summary } = finishSession(store.state, def, now());
      if (!summary) return null;
      const iso = new Date(now()).toISOString();
      store.update(() => ({ ...state, planned: null }));
      rec?.reviewDone({ step: summary.step, firstTryCorrect: summary.firstTryCorrect, items: summary.total, asked: summary.asked, lateDays: summary.lateDays });
      finishInboxItem(storage, extIdOf(mod.id, summary.step), iso);
      return { summary, next: sync() };
    },
    /** '처음부터': 끝낸 회차·일정을 지우고 받은 일정함의 항목을 취소한다. */
    restart() {
      cancelInboxItems(storage, allExtIds(mod.id), new Date(now()).toISOString());
      store.update(resetForRestart);
    },
    dateOf: (ts) => localDate(ts, tz()),
    todayDate: () => localDate(now(), tz()),
    validExam: (text) => validExamDate(text, localDate(now(), tz())),
    text: REVIEW_TEXT,
  };
}
