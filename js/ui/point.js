// 낱말에서 위의 수 · 표 칸을 가리키는 밑줄 화살표 그리기(SPEC_POINT.md, K04 A179). 순수 계산은 core/point.js.
// DOM 을 글 안에 넣지 않는다: 글 단위는 문장 span 의 글 노드라 타자기가 다시 채운다. 낱말 · 대상의 자리는 Range(글자 위치)로 재고,
// 읽기 흐름(.flow) 위에 겹친 SVG 한 장(pointer-events 없음, 읽는 프로그램에는 숨김)에 밑줄 · 화살표 · 테두리를 그린다. sync() 는 매번 그림 전체를 다시 만든다 —
// 움직임은 CSS 애니메이션이고, 다시 만들어도 이어서 보이도록 처음 나타난 때부터 지난 시간만큼 음의 지연(--t)을 준다.
import { svg } from './dom.js';
import { sentencePartsOf } from '../core/sentences.js';
import { findWord, sentenceAt, arrowPath } from '../core/point.js';

const LEAVE_MS = 250; // 사라질 때 옅어지는 시간

// 글 단위 p 에서 지금 눈에 보이는 글 노드들(타자 중이면 .typed 안 — 숨은 전체 글 .sr-only 는 건너뛴다).
function visibleNodes(p) {
  const walker = document.createTreeWalker(p.querySelector('.typed') ?? p, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  return nodes;
}

// 글 단위 p 안의 [start, end) 글자의 줄 조각들(화면 좌표). 그 끝 글자가 아직 안 나왔으면(타자 중) 빈 배열.
function wordRects(p, start, end) {
  const nodes = visibleNodes(p);
  let acc = 0;
  const range = document.createRange();
  let hasStart = false;
  for (const n of nodes) {
    const len = n.data.length;
    if (!hasStart && start < acc + len) { range.setStart(n, start - acc); hasStart = true; }
    if (hasStart && end <= acc + len) { range.setEnd(n, end - acc); return [...range.getClientRects()].filter((r) => r.width > 0); }
    acc += len;
  }
  return [];
}

const widest = (rects) => rects.reduce((a, b) => (b.width > a.width ? b : a));

export function createPointer({ flow, mod, steps, stepEls, handles, reading, reducedMotion }) {
  const layer = svg('svg', { class: 'point-layer', 'aria-hidden': 'true', focusable: 'false' });
  const stepOf = (blockId, unit) => steps.findIndex((s) => s.kind === 'unit' && s.blockId === blockId && s.unitIndex === unit);
  const entries = []; // 모듈에 적힌 표시들(글 단위 번호는 걸음 번호로 바꿔 둔다)
  for (const scene of mod.scenes) {
    for (const block of scene.blocks) {
      for (const [i, pt] of (block.type === 'text' ? block.points ?? [] : []).entries()) {
        const at = findWord(block.units[pt.unit], pt.word, pt.nth ?? 1);
        const parts = sentencePartsOf(block, block.units[pt.unit]);
        const to = pt.to;
        const target = to.cell !== undefined
          ? { cell: to.cell, blockId: to.block }
          : { step: stepOf(to.block, to.unit), at: findWord(scene.blocks.find((b) => b.id === to.block).units[to.unit], to.text, to.nth ?? 1) };
        entries.push({ key: `${block.id}:${i}`, step: stepOf(block.id, pt.unit), at, sentence: sentenceAt(parts, at.start), target });
      }
    }
  }
  const born = new Map();      // 키 → 처음 나타난 시각(움직임을 이어 보이게)
  const dismissed = new Set(); // '걸음:문장' — 다음 문장으로 넘어간 문장의 화살표는 다시 나오지 않는다
  let lastArrow = null;        // { key, group } — 사라질 때 옅어지는 꼴로 잠깐 남긴다
  let ghost = null;       // { node, until }

  const age = (key, now) => { if (!born.has(key)) born.set(key, now); return now - born.get(key); };
  // style 속성을 문자열로 두면 CSP(style-src 'self')가 막는다 — CSSOM(el.style)으로 준다
  const timed = (el, key, now) => { el.style.setProperty('--t', `${-Math.round(age(key, now))}ms`); return el; };
  const underPath = (rects, box) => rects.map((r) => `M ${r.left - box.left} ${r.bottom - box.top + 1} H ${r.right - box.left}`).join(' ');

  // 화살표 대상의 자리: { rects(밑줄 줄 조각들) | cell(칸 모양), end: { x, top, bottom } } 또는 아직 없으면 null
  function targetSpot(t) {
    if (t.cell) {
      const cell = handles.get(t.blockId)?.el.querySelectorAll('tbody tr')[t.cell[0]]?.children[t.cell[1]];
      const r = cell?.getBoundingClientRect();
      return r && r.width > 0 ? { cell: r, x: (r.left + r.right) / 2, top: r.top, bottom: r.bottom } : null;
    }
    const p = stepEls.get(t.step);
    const rects = p && !p.hidden ? wordRects(p, t.at.start, t.at.end) : [];
    if (!rects.length) return null;
    const r = widest(rects);
    return { rects, x: (r.left + r.right) / 2, top: r.top, bottom: r.bottom + 1 };
  }

  function sync() {
    if (!entries.length) return;
    const now = performance.now();
    const box = flow.getBoundingClientRect();
    const rd = reading();
    const kids = [];
    let arrow = null;
    const shown = [];
    for (const e of entries) {
      const p = stepEls.get(e.step);
      const rects = p && !p.hidden ? wordRects(p, e.at.start, e.at.end) : [];
      if (!rects.length) continue;
      shown.push({ e, rects });
      if (e.step !== rd.step || dismissed.has(`${e.step}:${e.sentence}`) || (rd.sentence !== null && rd.sentence !== e.sentence)) continue;
      const spot = targetSpot(e.target);
      if (spot) arrow = { e, rects, spot }; // 한 화면에 화살표는 하나 — 가장 나중 것
    }
    for (const { e, rects } of shown) {
      kids.push(timed(svg('path', { class: `point-under${arrow?.e === e ? '' : ' is-quiet'}`, pathLength: 1, d: underPath(rects, box) }), `u:${e.key}`, now));
    }
    let group = null;
    if (arrow) {
      const { e, rects, spot } = arrow;
      const src = widest(rects);
      const sx = (src.left + src.right) / 2 - box.left;
      const sy = src.bottom - box.top + 1;
      const up = spot.bottom < src.bottom;
      const ex = spot.x - box.left;
      const ey = (up ? spot.bottom : spot.top) - box.top;
      const view = document.documentElement.clientWidth;
      let left = sx < box.width / 2;
      const mk = flow.querySelector('.sent-marker:not([hidden])')?.getBoundingClientRect(); // ▼ 가 가는 쪽에 있으면 반대쪽 빈자리로 나간다(▼ 위를 지나가지 않게)
      const mid = (src.left + src.right) / 2;
      if (mk && mk.bottom > src.top && mk.top < src.bottom + 30 && (left ? mk.right < mid : mk.left > mid)) left = !left;
      const room = left ? box.left : view - box.right; // 글 칸 옆의 빈자리 — 화면 밖으로 나가 가로 스크롤이 생기지 않게
      const push = Math.max(4, Math.min(26, room - 6));
      const { d, vs } = arrowPath({ sx, sy, ex, ey, bowX: left ? -push : box.width + push });
      const t = (el) => timed(el, `a:${e.key}`, now);
      group = svg('g', { class: 'point-arrow-group', 'data-end-x': Math.round(ex), 'data-end-y': Math.round(ey) },
        spot.cell
          ? t(svg('rect', { class: 'point-mark', pathLength: 1, x: spot.cell.left - box.left - 1, y: spot.cell.top - box.top - 1, width: spot.cell.width + 2, height: spot.cell.height + 2, rx: 4 }))
          : t(svg('path', { class: 'point-mark', pathLength: 1, d: underPath(spot.rects, box) })),
        t(svg('path', { class: 'point-arrow', pathLength: 1, d })),
        t(svg('path', { class: 'point-head', d: `M ${ex - 4.5} ${ey - vs * 7} L ${ex} ${ey} L ${ex + 4.5} ${ey - vs * 7}` })));
      kids.push(group);
    }
    if (lastArrow && lastArrow.key !== arrow?.e.key && !reducedMotion.matches) { // 화살표가 바뀌거나 사라졌다 — 앞 것을 옅어지며 지운다
      const node = lastArrow.group.cloneNode(true);
      node.classList.add('point-leave');
      ghost = { node, until: now + LEAVE_MS };
    }
    lastArrow = arrow ? { key: arrow.e.key, group } : null;
    if (ghost && now < ghost.until) { ghost.node.style.animationDelay = `${ghost.until - now - LEAVE_MS}ms`; kids.push(ghost.node); } // 다시 붙여도 옅어지는 움직임이 처음부터 다시 시작하지 않게
    else ghost = null;
    layer.replaceChildren(...kids);
  }

  // 다음 문장으로 넘어간다 — 그 문장의 화살표는 사라진다(읽는 문장이 바뀌기 전에 곧바로).
  function dismiss(step, sentence) { dismissed.add(`${step}:${sentence}`); sync(); }

  return { layer, sync, dismiss };
}
