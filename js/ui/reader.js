// 읽기 흐름: 장면·글 단위·블록을 한 걸음씩 펼치고, '계속'·바로 펼치기·정지·자동 이어가기를 다룬다.
// 상태(어디까지 열렸나)는 session.progress.step 하나가 정본이고, 여기는 그것을 화면에 맞춘다.
import { h, clear, isInteractive } from './dom.js';
import { flattenSteps, conditionFor } from '../core/module.js';
import { advance, moveTo } from '../core/progress.js';
import { skippedScenes, jumpTarget, formatSceneNos, SKIP_TEXT } from '../core/skip.js';
import { isSceneShown, browseBy, sceneNav } from '../core/sceneview.js';
import { createRevisitTracker } from '../core/revisit.js';
import { createTyper, fillText } from './typing.js';
import { RAMP, FIRST_GAP_MS } from '../core/segment.js';
import { sentencePartsOf } from '../core/sentences.js';
import { renderBlock } from './blocks/index.js';
import { openPassageDialog } from './blocks/passage.js';
import { passageBefore, PASSAGE_TEXT } from '../core/passage.js';
import { recallVeils, ROUND_TEXT } from '../core/round.js';

const AUTO_CONTINUE_MS = 1400;
const REVISIT_CHECK_MS = 500; // 앞 글을 보고 있는지 살피는 간격(머문 시간 규칙은 core/revisit.js)

