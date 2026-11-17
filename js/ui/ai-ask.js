// 질문하기: 도움 서랍 안 사다리 아래의 질문 칸. 연결된 서비스가 있을 때만 그린다(client.available).
// 서비스가 없는 기본 상태에서는 아무것도 그리지 않는다. 답은 textContent 로만 쓴다(HTML 을 해석하지 않는다).
import { h, uid } from './dom.js';
import { QUESTION_MAX_CHARS } from '../core/ai/protocol.js';
import { AI_MESSAGES } from '../core/ai/client.js';
import { attemptsIn } from '../core/ai/answers.js';
import { emergencyContent } from './emergency.js';

const FAKE_NOTE = '시험용 가짜 응답기입니다. 실제 AI 가 아닙니다.';
const REAL_NOTE = 'AI 가 새로 만든 답입니다. 사람이 확인하지 않았으니 틀릴 수 있습니다.';
const FAKE_SEND_NOTE = '시험용이라 질문은 이 기기 밖으로 나가지 않습니다.';
const SEND_NOTE = '질문과 지금 보고 있는 본문이 AI 서비스로 전송됩니다. 이름·노트는 보내지 않습니다.';

export function createAiAsk({ client, mod, session, rec, announce }) {
  const drafts = new Map(); // 대상별 쓰던 글(서랍이 다시 그려져도 남는다)
  const lasts = new Map();  // 대상별 마지막 결과
  let pending = null;       // { key } 답을 기다리는 중
  let live = null;          // 지금 화면에 붙어 있는 { key, resultBox, button, status }

  function paint() {
    if (!live) return;
    const { key, resultBox, button, status } = live;
    resultBox.replaceChildren();
    const waiting = pending?.key === key;
    button.disabled = pending !== null;
    status.textContent = waiting ? '답을 기다리는 중…' : '';
    const res = lasts.get(key);
    if (!res || waiting) return;
    const note = (text) => h('p', { class: 'small', text });
    switch (res.status) {
      case 'ok': {
        const answer = h('div', { class: 'ai-answer' },
          h('p', { class: 'tag', text: res.kind === 'clarify' ? '되묻는 말' : '답' }),
          h('p', { text: res.text }));
        resultBox.append(answer, note(res.provider.isReal ? REAL_NOTE : FAKE_NOTE), feedbackRow(res));
        break;
      }
      case 'refused':
      case 'withheld': resultBox.append(note(res.text)); break;
      case 'emergency': resultBox.append(emergencyContent(res.notice)); break;
      case 'invalid': resultBox.append(note(res.reason === 'empty' ? AI_MESSAGES.invalid_empty : AI_MESSAGES.invalid_long)); break;
      case 'locked': resultBox.append(note(AI_MESSAGES.locked)); break;
      case 'limited': resultBox.append(note(res.reason === 'count' ? AI_MESSAGES.limited_count : AI_MESSAGES.limited_interval)); break;
      default: resultBox.append(note(AI_MESSAGES.unavailable)); break;
    }
  }

  function feedbackRow(res) {
    const row = h('div', { class: 'ai-feedback' });
    const send = (helpful) => {
      rec.aiFeedback({ blockId: res.blockId, helpful });
      row.replaceChildren(h('p', { class: 'small', text: '의견을 받았습니다.' }));
    };
    row.append(
      h('span', { class: 'small', text: '이 답이 도움이 됐나요?' }),
      h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => send(true) }, '도움이 됐다'),
      h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => send(false) }, '도움이 안 됐다'));
    return row;
  }

  async function submit(target, key, text) {
    if (pending) return;
    pending = { key };
    paint();
    const result = await client.ask({ mod, blockId: target.blockId, unitIndex: target.unitIndex, itemKey: target.itemKey, question: text, selectedText: target.selectedText, progress: session.progress });
    pending = null;
    lasts.set(key, { ...result, blockId: target.blockId });
    // 질문 기록: 아무것도 묻지 않은 빈 질문은 남기지 않는다. 글은 동의가 있을 때만 남고, 긴급이면 동의가 있어도 남지 않는다(core/telemetry.js).
    if (!(result.status === 'invalid' && result.reason === 'empty')) {
      rec.aiQuestion({
        blockId: target.blockId, log: result.log, outcome: result.status, provider: result.log.sent ? client.provider.id : undefined,
        afterAttempts: attemptsIn(mod, session.progress, target.blockId), selectedText: typeof target.selectedText === 'string' && target.selectedText !== '', text,
      });
    }
    announce?.(result.status === 'ok' ? '답이 도착했습니다.' : '질문 결과가 나왔습니다.');
    paint();
  }

  return {
    // 도움 서랍이 다시 그려질 때마다 부른다. 서비스가 없으면 null.
    node(target) {
      if (!client.available) return null;
      const key = `${target.blockId}|${target.itemKey ?? ''}`;
      const inputId = uid('ai-q-');
      const counter = h('p', { class: 'small ai-counter' });
      const input = h('textarea', {
        id: inputId, class: 'input input-text', rows: 3, maxlength: QUESTION_MAX_CHARS, dataset: { focusId: 'ai-input' },
        onInput: () => { drafts.set(key, input.value); updateCounter(); },
      });
      input.value = drafts.get(key) ?? '';
      const updateCounter = () => { counter.textContent = `남은 글자 ${Math.max(0, QUESTION_MAX_CHARS - input.value.length)}자`; };
      updateCounter();
      const button = h('button', { type: 'button', class: 'btn', onClick: () => submit(target, key, input.value) }, '보내기');
      const status = h('p', { class: 'small', role: 'status' });
      const resultBox = h('div', { class: 'ai-result', 'aria-live': 'polite' });
      live = { key, resultBox, button, status };
      const section = h('section', { class: 'ai-ask', 'aria-labelledby': `${inputId}-title` },
        h('h4', { class: 'help-sub', id: `${inputId}-title`, text: '질문하기' }),
        h('p', { class: 'small', text: client.provider.isReal ? REAL_NOTE : FAKE_NOTE }),
        h('p', { class: 'small', text: client.provider.isReal ? SEND_NOTE : FAKE_SEND_NOTE }), // 가짜 응답기는 아무것도 보내지 않는다 — 보낸다고 말하지 않는다
        h('label', { class: 'small', for: inputId, text: '묻고 싶은 것' }),
        input, counter, h('div', { class: 'ladder' }, button), status, resultBox);
      paint();
      return section;
    },
  };
}
