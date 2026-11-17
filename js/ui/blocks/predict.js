// 예상 적기: 정답이 없고, 적지 않아도 계속할 수 있다. 입력은 저장만 하고 채점·평가하지 않는다.
import { h, uid } from '../dom.js';
import { setPredict } from '../../core/progress.js';

export function renderPredict(ctx, block) {
  const id = uid('predict-');
  let timer = null;
  const area = h('textarea', {
    id, rows: 4, class: 'input input-text', lang: 'ko',
    onInput: () => {
      ctx.guard.markInput();
      clearTimeout(timer);
      timer = setTimeout(save, 400);
    },
    onBlur: () => {
      save();
      // 학습 기록: 적었는지(글자 수)만 남기고 글은 남기지 않는다. 같은 길이로 다시 벗어난 것은 세지 않는다.
      const chars = area.value.trim().length;
      if (chars > 0 && chars !== reportedChars) { reportedChars = chars; ctx.rec.predictWritten({ blockId: block.id, chars }); }
    },
  });
  let reportedChars = 0;
  area.value = ctx.session.progress.predicts[block.id] ?? '';
  function save() {
    clearTimeout(timer);
    ctx.session.update((s) => (s.predicts[block.id] === area.value ? s : setPredict(s, block.id, area.value)));
  }
  const el = h('div', { class: 'block block-predict', dataset: { blockId: block.id } },
    h('p', { class: 'eyebrow', text: block.optional === false ? '예상 적기' : '예상 적기 (선택)' }),
    h('label', { class: 'prompt', for: id, text: block.prompt }),
    area,
    h('p', { class: 'small', text: '정답이 없는 질문입니다. 적은 내용은 이 기기에만 저장되고, 채점하지 않습니다.' }));
  return { el, blockId: block.id, resolved: () => true, refresh() {}, focus: () => area.focus() };
}
