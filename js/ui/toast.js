// 짧은 알림. 화면 읽기 프로그램에는 polite 영역으로 한 번만 전달한다.
import { h } from './dom.js';

export function createToaster(host) {
  let timer = null;
  const box = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });
  host.append(box);
  return {
    show(message, ms = 3200) {
      box.textContent = message;
      box.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(() => { box.hidden = true; }, ms);
    },
  };
}

// 화면에는 보이지 않지만 읽어 주는 안내 영역.
export function createAnnouncer(host) {
  const region = h('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
  host.append(region);
  let flip = false;
  return (message) => {
    // 같은 문장을 연달아 알릴 때도 다시 읽히도록 보이지 않는 문자를 번갈아 덧붙인다.
    flip = !flip;
    region.textContent = message + (flip ? '​' : '');
  };
}
