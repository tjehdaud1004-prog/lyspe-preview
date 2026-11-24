// 진입점: 모듈 데이터를 불러와 검증하고, 화면 부품들을 조립한다. 과목 지식은 여기에도 없다.
import { h, clear } from './dom.js';
import { validateModule } from '../core/module.js';
import { createStorage, createMemoryBackend, probeBackend, keys } from '../core/storage.js';
import { defaultSettings, sanitizeSettings } from '../core/settings.js';
import { setPhase, addElapsed, hasProgress, moveTo } from '../core/progress.js';
import { flattenSteps } from '../core/module.js';
import { createSession } from './session.js';
import { createInputGuard } from './input-guard.js';
import { createToaster, createAnnouncer } from './toast.js';
import { createHelp } from './help.js';
import { createNote } from './note.js';
import { createReader } from './reader.js';
import { createLayout } from './layout.js';
import { createSelectionBar } from './selection.js';
import { createEnd } from './end.js';
import { createSettingsDialog } from './settings.js';
import { askConfirm } from './dialog.js';
import { createRecording, NOTICE_SHORT } from './recording.js';
import { createProbeGate } from './probe.js';
import { closeProbe } from '../core/probe.js';
import { createSkipGate } from './skip.js';
import { createOpenerGate } from './opener.js';
import { closeOpener } from '../core/opener.js';
import { closeSkip, jumpTarget, skippedScenes } from '../core/skip.js';
import { createReviewGate } from './review.js';
import { createReviewStore } from '../core/review.js';
import { createReviewPlanner } from '../core/review-plan.js';
import { createElapsedMeter } from '../core/elapsed.js';
import { createAiClient } from '../core/ai/client.js';
import { resolveProvider } from '../core/ai/config.js';
import { createAiAsk } from './ai-ask.js';
import { setQuestionTextAvailable } from '../core/telemetry.js';
import { checkKind, KINDS } from '../data/kinds.mjs';
import { showHome } from './home.js';

const TIME_FLUSH_MS = 10_000;
const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// 오류 화면: 조용히 다른 모듈을 열지 않는다. 늘 목록으로 가는 링크를 둔다(주소에서 ?m= 을 뗀 같은 위치).
function showFatal(root, title, lines) {
  clear(root).append(h('main', { class: 'fatal', id: 'main' },
    h('h1', { text: title }),
    h('ul', {}, ...lines.map((l) => h('li', { text: l }))),
    h('p', {}, h('a', { class: 'btn', href: './' }, '모듈 목록으로 가기'))));
}

function readStoredSettings(storage) {
  try { return JSON.parse(storage.read(keys.settings())); } catch { return null; }
}

