// 작성 점검(경고): 확인 문항·문제의 정답이 그 문항 앞에 보이는 글·그림에 그대로 나오는가. DOM 을 모른다.
//
// 대상: check 블록과 problem·transfer 의 각 부분(자동 채점하는 number·choice·term 답). 연결(link) 빈칸은 여기서 보지 않는다.
// 묶음 돌리기(round)의 문항은 보지 않는다: 뜻을 보이고 가린 뒤 낱말을 묻는 것이 recall 묶음의 본래 모양이라 정답이 앞 글에 있는 것이 당연하다(SPEC_KINDS.md 2절).
// 지문(passage)의 글은 '앞에 보이는 글'로 치지 않는다: 읽기 문항의 답은 지문 안에 있는 것이 정상이다(4절). 지문 뒤에 오는 본문 글은 지금 규칙대로 본다.
//
// '문항 앞에 보이는 글'의 규칙(같은 장면 안에서만 본다):
//   condition  그 블록(없으면 장면)의 조건 한 줄
//   unit       그 문항 블록보다 앞에 있는 글 블록의 모든 단위
//   help-note  그 글 블록의 '다른 설명'(열어도 문항 결과가 달라지지 않는 도움이라 '공짜로 보이는 글'이다)
//   figure     앞에 있는 그림의 글자 — 표의 제목·머리·칸, 그래프의 제목·축 이름·선 이름·표시점 글자(눈금 숫자는 뺀다: 눈금은 위치를 읽는 재료다)
//   alt        앞에 있는 그림의 텍스트 대체
//   link       앞에 있는 연결 블록의 구하려는 것·알고 있는 것·단계 제목·결과·이유
//   prompt     앞에 있는 예상 적기·예상 다시 보기·확인 문항·문제의 지시문과 부분 제목, 그리고 이 문항 자신의 지시문
//              (문제의 부분은 한 화면에 함께 보이므로 같은 문제의 모든 부분 제목을 본다)
//   feedback   앞에 있는 확인 문항·문제의 오개념 피드백, 같은 문제의 다른 부분의 오개념 피드백(숫자 답만 본다)
//              — 그 오답을 낸 학습자에게만 보이지만, 보이면 뒤(옆) 문항의 답을 그냥 준다
//   own        이 문항 자신의 오개념 피드백(숫자 답만) — 틀렸다고 알리면서 정답을 말해 버리는 경우
//   보지 않는 것: 힌트·풀이(열면 결과가 '힌트를 본 뒤'·'풀이를 본 뒤'로 남는다), 뒤에 있는 블록의 오개념 피드백, 다른 장면의 글,
//                 문항보다 뒤에 나오는 글(건너뛴 뒤 돌아와 답하는 경로 — 진행 상태의 '건너뛴 뒤'로 따로 표시한다).
//
// 숫자 답: 글 속의 수(천 단위 쉼표 허용)가 정답과 같은 값이면 걸린다. 단, 정답에 단위가 있고 글 속의 수 바로 뒤에
//          이 모듈이 쓰는 '다른 단위'가 붙어 있으면 다른 양으로 보고 넘어간다("50분"은 단위가 '원'인 정답 50 의 누출이 아니다).
// 보기 답: 약한 규칙 — 문항 앞에 보이는 글 전체에 정답 보기의 글은 나오는데 다른 보기의 글은 하나도 안 나올 때만 걸린다
//          (정답만 이름이 불린 경우). 글의 뜻으로 답을 알려 주는 경우는 기계로 잡지 못한다.
// 그림이 revealAfter 로 이 문항을 가리키면, 그 그림은 가린 상태(값 대신 '?', alt)로 본다.
// 의도된 경우: 문항(또는 부분)에 leakOk: "<이유>" 를 적으면 그 문항은 경고하지 않고 leakAcknowledged() 에 모인다.
import { figureAltText, markValueText } from './reveal.js';
import { evalLine } from './chart.js';
import { formatNumber } from './format.js';
import { normalizeTerm, normalizeInput } from './answer.js';
import { choiceItems } from './shuffle.js';

// 수의 중간에서 새로 시작하지 않는다. "1,000원,400원"의 400 은 따로 읽는다.
const NUMBER = /(?<![\d.])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
const isStr = (v) => typeof v === 'string' && v.trim() !== '';

