// 아주 작은 DOM 도우미. 모든 화면 코드가 이것으로 요소를 만든다(문자열 HTML 을 만들지 않는다 — 학습자 입력이 섞여도 안전).

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, props = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.setAttribute('class', value);
    else if (key === 'text') el.textContent = value;
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

let counter = 0;
export function uid(prefix = 'u') { counter += 1; return `${prefix}${counter}`; }

// 키보드·터치로 누르는 요소 위에서는 '화면 아무 곳이나 탭' 단축을 무시한다.
export const INTERACTIVE = 'button, a, input, textarea, select, summary, label, canvas, dialog, [contenteditable], [role="tab"], [role="radio"]';
export const isInteractive = (target) => target instanceof Element && target.closest(INTERACTIVE) !== null;
