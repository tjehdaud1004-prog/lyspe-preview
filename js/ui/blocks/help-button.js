// 블록·문항에 붙는 '도움' 단추와 '건너뛰기' 단추. 도움 서랍 자체는 ui/help.js 가 맡는다.
import { h } from '../dom.js';
import { skipItem } from '../../core/progress.js';

export function helpButton(ctx, { blockId, helpKey, itemKey = null, label = '도움' }) {
  const btn = h('button', {
    type: 'button', class: 'btn', 'aria-expanded': 'false', 'aria-controls': 'help-drawer', dataset: { action: 'help' },
    onClick: () => ctx.help.toggle({ blockId, helpKey, itemKey, opener: btn }),
  }, label);
  return btn;
}

export function skipButton(ctx, keys, label = '건너뛰기') {
  return h('button', {
    type: 'button', class: 'btn btn-quiet', dataset: { action: 'skip' },
    onClick: () => {
      const before = ctx.session.progress;
      ctx.session.update((s) => keys.reduce((acc, k) => skipItem(acc, k), s));
      // 학습 기록: '건너뜀'이 새로 표시된 항목만 attempt(result=skipped)로 남긴다.
      for (const k of keys) {
        if (ctx.session.progress.items[k]?.skipped && !before.items[k]?.skipped) ctx.rec.attempt({ key: k, result: 'skipped', progress: ctx.session.progress });
      }
    },
  }, label);
}
