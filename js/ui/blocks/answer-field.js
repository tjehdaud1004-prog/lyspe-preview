// 답 입력칸: number(숫자 칸 + 단위 + ± 단추), choice(라디오), linear(식 한 줄 + 기호 단추), term(낱말 한 줄), text·expr(여러 줄).
import { h, uid } from '../dom.js';
import { linearKeys, submitsOnEnter } from '../../core/answer.js';

const MINUS_LEAD = /^\s*[-−–－]\s*/; // 글 맨 앞의 빼기(여러 모양)
const KEY_NAMES = { '+': '더하기', '−': '빼기', '×': '곱하기', '=': '등호' };

// order: 보기 문항에서 보기를 보일 차례(id 배열, core/shuffle.js optionOrder). 없으면 적힌 차례. 보기 id·채점은 차례와 무관하다.
export function createAnswerField(answer, { labelId, label = '', onEnter, onInput, order = null } = {}) {
  const id = uid('ans-');
  let inputs = [];
  let labels = [];        // 보기 문항의 보기 줄(label) — 이미 틀린 보기 표시용
  let tried = new Set();  // 다시 고를 수 없는 보기 id
  let locked = false;
  let el;

  if (answer.kind === 'choice') {
    const name = uid('choice-');
    const shown = Array.isArray(order) && order.length === answer.options.length
      ? order.map((id) => answer.options.find((o) => o.id === id)).filter(Boolean)
      : answer.options;
    const options = shown.length === answer.options.length ? shown : answer.options;
    inputs = options.map((o) => h('input', { type: 'radio', name, value: o.id, onChange: () => onInput?.() }));
    el = h('fieldset', { class: 'choices' },
      h('legend', { class: 'sr-only', text: label }),
      ...(labels = options.map((o, i) => h('label', { class: 'choice' }, inputs[i], h('span', { text: o.label }), h('span', { class: 'choice-note', hidden: true, text: '맞지 않음' })))));
  } else if (answer.kind === 'number') {
    const input = h('input', {
      id, type: 'text', inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      class: 'input input-number', 'aria-labelledby': labelId,
      onInput: () => onInput?.(),
      onKeydown: (e) => { if (submitsOnEnter(e)) { e.preventDefault(); onEnter?.(); } },
    });
    // 휴대폰의 숫자 자판에는 빼기 키가 없다 — 음수가 답이든 아니든 모든 수 칸에 똑같이 `±` 단추를 둔다(부호가 새지 않게).
    const sign = h('button', {
      type: 'button', class: 'btn btn-sign', 'aria-label': '부호 바꾸기', dataset: { action: 'sign' },
      onClick: () => {
        input.value = MINUS_LEAD.test(input.value) ? input.value.replace(MINUS_LEAD, '') : `-${input.value}`;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        onInput?.();
      },
    }, '±');
    inputs = [input, sign];
    el = h('div', { class: 'field-row field-row-number' }, input, answer.unit && h('span', { class: 'unit', text: answer.unit }), sign);
  } else if (answer.kind === 'linear') {
    // 식 한 줄. 휴대폰 자판에서 찾기 번거로운 기호는 아래 단추로 커서 자리에 넣는다.
    const input = h('input', {
      id, type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      class: 'input input-expr', 'aria-labelledby': labelId,
      onInput: () => onInput?.(),
      onKeydown: (e) => { if (submitsOnEnter(e)) { e.preventDefault(); onEnter?.(); } },
    });
    const insert = (ch) => {
      const at = input.selectionStart ?? input.value.length;
      input.setRangeText(ch, at, input.selectionEnd ?? at, 'end');
      input.focus();
      onInput?.();
    };
    const keys = linearKeys(answer).map((ch) => h('button', { type: 'button', class: 'btn btn-key', 'aria-label': `${KEY_NAMES[ch] ?? ch} 넣기`, onClick: () => insert(ch) }, ch));
    inputs = [input, ...keys];
    el = h('div', { class: 'field-col' },
      h('div', { class: 'field-row' }, answer.label && h('span', { class: 'unit', text: `${answer.label} =` }), input, answer.unit && h('span', { class: 'unit', text: answer.unit })),
      h('div', { class: 'expr-keys', role: 'group', 'aria-label': '기호 넣기' }, keys));
  } else if (answer.kind === 'numbers') {
    // 수 여럿: 글 칸 하나(쉼표 · 띄어쓰기 · 줄바꿈으로 가른 정수). 쉼표가 없는 숫자 자판이 있어 inputmode 는 text 로 두고,
    // 휴대폰에서 찾기 번거로운 쉼표 · 빼기는 아래 단추로 커서 자리에 넣는다.
    const input = h('input', {
      id, type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      class: 'input input-numbers', 'aria-labelledby': labelId, placeholder: '수를 쉼표로 이어 적기', // 수가 든 예시는 쓰지 않는다(어느 문항의 정답과 같으면 답이 샌다)
      onInput: () => onInput?.(),
      onKeydown: (e) => { if (submitsOnEnter(e)) { e.preventDefault(); onEnter?.(); } },
    });
    const insert = (ch) => {
      const at = input.selectionStart ?? input.value.length;
      input.setRangeText(ch, at, input.selectionEnd ?? at, 'end');
      input.focus();
      onInput?.();
    };
    const keys = [[',', '쉼표'], ['−', '빼기']].map(([ch, name]) => h('button', { type: 'button', class: 'btn btn-key', 'aria-label': `${name} 넣기`, onClick: () => insert(ch) }, ch));
    inputs = [input, ...keys];
    el = h('div', { class: 'field-col' },
      h('div', { class: 'field-row' }, input, answer.unit && h('span', { class: 'unit', text: answer.unit })),
      h('div', { class: 'expr-keys', role: 'group', 'aria-label': '기호 넣기' }, keys));
  } else if (answer.kind === 'term') {
    // 낱말 한 줄. 한글 조합 중의 Enter 는 제출이 아니다(submitsOnEnter). 맞춤법 밑줄·자동 대문자는 끈다 — 떠올려 적는 칸이다.
    const input = h('input', {
      id, type: 'text', inputmode: 'text', lang: 'ko', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done',
      class: 'input input-term', 'aria-labelledby': labelId,
      onInput: () => onInput?.(),
      onKeydown: (e) => { if (submitsOnEnter(e)) { e.preventDefault(); onEnter?.(); } },
    });
    inputs = [input];
    el = h('div', { class: 'field-row' }, input);
  } else {
    const input = h('textarea', { id, rows: 3, class: 'input input-text', lang: 'ko', 'aria-labelledby': labelId, onInput: () => onInput?.() });
    inputs = [input];
    el = h('div', { class: 'field-row field-row-block' }, input);
  }

  return {
    el,
    getValue() {
      if (answer.kind === 'choice') return inputs.find((i) => i.checked)?.value ?? '';
      return inputs[0].value;
    },
    setValue(value) {
      if (answer.kind === 'choice') inputs.forEach((i) => { i.checked = i.value === value; });
      else inputs[0].value = value ?? '';
    },
    setDisabled(disabled) { locked = disabled; inputs.forEach((i) => { i.disabled = locked || tried.has(i.value); }); },
    // 보기 문항: 틀린 것으로 확인된 보기는 고른 표시를 지우고 다시 고를 수 없게 한다. 색만이 아니라 글자('맞지 않음')로도 알린다.
    setTried(ids) {
      if (answer.kind !== 'choice') return;
      tried = new Set(ids);
      inputs.forEach((input, i) => {
        const on = tried.has(input.value);
        if (on) input.checked = false;
        input.disabled = locked || on;
        labels[i].classList.toggle('is-tried', on);
        labels[i].querySelector('.choice-note').hidden = !on;
      });
    },
    focus() { (inputs.find((i) => i.checked) ?? inputs.find((i) => !i.disabled) ?? inputs[0]).focus(); },
  };
}
