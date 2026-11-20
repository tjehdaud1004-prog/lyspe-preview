// 설정 창. 표시 방식·단위·속도·자동 이어가기 등은 설계값으로 잠그지 않고 사용자가 바꾼다. 바꾸면 바로 적용·저장된다.
// 학습 기록(동의 스위치·이 기기의 기록 요약·내보내기·지우기)도 여기에 있다.
import { h, uid } from './dom.js';
import { SPEED_LABELS, TEXT_UNIT_LABELS } from '../core/segment.js';
import { FLOW_VIEW_LABELS } from '../core/sceneview.js';
import { findBlock } from '../core/module.js';
import { formatDuration } from '../core/format.js';
import { summarizeEvents, SUMMARY_NOTE, QUESTION_TEXT_AVAILABLE } from '../core/telemetry.js';
import { askConfirm } from './dialog.js';
import { createEmergencyDisclosure } from './emergency.js';
import { scheduleBox } from './end-review.js';

function radioGroup({ legend, name, options, current, onChange, hint }) {
  return h('fieldset', { class: 'setting' },
    h('legend', { text: legend }),
    hint && h('p', { class: 'small', text: hint }),
    h('div', { class: 'radio-row' }, ...options.map((o) => {
      const input = h('input', { type: 'radio', name, value: String(o.value), checked: o.value === current, onChange: () => onChange(o.value) });
      return h('label', { class: 'choice choice-inline' }, input, h('span', { text: o.label }));
    })));
}

const FIRST_ATTEMPT_LABELS = { correct: '처음에 맞음', wrong: '처음에 틀림', none: '—' };
const DISPLAY_LABELS = { typing: '조금씩 나타남', instant: '바로 보임' };

