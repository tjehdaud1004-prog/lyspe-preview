// 예상 다시 보기: 앞에서 적은 예상을 다시 보여 주고, 지금까지 알아낸 것과 나란히 놓는다.
// 채점하지 않고, 예상이 맞았는지 판정하지 않는다. 적지 않았으면 그 사실만 말한다(규칙·문구: core/lookback.js).
import { h, uid } from '../dom.js';
import { setPredict } from '../../core/progress.js';
import { lookbackView, LOOKBACK_TEXT } from '../../core/lookback.js';

export function renderLookback(ctx, block) {
  const id = uid('lookback-');
  const top = h('div', { class: 'lookback-top' });
  let timer = null;
  let signature = '';

  // '견주어 본 점'은 예상 적기와 같은 자리(progress.predicts)에 이 블록 id 로 저장한다. 학습 기록에는 남기지 않는다.
  const area = h('textarea', {
    id, rows: 3, class: 'input input-text', lang: 'ko',
    onInput: () => { ctx.guard.markInput(); clearTimeout(timer); timer = setTimeout(save, 400); },
    onBlur: () => save(),
  });
  area.value = ctx.session.progress.predicts[block.id] ?? '';
  function save() {
    clearTimeout(timer);
    ctx.session.update((s) => ((s.predicts[block.id] ?? '') === area.value ? s : setPredict(s, block.id, area.value)));
  }

  function render() {
    const view = lookbackView(ctx.mod, block, ctx.session.progress.predicts);
    const next = JSON.stringify(view);
    if (next === signature) return; // 다른 문항이 바뀔 때마다 다시 그리지 않는다
    signature = next;
    const known = h('div', { class: 'compare-col' }, h('p', { class: 'compare-head', text: LOOKBACK_TEXT.knownHead }), h('p', { class: 'compare-body', text: view.known }));
    const parts = [
      !view.written && h('p', { class: 'lookback-empty', text: view.emptyLine }),
      h('div', { class: `compare${view.written ? '' : ' compare-single'}` },
        view.written && h('div', { class: 'compare-col' }, h('p', { class: 'compare-head', text: view.mineHead }), h('p', { class: 'compare-body', text: view.mine })),
        known),
      h('p', { class: 'prompt lookback-prompt', text: view.prompt }),
    ];
    top.replaceChildren(...parts.filter(Boolean)); // replaceChildren 은 false 를 글자로 넣으므로 걸러 낸다
  }
  render();

  const el = h('div', { class: 'block block-lookback', dataset: { blockId: block.id } },
    h('p', { class: 'eyebrow', text: LOOKBACK_TEXT.eyebrow }),
    top,
    h('label', { class: 'lookback-label', for: id, text: LOOKBACK_TEXT.noteLabel }),
    area,
    h('p', { class: 'small', text: LOOKBACK_TEXT.footer }));
  return { el, blockId: block.id, resolved: () => true, refresh: render, focus: () => area.focus() };
}
