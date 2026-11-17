// 도움 서랍. 학습자가 열 때만 나오고(자동으로 끼어들지 않음), 현재 블록(또는 고른 문장)에 붙은 정해 둔 도움만 보여 준다.
// 서랍은 대상 블록 바로 아래로 옮겨 붙으므로, 열어도 위쪽 본문·노트의 위치는 바뀌지 않는다.
import { h, clear } from './dom.js';
import { findBlock, helpSpec } from '../core/module.js';
import { nextHelp, useHint, viewSolution, isResolved } from '../core/progress.js';
import { linkView } from '../core/link.js';
import { figureState } from '../core/figure-state.js';
import { helpGate, UNAIDED_LOCKED_MESSAGE } from '../core/unaided.js';
import { ROUND_TEXT } from '../core/round.js';
import { createEmergencyDisclosure } from './emergency.js';

export function createHelp({ mod, session, announce, rec, toast = null, ai = null }) {
  const el = h('section', { class: 'help', id: 'help-drawer', 'aria-labelledby': 'help-title', hidden: true });
  let target = null; // { blockId, helpKey, itemKey, unitIndex, selectedText?, opener }
  let emergencyOpen = false; // 긴급 안내를 펴 둔 채 서랍이 다시 그려져도 닫히지 않게

  const isOpen = () => !el.hidden;
  const same = (a, b) => a && b && a.blockId === b.blockId && a.helpKey === b.helpKey && a.unitIndex === b.unitIndex;

  function setExpanded(opener, value) { opener?.setAttribute('aria-expanded', value ? 'true' : 'false'); }

  function place() {
    const blockEl = document.querySelector(`[data-block-id="${CSS.escape(target.blockId)}"]`);
    if (blockEl) blockEl.after(el);
  }

  function ladder(helpKey, { shared = false } = {}) {
    const spec = helpSpec(mod, helpKey);
    const state = session.progress.help[helpKey] ?? { hints: 0, solution: false };
    const out = [];
    if (spec.hints.length === 0 && !spec.solution) return [h('p', { class: 'small', text: '이 부분에는 준비된 힌트가 없습니다.' })];
    if (shared) out.push(h('p', { class: 'small', text: '이 문제의 모든 부분이 힌트와 풀이를 함께 씁니다.' }));
    if (state.hints > 0) {
      out.push(h('ol', { class: 'hint-list' }, ...spec.hints.slice(0, state.hints).map((text, i) =>
        h('li', {}, h('span', { class: 'tag', text: `힌트 ${i + 1}` }), ` ${text}`))));
    }
    if (state.solution && spec.solution) {
      out.push(h('div', { class: 'solution' }, h('p', { class: 'tag', text: '풀이' }), h('p', { text: spec.solution })));
    }
    const next = nextHelp(session.progress, helpKey, spec);
    if (next) {
      const label = next.type === 'hint' ? `다음 힌트 보기 (${next.level}/${next.of})` : '풀이 보기';
      out.push(h('div', { class: 'ladder' },
        h('button', {
          type: 'button', class: 'btn', dataset: { focusId: 'ladder', action: 'help-next' },
          onClick: () => {
            if (next.type === 'hint') session.update((s) => useHint(s, helpKey, spec.hints.length));
            else session.update((s) => viewSolution(s, helpKey));
            rec.helpOpen({ blockId: target.blockId, helpKey, kind: next.type === 'hint' ? 'hint' : 'solution', level: next.type === 'hint' ? next.level : undefined, progress: session.progress });
            announce(next.type === 'hint' ? `힌트 ${next.level}을 열었습니다.` : '풀이를 열었습니다.');
          },
        }, label),
        next.type === 'solution' && h('p', { class: 'small', text: '풀이를 열면 이 문항은 기록에 ‘풀이를 본 뒤’로 남습니다.' })));
    }
    return out;
  }

  function linkReasons(block) {
    // 카드에서 이유가 보이는 단계만 서랍에도 보인다(같은 판정 — core/link.js). 빈칸을 풀기 전이거나 앞 단계가 남아 잠긴 단계의 이유는 뺀다.
    const view = linkView(block, (key) => isResolved(session.progress, key, key));
    const items = block.steps
      .filter((s, i) => view[i].showWhy)
      .map((s) => h('li', {}, h('span', { class: 'tag tag-why', text: '연결 이유' }), ` ${block.steps.indexOf(s) + 1}단계. ${s.why}`));
    return [h('h4', { class: 'help-sub', text: '왜 이 방법을 써도 되는가' }), h('ul', { class: 'reason-list' }, ...items)];
  }

  function body() {
    const found = findBlock(mod, target.blockId);
    if (!found) return [h('p', { text: '도움을 찾지 못했습니다.' })];
    const { block } = found;
    switch (block.type) {
      case 'check': return ladder(block.id);
      case 'problem':
      case 'transfer': return ladder(block.id, { shared: true });
      case 'round': return [h('p', { class: 'small', text: ROUND_TEXT.help })]; // 힌트·풀이 사다리가 없다 — ‘모르겠다’가 정답을 보는 길이다
      case 'link': return [...(target.itemKey ? ladder(target.itemKey) : []), ...linkReasons(block)];
      case 'text': {
        const list = (block.help ?? []).filter((x) => target.unitIndex === undefined || x.unit === undefined || x.unit === target.unitIndex);
        if (list.length === 0) return [h('p', { class: 'small', text: '이 부분에 붙은 다른 설명이 없습니다. 모르는 곳은 노트에 적어 두고 계속 읽어도 됩니다.' })];
        return list.map((x) => h('div', { class: 'help-note' }, h('p', { class: 'tag', text: x.title }), h('p', { text: x.body })));
      }
      // 값을 가려 둔 그림(revealAfter)은 그 문항이 풀리기 전에는 설명에서도 값을 말하지 않는다.
      case 'figure': return [h('p', { class: 'tag', text: '그림 설명' }), h('p', { text: figureState(mod, block, session.progress).alt })];
      default: return [h('p', { class: 'small', text: '이 부분에는 준비된 도움이 없습니다.' })];
    }
  }

  function render() {
    const focusId = el.contains(document.activeElement) ? document.activeElement.dataset?.focusId : null;
    clear(el);
    el.append(
      h('div', { class: 'help-head' },
        h('h3', { id: 'help-title', class: 'help-title', tabindex: '-1', text: '도움' }),
        h('button', { type: 'button', class: 'btn btn-quiet', dataset: { action: 'help-close' }, onClick: () => close(), text: '닫기' })),
      h('p', { class: 'small help-note-line', text: '미리 써 둔 안내입니다. AI 가 지금 답하는 것이 아닙니다.' }),
      ...body(),
      // 질문하기: 연결된 서비스가 있을 때만(없으면 null). 사다리 아래에 둔다.
      ...[ai?.node(target)].filter(Boolean),
      // 긴급 안내: 서비스 연결과 상관없이 언제나 서랍 맨 아래에 있다. 열었다는 사실만 기록하고 진행은 잠그지 않는다.
      createEmergencyDisclosure({
        open: emergencyOpen,
        onToggle: (opened) => {
          emergencyOpen = opened;
          if (opened) rec.helpOpen({ blockId: target.blockId, helpKey: target.helpKey, kind: 'emergency', progress: session.progress });
        },
      }));
    if (focusId) (el.querySelector(`[data-focus-id="${focusId}"]`) ?? el.querySelector('#help-title'))?.focus({ preventScroll: true });
  }

  function open(next) {
    // 도움 없이 먼저 하는 문제: 모든 부분에 첫 답이 남기 전에는 열지 않고 알려 주기만 한다(core/unaided.js).
    if (helpGate(mod, session.progress, next.blockId).locked) {
      if (toast) toast.show(UNAIDED_LOCKED_MESSAGE, 5000); else announce(UNAIDED_LOCKED_MESSAGE);
      return;
    }
    if (target && target.opener !== next.opener) setExpanded(target.opener, false);
    target = next;
    place();
    el.hidden = false;
    setExpanded(target.opener, true);
    render();
    // 학습 기록: 문항의 힌트·풀이는 학습자가 '다음 힌트'·'풀이 보기'를 눌렀을 때(위 ladder) 남는다.
    // 서랍을 여는 것만으로 내용이 나오는 글·그림·연결 단계는 여는 순간 남긴다.
    const type = findBlock(mod, target.blockId)?.block.type;
    const kind = type === 'link' ? 'link_reason' : type === 'text' || type === 'figure' ? 'other_explanation' : null;
    if (kind) rec.helpOpen({ blockId: target.blockId, helpKey: target.helpKey, kind, progress: session.progress });
  }

  function close({ restoreFocus = true } = {}) {
    if (!isOpen()) return;
    const hadFocus = el.contains(document.activeElement);
    el.hidden = true;
    emergencyOpen = false;
    setExpanded(target?.opener, false);
    if (restoreFocus && hadFocus) target?.opener?.focus();
  }

  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  return {
    el,
    isOpen,
    open,
    close,
    toggle(next) { if (isOpen() && same(target, next) && target.itemKey === next.itemKey) close(); else open(next); },
    refresh() { if (isOpen()) render(); },
  };
}
