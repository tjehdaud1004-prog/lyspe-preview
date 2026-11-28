// 낱말에서 위의 수 · 표 칸을 가리키는 밑줄 화살표 그리기(SPEC_POINT.md, K04 A179). 순수 계산은 core/point.js.
// DOM 을 글 안에 넣지 않는다: 글 단위는 문장 span 의 글 노드라 타자기가 다시 채운다. 낱말 · 대상의 자리는 Range(글자 위치)로 재고,
// 읽기 흐름(.flow) 위에 겹친 SVG 한 장(pointer-events 없음, 읽는 프로그램에는 숨김)에 밑줄 · 화살표 · 테두리를 그린다. sync() 는 매번 그림 전체를 다시 만든다 —
// 움직임은 CSS 애니메이션이고, 다시 만들어도 이어서 보이도록 처음 나타난 때부터 지난 시간만큼 음의 지연(--t)을 준다.
import { svg } from './dom.js';
import { sentencePartsOf } from '../core/sentences.js';
import { findWord, sentenceAt, throughPath } from '../core/point.js';

const LEAVE_MS = 250; // 사라질 때 옅어지는 시간
const POINT_MS = 700; // 화살표가 그려지는 동안(밑줄 0.3 + 선 0.58 + 화살촉 0.1 은 reader.css) — 이 동안 .flow 에 is-pointing(글이 연해짐)

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

// 그림 부품 대상(점 · 축 · 교점)을 figure.js 가 단 표시로 찾는 선택자(계열 id 는 영문 · 숫자 · - · _ 만 쓰므로 따옴표 안에 그대로 둔다)
const PART_SELECTOR = (to) => (to.point ? `[data-pt="${to.point[0]}:${to.point[1]}"]` : to.axis ? `[data-axis="${to.axis}"]` : `[data-mark="${to.mark}"]`);

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
          : to.text === undefined ? { part: PART_SELECTOR(to), kind: to.axis !== undefined ? 'axis' : 'ring', blockId: to.block } // 그림 속 점 · 축 · 교점 — figure.js 가 단 data-pt · data-axis · data-mark
          : { step: stepOf(to.block, to.unit), at: findWord(scene.blocks.find((b) => b.id === to.block).units[to.unit], to.text, to.nth ?? 1) };
        entries.push({ key: `${block.id}:${i}`, step: stepOf(block.id, pt.unit), at, sentence: sentenceAt(parts, at.start), target });
      }
    }
  }
  const born = new Map();      // 키 → 처음 나타난 시각(움직임을 이어 보이게)
  const dismissed = new Set(); // '걸음:문장' — 다음 문장으로 넘어간 문장의 화살표는 다시 나오지 않는다
  let lastArrow = null;        // { key, group } — 사라질 때 옅어지는 꼴로 잠깐 남긴다
  let ghost = null;       // { node, until }
  let settleTimer = 0;

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
    if (t.part) { // 그림 부품: 축은 이름 글자 아래 밑줄, 점 · 교점은 둥근 고리(끝은 고리의 가장자리)
      const r = handles.get(t.blockId)?.el.querySelector(t.part)?.getBoundingClientRect();
      if (!r || !(r.width > 0)) return null;
      const x = (r.left + r.right) / 2;
      if (t.kind === 'axis') return { rects: [r], x, top: r.top, bottom: r.bottom + 1 };
      const cy = (r.top + r.bottom) / 2;
      const radius = Math.max(r.width, r.height) / 2 + 4;
      return { ring: { cx: x, cy, r: radius }, x, top: cy - radius, bottom: cy + radius };
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
      if (!rects.length) { // 낱말이 화면 글에서 사라졌다(처음부터 · 되돌림) — 다시 나오면 처음처럼 그린다(화면 밖 스크롤은 글이 남아 있어 여기 오지 않는다)
        born.delete(`u:${e.key}`); born.delete(`a:${e.key}`); dismissed.delete(`${e.step}:${e.sentence}`);
        continue;
      }
      shown.push({ e, rects });
      if (e.step !== rd.step || dismissed.has(`${e.step}:${e.sentence}`) || (rd.sentence !== null && rd.sentence !== e.sentence)) continue;
      const spot = targetSpot(e.target);
      // 대상이 지금 화면(머리 띠 아래 ~ 창 아래)에 없으면 긋지 않는다 — 화면 밖까지 뻗는 선은 가리키는 것이 보이지 않는다
      const viewTop = Math.max(0, document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0);
      if (spot && spot.bottom > viewTop && spot.top < window.innerHeight) arrow = { e, rects, spot }; // 한 화면에 화살표는 하나 — 가장 나중 것
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
      const rel = (r) => ({ x: (r.left + r.right) / 2 - box.left, top: r.top - box.top, bottom: r.bottom - box.top });
      const { d, end, dir } = throughPath({
        src: { ...rel(src), bottom: sy },
        dst: { x: spot.x - box.left, top: spot.top - box.top, bottom: spot.bottom - box.top, ring: spot.ring && { cx: spot.ring.cx - box.left, cy: spot.ring.cy - box.top, r: spot.ring.r } },
        side: sx < box.width / 2 ? 1 : -1, // 글 칸 가운데쪽으로 살짝 휜다
      });
      const head = `M ${end.x - dir.x * 7 - dir.y * 4.5} ${end.y - dir.y * 7 + dir.x * 4.5} L ${end.x} ${end.y} L ${end.x - dir.x * 7 + dir.y * 4.5} ${end.y - dir.y * 7 - dir.x * 4.5}`;
      const t = (el) => timed(el, `a:${e.key}`, now);
      group = svg('g', { class: 'point-arrow-group', 'data-end-x': Math.round(end.x), 'data-end-y': Math.round(end.y) },
        spot.ring
          ? t(svg('circle', { class: 'point-mark', pathLength: 1, cx: spot.ring.cx - box.left, cy: spot.ring.cy - box.top, r: spot.ring.r }))
          : spot.cell
          ? t(svg('rect', { class: 'point-mark', pathLength: 1, x: spot.cell.left - box.left - 1, y: spot.cell.top - box.top - 1, width: spot.cell.width + 2, height: spot.cell.height + 2, rx: 4 }))
          : t(svg('path', { class: 'point-mark', pathLength: 1, d: underPath(spot.rects, box) })),
        t(svg('path', { class: 'point-arrow', pathLength: 1, d })),
        t(svg('path', { class: 'point-head', d: head })));
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
    // 그리는 동안(처음 나타난 때부터 POINT_MS)만 글을 연하게 — 나이로 가르므로 다시 재도 다시 시작하지 않고, 화살표가 없어지면 이 sync 에서 곧바로 뗀다
    const left = arrow && !reducedMotion.matches ? POINT_MS - age(`a:${arrow.e.key}`, now) : 0;
    flow.classList.toggle('is-pointing', left > 0);
    clearTimeout(settleTimer);
    if (left > 0) settleTimer = setTimeout(sync, left + 20); // 그리기가 끝나는 때 한 번 더 — ▼ 앞에서 기다리는 동안 아무도 sync 를 부르지 않을 수 있다
  }

  // 다음 문장으로 넘어간다 — 그 문장의 화살표는 사라진다(읽는 문장이 바뀌기 전에 곧바로).
  function dismiss(step, sentence) { dismissed.add(`${step}:${sentence}`); sync(); }

  return { layer, sync, dismiss };
}
