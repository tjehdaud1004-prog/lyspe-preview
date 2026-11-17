// 정리 화면에 더하는 구역: 도움 없이 먼저 해 본 문제의 첫 답, 시작 전·며칠 뒤에 도움 없이 푼 문항 묶음.
// 관찰한 것(맞음 / 틀림 / 모르겠다 …)만 적는다. 점수·등급·평가 문구를 만들지 않는다.
import { h } from './dom.js';
import { summarizeFirst, FIRST_LABELS, UNAIDED_SUMMARY_NOTE } from '../core/unaided.js';
import { summarizeProbe, delayedStatus, delayedLine, PROBE_LABELS } from '../core/probe.js';
import { summarizeSkip, SKIP_TEXT, SKIP_LABELS } from '../core/skip.js';

const countsText = (counts, labels) => Object.entries(labels).filter(([k]) => counts[k] > 0).map(([k, name]) => `${name} ${counts[k]}`).join(' · ');

function firstSection(mod, progress) {
  const rows = summarizeFirst(mod, progress);
  if (rows.length === 0) return [];
  const sceneNo = (id) => mod.scenes.findIndex((s) => s.id === id) + 1;
  return [
    h('table', { class: 'summary-table first-table' },
      h('caption', { text: '도움 없이 먼저 해 본 문제의 첫 답' }),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: '장면' }), h('th', { scope: 'col', text: '칸 수' }), h('th', { scope: 'col', text: '첫 답' }))),
      h('tbody', {}, ...rows.map((r) => h('tr', {},
        h('th', { scope: 'row' }, h('span', { class: 'scene-no', text: `${sceneNo(r.sceneId)}` }), ` ${r.sceneTitle}`),
        h('td', { text: `${r.total}칸` }),
        h('td', { class: 'detail', text: countsText(r.counts, FIRST_LABELS) }))))),
    h('details', { class: 'first-detail' },
      h('summary', { text: '칸마다 보기' }),
      ...rows.map((r) => h('ul', { class: 'first-list', 'aria-label': r.sceneTitle }, ...r.parts.map((p) =>
        h('li', {}, h('span', { class: 'first-label', text: p.label }), ' — ', h('strong', { text: FIRST_LABELS[p.result] })))))),
    h('p', { class: 'small', text: UNAIDED_SUMMARY_NOTE }),
  ];
}

function probeResult(mod, progress, kind, lead) {
  const s = summarizeProbe(mod, progress, kind);
  if (!s || s.total === s.counts.none) return [];
  return [h('p', { class: 'measure-line' }, `${lead} `, h('strong', { text: countsText(s.counts, PROBE_LABELS) }))];
}

function delayedSection(mod, session, onProbe) {
  const status = delayedStatus(mod, session.progress, session.now());
  const line = delayedLine(mod, status);
  if (!line) return [];
  const canStart = ['due', 'declined', 'started'].includes(status.state);
  const days = session.progress.probes?.delayed?.daysSince;
  return [
    h('p', { class: 'measure-line', text: line }),
    ...probeResult(mod, session.progress, 'delayed', Number.isInteger(days) ? `끝까지 본 지 ${days}일 뒤의 답:` : '다시 푼 답:'),
    canStart && h('div', { class: 'end-actions' },
      h('button', { type: 'button', class: 'btn', dataset: { action: 'probe-delayed' }, onClick: () => onProbe?.('delayed') }, status.state === 'started' ? '이어서 풀기' : '지금 풀어 보기')),
  ];
}

// 건너뛰기 확인(core/skip.js): 확인을 시작한 적이 있을 때만. 목표별 결과와 장면별 선택. 건너뛰기는 잠정이며 점수가 아니다.
function skipSection(mod, progress) {
  const s = summarizeSkip(mod, progress);
  if (!s) return [];
  return [
    h('h4', { class: 'measure-sub', text: SKIP_TEXT.endTitle }),
    h('p', { class: 'measure-line', text: SKIP_TEXT.endHead }),
    s.status === 'declined' && h('p', { class: 'small', text: SKIP_TEXT.statusLine.declined }),
    h('ul', { class: 'skip-summary' }, ...s.goals.map((g) => h('li', {},
      h('p', {}, h('strong', { text: g.label })),
      h('p', { class: 'small', text: g.verdict === 'pass' ? SKIP_TEXT.pass : g.verdict === 'insufficient' ? SKIP_TEXT.insufficient : '이 목표는 끝까지 묻지 않았습니다.' }),
      h('p', { class: 'small', text: g.rows.map((r, i) => `문제 ${i + 1} ${SKIP_LABELS[r.result]}`).join(' · ') }),
      g.scenes.filter((sc) => sc.choice).length > 0 && h('p', { class: 'small', text: g.scenes.filter((sc) => sc.choice).map((sc) => `장면 ${sc.no} ‘${sc.title}’ ${sc.choice === 'skip' ? SKIP_TEXT.choiceSkip : SKIP_TEXT.choiceView}`).join(' · ') })))),
  ];
}

export function measureSections({ mod, session, onProbe }) {
  const nodes = [
    ...skipSection(mod, session.progress),
    ...firstSection(mod, session.progress),
    ...probeResult(mod, session.progress, 'pre', '시작하기 전에 도움 없이 푼 문제의 답(점수가 아닙니다):'),
    ...delayedSection(mod, session, onProbe),
  ].filter(Boolean);
  return nodes.length === 0 ? [] : [h('div', { class: 'measure' }, h('h3', { class: 'help-sub', text: '도움 없이 해 본 것' }), ...nodes)];
}
