// 건너뛰기 확인과 건너뛴 장면. 순수 로직 — DOM·저장소·시계를 모른다(시각은 인자로 받는다).
//
// 이미 아는 학습자가 설명과 초기 연습을 건너뛸 수 있게 한다. 다만 건너뛰기의 이득은 입증되지 않았다 — 스스로 재 봐야 하는 가설이다
// (research/out/SKIP/종합.md). 그래서 이 기능은 '건너뛴 사람이 뒤에서 어떻게 했는지 재는 기록'과 한 묶음이다(기록은 data/schema.mjs 의 skip_* 이벤트).
//
// 규칙(조사에서 가져온 것):
//  1. 목표별로 따로 판정한다. 건너뛰기는 증거가 확보된 목표가 덮는 장면에만.
//  2. 판정은 도움·재시도·피드백이 없는 첫 응답으로만 한다(문항마다 답은 한 번, 힌트·풀이 없음, '모르겠다' 가능).
//  3. 목표의 문항을 모두 맞혀야 '건너뛸 수 있음'. 하나라도 틀리거나 모르면 '증거 부족'이다 — 사람을 판정하는 말이 아니라 그 장면에 대한 말이다.
//  4. 숫자만 바꾼 문항 둘을 증거 둘로 세지 않는다 → 한 목표 안의 문항은 form 이 서로 달라야 한다.
//  5. 고르기 문항만으로 목표를 통과시키지 않는다(한 목표의 문항이 모두 choice 면 모듈 검증 오류).
//  6. 건너뛰기는 잠정이다. 건너뛴 장면은 언제든 열 수 있고, 뒤의 '도움 없이 먼저' 문제와 '다시 풀어 보기'가 그 내용을 다시 묻는다.
//  7. 학습자가 고른다. 건너뛸 수 있어도 '모두 보기'를 고를 수 있다.
//  8. 확률·숙달을 보증하는 말을 쓰지 않는다.
//  9. 아래의 숫자(문항 수·상한)는 모두 근거 없는 출발점이다.
//
// 이 모듈에서 import 하는 것은 answer.js·probe.js 뿐이다(core/module.js 가 이 파일을 부르므로 되돌아 부르지 않는다).
import { grade, isAutoGraded, matchMisconception } from './answer.js';
import { probeDef } from './probe.js';

export const GOAL_KINDS = ['perform', 'explain', 'transfer'];
export const SKIP_RESULTS = ['correct', 'wrong', 'unknown'];
export const SKIP_STATUSES = ['started', 'declined', 'done', 'na']; // na: 권하지 않았다(시작 전 문항에서 놓친 것이 있거나, 이미 본문을 본 뒤)
export const VERDICTS = ['pass', 'insufficient'];
export const SCENE_CHOICES = ['skip', 'view'];
// 근거 없는 출발점이다 — 짧게 두려는 상한일 뿐이고 이 수가 맞다는 근거는 없다.
export const MAX_GOALS = 4;
export const MAX_GOAL_ITEMS = 3;
export const MAX_SKIP_ITEMS = 9;

export const SKIP_LABELS = Object.freeze({ correct: '맞음', wrong: '틀림', unknown: '모르겠다', not_asked: '묻지 않음' });

