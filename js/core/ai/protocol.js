// 학습 전담 AI 와 주고받는 요청·응답 형식(v1)과 검증. 순수 함수 — DOM·네트워크를 모른다.
// 어느 서비스든 이 형식만 맞추면 나머지 코드는 그대로다(client.js 가 서비스와 화면 사이를 맡는다).
//
// 요청에 넣지 않는 것: 학습자 키·세션 id·기기 정보·노트 내용·다른 문항의 답·정답 값 자체. 시험이 지킨다(tests/ai.test.js).
import { findBlock, helpSpec } from '../module.js';
import { figureState } from '../figure-state.js';
import { targetsOf, answerOpen, protectedOf, leaksAny, moduleUnits } from './answers.js';

export const AI_PROTOCOL_VERSION = 1;
export const QUESTION_MAX_CHARS = 300; // 근거 없는 출발점
export const ANSWER_MAX_CHARS = 1200;  // 근거 없는 출발점

export const RESPONSE_KINDS = ['answer', 'clarify', 'refuse'];
export const RESPONSE_SCOPES = ['in', 'adjacent', 'off_topic', 'emergency'];

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (n) => Math.max(0, Math.round(Number(n) || 0));

// 지금 블록의 글(화면에 보이는 것만). 연결(link)은 단계의 결과·이유가 풀기 전에는 가려져 있으므로 목표와 알려진 것만 싣는다.
function blockText(mod, scene, block, unitIndex, progress) {
  switch (block.type) {
    case 'text': {
      const upto = Number.isInteger(unitIndex) ? unitIndex + 1 : block.units.length; // 열린 단위까지(모르면 블록 전체)
      return block.units.slice(0, upto).join('\n');
    }
    case 'check': {
      const options = block.answer?.kind === 'choice' ? block.answer.options.map((o) => `- ${o.label}`) : [];
      return [block.prompt, ...options].filter(isStr).join('\n');
    }
    case 'problem':
    case 'transfer': {
      const parts = block.parts.flatMap((p) => [p.label, ...(p.answer?.kind === 'choice' ? p.answer.options.map((o) => `- ${o.label}`) : [])]);
      return [block.prompt, ...parts].filter(isStr).join('\n');
    }
    case 'link': return [block.goal, block.given].filter(isStr).join('\n');
    case 'figure': return figureState(mod, block, progress ?? { items: {}, help: {} }).alt ?? '';
    default: return isStr(block.prompt) ? block.prompt : '';
  }
}

export function buildRequest({ mod, blockId, unitIndex, itemKey, question, selectedText, progress }) {
  const found = findBlock(mod, blockId);
  const scene = found?.scene;
  const block = found?.block;
  const targets = block ? targetsOf(mod, blockId, itemKey) : [];
  const answerAllowed = targets.every((g) => answerOpen(progress, g)); // 문항이 없으면 지킬 답도 없다 → true
  const guarded = block ? protectedOf(mod, progress, blockId) : [];
  const units = moduleUnits(mod);
  // 아직 말하면 안 되는 정답이 든 힌트·피드백은 요청에서 뺀다(힌트 가운데 값을 말하는 것이 있을 수 있다).
  const safe = (text) => isStr(text) && (answerAllowed || !leaksAny(text, guarded, units));

  let item = null;
  let reference = null;
  if (targets.length > 0) {
    const single = targets.length === 1;
    const helpKeys = [...new Set(targets.map((g) => g.helpKey))];
    const specs = helpKeys.map((k) => helpSpec(mod, k));
    const hintsSeen = Math.max(...helpKeys.map((k) => progress?.help?.[k]?.hints ?? 0));
    item = {
      prompt: String((single ? targets[0].label : (block.prompt ?? block.goal ?? targets[0].label)) ?? ''),
      solved: targets.every((g) => progress?.items?.[g.key]?.solved === true),
      attempts: targets.reduce((s, g) => s + int(progress?.items?.[g.key]?.attempts), 0),
      hintsSeen: int(hintsSeen),
      solutionSeen: helpKeys.some((k) => progress?.help?.[k]?.solution === true),
    };
    reference = {
      hints: [...new Set(specs.flatMap((s) => s.hints))].filter(safe),
      misconceptions: targets.flatMap((g) => g.misconceptions.map((m) => m.feedback)).filter(safe).map((feedback) => ({ feedback })),
    };
    // 풀이는 답을 말해도 될 때만 싣는다. 키 자체를 만들지 않는다.
    if (answerAllowed) reference.solution = specs.map((s) => s.solution).filter(isStr).join('\n') || null;
  }

  return {
    v: AI_PROTOCOL_VERSION,
    module: { id: mod.id, version: mod.version, title: mod.title, centralQuestion: mod.centralQuestion },
    scope: mod.ai?.scope ?? { in: mod.centralQuestion, adjacent: [] },
    context: {
      sceneTitle: scene?.title ?? '',
      blockType: block?.type ?? '',
      blockText: block ? blockText(mod, scene, block, unitIndex, progress) : '',
      item,
      reference,
    },
    question: { text: String(question ?? ''), selectedText: isStr(selectedText) ? String(selectedText).slice(0, QUESTION_MAX_CHARS) : null },
    policy: { answerAllowed, language: 'ko', maxChars: ANSWER_MAX_CHARS },
  };
}

// 응답 검증: 서비스가 무엇을 돌려주든 이 관문을 통과한 것만 화면으로 간다. HTML 은 해석하지 않는다(화면은 textContent 로만 쓴다).
export function validateResponse(raw) {
  const errors = [];
  if (!isObj(raw)) return { ok: false, errors: ['응답이 객체가 아니다'], value: null };
  if (raw.v !== AI_PROTOCOL_VERSION) errors.push(`v 는 ${AI_PROTOCOL_VERSION}`);
  if (!RESPONSE_KINDS.includes(raw.kind)) errors.push(`kind 는 ${RESPONSE_KINDS.join('|')}`);
  if (!RESPONSE_SCOPES.includes(raw.scope)) errors.push(`scope 는 ${RESPONSE_SCOPES.join('|')}`);
  if (typeof raw.text !== 'string') errors.push('text 는 문자열');
  else if (raw.text.trim() === '') errors.push('text 가 비어 있다');
  else if (raw.text.trim().length > ANSWER_MAX_CHARS) errors.push(`text 가 ${ANSWER_MAX_CHARS}자를 넘는다`);
  if (!isStr(raw.provider)) errors.push('provider 는 비어 있지 않은 문자열');
  if (raw.model !== undefined && typeof raw.model !== 'string') errors.push('model 은 문자열');
  if (errors.length > 0) return { ok: false, errors, value: null };
  const value = { v: AI_PROTOCOL_VERSION, kind: raw.kind, scope: raw.scope, text: raw.text.trim(), provider: raw.provider };
  if (raw.model !== undefined) value.model = raw.model;
  return { ok: true, errors, value };
}
