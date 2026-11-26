// LySpe 학습 기록 — 이벤트 형식(v1)과 검증.
// 플레이어(브라우저)와 집계기(Node)가 같은 파일을 쓴다. 의존 없음.
// 원칙: 개인을 식별하는 값·노트 내용·자유 서술 답의 본문은 이벤트에 넣지 않는다(질문 글만 예외이며 동의가 있을 때만).

export const SCHEMA_VERSION = 1;

// 이벤트 종류와 data 필드. '?' 는 선택.
export const EVENT_TYPES = {
  // --- 세션·모듈
  session_start: { resumed: 'boolean', gapMs: 'number?' },            // gapMs: 이 모듈을 마지막으로 본 뒤 지난 시간
  session_end: { reason: 'string' },                                   // hidden | unload | idle | finished
  module_open: { fromBlockId: 'string?' },                             // 이어 보기면 복구된 위치
  module_finish: { activeMs: 'number' },
  module_reset: {},
  // --- 본문 읽기
  unit_shown: { chars: 'number', mode: 'string' },                     // mode: typing | instant
  unit_done: { activeMs: 'number', expandedEarly: 'boolean', pausedMs: 'number', shownMs: 'number?' },
                                                                        // shownMs: 표시가 시작돼 다 나타날 때까지의 활동 시간(일찍 펼쳤으면 펼친 때까지, 바로 보임이면 0). activeMs - shownMs = 다 나타난 뒤 넘기기까지
  unit_revisit: { fromBlockId: 'string', via: 'string?' },             // 앞 내용으로 되돌아가 봄. via: end(끝 화면의 '본문 다시 보기'·기본) | scroll(읽는 위치보다 앞 블록이 화면에 머묾; 이때 이벤트의 block = 다시 본 블록) | scene(장면별로 보기에서 지난 장면을 엶; block = 그 장면의 첫 블록) | fold(접은 설명을 펼침; block = 접은 첫 글 블록)
  explain_fold: { sceneId: 'string', atBlockId: 'string', foldedUnits: 'number', shownUnits: 'number' },
                                                                        // '설명 접고 문항으로'를 눌렀다(K04 A177). atBlockId: 누른 때 읽던 글 블록 · foldedUnits: 접은 글 단위 수 · shownUnits: 그 가운데 이미 다 보였던 수
  // --- 설정(표시 방식·속도는 학습자에게 맞는 값을 찾는 재료)
  setting_change: { key: 'string', from: 'string', to: 'string' },
  // --- 문항
  attempt: { n: 'number', result: 'string', misconceptionId: 'string?', activeMs: 'number', hintsSeen: 'number', solutionSeen: 'boolean', part: 'string?', unaided: 'string?', shownOrder: 'array?' },
                                                                        // shownOrder: 보기 섞기(모듈의 shuffleOptions)를 켠 모듈의 고르는 문항에서만 — 학습자에게 보인 보기 id 의 차례
                                                                        // result: correct | wrong | self_checked | skipped | unknown('모르겠다' — 도움 없이 먼저 푸는 자리에서만)
                                                                        // part: 문제(problem·transfer)의 부분 id
                                                                        // unaided: '도움 없이 먼저' 자리의 시도일 때만. first = 그 부분의 첫 답(힌트·풀이가 열리기 전) | after = 첫 답 뒤의 시도
  predict_written: { chars: 'number' },                                 // 예상 적기를 했는지(내용은 넣지 않음)
  link_fill: { stepId: 'string', result: 'string', n: 'number' },
  // --- 도움 없이 푸는 문항 묶음(본문 밖): kind = pre(모듈을 시작하기 전 선수지식) | delayed(끝낸 뒤 며칠 지나 다시 풀기)
  probe: { kind: 'string', action: 'string', items: 'number', daysSince: 'number?' },
                                                                        // action: offered | started | declined | finished   items: 묶음의 문항 수
                                                                        // daysSince: 모듈을 끝낸 뒤 지난 날수(delayed 에서만)
  probe_answer: { kind: 'string', item: 'string', result: 'string', activeMs: 'number', misconceptionId: 'string?', daysSince: 'number?', shownOrder: 'array?' },
                                                                        // result: correct | wrong | unknown   도움·재시도 없이 낸 답 하나   shownOrder: attempt 와 같다
  // --- 여는 카드(core/opener.js): 본문 앞에서 상황 그림을 보고 직관으로 답하는 핵심 질문 하나. 처음 고른 답은 맞다 · 틀리다를 알리지 않고, 끝 화면에서 한 번 더 고른다
  opener_answer: { chosen: 'string', result: 'string', activeMs: 'number', misconceptionId: 'string?', shownOrder: 'array?' },
                                                                        // chosen: 고른 보기 id   result: correct | wrong   activeMs: 질문과 보기가 나온 때부터 고른 때까지의 활동 시간(그림만 보이던 시간은 뺀다)
                                                                        // misconceptionId: 등록한 오답에 맞을 때 `opener.m<번호>`   shownOrder: 보기 섞기를 켠 모듈에서 보인 보기 id 의 차례
  opener_revisit: { chosen: 'string', result: 'string', first: 'string', firstResult: 'string', activeMs: 'number', shownOrder: 'array?' },
                                                                        // 끝 화면에서 다시 고른 답. first · firstResult: 처음 고른 보기 id · 그 결과   activeMs: 다시 보기 카드가 나온 때부터 고른 때까지
  // --- 건너뛰기 확인(core/skip.js): 이미 아는 학습자가 아는 장면을 건너뛰기 전에 목표별 문항을 도움 없이 푼다. 건너뛴 뒤의 수행은 attempt{unaided:'first'}·probe_answer{kind:'delayed'} 가 잰다
  skip_check: { action: 'string', goals: 'number', items: 'number', reason: 'string?' },
                                                                        // action: offered | started | declined | finished | not_offered   goals·items: 확인의 목표 수·문항 수(최대치)
                                                                        // reason: not_offered 일 때만 — pre_miss(시작 전 문항에서 틀리거나 모르는 것이 있었다)
  skip_answer: { goal: 'string', item: 'string', result: 'string', activeMs: 'number', misconceptionId: 'string?', shownOrder: 'array?' },
                                                                        // result: correct | wrong | unknown   도움·재시도 없이 낸 첫 응답 하나
  skip_verdict: { goal: 'string', verdict: 'string', correct: 'number', asked: 'number', total: 'number' },
                                                                        // verdict: pass | insufficient   asked: 실제로 물은 문항 수(한 목표에서 맞지 않은 답이 나오면 남은 문항을 묻지 않으므로 total 보다 작을 수 있다)
  skip_module: { to: 'string' },                                        // 다음 사슬 모듈로 잇기(모듈 머리의 next): 건너뛰기 확인을 통과해 ‘이 모듈을 건너뛰고 다음으로’를 눌렀다. to = 다음 모듈 id
  skip_decision: { sceneId: 'string', choice: 'string' },               // choice: skip | view — 건너뛸 수 있는 장면마다 한 건
  skip_return: { sceneId: 'string', trigger: 'string' },                // 건너뛴 장면으로 돌아가 봄. trigger: browse(장면별 보기·접힌 줄을 펼침) | offer(‘도움 없이 먼저’ 자리의 알림 단추)
  // --- 복습(core/review.js, data/review.mjs): 모듈을 끝낸 뒤 정해진 날에 푸는 복습 회차. 시험 날짜의 값은 남기지 않는다(있는지만)
  review_planned: { step: 'number', kind: 'string', date: 'string', time: 'string', gapDays: 'number', basis: 'string', examDate: 'boolean' },
                                                                        // 일정이 정해지거나 바뀔 때(같은 내용이면 다시 남기지 않는다). kind: review | resume(끝까지 하지 않은 모듈의 '이어 하기', step 0)
                                                                        // date: 'YYYY-MM-DD'(기기의 지역 날짜)  time: 'HH:mm'   gapDays: 기준일로부터의 날수(시험 날짜가 있으면 줄어들 수 있다)
                                                                        // basis: completed(모듈을 끝낸 날) | review(앞 회차를 한 날) | active(이어 하기 — 마지막으로 연 날)   examDate: 시험 날짜가 정해져 있는가
  review_start: { step: 'number', lateDays: 'number', items: 'number' },
                                                                        // lateDays: 예정일보다 며칠 늦게 시작했는가(일찍이면 0)   items: 이번 회차의 문항 수
  review_answer: { step: 'number', item: 'string', attempt: 'number', result: 'string', ms: 'number', shownOrder: 'array?' },
                                                                        // attempt: 이 회차에서 그 문항을 몇 번째로 묻는가(1~3)   result: correct | wrong | unknown   답의 값은 남기지 않는다   ms: 활동 시간
  review_done: { step: 'number', firstTryCorrect: 'number', items: 'number', asked: 'number', ms: 'number', lateDays: 'number' },
                                                                        // firstTryCorrect: 첫 시도에 맞힌 문항 수   asked: 물은 횟수 전체(다시 물은 것 포함)   ms: 이번 방문의 활동 시간
  // --- 묶음 돌리기(round 블록, core/round.js): 문항을 한 번에 하나씩 묻고 곧 알려 주는 짧은 묶음. 낸 답의 글은 남기지 않는다. 이벤트의 block 이 묶음의 블록 id 다
  round_item: { item: 'string', n: 'number', result: 'string', ms: 'number', mode: 'string', pair: 'string?', bucket: 'string?', chosen: 'string?', shownOrder: 'array?' },
                                                                        // item: 문항 id   n: 이 문항이 나온 번째(1, 2, …)   result: correct | wrong | dontknow('모르겠다')
                                                                        // ms: 문항이 보인 때부터 답을 낸 때까지의 활동 시간   mode: recall | sort | drill
                                                                        // pair: 문항이 묻는 pairs 항목의 id(있을 때)   bucket: sort 문항의 정답 갈래   chosen: sort 에서 고른 갈래
  round_done: { mode: 'string', items: 'number', firstCorrect: 'number', presentations: 'number', unresolved: 'number', skipped: 'number', medianCorrectMs: 'number?' },
                                                                        // 줄이 다 돌았거나 묶음을 건너뛰었다(한 묶음에 한 번)   items: 문항 수   firstCorrect: 처음에 맞힌 문항 수   presentations: 나온 횟수 전체(다시 물은 것 포함)
                                                                        // unresolved: 끝내 맞히지 못했고 건너뛰지도 않은 문항 수   skipped: 묶음을 건너뛰어 남은 문항 수   medianCorrectMs: 맞힌 문항에서 한 문항에 걸린 시간의 가운데 값(맞힌 것이 없으면 없음)
  // --- 지문(passage 블록): 지문을 겹쳐 띄워 다시 봤다
  passage_open: { from: 'string?' },                                    // 이벤트의 block 이 지문의 블록 id   from: 그때 하던 블록 id
  // --- 도움
  help_open: { kind: 'string', level: 'number?', afterAttempts: 'number', msSinceBlockStart: 'number' },
                                                                        // kind: hint | solution | other_explanation | link_reason | skipped_solution(건너뛴 문항의 ‘정답과 풀이 보기’를 폈다 — 문항 상태는 건너뜀 그대로) | emergency(긴급 안내를 폈다 — 열었다는 사실만 남기고 진행은 잠그지 않는다)
  ai_question: { qType: 'string', scope: 'string', tier: 'number', chars: 'number', afterAttempts: 'number', selectedText: 'boolean', text: 'string?', sent: 'boolean?', outcome: 'string?', provider: 'string?' },
                                                                        // qType: meaning | why_step | check_calc | other_explanation | answer_only | other
                                                                        // scope: in | adjacent | off_topic | emergency   tier: 1 정해진 도움, 2 검수된 답, 3 새로 만든 답
                                                                        // (scope 는 서비스가 답하지 않았으면 unknown, tier 는 답을 내지 않았으면 0)
                                                                        // sent: 서비스로 요청이 나갔는가(긴급은 false)   provider: 서비스 id(fake 는 시험용)
                                                                        // outcome: ok | refused | withheld | limited | locked | unavailable | invalid | emergency
  ai_feedback: { helpful: 'boolean' },
  // --- 노트
  note_open: { tool: 'string' },                                        // type | draw | paper
  note_activity: { tool: 'string', chars: 'number?', strokes: 'number?', activeMs: 'number' },
  note_attach: {},                                                      // 본문 문장을 노트에 붙임
  // --- 화면·흐름
  layout: { w: 'number', h: 'number', pointer: 'string', reducedMotion: 'boolean', sheet: 'string?' },
  idle: { ms: 'number' },                                               // 입력이 없던 구간(집계에서 활동 시간에서 뺀다)
  // --- 끝과 자기 보고
  final_answer: { chars: 'number' },
  self_report: { item: 'string', value: 'number' },                     // item: difficulty | effort | confidence (선택 응답)
  content_flag: { kind: 'string' },                                     // 학습자가 '이 부분 이해 안 됨/오류 같음'을 누름
};