export function createReader(ctx) {
  const { mod, session, guard, announce } = ctx;
  const steps = flattenSteps(mod);
  const lastIndex = steps.length - 1;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const flow = h('div', { class: 'flow', id: 'flow' });
  const scenes = new Map();     // sceneIndex → { section, body }
  const textBlocks = new Map(); // blockId → 컨테이너 요소
  const handles = new Map();    // blockId → { el, resolved, refresh, focus }
  const stepEls = new Map();    // 단계 번호 → 그 단계의 요소(스크롤 대상)
  const unitDone = new Set();
  const expandedEarly = new Map(); // 단계 번호 → 다 나타나기 전에 바로 펼쳤는가(학습 기록 unit_done 용)
  const rec = ctx.rec;
  let typer = null;
  let typerEl = null;
  let drawing = null; // 지금 그려지는 그림 { done, queue } — 없으면 null
  let autoTimer = null;
  let controlsEl = null;
  let active = true; // 끝 화면에서는 읽기 조작 단추를 감춘다
  let browsing = null; // '장면별로 보기'에서 지금 장면 대신 보고 있는 지난 장면 번호(없으면 null)
  let lastView = session.settings.view;
  const expanded = new Set(); // '이어서 쌓기'에서 펼친 건너뛴 장면 번호
  const skipped = () => skippedScenes(session.progress); // 건너뛰기 확인으로 건너뛴 장면 id

  // ---------- 조각 만들기 ----------

  function sceneOf(sceneIndex) {
    let entry = scenes.get(sceneIndex);
    if (entry) return entry;
    const scene = mod.scenes[sceneIndex];
    const titleId = `scene-title-${scene.id}`;
    const body = h('div', { class: 'scene-body' });
    const title = h('h2', { class: 'scene-title', id: titleId, text: scene.title });
    const isSkipped = skipped().has(scene.id);
    // 건너뛴 장면: 머리에 띠를 달고, '이어서 쌓기'에서는 접힌 한 줄로 둔다(펼치면 skip_return).
    const section = h('section', { class: 'scene', 'aria-labelledby': titleId, dataset: { sceneId: scene.id, ...(isSkipped ? { skipped: 'true' } : {}) } },
      isSkipped && h('button', { type: 'button', class: 'btn skip-fold', onClick: () => openSkippedScene(scene.id, 'browse') }, SKIP_TEXT.fold({ no: sceneIndex + 1, title: scene.title })),
      // 장면 머리에는 제목만 둔다(K04 A123): '장면 n / N' 은 위 막대에 있고, 하는 일 딱지는 학습자 화면에서 뺐다(자료 scene.focus 와 집계 byTag 는 그대로).
      h('header', { class: 'scene-head' },
        title,
        isSkipped && h('p', { class: 'skip-banner', text: SKIP_TEXT.banner })),
      body);
    flow.append(section);
    entry = { section, body, title, titlePending: true, typedAny: false }; // titlePending: 제목을 아직 타자로 치지 않았다(K04 A143) · typedAny: 이 장면에서 타자로 나온 것이 있다
    scenes.set(sceneIndex, entry);
    return entry;
  }

  // ---------- 보기 방식(이어서 쌓기 / 장면별로 보기) ----------
  // 어느 장면이 보이는가는 core/sceneview.js 가 정한다. 숨기기만 하므로 진행·문항 상태·노트는 그대로다.

  const navLabel = h('p', { class: 'scene-nav-label', role: 'status', 'aria-live': 'polite' });
  const prevSceneBtn = h('button', { type: 'button', class: 'btn', onClick: () => browse(-1) }, '앞 장면 보기');
  const nextSceneBtn = h('button', { type: 'button', class: 'btn', onClick: () => browse(1) }, '뒤 장면 보기');
  const nowSceneBtn = h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => returnToCurrent({ scroll: true }) }, '지금 장면으로');
  const nav = h('nav', { class: 'scene-nav', 'aria-label': '장면 이동', hidden: true }, navLabel, h('div', { class: 'scene-nav-actions' }, prevSceneBtn, nextSceneBtn, nowSceneBtn));

  const currentScene = () => steps[session.progress.step].sceneIndex;

  // 앞 단위 옅게(K04 A123 B): 지금 단위(가장 최근 단위)보다 앞선 글 단위는 글자 색을 한 단계 낮춘다. 마우스를 올리거나 초점이 가면 원래 색(css/reader.css).
  // 그림 바로 앞의 글은 그림과 한 자리라 옅게 하지 않는다.
  function markPast() {
    const cur = session.progress.step;
    const now = steps[cur];
    let keepFrom = cur;
    if (now?.kind === 'block' && mod.scenes[now.sceneIndex].blocks[now.blockIndex].type === 'figure') {
      const prev = steps[cur - 1];
      if (prev?.kind === 'unit' && prev.sceneIndex === now.sceneIndex) {
        keepFrom = cur - 1;
        while (keepFrom > 0 && steps[keepFrom - 1].kind === 'unit' && steps[keepFrom - 1].blockId === prev.blockId) keepFrom -= 1;
      }
    }
    for (const [index, el] of stepEls) if (steps[index].kind === 'unit') el.classList.toggle('is-past', index < keepFrom);
  }

  function applyView() {
    const view = session.settings.view;
    const cur = currentScene();
    flow.dataset.view = view;
    markPast();
    for (const [sceneIndex, entry] of scenes) {
      entry.section.hidden = !isSceneShown({ view, sceneIndex, currentScene: cur, browsing });
      // 건너뛴 장면은 '이어서 쌓기'에서 접어 둔다(지금 읽는 장면과 펼친 장면은 제외).
      if (entry.section.dataset.skipped === 'true') entry.section.classList.toggle('is-folded', view === 'stack' && sceneIndex !== cur && !expanded.has(sceneIndex));
    }
    const info = sceneNav({ view, currentScene: cur, browsing, sceneCount: mod.scenes.length });
    nav.hidden = !info.visible || !active;
    if (!info.visible) return;
    navLabel.textContent = info.label;
    navLabel.hidden = info.atCurrent; // 지금 읽는 장면이면 위 막대의 '장면 n / N' 과 같은 글이라 한 번만 둔다. 지난 장면을 볼 때만 보인다
    prevSceneBtn.disabled = !info.canPrev;
    nextSceneBtn.disabled = !info.canNext;
    nowSceneBtn.hidden = info.atCurrent;
  }

  function browse(delta) {
    const next = browseBy({ view: session.settings.view, currentScene: currentScene(), browsing, delta });
    if (next === browsing) return;
    browsing = next;
    tracker.reset();
    // 지난 장면을 연 것은 그 자체가 앞 글 다시 보기다(장면 단위 — 그 장면 안에서 어느 블록을 봤는지는 남기지 않는다).
    if (browsing !== null) {
      rec.unitRevisit({ fromBlockId: currentStep().blockId, blockId: mod.scenes[browsing].blocks[0].id, via: 'scene' });
      // 건너뛴 장면으로 들어갈 때마다 한 번(skip_return) — 건너뛴 사람이 그 내용으로 돌아가 보는가
      if (skipped().has(mod.scenes[browsing].id)) rec.skipReturn({ sceneId: mod.scenes[browsing].id, trigger: 'browse' });
    }
    applyView();
    announce(`장면 ${(browsing ?? currentScene()) + 1}을 봅니다.`);
    nav.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }

  // 건너뛴 장면을 연다. trigger: browse(접힌 줄을 펼침) | offer('도움 없이 먼저' 자리의 알림 단추). 장면별로 보기면 그 장면으로 옮기고, 쌓기면 펼치고 스크롤한다.
  function openSkippedScene(sceneId, trigger) {
    const sceneIndex = mod.scenes.findIndex((sc) => sc.id === sceneId);
    const entry = scenes.get(sceneIndex);
    if (sceneIndex < 0 || !entry || sceneIndex >= currentScene()) return;
    if (session.settings.view === 'scene') {
      browsing = sceneIndex;
      tracker.reset();
      rec.unitRevisit({ fromBlockId: currentStep().blockId, blockId: mod.scenes[sceneIndex].blocks[0].id, via: 'scene' });
      applyView();
      announce(`장면 ${sceneIndex + 1}을 봅니다.`);
      nav.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    } else {
      expanded.add(sceneIndex);
      applyView();
      announce(`장면 ${sceneIndex + 1}을 폈습니다.`);
      entry.section.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
    rec.skipReturn({ sceneId, trigger });
  }

  // 지난 장면을 보다가 읽던 자리로 돌아온다('계속'·'도움'을 누를 때도 먼저 이쪽으로 돌아온다 — 새 글이 안 보이는 곳에서 나오지 않게).
  function returnToCurrent({ scroll = false } = {}) {
    if (browsing === null) return;
    browsing = null;
    applyView();
    if (scroll) stepEls.get(session.progress.step)?.scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }

  // ---------- 앞 글 다시 보기 기록(스크롤) ----------
  // 보는 띠(화면 가운데)에 든 블록과 화면에 보이는 블록을 IntersectionObserver 로 모으고, 규칙은 core/revisit.js 가 정한다.
  const order = new Map(); // blockId → 읽는 순서 번호
  steps.forEach((st) => { if (!order.has(st.blockId)) order.set(st.blockId, order.size); });
  const tracker = createRevisitTracker();
  const inBand = new Set();
  const inView = new Set();
  let bandObserver = null;
  let viewObserver = null;
  if (typeof IntersectionObserver === 'function') {
    const collect = (set) => (entries) => { for (const e of entries) { const id = e.target.dataset?.blockId; if (id) { if (e.isIntersecting) set.add(id); else set.delete(id); } } };
    bandObserver = new IntersectionObserver(collect(inBand), { rootMargin: '-35% 0px -35% 0px' });
    viewObserver = new IntersectionObserver(collect(inView));
  }
  const watchBlock = (el) => { bandObserver?.observe(el); viewObserver?.observe(el); };
  function checkRevisit() {
    if (!active || document.hidden || !bandObserver) return;
    if (browsing !== null) return; // 지난 장면을 보는 중: 장면을 열 때 이미 기록했다(via 'scene'). 같은 일을 스크롤로 또 세지 않는다
    const frontier = currentStep().blockId;
    for (const id of tracker.update({ now: performance.now(), inBand, order, frontier, frontierVisible: inView.has(frontier) })) {
      rec.unitRevisit({ fromBlockId: frontier, blockId: id, via: 'scroll' });
    }
  }
  setInterval(checkRevisit, REVISIT_CHECK_MS);

  function textBlockOf(step, block) {
    let el = textBlocks.get(block.id);
    if (!el) {
      el = h('div', { class: 'block block-text', dataset: { blockId: block.id, blockType: 'text' } });
      textBlocks.set(block.id, el);
      sceneOf(step.sceneIndex).body.append(el);
      watchBlock(el);
    }
    return el;
  }

  // instant: 이어 보기로 이미 열렸던 단계를 다시 펼치는 것(애니메이션·안내 없음).
  // track: 이 단계가 지금 학습자 앞에 새로 나온 것이라 학습 기록(unit_shown)을 남긴다.
  function showStep(index, { instant, track = !instant }) {
    const step = steps[index];
    const block = mod.scenes[step.sceneIndex].blocks[step.blockIndex];
    rec.blockShown(block.id);
    if (step.kind === 'block') {
      const handle = renderBlock(ctx, block);
      handles.set(block.id, handle);
      handle.el.tabIndex = -1; // 키보드로 이어 갈 때 초점을 받을 수 있게
      handle.el.dataset.step = String(index); // 걷기 도구가 읽는 표지(SPEC_WALK.md 끝의 표)
      handle.el.dataset.blockType = block.type;
      handle.el.setAttribute('role', 'group');
      handle.el.setAttribute('aria-label', blockKindName(block.type));
      const sc = sceneOf(step.sceneIndex);
      sc.titlePending = false; // 블록으로 시작한 장면은 제목이 바로 보인다
      sc.body.append(handle.el);
      watchBlock(handle.el);
      stepEls.set(index, handle.el);
      unitDone.add(index);
      applyVeil();
      if (!instant && block.type === 'figure' && session.settings.display !== 'instant' && !reducedMotion.matches) startDraw(handle);
      if (!instant) announce(`${blockKindName(block.type)}이 나왔습니다.`);
      return;
    }
    const text = block.units[step.unitIndex];
    const parts = sentencePartsOf(block, text); // 문장마다 줄을 바꿔 보인다(K04 A126). 나타나는 차례 · 시각은 그대로
    const p = h('p', { class: 'unit', dataset: { step: String(index), unit: String(step.unitIndex) } });
    textBlockOf(step, block).append(p);
    stepEls.set(index, p);
    const scene = sceneOf(step.sceneIndex);
    if (instant || session.settings.display === 'instant') {
      scene.titlePending = false; // 바로 보임: 제목도 바로
      fillText(p, text, parts);
      unitDone.add(index);
      if (track) rec.unitShown({ blockId: block.id, chars: text.length, mode: 'instant' });
      if (!instant) announce(text);
      afterUnitDone(index);
      return;
    }
    announce(text); // 눈에 보이는 글자는 aria-hidden 이므로, 단위 전체를 한 번만 알려 준다
    rec.unitShown({ blockId: block.id, chars: text.length, mode: 'typing' });
    const common = { getSpeed: () => session.settings.speed, getUnit: () => session.settings.unit, isHeld: () => guard.held(), onTick: followTyping };
    // 본문 글 단위를 친다. 장면의 첫 글(제목이 아니면 이 단위)이면 틈 · 느린 가속(K04 A143).
    const typeBody = (first) => {
      scene.typedAny = true;
      typerEl = p;
      typer = createTyper({
        el: p, text, parts, ...common,
        ...(first ? { ramp: RAMP.first, gap: FIRST_GAP_MS } : {}),
        onStateChange: (st) => {
          rec.unitStalled(st.paused || st.held);
          if (st.done) { rec.unitFullyShown(); expandedEarly.set(index, st.early); typer = null; unitDone.add(index); afterUnitDone(index); }
          updateControls();
        },
      });
      typer.start();
    };
    const begin = () => {
    if (!scene.titlePending) { typeBody(!scene.typedAny); return; }
    // 장면 제목도 같은 타자기로 먼저 친다(장면의 첫 글). 다 나오면 본문 첫 단위가 시작한다. 중간에 '바로 펼치기'면 본문도 바로 펼친다.
    scene.titlePending = false;
    scene.typedAny = true;
    typerEl = scene.title;
    typer = createTyper({
      el: scene.title, text: scene.title.textContent, ...common, ramp: RAMP.first, gap: FIRST_GAP_MS,
      onStateChange: (st) => {
        rec.unitStalled(st.paused || st.held);
        if (st.done) { typer = null; typeBody(false); if (st.early) typer.finish(); }
        updateControls();
      },
    });
    typer.start();
    };
    // 그림이 그려지는 동안이면 그리기가 끝난 뒤에 시작한다(그림 먼저 장면)
    if (!drawing) { begin(); return; }
    if (scene.titlePending) scene.title.style.visibility = 'hidden'; // 기다리는 동안 제목이 다 보였다가 지워지고 다시 쳐지지 않게
    drawing.queue.push(() => { scene.title.style.visibility = ''; begin(); });
  }

  // 그려지듯 나오기(K04 A144): 그림이 처음 나올 때 한 번. 그리는 동안은 글이 나오는 것과 같은 자리를 쓴다 —
  // '바로 펼치기'(= typer.finish)로 건너뛸 수 있고, 다음 글 단위는 그리기가 끝난 뒤 시작한다(drawing.queue).
  function startDraw(handle) {
    const d = handle.drawIn?.();
    if (!d) return;
    const mine = { done: false, queue: [] };
    drawing = mine;
    typerEl = null;
    typer = { drawing: true, state: () => ({ done: mine.done, paused: false, held: false, early: false }), finish: () => d.finish(), pause() {}, resume() {} };
    d.done.then(() => {
      if (drawing !== mine) return;
      mine.done = true;
      drawing = null;
      if (typer?.drawing) typer = null;
      for (const fn of mine.queue) fn();
      updateControls();
    });
  }

  function blockKindName(type) {
    return { check: '확인 문항', problem: '문제', transfer: '다른 상황 문제', link: '연결 단계', figure: '그림', predict: '예상 적기', audio: '음성', lookback: '예상 다시 보기', round: '문항 묶음', passage: '지문' }[type] ?? '내용';
  }

  // ---------- 떠올리기 묶음이 진행 중인 동안 앞 글 가리기 ----------
  // 뜻을 가리고 떠올리는 묶음이다 — 같은 장면의 앞 블록과 장면 머리를 hidden 으로 가리고(읽는 프로그램에도 안 읽힌다) 한 줄을 둔다. 마치거나 건너뛰면 다시 보인다.
  // 규칙(어느 블록이 가려지는가)은 core/round.js recallVeils 가 정한다. '앞 장면 보기'는 막지 않는다(unit_revisit via scene 이 남는다).
  const veiledEls = new Set();
  const veilNotes = new Map(); // 묶음 id → 한 줄 요소
  function applyVeil() {
    const live = recallVeils(mod, session.progress.rounds).filter((v) => handles.has(v.roundId));
    const wantEls = new Set();
    const wantNotes = new Set();
    for (const v of live) {
      for (const id of v.blockIds) { const el = handles.get(id)?.el ?? textBlocks.get(id); if (el) wantEls.add(el); }
      const scene = scenes.get(mod.scenes.findIndex((sc) => sc.id === v.sceneId));
      if (scene) { const head = scene.section.querySelector('.scene-head'); if (head) wantEls.add(head); }
      let note = veilNotes.get(v.roundId);
      if (!note) { note = h('p', { class: 'small veil-note', role: 'note', dataset: { stage: 'veiled', veilOf: v.roundId }, text: ROUND_TEXT.veiled }); veilNotes.set(v.roundId, note); handles.get(v.roundId).el.before(note); }
      wantNotes.add(v.roundId);
    }
    for (const el of veiledEls) if (!wantEls.has(el)) { el.hidden = false; veiledEls.delete(el); }
    for (const el of wantEls) { el.hidden = true; veiledEls.add(el); }
    for (const [id, note] of veilNotes) if (!wantNotes.has(id)) { note.remove(); veilNotes.delete(id); }
  }

  // ---------- 진행 ----------

  const currentStep = () => steps[session.progress.step];
  const isTyping = () => typer !== null && !typer.state().done;

  function canContinue() {
    const index = session.progress.step;
    const step = steps[index];
    if (step.kind === 'unit') return unitDone.has(index);
    return handles.get(step.blockId)?.resolved() ?? false;
  }

  // 건너뛴 직후 눈에 보이는 한 줄(지금 장면의 머리에 붙는다).
  function noteJump(sceneIndex, text) {
    sceneOf(sceneIndex).section.querySelector('.scene-head')?.append(h('p', { class: 'skip-jump-note', role: 'status', text }));
  }

  // byKeyboard: 키보드로 눌렀을 때만, 새로 나온 문항 블록으로 초점을 옮긴다(마우스·터치에서는 화면 키보드가 뜨지 않게 옮기지 않는다).
  function proceed({ byKeyboard = false } = {}) {
    clearTimeout(autoTimer);
    if (isTyping()) { typer.finish(); return; }
    if (!canContinue()) { ctx.toast.show('먼저 이 문항을 풀거나 ‘건너뛰기’를 눌러 주세요.'); return; }
    // 글 단위를 떠난다(다음으로 가거나 끝으로 간다): 이 단위를 보는 데 걸린 활동 시간을 기록한다.
    if (steps[session.progress.step].kind === 'unit') rec.unitDone({ expandedEarly: expandedEarly.get(session.progress.step) === true });
    if (session.progress.step >= lastIndex) { ctx.onEnd(); return; }
    browsing = null; // 지난 장면을 보고 있었어도 새 글은 지금 장면에서 나온다
    // 다음 걸음이 건너뛴 장면이면 건너뛰지 않은 첫 장면까지 한 번에 간다. 넘어간 걸음은 '바로 보임'으로 그려 두되(지난 장면 열기에서 볼 수 있게) 학습 기록은 남기지 않는다.
    const from = session.progress.step + 1;
    const target = jumpTarget(steps, from, mod, skipped());
    session.update((s) => (target === from ? advance(s, lastIndex) : moveTo(s, target, lastIndex)));
    let index = session.progress.step;
    for (let i = from; i < index; i += 1) showStep(i, { instant: true, track: false });
    if (index > from) {
      const text = SKIP_TEXT.jumped(formatSceneNos(steps.slice(from, index).map((st) => st.sceneIndex + 1)));
      announce(text);
      noteJump(steps[index].sceneIndex, text);
    }
    showStep(index, { instant: false });
    // 그림 먼저(figureFirst): 그림 걸음은 나타나자마자 글 단위로 이어 간다 — 그림이 장면 머리 바로 아래에 먼저 놓이고, 그 아래에 글이 써진다(그림은 움직이지 않는다). 화면은 그림 자리에 맞춘다.
    const shownAt = index;
    while (steps[index].lead === true && index < lastIndex) {
      session.update((s) => advance(s, lastIndex));
      index = session.progress.step;
      showStep(index, { instant: false });
    }
    applyView();
    ctx.onStep(stepInfo());
    scrollToStep(shownAt);
    updateControls();
    const step = steps[index];
    if (byKeyboard && step.kind === 'block') handles.get(step.blockId)?.el.focus({ preventScroll: true });
  }

  function afterUnitDone(index) {
    // 자동 이어가기: 다음이 글 단위일 때만. 문항·그림 앞에서는 항상 멈춘다.
    clearTimeout(autoTimer);
    const next = steps[index + 1];
    if (!session.settings.autoContinue || !next || next.kind !== 'unit' || index !== session.progress.step) return;
    const attempt = () => {
      if (index !== session.progress.step || !session.settings.autoContinue) return;
      if (guard.held() || document.hidden) { autoTimer = setTimeout(attempt, AUTO_CONTINUE_MS); return; }
      proceed();
    };
    autoTimer = setTimeout(attempt, AUTO_CONTINUE_MS);
  }

  function stepInfo() {
    const step = currentStep();
    return {
      index: session.progress.step, total: steps.length, step,
      sceneIndex: step.sceneIndex, sceneCount: mod.scenes.length,
      condition: conditionFor(mod, step.blockId),
    };
  }

  // ---------- 스크롤 ----------

  const visibleBottom = () => (controlsEl ? controlsEl.getBoundingClientRect().top : window.innerHeight);

  function scrollToStep(index) {
    if (guard.held()) return; // 입력 중에는 화면을 옮기지 않는다
    const el = stepEls.get(index);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // 문항 블록은 아래가 조작 줄에 가리면 안 된다: 아랫변이 조작 줄 위 여백(--controls-clear)을 넘으면 머리를 위에 맞춘다(화면보다 길면 어차피 머리가 위).
    const clear = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--controls-clear')) || 16;
    const covered = steps[index].kind === 'block' && rect.bottom > visibleBottom() - clear;
    if (rect.top < 72 || rect.top > visibleBottom() - 96 || covered) el.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }

  let lastFollow = 0;
  function followTyping() {
    if (guard.held() || !typerEl) return;
    const now = performance.now();
    if (now - lastFollow < 120) return;
    lastFollow = now;
    const rect = typerEl.getBoundingClientRect();
    if (rect.top > visibleBottom()) return; // 나타나는 글이 통째로 화면 아래에 있다 = 학습자가 앞 글을 보러 올라갔다. 도로 끌어내리지 않는다
    const overflow = rect.bottom - (visibleBottom() - 24);
    if (overflow > 0) window.scrollBy({ top: overflow, behavior: 'auto' });
  }

  // ---------- 조작 단추 ----------

  const continueBtn = h('button', { type: 'button', class: 'btn btn-primary btn-continue', dataset: { action: 'continue' }, onClick: (e) => proceed({ byKeyboard: e.detail === 0 }) }, '계속');
  const pauseBtn = h('button', { type: 'button', class: 'btn', hidden: true, dataset: { action: 'pause' }, onClick: () => { if (!typer) return; const st = typer.state(); if (st.paused) typer.resume(); else typer.pause(); } }, '정지');
  const helpBtn = h('button', {
    type: 'button', class: 'btn', 'aria-expanded': 'false', 'aria-controls': 'help-drawer', dataset: { action: 'help' },
    onClick: () => {
      returnToCurrent(); // 도움은 지금 읽는 블록 뒤에 열린다
      const step = currentStep();
      ctx.help.toggle({ blockId: step.blockId, helpKey: step.blockId, unitIndex: step.kind === 'unit' ? step.unitIndex : undefined, opener: helpBtn });
    },
  }, '도움');
  // 지문 보기: 같은 장면에서 지문 뒤의 블록을 하는 동안 조작 줄에 늘 있다. 누르면 지문이 겹쳐 뜨고, 닫으면 하던 자리로 돌아온다.
  const passageBtn = h('button', {
    type: 'button', class: 'btn', 'aria-haspopup': 'dialog', dataset: { action: 'passage' },
    onClick: () => {
      const step = currentStep();
      const passage = passageBefore(mod, step.blockId);
      if (passage) openPassageDialog(ctx, passage, { opener: passageBtn, from: step.blockId });
    },
  }, PASSAGE_TEXT.open);
  const passageBar = h('div', { class: 'controls-passage', hidden: true });
  const status = h('p', { class: 'controls-status small', role: 'status', 'aria-live': 'polite' });

  function updateControls() {
    if (!controlsEl) return;
    continueBtn.hidden = !active;
    helpBtn.hidden = !active;
    passageBtn.hidden = !active || passageBefore(mod, currentStep().blockId) === null;
    passageBar.hidden = passageBtn.hidden;
    if (!active) { pauseBtn.hidden = true; status.textContent = ''; return; }
    const typing = isTyping();
    const st = typing ? typer.state() : null;
    const atEnd = session.progress.step >= lastIndex;
    // 한 화면에 지금 할 일 하나(K04 A123 · A175, 사용자 기준 3 — 제작 판단): 문항 블록이 제 '도움'을 지니면 조작 줄의 '도움'은 숨긴다(같은 단추 둘).
    const onBlock = currentStep().kind === 'block';
    const ownHelp = onBlock && [...(stepEls.get(session.progress.step)?.querySelectorAll('[data-action="help"]') ?? [])].some((b) => !b.hidden && b.getClientRects().length > 0);
    helpBtn.hidden = ownHelp;
    continueBtn.textContent = typing ? '바로 펼치기' : atEnd ? '중심 질문으로 돌아가기' : '계속';
    const blocked = !typing && !canContinue();
    continueBtn.setAttribute('aria-disabled', String(blocked));
    continueBtn.classList.toggle('is-blocked', blocked);
    continueBtn.classList.toggle('is-typing', typing); // 글이 나타나는 동안의 '바로 펼치기'는 윤곽만(지금 단위보다 무겁지 않게)
    // 문항을 풀기 전에는 막힌 '계속'을 보이지 않는다 — 할 일은 문항 하나(풀거나 '모르겠다' · '건너뛰기'). 풀면 다시 나온다.
    const waitingOnBlock = blocked && onBlock;
    continueBtn.hidden = waitingOnBlock;
    pauseBtn.hidden = !typing || typer.drawing === true; // 그리는 동안은 '정지'가 없다(바로 펼치기만)
    pauseBtn.textContent = st?.paused ? '이어서 쓰기' : '정지';
    let text = '';
    if (st?.held) text = '입력 중이라 글이 잠시 멈췄습니다. 입력을 마치거나 ‘바로 펼치기’를 누르면 이어집니다.';
    else if (st?.paused) text = '정지했습니다.';
    else if (blocked && !waitingOnBlock) text = '문항을 풀거나 ‘건너뛰기’를 누르면 이어집니다.';
    if (status.textContent !== text) status.textContent = text;
  }

  // ---------- 화면 어디든 탭 / 스페이스 / Enter ----------

  function onDocumentClick(e) {
    if (!isTyping() || isInteractive(e.target)) return;
    if (!(e.target instanceof Element) || e.target.closest('.note, .topbar, dialog, .controls, .selection-bar')) return;
    if (String(window.getSelection?.() ?? '') !== '') return; // 글을 고르는 중이면 펼치지 않는다
    typer.finish();
  }

  function onDocumentKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    if (isInteractive(e.target)) return;
    if (e.key === ' ' && isTyping()) { e.preventDefault(); typer.finish(); return; }
    if (e.key === 'Enter' && (isTyping() || canContinue()) && session.progress.phase === 'reading') { e.preventDefault(); proceed({ byKeyboard: true }); }
  }

  // ---------- 공개 ----------

  function mount() {
    clear(flow);
    veiledEls.clear(); veilNotes.clear();
    scenes.clear(); textBlocks.clear(); handles.clear(); stepEls.clear(); unitDone.clear(); expandedEarly.clear(); expanded.clear();
    typer = null; typerEl = null; drawing = null; browsing = null;
    bandObserver?.disconnect(); viewObserver?.disconnect(); inBand.clear(); inView.clear(); tracker.reset();
    flow.append(nav);
    // 이어 보기: 이미 열린 단계는 모두 바로 펼친다. 처음 시작이면 첫 단위만 설정대로(점진 표시 등) 연다.
    // 학습 기록(unit_shown)은 지금 화면 앞에 있는 단계 하나에 대해서만 남긴다(이어 보기로 다시 펼친 앞 단계는 남기지 않는다).
    // 건너뛴 장면의 걸음은 이어 보기와 같이 '바로 보임'으로 그린다. 건너뛰기로 막 시작한 것(읽은 흔적 없이 건너뛴 장면만 앞에 있음)이면 닿은 걸음을 처음처럼 연다.
    const upTo = session.progress.step;
    const sk = skipped();
    const p = session.progress;
    const readSomething = p.phase !== 'reading' || Object.keys(p.items).length > 0 || Object.keys(p.help).length > 0 || Object.values(p.predicts).some((t) => t !== '') || Object.keys(p.rounds ?? {}).length > 0;
    const fresh = !readSomething && steps.slice(0, upTo).every((st) => sk.has(st.sceneId));
    for (let i = 0; i <= upTo; i += 1) showStep(i, { instant: !(fresh && i === upTo), track: i === upTo });
    if (fresh && upTo > 0) {
      const text = SKIP_TEXT.jumped(formatSceneNos(steps.slice(0, upTo).map((st) => st.sceneIndex + 1)));
      announce(text);
      noteJump(steps[upTo].sceneIndex, text);
    }
    applyView();
    ctx.onStep(stepInfo());
    updateControls();
  }

  ctx.isCurrentBlock = (blockId) => currentStep()?.blockId === blockId; // 문턱 판이 아직 지금 걸음인지 안다(ui/blocks/round.js)
  ctx.proceed = () => proceed(); // 문턱 판의 ‘그래도 계속’이 부른다(ui/blocks/round.js)
  ctx.openScene = openSkippedScene; // '도움 없이 먼저' 자리의 알림 단추가 부른다(ui/blocks/unaided.js)
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKey);

  return {
    el: flow,
    mount,
    setControls(el, { children }) {
      controlsEl = el;
      // '지문 보기'는 조작 줄(.controls-row)의 '정지' 앞에 끼운다. 그 줄이 없으면 따로 한 줄을 둔다.
      const row = children.find((c) => c?.classList?.contains('controls-row'));
      const aux = row?.querySelector('.controls-aux') ?? row; // 노트 · 도움 · 정지 한 무리(계속 단추와 따로)
      if (row) { aux.insertBefore(passageBtn, pauseBtn.parentElement === aux ? pauseBtn : null); el.replaceChildren(...children, status); } else { passageBar.append(passageBtn); el.replaceChildren(passageBar, ...children, status); }
      updateControls();
    },
    controlButtons: { continueBtn, pauseBtn, helpBtn },
    refresh() { handles.forEach((hd) => hd.refresh()); applyVeil(); updateControls(); },
    onSettings() {
      if (session.settings.display === 'instant' && isTyping()) typer.finish();
      if (!session.settings.autoContinue) clearTimeout(autoTimer);
      if (session.settings.view !== lastView) {
        lastView = session.settings.view;
        browsing = null;
        applyView();
        if (lastView === 'scene') stepEls.get(session.progress.step)?.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    },
    scrollToCurrent() { stepEls.get(session.progress.step)?.scrollIntoView({ block: 'center' }); },
    currentStepInfo: stepInfo,
    setActive(value) { active = value; applyView(); updateControls(); },
    updateControls,
    unitDone: (index) => unitDone.has(index),
    isTyping,
    stepCount: steps.length,
  };
}
