// 학습 기록 조립기. 플레이어가 한 일(문항 제출·도움 열기·글 단위 보기 …)을 정본 형식(data/schema.mjs)의 이벤트로 바꿔
// 저장 링에 넣는다. 순수 로직 — DOM·저장소를 직접 모른다(store·시계는 밖에서 받는다).
//
// 원칙(parts/20_learning_data.md):
//  · 기록 동의(record)가 꺼져 있으면 아무것도 만들지도 저장하지도 않는다(학습자 키도 만들지 않는다).
//  · 형식에 없는 필드는 만들지 않는다 — 형식 검사에 걸리면 그 이벤트는 버리고 errors 에 남긴다(화면은 계속 동작).
//  · 노트 내용·서술형 답의 글·예상 적기의 글은 받지도 않는다. 길이(chars)와 횟수(strokes)뿐이다.
import { createRecorder, validateEvent } from '../data/schema.mjs';
import { report } from '../data/metrics.mjs';
import { createActivityClock, createBurst, IDLE_MS, BURST_GAP_MS } from './activity.js';
import { gradables, findBlock } from './module.js';

export { IDLE_MS, BURST_GAP_MS };

// ---------- 동의 ----------
// record: 학습 기록 남기기(기본 꺼짐). questionText: 질문 글도 남기기 — AI 질문 기능이 생기기 전에는 켤 수 없다.
// noticeSeen: 처음 열 때의 안내를 봤는가(안내는 진행을 막지 않는다).

// 질문 글을 남길 수 있는가: 연결된 서비스가 있을 때만 true. 기본은 false 이고, 앱이 서비스를 정한 직후(기록을 만들기 전에)
// setQuestionTextAvailable 로 바꾼다. 가져가는 쪽은 live binding 으로 현재 값을 본다(모듈 수준 상태이므로 시험은 끝나면 되돌린다).
export let QUESTION_TEXT_AVAILABLE = false;
export function setQuestionTextAvailable(value) { QUESTION_TEXT_AVAILABLE = value === true; }

export const defaultConsent = () => ({ record: false, questionText: false, noticeSeen: false });

export function sanitizeConsent(raw) {
  const c = defaultConsent();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return c;
  c.record = raw.record === true;
  c.questionText = QUESTION_TEXT_AVAILABLE && c.record && raw.questionText === true;
  c.noticeSeen = raw.noticeSeen === true;
  return c;
}