// 글에서 수를 뽑는다: [{ value, index, raw, rest }] — rest 는 수 바로 뒤의 글(단위 판정용).
export function numberTokens(text) {
  const s = String(text ?? '');
  return [...s.matchAll(NUMBER)].map((m) => ({
    value: Number(m[0].replace(/,/g, '')), index: m.index, raw: m[0], rest: s.slice(m.index + m[0].length).trimStart(),
  }));
}

// 이 모듈이 쓰는 단위 낱말(정답의 단위·별칭, 그래프 축 단위). 긴 것부터.
export function moduleUnits(mod) {
  const units = new Set();
  const add = (u) => { if (isStr(u)) units.add(u.trim()); };
  for (const def of Object.values(mod.figures ?? {})) { add(def.xUnit); add(def.yUnit); }
  for (const item of leakItems(mod, { all: true })) { add(item.answer.unit); (item.answer.unitAliases ?? []).forEach(add); }
  return [...units].sort((a, b) => b.length - a.length);
}

// 검사 대상 문항. all: 자동 채점이 아닌 것·leakOk 가 붙은 것도 포함.
function leakItems(mod, { all = false } = {}) {
  const out = [];
  for (const scene of mod.scenes) {
    scene.blocks.forEach((block, blockIndex) => {
      const base = { scene, block, blockIndex, sceneId: scene.id, blockId: block.id };
      if (block.type === 'check') out.push({ ...base, key: block.id, answer: block.answer, own: block, label: block.prompt });
      else if (block.type === 'problem' || block.type === 'transfer') {
        for (const part of block.parts) out.push({ ...base, key: `${block.id}#${part.id}`, answer: part.answer, own: part, label: part.label });
      }
    });
  }
  return all ? out : out.filter((i) => (i.answer.kind === 'number' || i.answer.kind === 'numbers' || i.answer.kind === 'choice' || i.answer.kind === 'term') && !isStr(i.own.leakOk));
}

function figureSources(mod, block, itemKey) {
  const masked = block.revealAfter !== undefined && block.revealAfter === itemKey;
  const out = [{ kind: 'alt', where: block.id, text: figureAltText(block, masked) }];
  const def = mod.figures?.[block.figure];
  if (!def) return out;
  const parts = def.kind === 'table'
    ? [def.caption, ...def.columns, ...def.rows.flat()]
    : def.kind === 'image' ? [def.alt, def.caption]
    : def.kind === 'points'
      ? [def.alt, def.x?.label, def.y?.label, ...(def.series ?? []).map((s) => s.label)]
      : [def.title, def.xLabel, def.yLabel, ...def.series.map((s) => s.label),
      ...(def.marks ?? []).map((m) => `${m.label} ${markValueText(def, { x: m.x, y: evalLine(def.series[0], m.x) }, masked)}`)];
  out.push({ kind: 'figure', where: block.id, text: parts.filter(isStr).join(' / ') });
  return out;
}

