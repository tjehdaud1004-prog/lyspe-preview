// 긴급 안내 그리기. 문구와 번호는 core/ai/emergency.js 의 고정 자료다(여기서 지어내지 않는다).
// 도움 서랍 아래·설정 창 아래·AI 가 긴급이라고 본 질문의 답 자리에서 같은 함수를 쓴다. 서비스 연결과 상관없이 언제나 있다.
// 이 앱은 전화를 대신 걸지 않는다: 번호 단추는 전화 화면을 여는 링크이고, 거는 것은 사람이 한다. 열어도 학습 진행을 잠그지 않는다.
import { h, uid } from './dom.js';
import { EMERGENCY_NOTICE } from '../core/ai/emergency.js';

export function emergencyContent(notice = EMERGENCY_NOTICE) {
  return h('div', { class: 'emergency' },
    h('h4', { class: 'help-sub', text: notice.title }),
    h('p', { class: 'small', text: notice.body }),
    h('ul', { class: 'emergency-list' }, ...notice.lines.map((line) =>
      h('li', { class: 'emergency-line' },
        h('p', { class: 'emergency-head' }, h('strong', { class: 'emergency-number', text: line.number }), ` ${line.label}`),
        h('p', { class: 'small', text: line.note }),
        line.tel
          ? h('a', { class: 'btn', href: line.tel, text: `${line.number} 전화 화면 열기` })
          : h('p', { class: 'small', text: '지역번호가 필요해 전화 단추를 두지 않았습니다. 번호를 보고 직접 걸어 주세요.' })))),
    h('p', { class: 'small', text: `${notice.verifiedOn} 에 확인한 번호입니다.` }));
}

// 단추 + 펼침 칸. 펼칠 때마다 onToggle(true) 를 부른다(열었다는 사실만 기록한다).
export function createEmergencyDisclosure({ open = false, onToggle = null } = {}) {
  const panelId = uid('emergency-');
  const panel = h('div', { id: panelId, class: 'emergency-panel', hidden: !open }, emergencyContent());
  const button = h('button', {
    type: 'button', class: 'btn btn-quiet', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': panelId,
    onClick: () => {
      const next = panel.hidden;
      panel.hidden = !next;
      button.setAttribute('aria-expanded', next ? 'true' : 'false');
      onToggle?.(next);
    },
  }, '긴급할 때 연락할 곳');
  return h('div', { class: 'emergency-disclosure' }, button, panel);
}
