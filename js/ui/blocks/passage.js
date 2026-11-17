// 고정된 지문(passage 블록): 문단이 한꺼번에 보이고(조각으로 나타나지 않는다) 문단마다 눈에 보이는 번호([1], [2] …)가 붙는다.
// 한 걸음으로 세고 곧 '계속'할 수 있다. 같은 장면에서 이 지문 뒤의 블록을 하는 동안에는 reader 의 조작 줄에 '지문 보기' 단추가 있고,
// 누르면 지문이 겹쳐 뜬다(openPassageDialog) — 닫으면 하던 자리로 돌아온다. 지문은 모듈 자료의 글 그대로이고, AI 가 쓴 글이 아니다.
import { h, uid } from '../dom.js';
import { PASSAGE_TEXT, paragraphLabels } from '../../core/passage.js';

function paragraphs(block) {
  const labels = paragraphLabels(block);
  return h('div', { class: 'passage-body' }, ...block.paragraphs.map((p, i) =>
    h('p', { class: 'passage-para', dataset: { para: p.id } }, h('span', { class: 'para-no', text: labels[i] }), ' ', h('span', { class: 'para-text', text: p.text }))));
}

export function renderPassage(ctx, block) {
  const el = h('div', { class: 'block block-passage', dataset: { blockId: block.id } },
    h('p', { class: 'eyebrow', text: PASSAGE_TEXT.eyebrow }),
    h('h3', { class: 'passage-title', text: block.title ?? PASSAGE_TEXT.untitled }),
    block.note && h('p', { class: 'small passage-note', text: block.note }),
    paragraphs(block));
  return { el, blockId: block.id, resolved: () => true, refresh() {}, focus() {} };
}

// 지문을 겹쳐 띄운다. opener: 눌린 단추(닫으면 초점이 돌아간다), from: 그때 하던 블록 id(기록용).
export function openPassageDialog(ctx, block, { opener = null, from = null } = {}) {
  const titleId = uid('passage-dlg-');
  const dialog = h('dialog', { class: 'dialog passage-dialog', 'aria-labelledby': titleId, dataset: { passageId: block.id } },
    h('div', { class: 'dialog-body' },
      h('div', { class: 'passage-dialog-head' },
        h('h2', { id: titleId, class: 'dialog-title', text: block.title ?? PASSAGE_TEXT.untitled }),
        h('button', { type: 'button', class: 'btn', dataset: { action: 'passage-close' }, onClick: () => finish() }, PASSAGE_TEXT.close)),
      block.note && h('p', { class: 'small passage-note', text: block.note }),
      paragraphs(block),
      h('p', { class: 'small', text: PASSAGE_TEXT.closeNote }),
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn btn-primary', dataset: { action: 'passage-close' }, onClick: () => finish() }, PASSAGE_TEXT.close))));
  // 닫는 길은 하나로 모은다: 닫기 단추·Esc('cancel')·그 밖의 'close'. 닫은 뒤에는 창을 치우고 열었던 단추로 초점을 돌려 하던 자리에서 이어지게 한다(스크롤은 그대로).
  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(); });
  dialog.addEventListener('close', finish);
  document.body.append(dialog);
  dialog.showModal();
  ctx.rec.passageOpen({ blockId: block.id, from: from ?? undefined });
  return dialog;
}