// 한 문항 앞에 보이는 글 덩어리들: [{ kind, where, text }]
export function visibleBefore(mod, item) {
  const { scene, block, blockIndex } = item;
  const out = [];
  const push = (kind, where, text) => { if (isStr(text)) out.push({ kind, where, text }); };
  push('condition', block.condition ? block.id : scene.id, block.condition ?? scene.condition);
  scene.blocks.slice(0, blockIndex).forEach((b) => {
    switch (b.type) {
      case 'text':
        b.units.forEach((u, i) => push('unit', `${b.id}[${i}]`, u));
        (b.help ?? []).forEach((x, i) => push('help-note', `${b.id}.help[${i}]`, x.body));
        break;
      case 'figure': out.push(...figureSources(mod, b, item.key)); break;
      case 'link':
        push('link', b.id, [b.goal, b.given].filter(isStr).join(' / '));
        b.steps.forEach((s) => push('link', `${b.id}#${s.id}`, [s.label, s.gives, s.why].filter(isStr).join(' / ')));
        break;
      case 'problem':
      case 'transfer':
        push('prompt', b.id, b.prompt);
        b.parts.forEach((p) => push('prompt', `${b.id}#${p.id}`, p.label));
        break;
      case 'lookback': push('prompt', b.id, [b.known, b.prompt, b.promptEmpty].filter(isStr).join(' / ')); break;
      case 'audio': push('prompt', b.id, b.transcript); break;
      case 'passage': break; // 지문의 글은 앞 글로 치지 않는다
      default: push('prompt', b.id, b.prompt); break; // check, predict
    }
  });
  push('prompt', block.id, block.prompt);
  if (block.type !== 'check') block.parts.forEach((p) => push('prompt', `${block.id}#${p.id}`, p.label));
  // 오개념 피드백: 앞 블록의 것, 같은 문제의 다른 부분의 것, 그리고 자기 것. 보기 답에는 쓰지 않는다(answerLeaks 가 거른다).
  const feedbackOf = (kind, where, list) => (list ?? []).forEach((m, i) => push(kind, `${where}.m${i + 1}`, m.feedback));
  scene.blocks.slice(0, blockIndex).forEach((b) => {
    if (b.type === 'check') feedbackOf('feedback', b.id, b.misconceptions);
    else if (b.type === 'problem' || b.type === 'transfer') b.parts.forEach((p) => feedbackOf('feedback', `${b.id}#${p.id}`, p.misconceptions));
  });
  if (block.type !== 'check') block.parts.forEach((p) => { if (`${block.id}#${p.id}` !== item.key) feedbackOf('feedback', `${block.id}#${p.id}`, p.misconceptions); });
  feedbackOf('own', item.key, item.own.misconceptions);
  return out;
}

const snippet = (text, index, length) => {
  const from = Math.max(0, index - 16);
  const to = Math.min(text.length, index + length + 16);
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
};

function numberHit(answer, text, units) {
  for (const t of numberTokens(text)) {
    if (Math.abs(t.value - Math.abs(answer.value)) > (answer.tolerance ?? 0) + 1e-9) continue;
    if (isStr(answer.unit)) {
      const own = [answer.unit, ...(answer.unitAliases ?? [])];
      const follows = units.find((u) => t.rest.startsWith(u));
      if (follows !== undefined && !own.includes(follows)) continue; // 다른 단위가 붙은 수 = 다른 양
    }
    return snippet(text, t.index, t.raw.length);
  }
  return null;
}

// 수 여럿 답: 정답 배열의 수들이 쉼표·띄어쓰기·가운뎃점으로 이어진 채 그 차례로 글에 나오는가(앞뒤가 다른 수의 일부가 아닐 때).
function numbersHit(answer, text) {
  const s = normalizeInput(text);
  const body = answer.value.map((n) => String(n).replace('-', String.raw`\-`)).join(String.raw`[,\s·]+`);
  const m = new RegExp(String.raw`(?<![\d.])` + body + String.raw`(?![\d])`).exec(s);
  return m ? snippet(s, m.index, m[0].length) : null;
}

// 보기 답: 정답 보기의 글이 나오는 덩어리들. 다른 보기의 글이 어디에든 나오면 빈 배열(정답만 불린 것이 아니다).
function choiceHits(answer, sources) {
  const correct = answer.options.find((o) => o.id === answer.value)?.label;
  if (!isStr(correct)) return [];
  const others = answer.options.filter((o) => o.id !== answer.value).map((o) => o.label);
  if (sources.some((src) => others.some((label) => src.text.includes(label)))) return [];
  return sources.filter((src) => src.text.includes(correct)).map((src) => ({ src, hit: snippet(src.text, src.text.indexOf(correct), correct.length) }));
}

// 낱말 답: 정답(또는 accept)이 글에 그대로 들어 있는 덩어리들. 견주기는 채점과 같다(공백·대소문자·NFC 무시).
function termHits(answer, sources) {
  const forms = [answer.value, ...(Array.isArray(answer.accept) ? answer.accept : [])].map(normalizeTerm).filter((s) => s !== '');
  const out = [];
  for (const src of sources) {
    const squashed = normalizeTerm(src.text);
    if (!forms.some((f) => squashed.includes(f))) continue;
    const at = Math.max(0, src.text.toLowerCase().indexOf(String(answer.value).toLowerCase()));
    out.push({ src, hit: snippet(src.text, at, String(answer.value).length) });
  }
  return out;
}