// 학습자 키: 기기에서 만든 무작위 값(계정과 연결하지 않는다). bytes 는 crypto.getRandomValues 를 받는다.
export function newRandomKey(getRandomValues = (a) => globalThis.crypto.getRandomValues(a), length = 16) {
  const bytes = getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const toolOfNoteMode = (mode) => ({ type: 'type', ink: 'draw', paper: 'paper' }[mode] ?? 'type');
const resultOf = (r) => (r === 'self' ? 'self_checked' : r);
const int = (n) => Math.max(0, Math.round(Number(n) || 0));

// ---------- 조립기 ----------

export function createTelemetry({ mod, store, learnerKey, sessionId, now = Date.now, newId, idleMs = IDLE_MS, burstGapMs = BURST_GAP_MS, consent = {} }) {
  const moduleVersion = mod.version;
  const live = { record: consent.record === true, questionText: consent.questionText === true }; // createRecorder 가 매번 읽는 동의 객체
  const errors = [];

  const sceneOfBlock = new Map();
  for (const scene of mod.scenes) for (const b of scene.blocks) sceneOfBlock.set(b.id, scene.id);
  const keysOfHelp = new Map();   // 도움 사다리 키 → 그 사다리를 쓰는 문항 키들
  const helpKeyOfItem = new Map(); // 문항 키 → 도움 사다리 키
  for (const g of gradables(mod)) {
    if (!keysOfHelp.has(g.helpKey)) keysOfHelp.set(g.helpKey, []);
    keysOfHelp.get(g.helpKey).push(g.key);
    helpKeyOfItem.set(g.key, g.helpKey);
  }

  let recorder = null;
  let began = false;
  let ended = false;
  let beginInfo = () => ({ resumed: false });
  let currentBlock = null;
  const shownAt = new Map();    // blockId → 처음 화면에 나온 시각(벽시계)
  const lastMark = new Map();   // blockId → 마지막 시도(또는 나온) 때의 활동 시간
  let unit = null;              // 지금 보고 있는 글 단위 { blockId, a0, pausedMs, stalledAt, shownMs(다 나타난 때의 활동 시간 경과), logged }
  let probeMark = 0;            // 본문 밖 문항 묶음: 마지막으로 풀기 시작했거나 답한 때의 활동 시간
  let skipMark = 0;             // 건너뛰기 확인: 마지막으로 풀기 시작했거나 답한 때의 활동 시간
  let openerMark = 0;           // 여는 카드: 질문과 보기가 나온 때(끝 화면의 다시 보기는 그 카드가 나온 때)의 활동 시간
  let reviewMark = 0;           // 복습: 마지막으로 열었거나 답한 때의 활동 시간
  let reviewOpenedAt = 0;       // 복습: 이번 방문에서 열었을 때의 활동 시간(review_done 의 ms 는 이번 방문의 활동 시간이다)

  function emit(type, data = {}, blockId = null) {
    if (!live.record) return null;
    try {
      if (!recorder) recorder = createRecorder({ store, learner: learnerKey(), session: sessionId, module: mod.id, moduleVersion, consent: live, now, newId });
      const where = {};
      if (blockId) { where.block = blockId; const scene = sceneOfBlock.get(blockId); if (scene) where.scene = scene; }
      return recorder.record(type, data, where);
    } catch (error) {
      if (errors.length < 20) errors.push(String(error?.message ?? error));
      return null;
    }
  }

  const clock = createActivityClock({ idleMs, now, onIdle: (ms) => emit('idle', { ms }) });
  const burst = createBurst({
    gapMs: burstGapMs, now,
    onFlush: ({ tool, chars, strokes, activeMs }) => {
      const data = { tool, activeMs };
      if (tool === 'draw') data.strokes = strokes; else data.chars = chars;
      emit('note_activity', data, currentBlock);
    },
  });

  // 활동 시간을 모듈 누적(store)에 더한다. 기록이 켜져 있는 동안의 시간만 센다.
  let credited = clock.active();
  function credit() {
    const cur = clock.active();
    if (live.record) store.addActive(cur - credited);
    credited = cur;
  }

  const api = {
    clock, errors,
    get consent() { return { ...live }; },
    get recording() { return live.record; },
    setBeginInfo(fn) { beginInfo = fn; },
    setCurrentBlock(blockId) { currentBlock = blockId; },

    // 동의가 바뀐다. 켜지는 순간 이번 방문의 시작 이벤트를 남기고, 꺼지면 그 뒤로 아무것도 남기지 않는다.
    setConsent(patch) {
      const wasOn = live.record;
      if (patch.record !== undefined) live.record = patch.record === true;
      live.questionText = QUESTION_TEXT_AVAILABLE && live.record && (patch.questionText ?? live.questionText) === true;
      if (!live.record) { burst.discard(); began = false; credited = clock.active(); }
      if (!wasOn && live.record) { credited = clock.active(); api.begin(); }
    },

    // ---- 세션·모듈
    begin() {
      if (!live.record || began) return;
      began = true;
      const info = beginInfo();
      const prev = store.lastSeenAtLoad;
      const data = { resumed: info.resumed === true };
      if (prev !== null && prev !== undefined) data.gapMs = int(now() - prev);
      emit('session_start', data);
      emit('module_open', info.fromBlockId ? { fromBlockId: info.fromBlockId } : {});
      if (info.layout) api.layout(info.layout);
    },
    sessionEnd(reason) {
      if (ended) return;
      ended = true;
      burst.flush();
      credit();
      emit('session_end', { reason });
    },
    moduleFinish() { credit(); emit('module_finish', { activeMs: int(store.activeMs) }); },
    moduleReset() {
      emit('module_reset');
      shownAt.clear(); lastMark.clear(); unit = null;
      if (live.record) store.resetActive();
      credited = clock.active();
    },

    // ---- 입력·시간 (계산기에 위임)
    input() { clock.input(); ended = false; },
    // 탭이 가려진다: 노트 묶음을 닫고, 가려진 시간은 활동 시간에서 뺀다(돌아오면 idle 로 남는다).
    hide() { burst.flush(); clock.hide(); api.sessionEnd('hidden'); },
    show() { clock.show(); ended = false; },
    // 1초마다: 침묵이 기준 시간을 넘으면 session_end('idle'), 노트 묶음 닫기.
    tick() {
      if (clock.checkIdle()) api.sessionEnd('idle');
      burst.tick();
    },
    activeNow: () => clock.active(),

    // ---- 본문 읽기
    blockShown(blockId) {
      if (!shownAt.has(blockId)) shownAt.set(blockId, now());
      if (!lastMark.has(blockId)) lastMark.set(blockId, clock.active());
    },
    unitShown({ blockId, chars, mode }) {
      api.blockShown(blockId);
      unit = { blockId, a0: clock.active(), pausedMs: 0, stalledAt: null, logged: false, shownMs: mode === 'instant' ? 0 : null };
      // 기록이 꺼져 있던 때 나온 단위는 unit_done 도 남기지 않는다(짝이 없는 unit_done 을 막는다).
      unit.logged = emit('unit_shown', { chars: int(chars), mode }, blockId) !== null;
    },
    // 점진 표시가 멈추거나(정지·입력 중 보호) 다시 흐른다.
    unitStalled(on) {
      if (!unit) return;
      if (on && unit.stalledAt === null) unit.stalledAt = now();
      else if (!on && unit.stalledAt !== null) { unit.pausedMs += now() - unit.stalledAt; unit.stalledAt = null; }
    },
    // 글이 다 나타났다(점진 표시가 끝났거나 '바로 펼치기'로 펼쳤다). 활동 시간으로 잰다(activeMs 와 같은 시계).
    unitFullyShown() {
      if (unit && unit.shownMs === null) unit.shownMs = int(clock.active() - unit.a0);
    },
    unitDone({ expandedEarly }) {
      if (!unit) return;
      const u = unit;
      unit = null;
      if (!u.logged) return;
      const pausedMs = u.pausedMs + (u.stalledAt !== null ? now() - u.stalledAt : 0);
      const data = { activeMs: int(clock.active() - u.a0), expandedEarly: expandedEarly === true, pausedMs: int(pausedMs) };
      if (u.shownMs !== null) data.shownMs = Math.min(u.shownMs, data.activeMs);
      emit('unit_done', data, u.blockId);
    },
    // 앞 글로 되돌아가 봄. via: 'end'(끝 화면의 '본문 다시 보기', 기본) | 'scroll'(읽는 위치보다 앞 블록이 화면에 머묾 — blockId = 다시 본 블록)
    // | 'scene'(장면별로 보기에서 '앞 장면 보기'로 지난 장면을 엶 — blockId = 그 장면의 첫 블록)
    unitRevisit({ fromBlockId, blockId, via }) {
      const data = { fromBlockId };
      if (via === 'end' || via === 'scroll' || via === 'scene' || via === 'fold') data.via = via; // 'fold': 접은 설명을 펼침(blockId = 접은 첫 글 블록)
      emit('unit_revisit', data, blockId ?? null);
    },
    // 한 문장이 끝나 멈춘 자리에서 다음 문장으로 넘어갔다(K04 A180). sentence: 방금 끝난 문장 번호(0부터), via: marker | continue | auto
    sentenceNext({ blockId, sentence, via }) { emit('sentence_next', { blockId, sentence: int(sentence), via }, blockId); },
    // '설명 접고 문항으로'를 눌렀다(K04 A177).
    explainFold({ sceneId, atBlockId, foldedUnits, shownUnits }) { emit('explain_fold', { sceneId, atBlockId, foldedUnits: int(foldedUnits), shownUnits: int(shownUnits) }, atBlockId); },

    settingChange({ key, from, to }) { emit('setting_change', { key, from, to }); },

    // ---- 문항. progress 는 제출이 반영된 뒤의 상태, result 는 correct|wrong|self|skipped.
    // unaided: '도움 없이 먼저' 자리의 시도일 때만 'first'(그 부분의 첫 답) | 'after'(첫 답 뒤). result 에 unknown('모르겠다')이 올 수 있다.
    attempt({ key, helpKey = helpKeyOfItem.get(key) ?? key.split('#')[0], result, progress, misconceptionIndex = -1, unaided, shownOrder }) {
      const blockId = key.split('#')[0];
      const a = clock.active();
      const since = lastMark.has(blockId) ? a - lastMark.get(blockId) : 0;
      lastMark.set(blockId, a);
      const help = progress.help[helpKey] ?? { hints: 0, solution: false };
      const data = {
        n: int(progress.items[key]?.attempts), result: resultOf(result),
        activeMs: int(since), hintsSeen: int(help.hints), solutionSeen: help.solution === true,
      };
      if (result === 'wrong' && misconceptionIndex >= 0) data.misconceptionId = `${key}.m${misconceptionIndex + 1}`;
      const blockType = findBlock(mod, blockId)?.block.type;
      if ((blockType === 'problem' || blockType === 'transfer') && key.includes('#')) data.part = key.split('#')[1];
      if (unaided === 'first' || unaided === 'after') data.unaided = unaided;
      if (Array.isArray(shownOrder)) data.shownOrder = [...shownOrder];
      emit('attempt', data, blockId);
      const found = findBlock(mod, blockId);
      if (found?.block.type === 'link' && key.includes('#')) {
        emit('link_fill', { stepId: key.split('#')[1], result: resultOf(result), n: data.n }, blockId);
      }
    },
    // ---- 묶음 돌리기(core/round.js). 낸 답의 글은 받지 않는다 — 결과·번째·걸린 활동 시간·(sort 의) 갈래뿐이다.
    roundItem({ blockId, item, n, result, ms, mode, pair, bucket, chosen, shownOrder }) {
      const data = { item, n: int(n), result, ms: int(ms), mode };
      if (typeof pair === 'string' && pair !== '') data.pair = pair;
      if (typeof bucket === 'string' && bucket !== '') data.bucket = bucket;
      if (typeof chosen === 'string' && chosen !== '') data.chosen = chosen;
      if (Array.isArray(shownOrder)) data.shownOrder = [...shownOrder];
      emit('round_item', data, blockId);
    },
    // 묶음이 풀렸다(줄이 다 돌았거나 건너뛰었다). summary: core/round.js roundSummary 의 결과.
    roundDone({ blockId, mode, summary }) {
      const data = { mode, items: int(summary.items), firstCorrect: int(summary.firstCorrect), presentations: int(summary.presentations), unresolved: int(summary.unresolved), skipped: int(summary.skipped) };
      if (Number.isFinite(summary.medianCorrectMs)) data.medianCorrectMs = int(summary.medianCorrectMs);
      emit('round_done', data, blockId);
    },
    // 지문(passage)을 겹쳐 띄웠다. blockId = 지문 블록, from = 그때 하던 블록.
    passageOpen({ blockId, from }) {
      emit('passage_open', typeof from === 'string' && from !== '' ? { from } : {}, blockId);
    },
    predictWritten({ blockId, chars }) { emit('predict_written', { chars: int(chars) }, blockId); },

    // ---- 본문 밖에서 도움 없이 푸는 문항 묶음(core/probe.js). kind: pre | delayed, action: offered | started | declined | finished
    probe({ kind, action, items, daysSince }) {
      const data = { kind, action, items: int(items) };
      if (Number.isFinite(daysSince)) data.daysSince = int(daysSince);
      probeMark = clock.active();
      emit('probe', data);
    },
    // 문항 하나의 답(한 번뿐). activeMs 는 풀기 시작(또는 앞 문항의 답) 뒤의 활동 시간이다. 답의 값은 남기지 않는다.
    probeAnswer({ kind, item, result, misconceptionIndex = -1, daysSince, shownOrder }) {
      const a = clock.active();
      const data = { kind, item, result, activeMs: int(a - probeMark) };
      probeMark = a;
      if (result === 'wrong' && misconceptionIndex >= 0) data.misconceptionId = `${item}.m${misconceptionIndex + 1}`;
      if (Number.isFinite(daysSince)) data.daysSince = int(daysSince);
      if (Array.isArray(shownOrder)) data.shownOrder = [...shownOrder];
      emit('probe_answer', data);
    },

    // ---- 여는 카드(core/opener.js). 질문과 보기가 나온 때(또는 끝 화면의 다시 보기 카드가 나온 때)를 활동 시간의 기준으로 잡는다. 고른 답의 글은 id 뿐이다.
    openerShown() { openerMark = clock.active(); },
    openerAnswer({ chosen, result, misconceptionIndex = -1, shownOrder }) {
      const a = clock.active();
      const data = { chosen, result, activeMs: int(a - openerMark) };
      openerMark = a;
      if (result === 'wrong' && misconceptionIndex >= 0) data.misconceptionId = `opener.m${misconceptionIndex + 1}`;
      if (Array.isArray(shownOrder)) data.shownOrder = [...shownOrder];
      emit('opener_answer', data);
    },
    openerRevisit({ chosen, result, first, firstResult, shownOrder }) {
      const a = clock.active();
      const data = { chosen, result, first, firstResult, activeMs: int(a - openerMark) };
      openerMark = a;
      if (Array.isArray(shownOrder)) data.shownOrder = [...shownOrder];
      emit('opener_revisit', data);
    },

    // ---- 건너뛰기 확인(core/skip.js). action: offered | started | declined | finished | not_offered, reason: pre_miss(not_offered 일 때)
    skipCheck({ action, goals, items, reason }) {
      const data = { action, goals: int(goals), items: int(items) };
      if (typeof reason === 'string') data.reason = reason;
      skipMark = clock.active();
      emit('skip_check', data);
    },
    // 문항 하나의 첫 응답(한 번뿐). activeMs 는 풀기 시작(또는 앞 문항의 답) 뒤의 활동 시간이다. 답의 값은 남기지 않는다.
    skipAnswer({ goal, item, result, misconceptionIndex = -1, shownOrder }) {
      const a = clock.active();
      const data = { goal, item, result, activeMs: int(a - skipMark) };
      skipMark = a;
      if (result === 'wrong' && misconceptionIndex >= 0) data.misconceptionId = `${item}.m${misconceptionIndex + 1}`;
      if (Array.isArray(shownOrder)) data.shownOrder = [...shownOrder];
      emit('skip_answer', data);
    },
    // 목표 하나의 판정. asked: 실제로 물은 문항 수, total: 그 목표의 문항 수.
    skipVerdict({ goal, verdict, correct, asked, total }) { emit('skip_verdict', { goal, verdict, correct: int(correct), asked: int(asked), total: int(total) }); },
    skipDecision({ sceneId, choice }) { emit('skip_decision', { sceneId, choice }); },
    // 다음 사슬 모듈로 잇기: 이 모듈을 건너뛰고 다음 모듈로 갔다(모듈 머리의 next).
    skipModule({ to }) { emit('skip_module', { to }); },
    skipReturn({ sceneId, trigger }) { emit('skip_return', { sceneId, trigger }); },

    // ---- 복습(core/review.js · data/review.mjs). 시험 날짜의 값은 받지 않는다(있는지만).
    reviewPlanned({ step, kind, date, time, gapDays, basis, examDate }) {
      emit('review_planned', { step: int(step), kind, date, time, gapDays: int(gapDays), basis, examDate: examDate === true });
    },
    // 복습 화면을 열었다(이어 하기 포함). 이벤트는 남기지 않고 활동 시간의 기준만 잡는다.
    reviewOpen() { reviewMark = reviewOpenedAt = clock.active(); },
    // 회차를 처음 시작했다.
    reviewStart({ step, lateDays, items }) {
      reviewMark = reviewOpenedAt = clock.active();
      emit('review_start', { step: int(step), lateDays: int(lateDays), items: int(items) });
    },
    // 문항 하나의 응답(다시 물은 것도 한 번씩). 답의 값은 남기지 않는다.
    reviewAnswer({ step, item, attempt, result, shownOrder }) {
      const a = clock.active();
      const data = { step: int(step), item, attempt: int(attempt), result, ms: int(a - reviewMark) };
      reviewMark = a;
      if (Array.isArray(shownOrder)) data.shownOrder = [...shownOrder];
      emit('review_answer', data);
    },
    reviewDone({ step, firstTryCorrect, items, asked, lateDays }) {
      emit('review_done', { step: int(step), firstTryCorrect: int(firstTryCorrect), items: int(items), asked: int(asked), ms: int(clock.active() - reviewOpenedAt), lateDays: int(lateDays) });
    },

    // ---- 도움. kind: hint | solution | other_explanation | link_reason | emergency
    // kind: emergency 는 긴급 안내를 폈다는 사실만 남긴다(helpKey·progress 없이 불러도 된다. blockId 가 없으면 지금 블록).
    helpOpen({ blockId = currentBlock, helpKey, kind, level, progress }) {
      const keys = keysOfHelp.get(helpKey) ?? [];
      const data = {
        kind,
        afterAttempts: keys.reduce((s, k) => s + int(progress?.items?.[k]?.attempts), 0),
        msSinceBlockStart: shownAt.has(blockId) ? int(now() - shownAt.get(blockId)) : 0,
      };
      if (level !== undefined) data.level = int(level);
      emit('help_open', data, blockId);
    },

    // ---- 학습 전담 AI(core/ai/client.js 의 결과 요약). 질문 글은 '질문 글도 남기기' 동의가 있을 때만, 긴급이면 동의가 있어도 남기지 않는다.
    // log = { qType, scope, tier, chars, sent }, outcome = 결과 status, provider = 서비스 id.
    aiQuestion({ blockId, log, outcome, provider, afterAttempts = 0, selectedText = false, text }) {
      const data = {
        qType: log.qType, scope: log.scope, tier: int(log.tier), chars: int(log.chars),
        afterAttempts: int(afterAttempts), selectedText: selectedText === true || (typeof selectedText === 'string' && selectedText !== ''),
        sent: log.sent === true,
      };
      if (typeof outcome === 'string') data.outcome = outcome;
      if (typeof provider === 'string') data.provider = provider;
      if (live.questionText && log.scope !== 'emergency' && outcome !== 'emergency' && typeof text === 'string') data.text = text;
      emit('ai_question', data, blockId);
    },
    aiFeedback({ blockId, helpful }) { emit('ai_feedback', { helpful: helpful === true }, blockId); },

    // ---- 노트 (내용은 받지 않는다)
    noteOpen(mode) { emit('note_open', { tool: toolOfNoteMode(mode) }, currentBlock); },
    noteTyped(chars) { if (live.record) burst.add('type', { chars: int(chars) }); },
    noteStroked(strokes) { if (live.record) burst.add('draw', { strokes: int(strokes) }); },
    noteFlush() { burst.flush(); },
    noteAttach() { emit('note_attach', {}, currentBlock); },

    // ---- 화면·끝
    layout({ w, h, pointer, reducedMotion, sheet }) {
      const data = { w: int(w), h: int(h), pointer, reducedMotion: reducedMotion === true };
      if (sheet) data.sheet = sheet;
      emit('layout', data);
    },
    finalAnswer(chars) { emit('final_answer', { chars: int(chars) }); },
    idle(ms) { emit('idle', { ms: int(ms) }); },
  };
  return api;
}

// ---------- 이 기기의 기록 요약 ----------
// metrics.report 를 이 기기의 이벤트에 돌린다. 한 사람의 기록이므로 minN=1. 사용 기록이며 학습 효과가 아니다.

export const SUMMARY_NOTE = '이 기기 한 사람의 사용 기록이며 학습 효과를 뜻하지 않습니다.';

export function summarizeEvents(rawEvents, { now = Date.now() } = {}) {
  const r = report(rawEvents, { minN: 1, now });
  const events = rawEvents.filter((e) => validateEvent(e).length === 0).sort((a, b) => a.ts - b.ts);
  const helpCount = {};
  for (const e of events) if (e.type === 'help_open' && e.block) helpCount[e.block] = (helpCount[e.block] ?? 0) + 1;
  const order = [];
  for (const e of events) if (e.block && !order.includes(e.block) && (e.type === 'attempt' || e.type === 'help_open')) order.push(e.block);
  const blocks = order.map((block) => {
    const d = r.difficultyByBlock[block];
    const first = d?.firstAttemptWrong ?? { value: null, n: 0 };
    return {
      block,
      firstAttempt: first.n === 0 ? 'none' : first.value === 1 ? 'wrong' : 'correct',
      helpOpened: helpCount[block] ?? 0,
      activeMs: d?.activeMsToFinish?.median ?? null,
    };
  });
  // 총 활동 시간: 방문(세션)마다 '마지막 이벤트 - 첫 이벤트 - idle 합' 을 더한다(metrics.time 의 세션 길이와 같은 식).
  let totalActiveMs = 0;
  const bySession = new Map();
  for (const e of events) { if (!bySession.has(e.session)) bySession.set(e.session, []); bySession.get(e.session).push(e); }
  for (const evs of bySession.values()) {
    const idle = evs.filter((e) => e.type === 'idle').reduce((s, e) => s + e.data.ms, 0);
    totalActiveMs += Math.max(0, evs[evs.length - 1].ts - evs[0].ts - idle);
  }
  // 도움 없이 먼저 해 본 자리의 첫 답: 블록·부분마다 가장 이른 것 하나씩 센다(서술형은 뺀다).
  const unaidedFirst = { correct: 0, wrong: 0, unknown: 0, skipped: 0 };
  const seenFirst = new Set();
  for (const e of events) {
    if (e.type !== 'attempt' || e.data.unaided !== 'first' || !(e.data.result in unaidedFirst)) continue;
    const k = `${e.block}#${e.data.part ?? ''}`;
    if (!seenFirst.has(k)) { seenFirst.add(k); unaidedFirst[e.data.result] += 1; }
  }
  return {
    eventCount: events.length, rejected: r.rejected,
    blocks, totalActiveMs, sessions: bySession.size, unaidedFirst,
    displayMode: r.choices.displayMode,
    settingChanges: r.choices.settingChanges,
    finished: events.some((e) => e.type === 'module_finish'),
    report: r,
  };
}
