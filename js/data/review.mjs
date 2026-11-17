// LySpe 복습 일정 규칙 — 모듈을 끝낸 뒤 언제 복습하면 좋은지 정한다. 순수 함수: DOM·저장소·시계를 모른다(시각은 인자로 받는다). 의존 없음(tags.mjs 와 같은 원칙).
//
// 날짜는 학습자 기기의 지역 날짜('YYYY-MM-DD')로 다루고, 변환에 쓸 tzOffsetMin(= -new Date().getTimezoneOffset())을 인자로 받는다.
// 한 번의 계산에는 오프셋 하나만 쓴다(여름 시간제 같은 날짜 중간의 변화는 다루지 않는다).
//
// 조사가 말한 것(research/out/S/S1~S5.md, 값의 출처는 이 수준으로만 쓴다):
//  · 같은 날 붙여서(간격 0) 다시 하는 것은 며칠 띄우는 것보다 대체로 낮았다(0일 대 1일의 차이가 늘 뚜렷했던 것은 아니다). 배운 날 몇 시간 뒤의 복습이 다음 날보다 낫다는 직접 근거는 없다 → 첫 복습은 다음 날 이후.
//  · 가장 좋은 간격은 시험까지 남은 기간이 길수록 길어진다(남은 기간의 대략 10~20%, 1년 쪽은 더 낮다). 너무 짧은 간격의 손해가 너무 긴 간격의 손해보다 크다. 성인·사실 암기 자료의 결과다.
//  · 간격을 점점 넓히는 것과 고르게 두는 것 사이에 차이가 없었다.
//  · 첫 학습 성적에 따라 복습 시점을 앞당기거나 미루는 근거는 없다. 하루 중 어느 시각이 낫다는 근거도 얇다. 날짜와 시각까지 스스로 적게 하면 실행이 늘었다는 성인 근거가 하나 있다.
//  · 놓친 복습을 어떻게 다루라는 근거는 없다.
// 아래 모든 날수·횟수는 근거 없는 출발점(제작 판단)이다. 상수 한 곳에 모았다 — 바꿀 때는 여기만 고친다.

/** 회차 1·2·3 의 간격(앞 기준일로부터의 날수). 근거 없는 출발점이다. */
export const REVIEW_GAPS_DAYS = Object.freeze([1, 7, 21]);
/** 회차는 3번까지. */
export const MAX_REVIEW_STEP = REVIEW_GAPS_DAYS.length;
/** 시험 날짜가 있을 때 한 회차의 간격 상한 = 기준일부터 시험일까지 날수의 5분의 1(0.2 — 조사의 '대략 10~20%' 가운데 위쪽, 근거 없는 출발점). 부동소수점 오차를 피하려고 나눗셈으로 쓴다. */
export const EXAM_DIVISOR = 5;
/** 예정 시각은 30분 단위. */
export const TIME_STEP_MIN = 30;

const MS_MIN = 60_000;
const MS_DAY = 86_400_000;
const pad = (n, w = 2) => String(n).padStart(w, '0');

// ---------- 날짜·시각 도우미 ----------

/** 시각(ms) → 학습자 기기의 지역 날짜 'YYYY-MM-DD'. */
export function localDate(ts, tzOffsetMin = 0) {
  const d = new Date(ts + tzOffsetMin * MS_MIN);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 'YYYY-MM-DD' → { y, m, d, dayNo(1970-01-01 부터의 날수) }. 실제로 있는 날짜가 아니면 null. */
export function parseDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return { y, m: mo, d, dayNo: Math.round(ms / MS_DAY) };
}

const dateOfDayNo = (n) => {
  const d = new Date(n * MS_DAY);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** 날짜에 날수를 더한다('YYYY-MM-DD'). 날짜가 틀리면 null. */
export function addDays(date, n) {
  const p = parseDate(date);
  return p ? dateOfDayNo(p.dayNo + n) : null;
}

/** 'HH:mm' 이고 분이 00 또는 30 인가(30분 단위). */
export function validTime(text) {
  return typeof text === 'string' && /^([01]\d|2[0-3]):(00|30)$/.test(text);
}

/** 'HH:mm' 을 30분 단위로 내린다('19:10' → '19:00'). 시각으로 읽을 수 없으면 null. */
export function snapTime(text) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(text ?? ''));
  if (!m) return null;
  return `${m[1]}:${Number(m[2]) >= TIME_STEP_MIN ? '30' : '00'}`;
}

/** 시각(ms)의 지역 시각을 30분 단위로 내린 'HH:mm'. */
export function floorTime(ts, tzOffsetMin = 0) {
  const d = new Date(ts + tzOffsetMin * MS_MIN);
  const min = d.getUTCHours() * 60 + d.getUTCMinutes();
  const floored = Math.floor(min / TIME_STEP_MIN) * TIME_STEP_MIN;
  return `${pad(Math.floor(floored / 60))}:${pad(floored % 60)}`;
}

/** 지역 날짜와 시각 → 시각(ms). */
export function atTs(date, time, tzOffsetMin = 0) {
  const p = parseDate(date);
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time ?? ''));
  if (!p || !m) return null;
  return Date.UTC(p.y, p.m - 1, p.d, Number(m[1]), Number(m[2])) - tzOffsetMin * MS_MIN;
}