// 점의 값이 <title>(마우스 올리기·길게 누르기)로 샌다: 문항 앞에 보이는 points 그림의 점 좌표가 그 numbers 문항의 정답과 같은데 그림에 hideValues 가 없으면 경고.
// 좌표는 [x, y](수직선 numberLine 은 [x] 하나). 문항 앞 = 같은 장면의 앞 블록(visibleBefore 와 같은 범위).
export function pointValueWarnings(mod) {
  const out = [];
  for (const item of leakItems(mod, { all: true })) {
    const { answer } = item;
    if (answer.kind !== 'numbers') continue;
    const want = JSON.stringify(answer.value);
    item.scene.blocks.slice(0, item.blockIndex).forEach((b) => {
      if (b.type !== 'figure') return;
      const def = mod.figures?.[b.figure];
      if (def?.kind !== 'points' || def.hideValues === true) return;
      for (const s of def.series ?? []) {
        for (const pt of s.points ?? []) {
          const coord = def.numberLine === true ? [pt[0]] : pt.slice(0, 2);
          if (JSON.stringify(coord) === want) { out.push(`${item.key}: 정답 [${answer.value.join(', ')}] 이 그림 ${b.figure}(${b.id})의 점 좌표와 같다 — 점의 <title> 로 답이 보인다. 그림에 "hideValues": true 를 켜세요`); return; }
        }
      }
    });
  }
  return [...new Set(out)];
}

// 경고 목록: [{ key, sceneId, blockId, answer: '<정답 표시>', kind, where, text }]
export function answerLeaks(mod) {
  const units = moduleUnits(mod);
  const out = [];
  for (const item of leakItems(mod)) {
    const { answer } = item;
    const shown = answer.kind === 'number'
      ? `${formatNumber(answer.value)}${answer.unit ?? ''}`
      : answer.kind === 'numbers' ? answer.value.join(', ')
      : answer.kind === 'term' ? answer.value : (answer.options.find((o) => o.id === answer.value)?.label ?? String(answer.value));
    const sources = visibleBefore(mod, item);
    const hits = answer.kind === 'number'
      ? sources.map((src) => ({ src, hit: numberHit(answer, src.text, units) })).filter((x) => x.hit !== null)
      : answer.kind === 'numbers' ? sources.map((src) => ({ src, hit: numbersHit(answer, src.text) })).filter((x) => x.hit !== null)
      : answer.kind === 'term' ? termHits(answer, sources.filter((src) => src.kind !== 'feedback' && src.kind !== 'own'))
        : choiceHits(answer, sources.filter((src) => src.kind !== 'feedback' && src.kind !== 'own'));
    for (const { src, hit } of hits) out.push({ key: item.key, sceneId: item.sceneId, blockId: item.blockId, answer: shown, kind: src.kind, where: src.where, text: hit });
  }
  return out;
}

const KIND_NAMES = { condition: '조건 한 줄', unit: '본문 단위', 'help-note': '다른 설명', figure: '그림 글자', alt: '그림의 텍스트 대체', link: '연결 단계', prompt: '지시문', feedback: '다른 문항의 오개념 피드백', own: '자기 오개념 피드백' };

// unitWarnings() 와 같은 꼴의 문자열 목록.
export function answerLeakWarnings(mod) {
  return answerLeaks(mod).map((w) => `${w.key}: 정답 ‘${w.answer}’이 ${w.kind === 'feedback' || w.kind === 'own' ? '' : '문항 앞의 '}${KIND_NAMES[w.kind]}(${w.where})에 나온다 — “${w.text}”`);
}

// leakOk 로 끈 문항: [{ key, reason }]
export function leakAcknowledged(mod) {
  return leakItems(mod, { all: true }).filter((i) => isStr(i.own.leakOk)).map((i) => ({ key: i.key, reason: i.own.leakOk.trim() }));
}

// 형식 검증: leakOk 는 이유를 적은 문자열이어야 한다(그냥 true 로 끄지 못한다).
export function checkLeakFields(mod) {
  return leakItems(mod, { all: true })
    .filter((i) => i.own.leakOk !== undefined && !isStr(i.own.leakOk))
    .map((i) => `${i.key}: leakOk 는 왜 의도된 것인지 적은 문자열이어야 한다`);
}