function applySettings(settings) {
  const root = document.documentElement;
  if (settings.theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = settings.theme;
  root.dataset.fontScale = String(settings.fontScale);
}

// 이 화면 코드에서 네트워크를 쓰는 곳은 여기 하나다: 같은 출처의 json(모듈 목록 modules/index.json, 모듈 modules/<id>/module.json).
async function loadJson(path, what) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${what}을 불러오지 못했습니다 (${response.status})`);
  return response.json();
}

export async function main() {
  const root = document.getElementById('app');
  // 저장소: localStorage 를 못 쓰면 메모리로 대신하고 그 사실을 알린다.
  let backend = null;
  try { backend = probeBackend(window.localStorage); } catch { backend = null; }
  const storageOk = backend !== null;
  const storage = createStorage(backend ?? createMemoryBackend());

  // 주소에 ?m= 이 없으면 모듈 목록. 있으면 그 모듈 하나(꼴이 틀리거나 없으면 오류 화면 — 다른 모듈로 바꿔 열지 않는다).
  const params = new URLSearchParams(location.search);
  if (!params.has('m')) {
    try {
      const lines = await loadJson('modules/index.json', '모듈 목록');
      if (!Array.isArray(lines)) throw new Error('모듈 목록 파일의 꼴이 올바르지 않습니다');
      applySettings(sanitizeSettings(readStoredSettings(storage), defaultSettings()));
      showHome({ root, lines, storage, applySettings });
    } catch (error) {
      showFatal(root, '모듈 목록을 열 수 없습니다', [String(error.message ?? error)]);
    }
    return;
  }
  const id = params.get('m');
  if (!MODULE_ID_PATTERN.test(id)) {
    showFatal(root, '모듈을 열 수 없습니다', [`주소의 모듈 이름 ‘${id.slice(0, 60)}’ 의 꼴이 맞지 않습니다. 소문자·숫자·하이픈만 쓸 수 있습니다.`]);
    return;
  }
  let mod;
  try {
    mod = await loadJson(`modules/${id}/module.json`, '모듈 파일');
  } catch (error) {
    showFatal(root, '모듈을 열 수 없습니다', [`모듈 ‘${id}’: ${String(error.message ?? error)}`]);
    return;
  }
  if (mod === null || typeof mod !== 'object' || mod.id !== id) {
    showFatal(root, '모듈을 열 수 없습니다', [`폴더 이름 ‘${id}’ 과 모듈 파일의 id ‘${String(mod?.id).slice(0, 60)}’ 가 다릅니다. 둘이 같아야 저장된 진행과 맞습니다.`]);
    return;
  }
  const check = validateModule(mod);
  if (!check.ok) { showFatal(root, '모듈 데이터에 문제가 있습니다', check.errors.slice(0, 12)); return; }
  const kindProblem = checkKind(mod);
  if (kindProblem) { showFatal(root, '모듈 데이터에 문제가 있습니다', [kindProblem]); return; }
  // 먼저 해 보기를 권하는 모듈(needs)의 제목: 문턱 판의 권하는 글에 쓴다. 목록을 못 읽어도 모듈은 연다(그때는 id 로 대신한다).
  let moduleTitles = new Map();
  if ((Array.isArray(mod.needs) && mod.needs.length > 0) || typeof mod.next === 'string') {
    try {
      const lines = await loadJson('modules/index.json', '모듈 목록');
      if (Array.isArray(lines)) moduleTitles = new Map(lines.filter((line) => typeof line?.id === 'string' && typeof line?.title === 'string').map((line) => [line.id, line.title]));
    } catch { moduleTitles = new Map(); }
  }

  // 사슬의 다음 모듈(모듈 머리의 next): 끝 화면의 ‘다음: …’ 단추와 건너뛰기 확인의 ‘이 모듈을 건너뛰고 다음으로’가 쓴다.
  const nextHref = typeof mod.next === 'string' ? `?m=${encodeURIComponent(mod.next)}` : null;
  const nextModule = nextHref ? { id: mod.next, title: moduleTitles.get(mod.next) ?? mod.next, href: nextHref } : null;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const session = createSession({ mod, storage, reducedMotion });
  applySettings(session.settings);

  const guard = createInputGuard();
  const announce = createAnnouncer(document.body);
  const toast = createToaster(document.body);
  // 학습 기록: 기본은 꺼짐. 켜면 이 기기 안(localStorage)에만 남고 어디로도 보내지 않는다.
  // 학습 전담 AI 의 연결부: 서비스를 정하는 곳은 core/ai/config.js 한 곳이다. 지금은 연결된 서비스가 없다(로컬의 ?ai=fake 만 가짜 응답기).
  // 서비스가 없으면 질문 칸도, '질문 글도 남기기' 스위치도 켜지지 않는다. 동의를 읽기 전에 정해 둬야 한다.
  const aiClient = createAiClient({ provider: resolveProvider({ search: location.search, hostname: location.hostname }) });
  setQuestionTextAvailable(aiClient.available);
  // 처음 열 때의 기록 안내는 한 번에 하나만 보이게 본문 밖 묶음처럼 앞에 둔다: 안내가 닫히면 그다음(시작 전 문항 → 본문)이 열린다.
  let noticePending = false;
  let afterNotice = () => {};
  const recording = createRecording({ mod, storage, storageOk, onOpenSettings: () => settingsDialog.open(), onNoticeDone: () => { if (noticePending) { noticePending = false; afterNotice(); } } });
  const rec = recording.rec;
  // 복습 일정(data/review.mjs)과 회차 상태. 복습 받기를 끄면 일정·기록·내보내기가 모두 멈춘다.
  const planner = createReviewPlanner({ mod, store: createReviewStore({ storage, mod }), storage, rec, getProgress: () => session.progress, getSettings: () => session.settings });
  const ai = createAiAsk({ client: aiClient, mod, session, rec, announce });
  const help = createHelp({ mod, session, announce, rec, toast, ai });
  const note = createNote({ session, guard, toast, rec });
  const settingsDialog = createSettingsDialog({ session, mod, recording, planner, onReviewChange: () => { reviewGate.refreshLine(); end.render(); } });

  const layoutRoot = h('div', { class: 'layout' });
  const progressLabel = h('p', { class: 'topbar-progress' });
  const reader = createReader({
    mod, session, guard, announce, toast, help, rec,
    moduleTitle: (moduleId) => moduleTitles.get(moduleId) ?? moduleId,
    moduleHref: (moduleId) => `?m=${encodeURIComponent(moduleId)}`,
    onStep(info) {
      progressLabel.textContent = `장면 ${info.sceneIndex + 1} / ${info.sceneCount}`;
      note.setCondition(info.condition);
      rec.setCurrentBlock(info.step.blockId);
    },
    onEnd() { session.update((s) => setPhase(s, 'final', session.now())); },
  });
  const layout = createLayout({ root: layoutRoot, note, session, rec });
  // 글을 고르면 위에 뜨던 띠(노트에 붙이기 · 이 문장 도움)는 사용자가 방해라고 해 일단 끈다(U-1124d, 2026-11-24). 다듬은 뒤 다시 켤 때 true 로.
  const SELECTION_BAR_ON = false;
  const selection = SELECTION_BAR_ON ? createSelectionBar({ flow: reader.el, note, help }) : null;

  async function restart() {
    const { ok, checked } = await askConfirm({
      title: '처음부터 다시 볼까요?',
      body: '이 모듈에서 읽은 위치와 문항 기록, 적어 둔 답이 지워집니다. 설정은 그대로입니다.',
      checkbox: '노트(타이핑·손글씨)도 함께 지우기',
      okLabel: '처음부터', danger: true,
    });
    if (!ok) return;
    help.close({ restoreFocus: false });
    rec.moduleReset();
    // 본문 밖 문항 묶음이 열려 있으면 닫는다. 이미 본문을 본 사람에게 '시작하기 전' 문항을 다시 권하지 않게 표시해 둔다.
    const seenBody = hasProgress(session.progress);
    gate.cancel();
    openerGate.cancel();
    skipGate.cancel();
    reviewGate.cancel();
    planner.restart(); // 끝낸 회차·일정을 지우고 받은 일정함의 항목을 취소한다
    openBody({ remount: false });
    session.reset({ keepNotes: !checked });
    if (seenBody) {
      session.update((s) => closeProbe(s, 'pre', session.now(), 'na'), { silent: true });
      session.update((s) => closeSkip(s, session.now(), 'na'), { silent: true }); // 건너뛰기 확인도 같은 취급
      session.update((s) => closeOpener(s, 'na', session.now()), { silent: true }); // 여는 카드도 같은 취급(이미 본문을 본 사람에게 다시 권하지 않는다)
    }
    note.reload();
    reviewGate.refreshLine();
    resume.hidden = true;
    reader.mount();
    end.render();
    reader.setActive(true);
    updateHead();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  const end = createEnd({
    mod, session, announce, rec, planner, next: nextModule,
    onRestart: restart,
    onReviewStart() { if (reviewGate.openNow()) window.scrollTo({ top: 0, behavior: 'auto' }); },
    onReviewChange() { reviewGate.refreshLine(); },
    onReview() {
      rec.unitRevisit({ fromBlockId: reader.currentStepInfo().step.blockId, via: 'end' }); // 끝에서 앞 내용으로 되돌아가 본다
      session.update((s) => setPhase(s, 'reading'));
      reader.el.scrollIntoView({ block: 'start' });
    },
    onProbe() { if (gate.openDelayed()) window.scrollTo({ top: 0, behavior: 'auto' }); },
  });

  // 본문 밖에서 도움 없이 푸는 문항 묶음(시작하기 전·끝낸 뒤 며칠 지나). 열려 있는 동안 본문·끝 화면·조작 줄을 가린다(css/measure.css).
  let bodyOpen = false;
  const gate = createProbeGate({
    mod, session, rec, announce,
    onOpen() { main.dataset.gate = 'open'; },
    // 시작 전 문항이 닫히면 건너뛰기 확인을 권할 수 있는지 본다(열 순서: 시작 전·며칠 뒤 문항 → 건너뛰기 확인 → 복습 → 본문).
    // 며칠 뒤 문항(측정)이 복습보다 먼저다 — 복습이 측정 문항의 답을 알려 주지 않게.
    onClose(kind) { if (kind === 'pre' && skipGate.openAtLoad()) return; if (reviewGate.openAtLoad()) return; openBody(); },
  });
  // 건너뛰기 확인: 같은 방식으로 본문을 가린다. 닫히면 건너뛴 장면이 첫 장면이었을 때 읽는 위치를 그 뒤로 옮기고 본문을 연다.
  const skipGate = createSkipGate({
    mod, session, rec, announce,
    next: nextModule && { ...nextModule, go() { window.location.href = nextModule.href; } },
    onOpen() { main.dataset.gate = 'open'; },
    onClose() {
      const steps = flattenSteps(mod);
      const target = jumpTarget(steps, session.progress.step, mod, skippedScenes(session.progress));
      if (target !== session.progress.step) { session.update((s) => moveTo(s, target, steps.length - 1), { silent: true }); skippedAtStart = true; }
      openBody();
    },
  });
  // 여는 카드: 본문 앞 첫 카드 하나(그림 → 질문 · 보기). 있는 모듈은 시작 전 문항 · 건너뛰기 확인을 따로 열지 않고, 카드 아래 '이미 아는 내용이면' 줄로만 지금의 흐름에 들어간다.
  // 시작을 누르면 복습(열 수 있을 때) → 본문. 그 줄을 누르면 시작 전 문항 → 건너뛰기 확인 → 복습 → 본문(지금의 흐름 그대로).
  const openerGate = createOpenerGate({
    mod, session, rec, announce,
    onOpen() { main.dataset.gate = 'open'; },
    onClose(kind) {
      if (kind === 'link') { if (!gate.openAtLoad() && !skipGate.openAtLoad() && !reviewGate.openAtLoad()) openBody(); return; }
      if (reviewGate.openAtLoad()) return;
      openBody();
    },
  });
  // 복습 한 회차: 열 수 있는 복습이 있으면 본문 전에 권한다('나중에'는 이 접속 동안만 접는다). 열려 있는 동안 본문을 같은 방식으로 가린다.
  const reviewGate = createReviewGate({ planner, rec, announce, onOpen() { main.dataset.gate = 'open'; }, onClose() { openBody(); } });
  let skippedAtStart = false; // 건너뛰기로 읽는 위치를 옮기고 막 시작했다 — '이어서 보기' 안내를 내지 않는다

  const resume = h('div', { class: 'resume', role: 'status', hidden: true },
    h('p', { class: 'resume-text' }),
    h('div', { class: 'resume-actions' },
      h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => { resume.hidden = true; } }, '닫기'),
      h('button', { type: 'button', class: 'btn', onClick: () => restart() }, '처음부터')));

  // ---------- 조립 ----------
  const controls = h('div', { class: 'controls', role: 'group', 'aria-label': '진행 조작' });
  const { continueBtn, pauseBtn, helpBtn } = reader.controlButtons;
  // 조작 줄: 노트 · 도움 · 정지는 작고 옅게 한 무리(controls-aux), '계속'은 따로 오른쪽에(K04 A123 C6).
  reader.setControls(controls, { children: [h('div', { class: 'controls-row' }, h('div', { class: 'controls-aux' }, layout.noteButton, helpBtn, pauseBtn), continueBtn)] });

  // 모듈 머리: 본문이 시작되면 제목 한 줄로 줄이고, 누르면 지금 모양 그대로 펼친다(K04 A123 C2). 줄이는 것은 읽는 중(reading)일 때만 —
  // 끝 화면 · 복습 · 건너뛰기 · 시작 전 문항 화면에서는 손대지 않는다. 눌러서 바꾼 상태는 이 접속 동안만 기억한다(저장하지 않는다).
  const headMoreId = 'module-head-more';
  let headOpenByUser = false;
  const headToggle = h('button', {
    type: 'button', class: 'btn btn-quiet head-toggle', 'aria-controls': headMoreId, 'aria-expanded': 'false',
    onClick: () => { headOpenByUser = !headOpenByUser; updateHead(); },
  }, '중심 질문 펼치기');
  const headMore = h('div', { class: 'head-more', id: headMoreId },
    h('p', { class: 'kind-tag' }, h('span', { class: 'tag', text: KINDS.find((k) => k.id === mod.kind).name })),
    h('p', { class: 'eyebrow', text: '중심 질문' }),
    h('p', { class: 'central', text: mod.centralQuestion }),
    mod.prerequisites.length > 0 && h('details', { class: 'prereq' },
      h('summary', { text: '먼저 알고 있으면 좋은 것' }),
      h('ul', {}, ...mod.prerequisites.map((p) => h('li', { text: p })))));

  const main = h('main', { class: 'reader', id: 'main', tabindex: '-1' },
    h('header', { class: 'module-head' },
      h('div', { class: 'module-head-row' }, h('h1', { class: 'module-title', text: mod.title }), headToggle),
      headMore,
      reviewGate.lineEl),
    !storageOk && h('p', { class: 'storage-warning', role: 'status', text: '이 브라우저에서는 진행을 저장할 수 없습니다. 새로고침하면 처음으로 돌아갑니다.' }),
    recording.notice, gate.el, openerGate.el, skipGate.el, reviewGate.el, resume, selection?.el, reader.el, end.el, controls);

  function updateHead() {
    const reading = bodyOpen && session.progress.phase === 'reading';
    const folded = reading && !headOpenByUser;
    main.dataset.head = folded ? 'folded' : 'open';
    headMore.hidden = folded;
    headToggle.hidden = !reading;
    headToggle.setAttribute('aria-expanded', String(!folded));
    headToggle.textContent = folded ? '중심 질문 펼치기' : '접기';
  }

  updateHead();

  const topbar = h('header', { class: 'topbar' },
    h('p', { class: 'brand', text: 'LySpe' }),
    h('p', { class: 'topbar-title', text: mod.title }),
    progressLabel,
    h('div', { class: 'topbar-actions' },
      h('a', { class: 'btn btn-quiet', href: './' }, '모듈 목록'),
      h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => settingsDialog.open() }, '설정'),
      h('button', { type: 'button', class: 'btn btn-quiet topbar-restart', onClick: () => restart() }, '처음부터')));

  layoutRoot.append(topbar, h('div', { class: 'columns' }, main, note.el));
  clear(root).append(layoutRoot);
  document.title = `${mod.title} — LySpe`;

  // ---------- 상태 연결 ----------
  let lastPhase = session.progress.phase;
  let finishLogged = session.progress.finishedAt !== null; // 끝까지 본 기록(module_finish)은 모듈당 한 번만 남긴다
  session.on((what, detail) => {
    if (what === 'settings') {
      for (const change of detail ?? []) rec.settingChange(change);
      applySettings(session.settings);
      planner.sync(); // 시험 날짜가 바뀌었을 수 있다
      reviewGate.refreshLine();
      reader.onSettings();
      note.redrawInk();
      return;
    }
    if (what === 'reset') { lastPhase = session.progress.phase; finishLogged = false; return; }
    if (what !== 'progress') return;
    reader.refresh();
    help.refresh();
    if (session.progress.phase !== lastPhase) {
      lastPhase = session.progress.phase;
      if (lastPhase === 'summary' && !finishLogged) { finishLogged = true; rec.moduleFinish(); rec.sessionEnd('finished'); }
      if (lastPhase === 'summary') { planner.sync(); reviewGate.refreshLine(); } // 끝냈다 — 첫 복습 일정을 정한다
      end.render();
      reader.setActive(lastPhase === 'reading');
      updateHead();
      if (lastPhase !== 'reading') end.focusTitle();
    }
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => note.redrawInk());

  // 학습 기록 시작(켜져 있을 때만 무언가 남는다). 화면을 펼치기 전에 시작해야 session_start 가 unit_shown 보다 앞선다.
  recording.start(() => ({
    resumed: session.resumed,
    fromBlockId: session.resumed ? reader.currentStepInfo().step.blockId : undefined,
    layout: layout.layoutInfo(),
  }));

  // 본문 열기. 본문 밖 문항 묶음을 권하는 동안에는 미뤘다가 그것이 닫힐 때 연다(점진 표시·unit_shown 기록이 가려진 채 시작되지 않게).
  function openBody({ remount = true } = {}) {
    main.removeAttribute('data-gate');
    if (bodyOpen || !remount) {
      bodyOpen = true; updateHead();
      end.render(); // 정리 화면에 방금 푼 결과가 보이게 다시 그린다
      if (remount && session.progress.phase !== 'reading') end.el.scrollIntoView({ block: 'start' });
      return;
    }
    bodyOpen = true;
    reader.mount();
    end.render();
    reader.setActive(session.progress.phase === 'reading');
    updateHead();

    if (hasProgress(session.progress) && !skippedAtStart) {
      resume.querySelector('.resume-text').textContent = session.progress.phase === 'summary'
        ? '이어서 보기: 끝까지 본 기록이 있습니다.'
        : `이어서 보기: 지난번에 보던 곳(장면 ${reader.currentStepInfo().sceneIndex + 1})에서 다시 열었습니다.`;
      resume.hidden = false;
      requestAnimationFrame(() => (session.progress.phase === 'reading' ? reader.scrollToCurrent() : end.el.scrollIntoView({ block: 'start' })));
    }
  }
  const startFlow = ({ notice = null } = {}) => {
    planner.sync();
    reviewGate.refreshLine();
    if (openerGate.openAtLoad({ notice })) return;
    const bypass = openerGate.bypassesGates(); // 여는 카드가 있는 모듈: 시작 전 문항 · 건너뛰기 확인을 따로 열지 않는다(며칠 뒤 문항 · 복습은 그대로)
    if (!gate.openAtLoad({ notice, noPre: bypass }) && !(!bypass && skipGate.openAtLoad()) && !reviewGate.openAtLoad()) openBody();
  };
  afterNotice = () => { main.removeAttribute('data-gate'); startFlow(); };
  noticePending = !recording.notice.hidden;
  // 처음 여는 모듈에 시작 전 문항이 있으면 기록 안내를 따로 보이지 않고 그 안내 카드 한 장에 합친다(안내는 한 번에 한 장).
  const mergeNotice = noticePending && (openerGate.offersAtLoad() || (!openerGate.bypassesGates() && gate.offersPreAtLoad()));
  if (mergeNotice) {
    noticePending = false;
    recording.notice.hidden = true;
    startFlow({ notice: { text: NOTICE_SHORT, acknowledge: (record) => recording.acknowledgeNotice({ record }) } });
  } else if (noticePending) main.dataset.gate = 'open'; // 안내만 보이고 본문 · 머리말 · 노트는 가린다(css/measure.css)
  else startFlow();

  // ---------- 활동 시간(보여 주기만 함) ----------
  // 학습 기록과 같은 계산기(rec.activeNow — core/activity.js)를 읽는다: 입력이 오래 없던 구간의 초과분과 탭이 가려진 시간은 들어가지 않는다.
  // 기록 동의와 무관하게 돈다. 정리 화면과 본문 밖 문항 묶음을 푸는 동안은 세지 않는다.
  const meter = createElapsedMeter({ active: () => rec.activeNow() });
  let pendingMs = 0;
  const countTime = () => { if (noticePending) { meter.take(false); return; } pendingMs += meter.take(session.progress.phase !== 'summary' && !gate.isOpen() && !skipGate.isOpen() && !reviewGate.isOpen()); };
  const flushTime = () => {
    countTime();
    if (pendingMs > 0) { const ms = pendingMs; pendingMs = 0; session.update((s) => addElapsed(s, ms), { silent: true }); }
  };
  setInterval(() => {
    countTime();
    if (pendingMs >= TIME_FLUSH_MS) flushTime();
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { flushTime(); session.flush(); planner.sync(); } else reviewGate.refreshLine();
  });
  window.addEventListener('pagehide', () => { flushTime(); session.flush(); planner.sync(); });
  // 열어 둔 채 예정 시각이 지나는 경우를 위해 가끔 다시 본다(받은 일정함은 같은 내용이면 다시 쓰지 않는다).
  setInterval(() => { planner.sync(); reviewGate.refreshLine(); }, 30_000);
}

// 모듈 가져오기만 하는 곳(시험 등)에서는 화면을 만들지 않는다.
if (typeof document !== 'undefined' && document.getElementById('app')) {
  main().catch((error) => {
    console.error(error);
    showFatal(document.getElementById('app'), '화면을 만드는 중 문제가 생겼습니다', [String(error.message ?? error)]);
  });
}
