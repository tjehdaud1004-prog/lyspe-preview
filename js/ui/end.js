// 끝 화면: ① 중심 질문으로 돌아가 자기 말로 답 적기(채점 안 함) ② 장면별 상태 요약.
// '학습 완료'·점수·효과를 말하지 않는다. 말할 수 있는 것은 '끝까지 봤다'와 이 화면이 관찰한 상태뿐이다.
import { h, uid } from './dom.js';
import { setFinalAnswer, setPhase, summarize, SCENE_LABELS } from '../core/progress.js';
import { summarizeTries, selfBreakdown, RETRIED_SUMMARY_NOTE } from '../core/tries.js';
import { elapsedSentence } from '../core/elapsed.js';
import { roundsOfScene, ROUND_TEXT } from '../core/round.js';
import { measureSections } from './end-measure.js';
import { reviewSections } from './end-review.js';
import { openerRevisitCard } from './opener.js';

const COUNT_LABELS = [['self', '스스로'], ['hint', '힌트 뒤'], ['solution', '풀이 뒤'], ['skipped', '건너뜀'], ['written', '직접 적음']];

// next: 모듈 머리의 next 가 가리키는 다음 사슬 모듈 { id, title, href } 또는 null.
export function createEnd({ mod, session, announce, onRestart, onReview, rec, onProbe, planner, onReviewStart, onReviewChange, next = null }) {
  const el = h('section', { class: 'end', id: 'end', 'aria-labelledby': 'end-title', hidden: true, tabindex: '-1' });
  let timer = null;

  function renderFinal() {
    const areaId = uid('final-');
    const area = h('textarea', {
      id: areaId, rows: 5, class: 'input input-text', lang: 'ko',
      onInput: () => { clearTimeout(timer); timer = setTimeout(save, 400); },
      onBlur: () => save(),
    });
    area.value = session.progress.finalAnswer;
    function save() {
      clearTimeout(timer);
      session.update((s) => (s.finalAnswer === area.value ? s : setFinalAnswer(s, area.value)));
    }
    return [
      h('p', { class: 'eyebrow', text: '마무리' }),
      h('h2', { id: 'end-title', class: 'end-title', tabindex: '-1', text: '중심 질문으로 돌아가기' }),
      h('blockquote', { class: 'central', text: mod.centralQuestion }),
      h('label', { class: 'prompt', for: areaId, text: '내 말로 답해 보기. 채점하지 않으며, 비워 두어도 됩니다.' }),
      area,
      h('p', { class: 'small', text: '종이에 먼저 써도 됩니다. 이 화면은 종이에 쓴 내용을 볼 수 없습니다.' }),
      h('div', { class: 'end-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', dataset: { action: 'final-finish' }, onClick: () => { save(); rec.finalAnswer(area.value.trim().length); session.update((s) => setPhase(s, 'summary', session.now())); } }, '끝까지 봤습니다 — 정리 보기'),
        h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => onReview() }, '본문 다시 보기')),
    ];
  }

  // 장면 한 줄의 '자세히': 채점 문항의 결과에, 묶음 돌리기(round)가 있으면 풀린 묶음 수와 처음에 맞힌 문항 수를 덧붙인다.
  function detailOf(r, i, tries) {
    if (r.label === 'checked-skip') return '확인 문제를 풀고 건너뜀. 장면의 문항은 풀지 않았습니다.';
    const parts = COUNT_LABELS.filter(([k]) => r.counts[k] > 0).map(([k, name]) => `${name} ${r.counts[k]}${k === 'self' ? selfBreakdown(tries[r.sceneId]) : ''}`);
    const rs = roundsOfScene(mod.scenes[i], session.progress.rounds);
    if (rs.rounds > 0) parts.push(`묶음 ${rs.rounds}개 중 ${rs.finished}개 마침 · ${ROUND_TEXT.firstLine(rs.firstCorrect, rs.items, 0)}`);
    return parts.join(' · ') || (r.total === 0 ? '문항 없음' : '');
  }

  function renderSummary() {
    const rows = summarize(mod, session.progress);
    const tries = summarizeTries(mod, session.progress); // '스스로' 안의 구분: 첫 시도 / 여러 번 만에 / 건너뛴 뒤
    const table = h('table', { class: 'summary-table' },
      h('caption', { text: '장면별 상태' }),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: '장면' }), h('th', { scope: 'col', text: '상태' }), h('th', { scope: 'col', text: '자세히' }))),
      h('tbody', {}, ...rows.map((r, i) => h('tr', {},
        h('th', { scope: 'row' }, h('span', { class: 'scene-no', text: `${i + 1}` }), ` ${r.title}`),
        h('td', {}, h('span', { class: 'outcome', dataset: { outcome: r.label }, text: SCENE_LABELS[r.label] })),
        h('td', { class: 'detail', text: detailOf(r, i, tries) })))));
    const final = session.progress.finalAnswer.trim();
    return [
      h('p', { class: 'eyebrow', text: '정리' }),
      h('h2', { id: 'end-title', class: 'end-title', tabindex: '-1', text: '끝까지 봤습니다' }),
      h('p', { class: 'lead', text: `이 모듈의 본문을 끝까지 열어 보았습니다. ${elapsedSentence(session.progress.elapsedMs)}` }),
      openerRevisitCard({ mod, session, rec, announce }), // 여는 질문이 있는 모듈에서 처음 답을 골랐다면 한 칸(다시 보기 — 이번에는 정답과 까닭)
      table,
      ...measureSections({ mod, session, onProbe }),
      ...reviewSections({ planner, onStart: onReviewStart, onChange: onReviewChange }), // 복습 일정(data/review.mjs). 언제 다시 풀면 좋은지와 시각 고르기
      h('div', { class: 'summary-final' },
        h('h3', { class: 'help-sub', text: '중심 질문에 내가 적은 답' }),
        h('p', { class: 'central central-small', text: mod.centralQuestion }),
        h('p', { class: final ? 'final-answer' : 'small', text: final || '적은 답이 없습니다.' })),
      h('p', { class: 'small', text: '이 표는 이 화면이 관찰한 것만 적습니다. 종이에 쓴 풀이나 머릿속 생각은 알 수 없어서 기록하지 않습니다. ‘끝까지 봤다’는 뜻이며, 얼마나 이해했는지를 나타내지 않습니다.' }),
      h('p', { class: 'small', text: RETRIED_SUMMARY_NOTE }),
      h('div', { class: 'end-actions' },
        next && h('a', { class: 'btn btn-primary', href: next.href, dataset: { action: 'next-module', next: next.id } }, `다음: ${next.title}`),
        h('button', { type: 'button', class: 'btn', onClick: () => onReview() }, '본문 다시 보기'),
        h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => onRestart() }, '처음부터 다시')),
    ];
  }

  function render() {
    const phase = session.progress.phase;
    el.hidden = phase === 'reading';
    el.dataset.phase = phase;
    if (phase === 'reading') { el.replaceChildren(); return; }
    el.replaceChildren(...(phase === 'final' ? renderFinal() : renderSummary()).filter(Boolean)); // 조건 && 요소가 false 로 올 수 있다
  }

  return {
    el, render,
    // 단계가 바뀐 직후에만 초점을 옮긴다(사용자가 누른 결과이므로 자동 이동이 아니다).
    focusTitle() { el.querySelector('#end-title')?.focus({ preventScroll: false }); announce(session.progress.phase === 'final' ? '중심 질문으로 돌아왔습니다.' : '끝까지 봤습니다.'); },
  };
}