// 작성 점검(경고): 보기 문항의 오답 보기마다 '왜 아닌지' 피드백이 있는가. 대상은 위와 같다(check·problem·transfer).
// 틀린 보기를 다시 고를 수 없게 했으므로, 피드백이 없는 보기는 '틀렸다'는 말만 남기고 사라진다.
export function choiceFeedbackGaps(mod) {
  const out = [];
  for (const item of leakItems(mod, { all: true })) {
    if (item.answer.kind !== 'choice') continue;
    const covered = new Set((item.own.misconceptions ?? []).filter((m) => m.match?.kind === 'choice').map((m) => m.match.value));
    const missing = item.answer.options.map((o) => o.id).filter((id) => id !== item.answer.value && !covered.has(id));
    if (missing.length > 0) out.push({ key: item.key, sceneId: item.sceneId, missing });
  }
  return out;
}

// 여는 카드(opener)의 글이 본문 뒤 문항의 정답을 새는가(경고): 그림의 글자 · 대체 글 · 질문 · 보기 · 오답 설명 · 까닭 속의 수가 다른 문항의 숫자 답과 같거나,
// 보기의 글이 다른 문항의 정답 보기와 같거나, 낱말 답(두 글자 이상)이 글에 들어 있으면 걸린다. 대상 문항은 본문(check · problem · link · round)과 시작 전 · 며칠 뒤 · 건너뛰기 확인 · 복습 전부다.
// 여는 카드는 본문 앞이라 뒤 문항의 답을 미리 알려 줄 수 있고, 같은 값이 끝 화면의 다시 보기에 겹치면 처음 답의 비교가 흐려진다.
const figureTexts = (def) => (def.kind === 'table'
  ? [def.caption, ...def.columns, ...def.rows.flat()]
  : def.kind === 'image' ? [def.alt, def.caption]
  : def.kind === 'points' ? [def.alt, def.x?.label, def.y?.label, ...(def.series ?? []).map((s) => s.label)]
    : [def.title, def.xLabel, def.yLabel, ...(def.series ?? []).map((s) => s.label)]).filter(isStr);

export function openerLeakWarnings(mod) {
  const op = mod.opener;
  if (!op || !op.answer) return [];
  const units = moduleUnits(mod);
  const texts = [
    ...figureTexts(mod.figures?.[op.figure] ?? {}).map((t) => ['그림', t]), ['대체 글', op.alt], ['질문', op.prompt],
    ...(op.answer.options ?? []).map((o) => ['보기', o.label]), ['까닭', op.solution], ...(op.misconceptions ?? []).map((m) => ['오답 설명', m.feedback]),
  ].filter(([, t]) => isStr(t));
  const out = [];
  for (const { key, item } of choiceItems(mod, { all: true })) {
    if (key === 'opener') continue;
    const a = item.answer;
    if (a.kind === 'number') {
      for (const [where, text] of texts) {
        for (const tok of numberTokens(text)) {
          if (tok.value !== a.value) continue;
          const otherUnit = units.find((u) => u !== a.unit && tok.rest.startsWith(u));
          if (a.unit && otherUnit) continue;
          out.push(`${where}의 수 ${tok.raw} 이 문항 ${key} 의 정답 값과 같다`);
        }
      }
    } else if (a.kind === 'choice') {
      const label = a.options.find((o) => o.id === a.value)?.label;
      if (isStr(label) && (op.answer.options ?? []).some((o) => normalizeTerm(o.label) === normalizeTerm(label))) out.push(`보기 ‘${label}’ 이 문항 ${key} 의 정답 보기와 같다`);
    } else if (a.kind === 'term') {
      for (const form of [a.value, ...(a.accept ?? [])].map(normalizeTerm).filter((f) => f.length >= 2)) {
        for (const [where, text] of texts) if (normalizeTerm(text).includes(form)) out.push(`${where}에 문항 ${key} 의 낱말 답 ‘${form}’ 이 들어 있다`);
      }
    }
  }
  return [...new Set(out)];
}
