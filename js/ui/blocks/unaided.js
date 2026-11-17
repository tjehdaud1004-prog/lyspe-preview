// '도움 없이 먼저' 자리의 화면 조각: 안내 한 줄, 첫 답 진행 표시, '모르겠다'·'건너뛰기' 단추.
// 규칙(언제 잠기고 무엇이 첫 답으로 남는가)은 core/unaided.js 에 있다. 여기는 보여 주고 누른 것을 전할 뿐이다.
import { h } from '../dom.js';
import { skipItem } from '../../core/progress.js';
import { returnOffers, SKIP_TEXT } from '../../core/skip.js';
import { helpGate, markUnknown, markSkippedFirst, partKeys, UNAIDED_NOTICE, UNAIDED_OPEN_MESSAGE } from '../../core/unaided.js';

export function createUnaidedUi(ctx, block) {
  const keys = partKeys(block);
  const gate = () => helpGate(ctx.mod, ctx.session.progress, block.id);
  let wasLocked = gate().locked;

  const status = h('p', { class: 'unaided-status' });
  const notice = h('div', { class: 'unaided-notice' }, h('p', { class: 'unaided-text', text: UNAIDED_NOTICE }), status);

  // 학습 기록: 답 없이 남은 첫 답(모르겠다·건너뜀)도 부분마다 attempt 한 건으로 남긴다.
  const logFirst = (firstKeys, result) => {
    for (const key of firstKeys) ctx.rec.attempt({ key, result, progress: ctx.session.progress, unaided: 'first' });
  };

  const unknownBtn = h('button', {
    type: 'button', class: 'btn', dataset: { action: 'dontknow' },
    onClick: () => {
      const { state, keys: marked } = markUnknown(ctx.mod, ctx.session.progress, block.id);
      if (marked.length === 0) return;
      ctx.session.update(() => state);
      logFirst(marked, 'unknown');
    },
  }, '모르겠다');

  const skipBtn = h('button', {
    type: 'button', class: 'btn btn-quiet', dataset: { action: 'skip' },
    onClick: () => {
      const before = ctx.session.progress;
      const { state, keys: marked } = markSkippedFirst(ctx.mod, before, block.id);
      ctx.session.update(() => keys.reduce((acc, k) => skipItem(acc, k), state));
      for (const k of keys) {
        if (ctx.session.progress.items[k]?.skipped && !before.items[k]?.skipped) {
          ctx.rec.attempt({ key: k, result: 'skipped', progress: ctx.session.progress, unaided: marked.includes(k) ? 'first' : 'after' });
        }
      }
    },
  }, '이 문제 건너뛰기');

  // 막히면 돌아가기: 모든 칸에 첫 답이 남은 뒤, 틀렸거나 모르겠다로 남은 칸이 가리키는 목표의 장면 가운데 앞에서 건너뛴 것을 알린다(core/skip.js).
  // 알림일 뿐이다 — 닫지 않아도 진행할 수 있다.
  const offers = h('div', { class: 'skip-return', hidden: true });
  let offerKey = '';
  function refreshOffers(locked) {
    const ids = locked ? [] : returnOffers(ctx.mod, ctx.session.progress, block.id);
    const key = ids.join('|');
    if (key === offerKey) return;
    offerKey = key;
    offers.hidden = ids.length === 0;
    offers.replaceChildren(...ids.map((id) => {
      const no = ctx.mod.scenes.findIndex((sc) => sc.id === id) + 1;
      const title = ctx.mod.scenes[no - 1].title;
      return h('div', { class: 'skip-return-item' },
        h('p', { class: 'skip-return-text', text: SKIP_TEXT.returnOffer({ no, title }) }),
        h('button', { type: 'button', class: 'btn', dataset: { action: 'open-scene', sceneId: id }, onClick: () => ctx.openScene?.(id, 'offer') }, SKIP_TEXT.openScene));
    }));
  }

  function refresh() {
    const g = gate();
    refreshOffers(g.locked);
    status.textContent = g.locked ? `첫 답 ${g.answered} / ${g.total}칸. 막혔으면 ‘모르겠다’를 누르면 도움이 열립니다.` : UNAIDED_OPEN_MESSAGE;
    notice.classList.toggle('is-open', !g.locked);
    unknownBtn.hidden = !g.locked;
    if (wasLocked && !g.locked) ctx.announce(UNAIDED_OPEN_MESSAGE);
    wasLocked = g.locked;
  }
  refresh();

  return { notice, offers, unknownBtn, skipBtn, refresh };
}
