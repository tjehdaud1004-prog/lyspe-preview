// 학습 전담 AI 의 연결부: 서비스(provider)와 화면 사이. 어느 서비스로 바꿔 끼워도 이 파일 아래는 그대로다.
// 서비스는 { id, label, isReal, ask(request, { signal }) } 만 지키면 된다(어디에도 연결하지 않았으면 provider 는 null — 질문 칸이 없다).
//
// ask() 의 순서(시험이 이 순서를 지킨다):
//  1 질문 다듬기 → 2 긴급 먼저(서비스를 부르지 않는다) → 3 도움 잠금 → 4 횟수·간격 → 5 요청 보내기(시간 제한)
//  → 6 응답 형식 검사 → 7 서비스가 emergency 라고 답함 → 8 주제 밖·거절 → 9 정답 누출 막기 → 10 통과
import { helpGate } from '../unaided.js';
import { buildRequest, validateResponse, QUESTION_MAX_CHARS } from './protocol.js';
import { EMERGENCY_NOTICE, looksLikeEmergency } from './emergency.js';
import { questionType } from './classify.js';
import { protectedOf, leaksAny, moduleUnits } from './answers.js';

// 모두 근거 없는 출발점이다.
export const AI_LIMITS = { maxQuestionsPerSession: 10, minIntervalMs: 5000, timeoutMs: 20000 };

// 화면 문구: 서비스가 쓴 글이 아니라 고정 문장이다(하지 않은 일을 했다고 말하지 않는다).
export const OFF_TOPIC_MESSAGE = '이 모듈의 내용을 묻는 질문만 받습니다. 지금 보던 문항으로 돌아가 볼까요?';
export const WITHHELD_MESSAGE = '답을 바로 알려 주는 내용이라 보여 주지 않았습니다. 먼저 한 번 답해 보거나 힌트를 열어 보세요.';
export const AI_MESSAGES = Object.freeze({
  invalid_empty: '질문을 적어 주세요.',
  invalid_long: `질문은 ${QUESTION_MAX_CHARS}자까지 적을 수 있습니다.`,
  locked: '먼저 한 번 풀어 본 뒤에 질문할 수 있습니다. 막혔으면 ‘모르겠다’를 누르면 열립니다.',
  limited_count: '이번에 열어 둔 동안 물어볼 수 있는 횟수를 다 썼습니다. 힌트를 열어 보거나 노트에 적어 두고 계속 읽어도 됩니다.',
  limited_interval: '조금 뒤에 다시 질문할 수 있습니다.',
  unavailable: '답을 받지 못했습니다. 잠시 뒤에 다시 해 보거나, 힌트를 열어 보세요.',
});

const VALID_QTYPES = new Set(['answer_only', 'meaning', 'why_step', 'check_calc', 'other_explanation', 'other']);

export function createAiClient({ provider = null, limits = AI_LIMITS, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let asked = 0;       // 서비스로 요청이 나간 횟수
  let lastAt = null;   // 마지막으로 요청을 내보낸 시각

  const log = (qType, scope, tier, chars, sent) => ({ qType: VALID_QTYPES.has(qType) ? qType : 'other', scope, tier, chars, sent });
  const emergency = (chars, sent) => ({ status: 'emergency', notice: EMERGENCY_NOTICE, log: log('other', 'emergency', 0, chars, sent) });

  async function callProvider(request) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimer(() => { controller.abort(); reject(new Error('timeout')); }, limits.timeoutMs); });
    try {
      return await Promise.race([Promise.resolve().then(() => provider.ask(request, { signal: controller.signal })), timeout]);
    } finally {
      clearTimer(timer);
    }
  }

  async function ask({ mod, blockId, unitIndex, itemKey, question, selectedText, progress }) {
    // 1. 질문 글 다듬기
    const text = String(question ?? '').trim();
    const qType = questionType(text);
    if (text === '') return { status: 'invalid', reason: 'empty', log: log('other', 'unknown', 0, 0, false) };
    if (text.length > QUESTION_MAX_CHARS) return { status: 'invalid', reason: 'too_long', log: log(qType, 'unknown', 0, text.length, false) };
    // 2. 긴급 먼저: 서비스를 부르지 않고, 질문 글은 요청으로 나가지 않는다(건강 등 민감정보).
    if (looksLikeEmergency(text)) return emergency(text.length, false);
    const quiet = (status, extra = {}) => ({ status, ...extra, log: log(qType, 'unknown', 0, text.length, false) });
    // 3. 도움 잠금: 도움 없이 먼저 하는 자리에서는 질문도 잠긴다.
    if (helpGate(mod, progress, blockId).locked) return quiet('locked');
    // 4. 횟수·간격
    if (asked >= limits.maxQuestionsPerSession) return quiet('limited', { reason: 'count' });
    if (lastAt !== null && now() - lastAt < limits.minIntervalMs) return quiet('limited', { reason: 'interval', retryInMs: Math.max(0, limits.minIntervalMs - (now() - lastAt)) });
    if (!provider) return quiet('unavailable');
    // 5. 요청 보내기
    const request = buildRequest({ mod, blockId, unitIndex, itemKey, question: text, selectedText, progress });
    asked += 1;
    lastAt = now();
    const sentLog = (scope, tier) => log(qType, scope, tier, text.length, true);
    let raw;
    try { raw = await callProvider(request); } catch { return { status: 'unavailable', log: sentLog('unknown', 0) }; }
    // 6. 응답 형식
    const checked = validateResponse(raw);
    if (!checked.ok) return { status: 'unavailable', reason: 'malformed', log: sentLog('unknown', 0) };
    const res = checked.value;
    // 7. 서비스가 긴급이라고 답함: 서비스의 글은 버리고 고정 안내
    if (res.scope === 'emergency') return emergency(text.length, true);
    // 8. 주제 밖·거절: 서비스가 쓴 거절 글은 쓰지 않는다
    if (res.scope === 'off_topic' || res.kind === 'refuse') return { status: 'refused', text: OFF_TOPIC_MESSAGE, log: sentLog(res.scope, 0) };
    // 9. 정답 누출 막기: 아직 말하면 안 되는 칸(풀지 않았고 풀이도 안 열었다)의 정답이 응답에 들어 있으면 보여 주지 않는다.
    if (!request.policy.answerAllowed && leaksAny(res.text, protectedOf(mod, progress, blockId), moduleUnits(mod))) {
      return { status: 'withheld', text: WITHHELD_MESSAGE, log: sentLog(res.scope, 0) };
    }
    // 10. 통과
    return {
      status: 'ok', kind: res.kind, scope: res.scope, text: res.text, tier: 3,
      provider: { id: provider.id, label: provider.label, isReal: provider.isReal === true },
      log: sentLog(res.scope, 3),
    };
  }

  return { get available() { return provider !== null; }, get provider() { return provider; }, ask };
}