/** 시험 날짜로 쓸 수 있는가: 실제로 있는 날짜이고 오늘(today, 'YYYY-MM-DD')보다 뒤. */
export function validExamDate(text, today) {
  const p = parseDate(text);
  const t = parseDate(today);
  return p !== null && t !== null && p.dayNo > t.dayNo;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** 화면에 적는 날짜: '10월 9일(금)'. */
export function dayLabelKo(date) {
  const p = parseDate(date);
  if (!p) return '';
  return `${p.m}월 ${p.d}일(${WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]})`;
}

// ---------- 일정 ----------

// 기준일(base)에서 step 번째 회차의 날짜와 실제 간격. 시험일 당일이거나 그 뒤면 null(그 회차와 이후 회차는 만들지 않는다).
function stepDate(base, step, exam) {
  let gap = REVIEW_GAPS_DAYS[step - 1];
  if (exam) {
    const span = exam.dayNo - parseDate(base).dayNo;
    if (span <= 0) return null;
    gap = Math.min(gap, Math.max(1, Math.floor(span / EXAM_DIVISOR)));
  }
  const date = addDays(base, gap);
  if (exam && parseDate(date).dayNo >= exam.dayNo) return null;
  return { date, gapDays: gap };
}

function makeItem({ kind, step, date, time, gapDays, basis }, tz) {
  return { kind, step, date, time, dueTs: atTs(date, time, tz), endTs: atTs(addDays(date, 1), '00:00', tz), gapDays, basis };
}

/**
 * 아직 하지 않은 회차 가운데 다음 하나의 일정.
 *  completedAt: 모듈을 끝낸 시각(없으면 아직 끝까지 하지 않았다)   lastActiveAt: 끝까지 하지 않은 모듈을 마지막으로 연 시각
 *  done: 이미 한 회차 [{ step, doneAt }]   examDate: 'YYYY-MM-DD' 또는 없음   timeOfDay: 'HH:mm'(학습자가 고른 시각) 또는 없음
 * 돌려주는 것: { items, preview }
 *  items   : 다음 하나만(뒤 회차는 앞 회차를 한 날에 달려 있어 미리 정할 수 없다). { kind:'review'|'resume', step, date, time, dueTs, endTs, gapDays, basis }
 *            basis: completed(모듈을 끝낸 날 기준) | review(앞 회차를 한 날 기준) | active(이어 하기 — 마지막으로 연 날 기준)
 *            endTs 는 그 날이 끝나는 시각(reviewStatus 가 시계 없이 '그날 끝'을 알도록 둔다).
 *  preview : 다음 회차 뒤의 '예상' 날짜 [{ step, date }] — 앞 회차를 예정일에 한다고 가정한 값.
 * 모듈을 끝까지 하지 않았으면 복습할 것이 없다 → 다음 날 같은 시각의 '이어 하기'(kind 'resume') 하나만 준다.
 * 회차 n 의 기준일은 회차 n-1 을 실제로 한 날이다 — 늦게 했으면 그만큼 뒤로 밀린다(조사: 너무 짧은 간격의 손해가 더 크다).
 */
export function planReviews({ completedAt, lastActiveAt, done = [], examDate, timeOfDay, tzOffsetMin = 0 } = {}) {
  const tz = tzOffsetMin;
  const exam = parseDate(examDate);
  const chosenTime = validTime(timeOfDay) ? timeOfDay : null;
  const none = { items: [], preview: [] };

  if (!Number.isFinite(completedAt)) {
    if (!Number.isFinite(lastActiveAt)) return none;
    const date = addDays(localDate(lastActiveAt, tz), 1);
    if (exam && parseDate(date).dayNo >= exam.dayNo) return none;
    const time = chosenTime ?? floorTime(lastActiveAt, tz);
    return { items: [makeItem({ kind: 'resume', step: 0, date, time, gapDays: 1, basis: 'active' }, tz)], preview: [] };
  }

  const doneAt = new Map();
  for (const d of done) if (Number.isInteger(d?.step) && Number.isFinite(d.doneAt) && !doneAt.has(d.step)) doneAt.set(d.step, d.doneAt);
  let next = 1;
  while (doneAt.has(next)) next += 1;
  if (next > MAX_REVIEW_STEP) return none;

  const time = chosenTime ?? floorTime(completedAt, tz);
  const base = localDate(next === 1 ? completedAt : doneAt.get(next - 1) ?? completedAt, tz);
  const first = stepDate(base, next, exam);
  if (!first) return none;
  const item = makeItem({ kind: 'review', step: next, date: first.date, time, gapDays: first.gapDays, basis: next === 1 ? 'completed' : 'review' }, tz);

  const preview = [];
  let prev = first.date;
  for (let step = next + 1; step <= MAX_REVIEW_STEP; step += 1) {
    const s = stepDate(prev, step, exam);
    if (!s) break;
    preview.push({ step, date: s.date });
    prev = s.date;
  }
  return { items: [item], preview };
}

/** 예정 시각 전 'scheduled' / 예정 시각~그날 끝 'due' / 다음 날부터 'overdue'. */
export function reviewStatus(item, now) {
  if (now < item.dueTs) return 'scheduled';
  return now < item.endTs ? 'due' : 'overdue';
}

/** 열 수 있는가: 예정일 당일 0시부터. 시각은 권하는 것이지 잠그는 것이 아니다. 예정일 전에는 열 수 없다(너무 이른 복습을 막는 유일한 잠금). */
export function canOpen(item, now, tzOffsetMin = 0) {
  return localDate(now, tzOffsetMin) >= item.date;
}

/** 예정일보다 며칠 늦게 했는가(일찍 했거나 같은 날이면 0). */
export function lateDays(item, doneAt, tzOffsetMin = 0) {
  return Math.max(0, parseDate(localDate(doneAt, tzOffsetMin)).dayNo - parseDate(item.date).dayNo);
}