export function createSettingsDialog({ session, mod, recording, planner, onReviewChange }) {
  const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'settings-title' });
  const recBox = h('div', { class: 'rec-settings' });
  const reviewBox = h('div', { class: 'rec-settings' });
  let status = '';

  function labelOf(blockId) {
    const found = findBlock(mod, blockId);
    if (!found) return blockId;
    const text = String(found.block.prompt ?? found.block.goal ?? blockId);
    return `${found.scene.title} · ${text.length > 22 ? `${text.slice(0, 22)}…` : text}`;
  }

  function summaryNode() {
    const s = summarizeEvents(recording.store.all(), { now: Date.now() });
    if (s.eventCount === 0) return h('p', { class: 'small', text: '이 기기에 남은 기록이 없습니다.' });
    const modes = Object.entries(s.displayMode).map(([k, n]) => `${DISPLAY_LABELS[k] ?? k} ${n}회`).join(' · ') || '—';
    return h('div', { class: 'rec-summary' },
      h('p', { class: 'small', text: `기록 ${s.eventCount}건 · 방문 ${s.sessions}번 · 총 활동 시간 ${formatDuration(s.totalActiveMs)}(입력 없이 오래 둔 시간과 탭이 가려진 시간은 뺌)` }),
      s.blocks.length > 0 && h('table', { class: 'summary-table rec-table' },
        h('caption', { text: '문항·블록별' }),
        h('thead', {}, h('tr', {}, ['블록', '첫 시도', '도움 연 횟수', '걸린 시간'].map((t) => h('th', { scope: 'col', text: t })))),
        h('tbody', {}, ...s.blocks.map((b) => h('tr', {},
          h('th', { scope: 'row', text: labelOf(b.block) }),
          h('td', { text: FIRST_ATTEMPT_LABELS[b.firstAttempt] }),
          h('td', { text: `${b.helpOpened}회` }),
          h('td', { text: b.activeMs === null ? '—' : formatDuration(b.activeMs) }))))),
      Object.values(s.unaidedFirst).some((n) => n > 0) && h('p', { class: 'small', text: `도움 없이 먼저 해 본 칸의 첫 답: 맞음 ${s.unaidedFirst.correct} · 틀림 ${s.unaidedFirst.wrong} · 모르겠다 ${s.unaidedFirst.unknown} · 건너뜀 ${s.unaidedFirst.skipped}` }),
      h('p', { class: 'small', text: `글이 나타난 방식: ${modes}` }),
      s.rejected > 0 && h('p', { class: 'small', text: `형식이 맞지 않아 요약에서 뺀 기록 ${s.rejected}건` }),
      h('p', { class: 'small rec-disclaimer', text: SUMMARY_NOTE }));
  }

  function renderRec() {
    const store = recording.store;
    const on = recording.consent.record;
    const recId = uid('rec-');
    const qId = uid('rec-q-');
    recBox.replaceChildren(...[
      h('h3', { class: 'dialog-subtitle', text: '학습 기록' }),
      h('p', { class: 'small', text: '남기면: 푸는 데 걸린 시간·시도 결과·도움을 연 횟수·화면 크기·설정을 바꾼 일. 남기지 않으면: 노트 내용, 서술형 답과 예상 적기의 글(길이만 남김), 이름·연락처. 기록은 이 기기 안에만 있고 어디로도 보내지 않습니다.' }),
      h('div', { class: 'setting' },
        h('label', { class: 'check-row', for: recId },
          h('input', { type: 'checkbox', role: 'switch', id: recId, checked: on, onChange: (e) => { status = ''; recording.setRecord(e.target.checked); renderRec(); } }),
          h('span', { text: '학습 기록 남기기' })),
        h('p', { class: 'small', text: on ? '켜져 있습니다. 끄면 그 뒤로는 남기지 않습니다(이미 남은 기록은 아래에서 지울 수 있습니다).' : '꺼져 있습니다(기본). 켜기 전에는 아무것도 남기지 않습니다.' })),
      h('div', { class: 'setting' },
        h('label', { class: 'check-row', for: qId },
          h('input', { type: 'checkbox', role: 'switch', id: qId, checked: recording.consent.questionText, disabled: !(QUESTION_TEXT_AVAILABLE && on), onChange: (e) => { recording.setQuestionText(e.target.checked); renderRec(); } }),
          h('span', { text: '질문 글도 남기기' })),
        h('p', { class: 'small', text: QUESTION_TEXT_AVAILABLE ? '이 스위치를 켜야만 AI 에게 물은 글이 기록에 남습니다. 긴급 안내가 나온 질문의 글은 켜 두어도 남기지 않습니다.' : '지금은 AI 에게 질문하는 기능이 없어 선택할 수 없습니다. 기능이 생겨도 이 스위치를 따로 켜야만 질문 글이 남습니다.' })),
      !recording.persistent && h('p', { class: 'storage-warning', role: 'status', text: '이 브라우저에서는 저장이 막혀 있어 기록이 이 화면을 닫을 때까지만 남습니다.' }),
      recording.persistent && !store.persistOk && h('p', { class: 'storage-warning', role: 'status', text: '저장 공간이 부족해 일부 기록이 저장되지 않았을 수 있습니다. 화면은 그대로 쓸 수 있습니다.' }),
      h('p', { class: 'small', text: `이 기기에 저장된 기록 ${store.count}건(최대 ${store.max}건) · 상한을 넘어 오래된 것부터 버린 기록 ${store.dropped}건` }),
      h('div', { class: 'rec-actions' },
        h('button', { type: 'button', class: 'btn', disabled: store.count === 0, onClick: () => { const r = recording.exportFile(); status = `${r.lines}줄(JSON Lines)을 파일로 내려받았습니다. 어디로도 보내지 않았습니다.`; renderRec(); } }, '기록 내보내기'),
        h('button', { type: 'button', class: 'btn btn-quiet', disabled: store.count === 0 && store.dropped === 0, onClick: onClear }, '기록 지우기')),
      h('p', { class: 'small', role: 'status', 'aria-live': 'polite', text: status }),
      h('h3', { class: 'dialog-subtitle', text: '이 기기의 기록 요약' }),
      summaryNode()].filter(Boolean));
  }

  // 복습: 시험 날짜(선택), 복습 일정·시각·받기 스위치(끝 화면과 같은 구역). 시험 날짜는 모듈 공통 설정이고 학습 기록에 값을 남기지 않는다.
  function renderReview() {
    const examId = uid('exam-');
    const exam = session.settings.examDate;
    const note = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' });
    const setExam = (value) => {
      session.updateSettings({ examDate: value });
      renderReview();
    };
    const input = h('input', {
      type: 'date', id: examId, class: 'input', value: exam ?? '',
      onChange: (e) => {
        const v = e.target.value;
        if (v === '') { setExam(null); return; }
        if (!planner.validExam(v)) { e.target.value = exam ?? ''; note.textContent = '시험 날짜는 오늘보다 뒤의 날짜여야 합니다.'; return; }
        setExam(v);
      },
    });
    reviewBox.replaceChildren(
      h('h3', { class: 'dialog-subtitle', text: '복습' }),
      h('div', { class: 'setting' },
        h('label', { for: examId, class: 'setting-label', text: '시험 날짜(선택)' }), ' ', input, ' ',
        exam && h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => setExam(null) }, '날짜 비우기'),
        h('p', { class: 'small', text: '적으면 시험 전에 복습이 끝나도록 복습 간격을 줄입니다. 비워 둘 수 있습니다. 시험 날짜의 값은 학습 기록에 남기지 않습니다.' }),
        exam && !planner.validExam(exam) && h('p', { class: 'small', text: '적어 둔 시험 날짜가 오늘이거나 지나서 복습 일정을 만들지 않습니다. 날짜를 비우거나 바꾸면 다시 정합니다.' }),
        note),
      scheduleBox({ planner, onChange: () => onReviewChange?.(), withTitle: false }).el);
  }

  async function onClear() {
    const { ok } = await askConfirm({
      title: '이 기기의 학습 기록을 지울까요?',
      body: `이 모듈의 학습 기록 ${recording.store.count}건이 이 기기에서 지워지고 되돌릴 수 없습니다. 진행·노트·설정은 그대로입니다.`,
      okLabel: '기록 지우기', danger: true,
    });
    if (!ok) return;
    recording.clearRecords();
    status = '이 모듈의 기록을 지웠습니다.';
    renderRec();
  }

  function render() {
    const s = session.settings;
    const set = (patch) => session.updateSettings(patch);
    const autoId = uid('auto-');
    dialog.replaceChildren(h('div', { class: 'dialog-body' },
      h('h2', { class: 'dialog-title', id: 'settings-title', text: '설정' }),
      radioGroup({
        legend: '본문 표시 방식', name: 'display', current: s.display, onChange: (v) => set({ display: v }),
        options: [{ value: 'typing', label: '조금씩 나타나게' }, { value: 'instant', label: '한 글 단위씩 바로' }],
        hint: '화면 어디든 누르거나 스페이스를 누르면 지금 글 단위를 바로 펼칩니다.',
      }),
      radioGroup({
        legend: '나타나는 단위', name: 'unit', current: s.unit, onChange: (v) => set({ unit: v }),
        options: Object.entries(TEXT_UNIT_LABELS).map(([value, label]) => ({ value, label })),
        hint: '‘조금씩 나타나게’일 때 글이 한 번에 나타나는 크기입니다(타자 = 자판을 치듯 자모가 차례로 조합되며, 어절 = 띄어쓰기 단위). 어느 쪽이 더 잘 기억된다고 확인된 것은 아니니, 바꿔 보며 편한 쪽을 고르세요.',
      }),
      radioGroup({
        legend: '본문 보기 방식', name: 'view', current: s.view, onChange: (v) => set({ view: v }),
        options: Object.entries(FLOW_VIEW_LABELS).map(([value, label]) => ({ value, label })),
        hint: '‘장면별로 보기’(기본)는 지금 장면만 보이고, ‘앞 장면 보기’로 지난 장면을 언제든 다시 볼 수 있습니다. ‘이어서 쌓기’는 지난 장면이 위쪽에 계속 남아 화면이 길어집니다. 진행·문항·노트는 어느 쪽이든 그대로입니다. 어느 쪽이 더 낫다고 확인된 것은 아닙니다.',
      }),
      radioGroup({
        legend: '나타나는 속도', name: 'speed', current: s.speed, onChange: (v) => set({ speed: v }),
        options: Object.entries(SPEED_LABELS).map(([value, label]) => ({ value, label })),
        hint: '단위와 상관없이 한 글 단위가 다 나타나는 데 걸리는 시간이 같도록 맞춥니다.',
      }),
      h('div', { class: 'setting' },
        h('label', { class: 'check-row', for: autoId },
          h('input', { type: 'checkbox', id: autoId, checked: s.autoContinue, onChange: (e) => set({ autoContinue: e.target.checked }) }),
          h('span', { text: '글 단위가 끝나면 다음 글 단위를 자동으로 이어 가기' })),
        h('p', { class: 'small', text: '입력 중일 때는 자동으로 넘어가지 않습니다. 문항과 그림 앞에서는 항상 멈춥니다.' })),
      radioGroup({
        legend: '화면 색', name: 'theme', current: s.theme, onChange: (v) => set({ theme: v }),
        options: [{ value: 'system', label: '기기 설정 따르기' }, { value: 'light', label: '밝게' }, { value: 'dark', label: '어둡게' }],
      }),
      radioGroup({
        legend: '글자 크기', name: 'fontScale', current: s.fontScale, onChange: (v) => set({ fontScale: Number(v) }),
        options: [{ value: 1, label: '보통' }, { value: 1.15, label: '크게' }, { value: 1.3, label: '아주 크게' }],
      }),
      reviewBox,
      recBox,
      // 긴급 안내: 도움이 잠긴 자리에서도 열 수 있게 설정 창 맨 아래에도 둔다(도움 서랍과 같은 그리기 함수).
      h('div', { class: 'rec-settings' }, createEmergencyDisclosure({ onToggle: (opened) => { if (opened) recording.rec.helpOpen({ kind: 'emergency' }); } })),
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onClick: () => dialog.close(), text: '닫기' }))));
    renderReview();
    renderRec();
  }

  document.body.append(dialog);
  return {
    open() { status = ''; render(); dialog.showModal(); },
  };
}