const ENVELOPE = { v: 'number', id: 'string', ts: 'number', session: 'string', learner: 'string', module: 'string', moduleVersion: 'string', scene: 'string?', block: 'string?', type: 'string', data: 'object' };

// 'array' 는 문자열 배열(보기 id 의 차례 같은 것).
function checkFields(obj, spec, where, errs) {
  for (const [k, t] of Object.entries(spec)) {
    const optional = t.endsWith('?');
    const type = optional ? t.slice(0, -1) : t;
    const v = obj[k];
    if (v === undefined || v === null) {
      if (!optional) errs.push(`${where}.${k} 없음`);
      continue;
    }
    if (type === 'array') { if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) errs.push(`${where}.${k} 형식(문자열 배열 아님)`); } else if (typeof v !== type) errs.push(`${where}.${k} 형식(${typeof v}, 기대 ${type})`);
    else if (type === 'number' && !Number.isFinite(v)) errs.push(`${where}.${k} 유한수 아님`);
  }
  for (const k of Object.keys(obj)) if (!(k in spec)) errs.push(`${where}.${k} 선언되지 않은 필드`);
}

/** 이벤트 한 건의 오류 목록(없으면 빈 배열). 선언되지 않은 필드는 오류다 — 개인정보가 섞여 들어오는 것을 막는다. */
export function validateEvent(e) {
  const errs = [];
  if (!e || typeof e !== 'object') return ['객체 아님'];
  checkFields(e, ENVELOPE, 'event', errs);
  if (e.v !== SCHEMA_VERSION) errs.push(`v=${e.v}`);
  const spec = EVENT_TYPES[e.type];
  if (!spec) errs.push(`type=${e.type} 모르는 종류`);
  else if (e.data && typeof e.data === 'object') checkFields(e.data, spec, 'data', errs);
  return errs;
}

/** 기록기. store 는 { append(event) } 만 있으면 된다. consent 가 false 면 아무것도 남기지 않는다.
 *  questionText 동의가 없으면 ai_question 의 text 는 지운다(길이와 종류만 남는다). */
export function createRecorder({ store, learner, session, module, moduleVersion, consent, now = Date.now, newId }) {
  let seq = 0;
  const makeId = newId || (() => `${session}-${++seq}`);
  return {
    record(type, data = {}, where = {}) {
      if (!consent || !consent.record) return null;
      const d = { ...data };
      if (type === 'ai_question' && !consent.questionText) delete d.text;
      const e = { v: SCHEMA_VERSION, id: makeId(), ts: now(), session, learner, module, moduleVersion, type, data: d };
      if (where.scene) e.scene = where.scene;
      if (where.block) e.block = where.block;
      const errs = validateEvent(e);
      if (errs.length) throw new Error(`이벤트 형식 오류(${type}): ${errs.join('; ')}`);
      store.append(e);
      return e;
    },
  };
}
