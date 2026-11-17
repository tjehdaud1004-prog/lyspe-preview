// 가짜 응답기 — 실제 AI 가 아니다. 바깥으로 아무것도 보내지 않는다. 시험과 개발 확인(로컬 주소의 ?ai=fake)에서만 쓴다(core/ai/config.js).
// 기본 동작은 결정적이다:
//  · 요청의 reference.hints[0] 이 있으면 그것을 답으로(answer·in), 없으면 되묻는다(clarify).
//  · 질문에 '날씨'·'게임'·'숙제 해 줘' 같은 낱말이 있으면 주제 밖으로 거절(refuse·off_topic).
// script(시험용): 배열. 묻는 순서대로 한 칸씩 쓴다(다 쓰면 기본 동작).
//   { raw: 값 }                     형식이 깨진 응답 — 그 값을 그대로 돌려준다
//   { throw: true }                 서비스가 예외를 던진다
//   { delayMs: n, ...다음 칸 }       n 밀리초 뒤에 답한다(중단 신호가 오면 멈춘다)
//   { leak: true, value: '7,000원' } 정답 값이 든 글(요청에는 정답이 없으므로 시험이 값을 넘겨준다)
//   그 밖의 객체                     응답 형식의 일부를 덮어쓴다. 예: { scope: 'emergency' }, { kind: 'refuse', scope: 'off_topic' }
import { AI_PROTOCOL_VERSION, ANSWER_MAX_CHARS } from './protocol.js';

const OFF_TOPIC = /날씨|게임|숙제\s*(좀\s*)?해\s*줘|대신\s*풀어/;
const CLARIFY_TEXT = '어느 부분이 막혔는지 조금 더 적어 주세요.';

export function createFakeProvider({ script = [], setTimer = setTimeout } = {}) {
  const queue = [...script];
  const calls = []; // 시험이 '몇 번 불렸나'를 볼 수 있게

  const base = (patch = {}) => ({ v: AI_PROTOCOL_VERSION, kind: 'answer', scope: 'in', text: '', provider: 'fake', model: 'fake-1', ...patch });

  function byDefault(request) {
    if (OFF_TOPIC.test(request?.question?.text ?? '')) return base({ kind: 'refuse', scope: 'off_topic', text: '이 모듈과 관계없는 질문입니다.' });
    const hint = request?.context?.reference?.hints?.[0];
    if (typeof hint === 'string' && hint.trim() !== '') return base({ text: hint.slice(0, ANSWER_MAX_CHARS) });
    return base({ kind: 'clarify', text: CLARIFY_TEXT });
  }

  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      setTimer(resolve, ms);
      signal?.addEventListener?.('abort', () => reject(new Error('aborted')), { once: true });
    });
  }

  async function ask(request, { signal } = {}) {
    calls.push(request);
    const step = queue.shift();
    if (step === undefined) return byDefault(request);
    if (typeof step.delayMs === 'number') await wait(step.delayMs, signal);
    if (step.throw === true) throw new Error('fake provider error');
    if ('raw' in step) return step.raw;
    if (step.leak === true) return base({ text: `이 문항의 답은 ${step.value ?? ''} 입니다.` });
    const { delayMs, ...patch } = step;
    return Object.keys(patch).length === 0 ? byDefault(request) : base(patch);
  }

  return { id: 'fake', label: '시험용 가짜 응답기', isReal: false, ask, calls };
}