// 화면 문구. 한 곳에 모아 두고 시험이 '선택·평가 아님·답은 한 번·언제든 열 수 있음·다시 묻는다·잠정'을 알리는지, 금지어가 없는지 본다.
// 문구에 '숙달'·'합격'·'불합격'·'통과'·'%' 를 쓰지 않는다. '점수'는 "점수가 아닙니다" 꼴로만 쓴다.
export const SKIP_RULE_TEXT = '문제마다 답은 한 번만 낼 수 있고 힌트와 풀이는 없습니다. 모르면 ‘모르겠다’를 누르면 됩니다. 한 목표에서 맞지 않은 답이 나오면 그 목표의 남은 문제는 묻지 않습니다. 맞았는지는 다 풀고 나서 한꺼번에 알려 줍니다.';
export const SKIP_TEXT = Object.freeze({
  eyebrow: '건너뛸 수 있는지 확인',
  title: '건너뛸 수 있는지 확인하기 (선택)',
  offer: (n) => `이 모듈의 내용을 이미 알고 있다면, 본문에 없는 ${n}문제 이내로 확인하고 아는 장면은 건너뛸 수 있습니다. 선택이며 시험이나 평가가 아닙니다. 건너뛴 장면은 언제든 열 수 있고, 뒤의 문제에서 그 내용을 다시 묻습니다.`,
  provisional: '건너뛰기는 잠정입니다. 건너뛰어도 모듈 뒤쪽의 ‘도움 없이 먼저’ 문제와 며칠 뒤 ‘다시 풀어 보기’가 그 내용을 다시 묻습니다.',
  start: '확인해 보기',
  resume: '이어서 풀기',
  decline: '확인 없이 처음부터 보기',
  submit: '답 내기',
  unknown: '모르겠다',
  stop: '그만하고 본문 보기',
  itemRule: '답은 한 번만 낼 수 있습니다. 힌트와 풀이는 없습니다.',
  progress: (k, max) => `문제 ${k} (최대 ${max}문제)`,
  done: '답을 모두 남겼습니다. 아래는 이 화면이 본 결과이고 점수가 아닙니다. 건너뛰기는 잠정이며, 건너뛴 장면은 언제든 열 수 있습니다.',
  pass: '이 목표의 문제를 모두 맞혔습니다.',
  passScenes: (list) => `건너뛸 수 있는 장면: ${list.map((s) => `장면 ${s.no} ‘${s.title}’`).join(', ')}`, // 제목 뒤에 조사를 붙이지 않는다(받침에 따라 은·는이 갈린다)
  insufficient: '건너뛸 근거가 모이지 않았습니다. 이 장면은 본문에서 봅니다.',
  needOther: (s) => `장면 ${s.no} ‘${s.title}’은 다른 목표의 근거가 더 필요해 본문에서 봅니다.`,
  scenePick: (s) => `장면 ${s.no} ‘${s.title}’ 건너뛰기`,
  skipAndStart: '고른 장면을 건너뛰고 시작하기',
  skipModule: '이 모듈을 건너뛰고 다음으로', // 모듈 머리에 next 가 있고 모든 목표를 통과했을 때만
  skipModuleNote: (title) => `건너뛸 수 있는 장면을 모두 건너뛰고 다음 모듈 ‘${title}’로 갑니다. 건너뛰기는 잠정이며, 이 모듈은 언제든 다시 열 수 있습니다.`,
  viewAll: '모두 보고 시작하기',
  begin: '본문 시작하기',
  banner: '확인 문제를 풀고 건너뛴 장면입니다. 건너뛰기는 잠정이며, 뒤의 문제에서 이 내용을 다시 묻습니다.',
  jumped: (nos) => `장면 ${nos}를 건너뛰었습니다. ‘앞 장면 보기’로 언제든 열 수 있습니다.`,
  fold: (s) => `건너뛴 장면 ${s.no} ‘${s.title}’ — 펼치기`,
  returnOffer: (s) => `앞에서 건너뛴 장면 ${s.no} ‘${s.title}’에 이 내용이 있습니다.`,
  openScene: '그 장면 열기',
  endTitle: '건너뛰기 확인',
  endHead: '건너뛰기는 잠정입니다. 아래는 이 화면이 본 결과이고 점수가 아닙니다.',
  choiceSkip: '건너뜀',
  choiceView: '모두 봄',
  statusLine: { declined: '건너뛰기 확인: 풀다가 본문으로 갔습니다. 건너뛴 장면은 없습니다.', na: '' },
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const clone = (s) => structuredClone(s);
const FORM_PATTERN = /^[a-z]+(-[a-z]+)*$/;

// ---------- 모듈 데이터 ----------

// 정의. 없거나 형식이 틀리면 null.
export function skipDef(mod) {
  const def = mod?.skipCheck;
  return isObj(def) && Array.isArray(def.goals) && def.goals.length > 0 ? def : null;
}

const goalList = (mod) => skipDef(mod)?.goals.filter((g) => isObj(g) && Array.isArray(g.items)) ?? [];

export function skipItemIds(mod) {
  return new Set(goalList(mod).flatMap((g) => g.items.map((it) => it?.id)));
}

// 문항 id → 그 문항이 속한 목표(없으면 null).
export function goalOf(mod, itemId) {
  return goalList(mod).find((g) => g.items.some((it) => it?.id === itemId)) ?? null;
}

// 저장 데이터를 거를 때 쓰는 색인: 문항 → 목표, 목표 → 장면·문항, 장면 → 그 장면을 덮는 목표들.
export function skipIndex(mod) {
  const itemGoal = new Map();
  const goalScenes = new Map();
  const sceneGoals = new Map();
  for (const g of goalList(mod)) {
    goalScenes.set(g.id, Array.isArray(g.scenes) ? g.scenes.filter((s) => typeof s === 'string') : []);
    for (const it of g.items) itemGoal.set(it?.id, g.id);
    for (const s of goalScenes.get(g.id)) {
      if (!sceneGoals.has(s)) sceneGoals.set(s, []);
      sceneGoals.get(s).push(g.id);
    }
  }
  return { itemGoal, goalScenes, sceneGoals };
}

const sceneOrder = (mod) => (mod.scenes ?? []).map((s) => s.id);

// ---------- 형식 검사 ----------

// core/module.js 의 validateModule 이 자기 검사 함수(checkAnswer·checkGrading·checkItemTags)와 id 중복 검사(claim)를 넘겨 부른다.
// 장면·블록·문항의 id 형식·중복은 앞의 검사가 이미 봤다 — 여기서는 skipCheck 와 goals 연결만 본다.
export function validateSkip(mod, errors, { claim, checkAnswer, checkGrading, checkItemTags, idPattern }) {
  const def = mod.skipCheck;
  const scenes = Array.isArray(mod.scenes) ? mod.scenes : [];
  const sceneIds = scenes.map((s) => s?.id);
  const goalIds = new Set();

  if (def !== undefined) {
    if (!isObj(def)) { errors.push('skipCheck: 객체여야 한다'); }
    else {
      if (def.intro !== undefined && !isStr(def.intro)) errors.push('skipCheck.intro 는 문자열');
      if (!Array.isArray(def.goals) || def.goals.length < 1 || def.goals.length > MAX_GOALS) errors.push(`skipCheck.goals 는 1~${MAX_GOALS}개`);
      else {
        let total = 0;
        const covered = new Set();
        def.goals.forEach((g, gi) => {
          const gw = `skipCheck.goals[${gi}]`;
          if (!isObj(g)) { errors.push(`${gw}: 객체여야 한다`); return; }
          if (!isStr(g.id) || !idPattern.test(g.id)) errors.push(`${gw}: id 형식 오류`);
          else { claim(g.id, gw); goalIds.add(g.id); }
          if (!GOAL_KINDS.includes(g.kind)) errors.push(`${gw}: kind 는 ${GOAL_KINDS.join('|')}`);
          if (!isStr(g.label)) errors.push(`${gw}: label 필요`);
          if (!Array.isArray(g.scenes) || g.scenes.length < 1 || !g.scenes.every(isStr)) errors.push(`${gw}: scenes 는 장면 id 1개 이상의 배열`);
          else {
            if (new Set(g.scenes).size !== g.scenes.length) errors.push(`${gw}: scenes 에 중복이 있다`);
            g.scenes.forEach((sid) => {
              const si = sceneIds.indexOf(sid);
              if (si < 0) { errors.push(`${gw}: scenes 의 '${sid}' 는 없는 장면`); return; }
              if (si === scenes.length - 1) errors.push(`${gw}: 마지막 장면 '${sid}' 는 건너뛸 수 있는 장면에 넣을 수 없다`);
              if ((scenes[si].blocks ?? []).some((b) => b?.unaided === true)) errors.push(`${gw}: '도움 없이 먼저' 블록이 있는 장면 '${sid}' 는 넣을 수 없다(그곳이 다시 묻는 자리다)`);
              covered.add(sid);
            });
          }
          if (!Array.isArray(g.items) || g.items.length < 1 || g.items.length > MAX_GOAL_ITEMS) { errors.push(`${gw}: items 는 1~${MAX_GOAL_ITEMS}개`); return; }
          total += g.items.length;
          const forms = new Set();
          g.items.forEach((item, i) => {
            const w = `${gw}.items[${i}]`;
            if (!isObj(item)) { errors.push(`${w}: 객체여야 한다`); return; }
            if (!isStr(item.id) || !idPattern.test(item.id)) errors.push(`${w}: id 형식 오류`);
            else claim(item.id, w);
            if (!isStr(item.form) || !FORM_PATTERN.test(item.form)) errors.push(`${w}: form 은 소문자·하이픈 낱말(문항의 형태 이름)`);
            else if (forms.has(item.form)) errors.push(`${w}: form '${item.form}' 이 같은 목표의 다른 문항과 겹친다(숫자만 바꾼 문항 둘은 증거 둘이 아니다)`);
            else forms.add(item.form);
            if (!isStr(item.prompt)) errors.push(`${w}: prompt 필요`);
            checkItemTags(item, w, errors, null); // 문항은 장면 밖이라 focus 포함 검사가 없다
            if (checkAnswer(item.answer, `${w}.answer`, errors)) {
              if (!isAutoGraded(item.answer)) errors.push(`${w}: 건너뛰기 확인 문항은 number|choice|linear|term 만 쓴다(채점할 수 있어야 한다)`);
              checkGrading(item.answer, item.misconceptions, w, errors);
            }
            if (item.hints !== undefined) errors.push(`${w}: 건너뛰기 확인 문항에는 hints 를 둘 수 없다(다 푼 뒤 보여 줄 solution 만 쓴다)`);
            if (item.solution !== undefined && !isStr(item.solution)) errors.push(`${w}: solution 은 문자열`);
          });
          if (g.items.every((item) => item?.answer?.kind === 'choice')) errors.push(`${gw}: 문항이 모두 choice 다 — 고르기만으로 목표를 통과시키지 않는다`);
        });
        if (total > MAX_SKIP_ITEMS) errors.push(`skipCheck: 전체 문항은 ${MAX_SKIP_ITEMS}개 이하(지금 ${total}개)`);
        if (scenes.length > 0 && covered.size >= scenes.length) errors.push('skipCheck: 모듈의 모든 장면이 건너뛸 수 있는 장면이 된다');
      }
    }
  }

  // 뒤에서 다시 묻는 자리의 연결: 문제·전이 문제의 부분, 시작 전·며칠 뒤 문항.
  const checkLinks = (obj, w) => {
    if (!isObj(obj) || obj.goals === undefined) return;
    if (!Array.isArray(obj.goals) || obj.goals.length < 1 || !obj.goals.every(isStr)) { errors.push(`${w}: goals 는 목표 id 1개 이상의 배열`); return; }
    if (new Set(obj.goals).size !== obj.goals.length) errors.push(`${w}: goals 에 중복이 있다`);
    if (!isObj(def) || !Array.isArray(def.goals)) { errors.push(`${w}: skipCheck 가 없는데 goals 가 있다`); return; }
    for (const id of obj.goals) if (!goalIds.has(id)) errors.push(`${w}: goals 의 '${id}' 는 skipCheck.goals 에 없는 목표`);
  };
  scenes.forEach((scene, si) => (scene?.blocks ?? []).forEach((block, bi) => {
    if (block?.goals !== undefined && block.type !== 'problem' && block.type !== 'transfer') errors.push(`scenes[${si}].blocks[${bi}]: goals 는 문제·전이 문제의 부분에만 붙인다`);
    if (block?.type === 'problem' || block?.type === 'transfer') {
      if (block.goals !== undefined) errors.push(`scenes[${si}].blocks[${bi}]: goals 는 블록이 아니라 부분(parts[])에 붙인다`);
      (Array.isArray(block.parts) ? block.parts : []).forEach((part, pi) => checkLinks(part, `scenes[${si}].blocks[${bi}].parts[${pi}]`));
    }
  }));
  for (const field of ['preCheck', 'delayedCheck']) {
    (Array.isArray(mod[field]?.items) ? mod[field].items : []).forEach((item, i) => checkLinks(item, `${field}.items[${i}]`));
  }
}

// ---------- 권하기 ----------

// 시작 전 문항을 다 풀었는데 틀리거나 모르는 것이 하나라도 있는가(선수지식이 흔들리는 사람에게 건너뛰기를 권하지 않는다).
export function skipBlockedByPre(mod, state) {
  const def = probeDef(mod, 'pre');
  const rec = state.probes?.pre;
  if (!def || rec?.status !== 'done') return false;
  return def.items.some((item) => rec.answers?.[item.id] !== 'correct');
}

// 화면을 열 때 본문보다 먼저 보여 줄 건너뛰기 문. 없으면 null.
// started: 본문을 읽은 흔적이 있는가(core/progress.js 의 hasProgress). 이어 보기에서는 권하지 않는다.
// 시작 전 문항이 있으면 그것이 먼저다 — 아직 권해지지 않았거나 풀다 만 상태면 null.
// 시작 전 문항에서 놓친 것이 있으면 null(skipBlockedByPre — 상태를 na 로 닫고 기록을 남기는 것은 화면 쪽이 한다).
export function skipGateFor(mod, state, { started = false } = {}) {
  if (!skipDef(mod) || started || Number.isFinite(state.finishedAt)) return null;
  if (probeDef(mod, 'pre')) {
    const pre = state.probes?.pre?.status;
    if (pre === undefined || pre === 'started') return null;
    if (skipBlockedByPre(mod, state)) return null;
  }
  const rec = state.skip;
  if (!rec) return { resume: false, stage: 'offer' };
  if (rec.status === 'started') return { resume: true, stage: 'items' };
  if (rec.status === 'done' && rec.decidedAt === null && eligibleScenes(mod, state).length > 0) return { resume: true, stage: 'decide' };
  return null;
}

// ---------- 상태 전이 ----------

const blank = () => ({ status: 'started', startedAt: 0, endedAt: null, answers: {}, verdicts: {}, scenes: {}, decidedAt: null });

// 풀기 시작. 아직 한 번도 열지 않았을 때만 시작한다(이미 시작했으면 그대로 이어 풀고, 끝났거나 닫았으면 바꾸지 않는다).
export function startSkip(state, now = 0) {
  if (state.skip) return state;
  const next = clone(state);
  next.skip = { ...blank(), startedAt: now };
  return next;
}

// 문항 하나의 답. 한 번만 남는다(재시도 없음).
export function answerSkip(state, itemId, result) {
  const cur = state.skip;
  if (cur?.status !== 'started' || !SKIP_RESULTS.includes(result) || cur.answers[itemId] !== undefined) return state;
  const next = clone(state);
  next.skip.answers[itemId] = result;
  return next;
}

// 닫기: 'declined'(풀다가 본문으로 감 — 낸 답은 남는다) 또는 'na'(권할 때가 지났다). 끝낸 것은 바꾸지 않는다.
export function closeSkip(state, now = 0, status = 'declined') {
  if (!['declined', 'na'].includes(status)) return state;
  const cur = state.skip;
  if (cur?.status === 'done' || cur?.status === status) return state;
  const next = clone(state);
  next.skip = { ...blank(), startedAt: now, ...(cur ?? {}), status, endedAt: now, verdicts: {}, scenes: {}, decidedAt: null };
  return next;
}

// 한 목표의 지금까지: 'pass'(문항을 모두 맞힘) | 'insufficient'(맞지 않은 답이 나옴) | 'pending'(아직 물을 문항이 남음).
function goalProgress(goal, answers) {
  let allCorrect = true;
  for (const item of goal.items) {
    const a = answers[item.id];
    if (a === undefined) { allCorrect = false; continue; }
    if (a !== 'correct') return 'insufficient';
  }
  return allCorrect ? 'pass' : 'pending';
}

// 다음에 물을 문항: 목표 순서 → 문항 순서. 한 목표에서 맞지 않은 답이 나오면 그 목표의 남은 문항은 묻지 않는다(판정이 이미 정해졌다).
// { goal, item } 또는 null(다 물었다).
export function nextSkipItem(mod, state) {
  const answers = state.skip?.answers ?? {};
  for (const goal of goalList(mod)) {
    if (goalProgress(goal, answers) !== 'pending') continue;
    const item = goal.items.find((it) => answers[it.id] === undefined);
    if (item) return { goal, item };
  }
  return null;
}

// 물은 문항 수와 묻게 될 최대 문항 수(화면의 '문제 k · 최대 n문제').
export function skipCounts(mod, state) {
  const answers = state.skip?.answers ?? {};
  return { asked: Object.keys(answers).length, max: goalList(mod).reduce((s, g) => s + g.items.length, 0) };
}

// 끝내기: 목표마다 판정을 채운다. pass = 그 목표의 문항 전부가 correct.
export function finishSkip(mod, state, now = 0) {
  const cur = state.skip;
  if (cur?.status !== 'started') return state;
  const next = clone(state);
  const verdicts = {};
  for (const goal of goalList(mod)) verdicts[goal.id] = goal.items.every((it) => cur.answers[it.id] === 'correct') ? 'pass' : 'insufficient';
  next.skip.verdicts = verdicts;
  next.skip.status = 'done';
  next.skip.endedAt = now;
  return next;
}

// 건너뛸 수 있는 장면: 그 장면을 scenes 에 넣은 목표가 모두 pass 인 장면 id(모듈의 장면 순서).
export function eligibleScenes(mod, state) {
  const rec = state.skip;
  if (rec?.status !== 'done') return [];
  const { sceneGoals } = skipIndex(mod);
  return sceneOrder(mod).filter((id) => {
    const goals = sceneGoals.get(id);
    return Boolean(goals) && goals.length > 0 && goals.every((g) => rec.verdicts?.[g] === 'pass');
  });
}

// 학습자의 선택을 남긴다. choices: { 장면 id: 'skip'|'view' }. 건너뛸 수 없는 장면은 무시, 빠진 장면은 view.
export function decideSkip(mod, state, choices, now = 0) {
  const cur = state.skip;
  if (cur?.status !== 'done' || cur.decidedAt !== null) return state;
  const next = clone(state);
  const scenes = {};
  for (const id of eligibleScenes(mod, state)) scenes[id] = choices?.[id] === 'skip' ? 'skip' : 'view';
  next.skip.scenes = scenes;
  next.skip.decidedAt = now;
  return next;
}

export function skippedScenes(state) {
  return new Set(Object.entries(state?.skip?.scenes ?? {}).filter(([, v]) => v === 'skip').map(([id]) => id));
}

// 걸음 index 가 건너뛴 장면에 있으면, 건너뛰지 않은 첫 장면의 첫 걸음 번호. 아니면 index 그대로.
// steps: flattenSteps(mod). 끝까지 건너뛴 장면뿐이면(마지막 장면은 넣을 수 없으므로 일어나지 않는다) index 그대로.
export function jumpTarget(steps, index, _mod, skipped) {
  const step = steps[index];
  if (!step || !skipped.has(step.sceneId)) return index;
  for (let i = index + 1; i < steps.length; i += 1) if (!skipped.has(steps[i].sceneId)) return i;
  return index;
}

// 장면 번호 목록의 글: 이어진 구간은 2~5, 떨어져 있으면 2, 4.
export function formatSceneNos(nos) {
  const sorted = [...new Set(nos)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(j > i ? `${sorted[i]}~${sorted[j]}` : `${sorted[i]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

// '도움 없이 먼저' 블록 blockId 에서, 첫 답이 wrong·unknown 인 부분의 goals 가 가리키는 목표들이 덮는 장면 가운데 건너뛴 장면 id(중복 없이, 장면 순서).
// 그 블록의 모든 부분에 첫 답이 남기 전에는 빈 목록.
export function returnOffers(mod, state, blockId) {
  const skipped = skippedScenes(state);
  if (skipped.size === 0) return [];
  let block = null;
  for (const scene of mod.scenes ?? []) { const b = (scene.blocks ?? []).find((x) => x.id === blockId); if (b) block = b; }
  if (!block || (block.type !== 'problem' && block.type !== 'transfer') || block.unaided !== true || !Array.isArray(block.parts)) return [];
  const firsts = block.parts.map((p) => state.first?.[`${block.id}#${p.id}`]);
  if (firsts.some((f) => f === undefined)) return [];
  const { goalScenes } = skipIndex(mod);
  const ids = new Set();
  block.parts.forEach((part, i) => {
    if (firsts[i] !== 'wrong' && firsts[i] !== 'unknown') return;
    for (const g of part.goals ?? []) for (const s of goalScenes.get(g) ?? []) if (skipped.has(s)) ids.add(s);
  });
  return sceneOrder(mod).filter((id) => ids.has(id));
}

// 답 채점(probe 와 같다). invalid 는 '답으로 읽을 수 없음'이며 답으로 남기지 않는다.
export function gradeSkip(item, input) {
  const r = grade(input, item.answer, item.misconceptions ?? []);
  if (r.result === 'invalid') return { result: 'invalid', reason: r.reason, misconceptionIndex: -1 };
  if (r.result === 'correct') return { result: 'correct', misconceptionIndex: -1 };
  return { result: 'wrong', misconceptionIndex: matchMisconception(item.answer, r.value, item.misconceptions ?? []) };
}

// 정리용: 목표별 결과. 확인을 시작한 적이 없으면 null.
export function summarizeSkip(mod, state) {
  const def = skipDef(mod);
  const rec = state.skip;
  if (!def || !rec || rec.status === 'na') return null;
  const eligible = new Set(eligibleScenes(mod, state));
  const order = sceneOrder(mod);
  const titleOf = (id) => mod.scenes[order.indexOf(id)]?.title ?? id;
  const goals = goalList(mod).map((goal) => ({
    id: goal.id, label: goal.label, verdict: rec.verdicts?.[goal.id] ?? null,
    rows: goal.items.map((item) => ({ id: item.id, prompt: item.prompt, result: rec.answers?.[item.id] ?? 'not_asked', solution: item.solution ?? null })),
    scenes: (goal.scenes ?? []).filter((id) => order.includes(id)).map((id) => ({ id, title: titleOf(id), no: order.indexOf(id) + 1, eligible: eligible.has(id), choice: rec.scenes?.[id] ?? null })),
  }));
  return { status: rec.status, decided: rec.decidedAt !== null, goals };
}

// ---------- 저장 데이터 거르기 ----------

// idx: skipIndex(mod). 모르는 문항·목표·장면·값은 버린다. 판정이 pass 가 아닌 목표가 덮는 장면의 skip 은 버린다. 없거나 깨졌으면 null.
export function sanitizeSkip(raw, idx) {
  if (!isObj(raw) || !SKIP_STATUSES.includes(raw.status)) return null;
  const rec = {
    status: raw.status,
    startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : 0,
    endedAt: Number.isFinite(raw.endedAt) ? raw.endedAt : null,
    answers: {}, verdicts: {}, scenes: {}, decidedAt: null,
  };
  if (isObj(raw.answers)) {
    for (const [id, result] of Object.entries(raw.answers)) if (idx?.itemGoal?.has(id) && SKIP_RESULTS.includes(result)) rec.answers[id] = result;
  }
  if (rec.status !== 'done') return rec;
  if (isObj(raw.verdicts)) {
    for (const [id, v] of Object.entries(raw.verdicts)) if (idx?.goalScenes?.has(id) && VERDICTS.includes(v)) rec.verdicts[id] = v;
  }
  rec.decidedAt = Number.isFinite(raw.decidedAt) ? raw.decidedAt : null;
  if (rec.decidedAt !== null && isObj(raw.scenes)) {
    for (const [id, v] of Object.entries(raw.scenes)) {
      const goals = idx?.sceneGoals?.get(id);
      if (!goals || !SCENE_CHOICES.includes(v)) continue;
      const allPass = goals.every((g) => rec.verdicts[g] === 'pass');
      if (v === 'skip' && !allPass) continue;
      rec.scenes[id] = v;
    }
  }
  return rec;
}
