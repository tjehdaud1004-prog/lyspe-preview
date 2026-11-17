// <dialog> 기반 확인 창. 키보드 초점 가두기·Esc 닫기는 브라우저 기본 동작에 맡긴다.
// 결과는 단추의 submit 에서 바로 확정하고, 'close' 이벤트(Esc)는 취소로 받는 보험으로만 쓴다.
import { h, uid } from './dom.js';

// 결과: { ok: boolean, checked: boolean }
export function askConfirm({ title, body, okLabel = '확인', cancelLabel = '취소', checkbox = null, danger = false }) {
  return new Promise((resolve) => {
    const titleId = uid('dlg-title-');
    const box = checkbox ? h('input', { type: 'checkbox', id: uid('dlg-check-') }) : null;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      const checked = box ? box.checked : false;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve({ ok, checked });
    };
    const form = h('form', { method: 'dialog', class: 'dialog-body' },
      h('h2', { id: titleId, class: 'dialog-title', text: title }),
      h('p', { class: 'dialog-text', text: body }),
      box && h('label', { class: 'check-row', for: box.id }, box, h('span', { text: checkbox })),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn', value: 'cancel', type: 'submit', text: cancelLabel }),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, value: 'ok', type: 'submit', text: okLabel })));
    const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': titleId }, form);
    form.addEventListener('submit', (e) => { e.preventDefault(); finish(e.submitter?.value === 'ok'); });
    dialog.addEventListener('cancel', () => finish(false));
    dialog.addEventListener('close', () => finish(dialog.returnValue === 'ok'));
    document.body.append(dialog);
    dialog.showModal();
    form.querySelector('.btn')?.focus(); // 되돌릴 수 없는 쪽이 기본 선택이 되지 않게 '취소'에 초점
  });
}
