// 낱말에서 위의 수 · 표 칸을 가리키는 밑줄 화살표의 순수 계산(SPEC_POINT.md, K04 A179). DOM · 시계를 모른다 — 그리기는 ui/point.js.
// 모듈 표시(text 블록의 points)의 검사 · 글 안에서 낱말 찾기 · 낱말이 속한 문장 · 화살표 곡선의 모양.

const isInt = (v) => Number.isInteger(v) && v >= 0;
const isStr = (v) => typeof v === 'string' && v !== '';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// text 안에서 word 가 nth 번째(1부터) 나오는 자리 { start, end }. 없으면 null.
export function findWord(text, word, nth = 1) {
  if (!isStr(word) || !Number.isInteger(nth) || nth < 1) return null;
  let at = -1;
  for (let i = 0; i < nth; i += 1) {
    at = text.indexOf(word, at + 1);
    if (at < 0) return null;
  }
  return { start: at, end: at + word.length };
}

// 글자 자리 offset 이 parts(문장 조각들, 이으면 글 전체) 의 몇째 문장인가(0부터). 끝을 넘으면 마지막.
export function sentenceAt(parts, offset) {
  let acc = 0;
  for (let i = 0; i < parts.length; i += 1) {
    acc += parts[i].length;
    if (offset < acc) return i;
  }
  return Math.max(0, parts.length - 1);
}

// 대상의 종류: 글(text) | 표 칸(cell) | 점 그래프의 점(point) | 점 · 직선 그래프의 축(axis) | 직선 그래프의 교점(mark). 정확히 하나만 적혀 있지 않으면 null.
const TARGET_KINDS = ['text', 'cell', 'point', 'axis', 'mark'];
export const targetKind = (to) => {
  const keys = isObj(to) ? TARGET_KINDS.filter((k) => to[k] !== undefined) : [];
  return keys.length === 1 ? keys[0] : null;
};

// 그림 부품(점 · 축 · 교점) 대상의 오류 한 줄(없으면 null). def 는 대상 그림 블록의 figures 정의(없거나 그림 블록이 아니면 undefined).
function figurePartError(kind, to, def) {
  const id = to.block;
  if (def?.kind !== 'points' && def?.kind !== 'lines') return `${kind} 은(는) 점 그래프(kind: "points")나 직선 그래프(kind: "lines") 그림 블록에만 쓴다 — '${id}' 은(는) 그런 그림이 아니다(image 그림의 부품은 가리키지 않는다)`;
  if (kind === 'axis') {
    if (to.axis !== 'x' && to.axis !== 'y') return `axis 는 "x" 또는 "y"`;
    return to.axis === 'y' && def.numberLine === true ? `axis "y" 는 수직선(numberLine) 그림에 없다` : null;
  }
  if (kind === 'mark') {
    if (def.kind !== 'lines') return `mark 는 직선 그래프(lines) 그림에만 쓴다 — '${id}' 은(는) 점 그래프다`;
    if (!isInt(to.mark)) return 'mark 는 0 이상의 정수(marks 의 번호)';
    const n = def.marks?.length ?? 0;
    return to.mark >= n ? `mark ${to.mark} 이(가) marks 범위 밖이다(${n}개)` : null;
  }
  if (def.kind !== 'points') return `point 는 점 그래프(points) 그림에만 쓴다 — '${id}' 은(는) 직선 그래프다`;
  const [sid, i] = Array.isArray(to.point) && to.point.length === 2 ? to.point : [];
  if (!isStr(sid) || !isInt(i)) return 'point 는 [계열 id, 번호] (번호는 0부터)';
  const s = def.series?.find((x) => x?.id === sid);
  if (!s) return `point: 계열 '${sid}' 이(가) '${id}' 그림에 없다`;
  return i >= (s.points?.length ?? 0) ? `point: 계열 '${sid}' 의 번호 ${i} 이(가) 범위 밖이다(점 ${s.points?.length ?? 0}개)` : null;
}

// 장면 하나의 글 블록들의 points 를 검사한다(검사 위치는 module.js 의 장면 반복). 틀린 곳마다 한국어 한 줄을 errors 에 넣는다.
export function checkPoints(scene, mod, sceneWhere, errors) {
  scene.blocks.forEach((block, bi) => {
    if (block?.points === undefined) return;
    const bw = `${sceneWhere}.blocks[${bi}]`;
    if (block.type !== 'text') { errors.push(`${bw}: points 는 글 블록에만 둔다`); return; }
    if (!Array.isArray(block.units) || !block.units.every(isStr)) return; // units 오류는 checkBlock 이 알린다
    if (!Array.isArray(block.points)) { errors.push(`${bw}.points: 배열이어야 한다`); return; }
    block.points.forEach((pt, i) => {
      const w = `${bw}.points[${i}]`;
      if (!isObj(pt)) { errors.push(`${w}: { unit, word, to } 객체여야 한다`); return; }
      if (!isInt(pt.unit) || pt.unit >= block.units.length) errors.push(`${w}: unit 은 0 이상 ${block.units.length - 1} 이하의 정수(이 블록의 글 단위 번호)`);
      else if (!isStr(pt.word) || findWord(block.units[pt.unit], pt.word, pt.nth ?? 1) === null) errors.push(`${w}: word '${pt.word}' 이(가) 글 단위 ${pt.unit} 안에 ${pt.nth ?? 1}번째로 없다(글에 있는 그대로 적는다)`);
      if (pt.nth !== undefined && (!Number.isInteger(pt.nth) || pt.nth < 1)) errors.push(`${w}: nth 는 1 이상의 정수`);
      const to = pt.to;
      const kind = targetKind(to);
      if (kind === null) { errors.push(`${w}.to: { block, unit, text } (글) · { block, cell: [행, 열] } (표 칸) · { block, point: [계열, 번호] } (점) · { block, axis: "x"|"y" } (축) · { block, mark: 번호 } (교점) 중 하나여야 한다`); return; }
      const target = scene.blocks.find((b) => b?.id === to.block);
      if (!target) { errors.push(`${w}.to: block '${to.block}' 이(가) 같은 장면에 없다`); return; }
      if (kind === 'text') {
        if (target.type !== 'text' || !Array.isArray(target.units)) { errors.push(`${w}.to: block '${to.block}' 은(는) 글 블록이 아니다(글을 가리키려면 글 블록)`); return; }
        if (!isInt(to.unit) || to.unit >= target.units.length) { errors.push(`${w}.to: unit 은 0 이상 ${target.units.length - 1} 이하의 정수`); return; }
        if (to.nth !== undefined && (!Number.isInteger(to.nth) || to.nth < 1)) errors.push(`${w}.to: nth 는 1 이상의 정수`);
        else if (findWord(target.units[to.unit], to.text, to.nth ?? 1) === null) errors.push(`${w}.to: text '${to.text}' 이(가) '${to.block}' 의 글 단위 ${to.unit} 안에 ${to.nth ?? 1}번째로 없다`);
        return;
      }
      const def = target.type === 'figure' ? mod.figures?.[target.figure] : null;
      if (kind !== 'cell') { const msg = figurePartError(kind, to, def); if (msg) errors.push(`${w}.to: ${msg}`); return; }
      if (def?.kind !== 'table' || !Array.isArray(def.rows)) { errors.push(`${w}.to: cell 은 표(kind: "table") 그림 블록에만 쓴다 — '${to.block}' 은(는) 표가 아니다`); return; }
      const [r, c] = Array.isArray(to.cell) && to.cell.length === 2 ? to.cell : [];
      if (!isInt(r) || !isInt(c)) errors.push(`${w}.to: cell 은 [행, 열] 두 정수(0부터, 머리 줄 제외)`);
      else if (r >= def.rows.length || c >= (def.rows[r]?.length ?? 0)) errors.push(`${w}.to: cell [${r}, ${c}] 이(가) 표 범위 밖이다(${def.rows.length}줄, 줄마다 ${def.rows[0]?.length ?? 0}칸)`);
    });
  });
}

// 화살표 길: 낱말 밑줄 가운데(sx, sy)에서 줄 사이 빈틈으로 옆 빈자리(bowX)까지 나가 대상 쪽으로 올라(내려)가고, 대상의 밑줄 아래 빈틈으로 들어와 도착점(ex, ey)에 닿는다.
// 글줄을 가로지르지 않도록 줄과 줄 사이만 지난다(직선이 글을 가로지르면 읽기를 방해한다 — 제작 판단). 모서리는 둥글게(Q) 이은 선 하나.
// 돌려주는 값: path 의 d · 끝에서 화살촉이 향하는 y 방향(vs: -1 위, 1 아래). 두 줄이 너무 가까우면(같은 줄 근처) 단순한 굽은 선 하나.
// 옆으로 닿는 길(축 이름): 낱말 밑줄 아래 → 글 칸 옆 빈자리(bowX) → 대상 가운데 높이(ey) → 수평으로 대상 옆(ex). 둥근 모서리 둘.
export function sidePath({ sx, sy, ex, ey, bowX, radius = 8, lane = 3 }) {
  const yS = sy + lane;
  const vs = ey < yS ? -1 : 1;
  const dirX = bowX >= sx ? 1 : -1;
  const r = Math.max(0, Math.min(radius, Math.abs(bowX - sx) / 2, Math.abs(ex - bowX) / 2, Math.abs(ey - yS) / 2));
  const f = (n) => Math.round(n * 10) / 10;
  const d = [
    `M ${f(sx)} ${f(sy)}`, `V ${f(yS)}`, `H ${f(bowX - dirX * r)}`,
    `Q ${f(bowX)} ${f(yS)} ${f(bowX)} ${f(yS + vs * r)}`, `V ${f(ey - vs * r)}`,
    `Q ${f(bowX)} ${f(ey)} ${f(bowX - dirX * r)} ${f(ey)}`, `H ${f(ex)}`,
  ].join(' ');
  return { d };
}

export function arrowPath({ sx, sy, ex, ey, bowX, radius = 8, lane = 3, approach = 5 }) {
  const vs = ey < sy ? -1 : 1;
  const yS = sy + lane;
  const yE = ey - vs * approach;
  const dirX = bowX >= sx ? 1 : -1;
  const r = Math.min(radius, Math.abs(bowX - sx) / 2, Math.abs(bowX - ex) / 2, Math.abs(yE - yS) / 4);
  if (!(r >= 2)) return { d: `M ${sx} ${sy} Q ${(sx + ex) / 2} ${Math.max(sy, ey) + 24} ${ex} ${ey}`, vs: -1 };
  const f = (n) => Math.round(n * 10) / 10;
  const d = [
    `M ${f(sx)} ${f(sy)}`, `V ${f(yS)}`, `H ${f(bowX - dirX * r)}`,
    `Q ${f(bowX)} ${f(yS)} ${f(bowX)} ${f(yS + vs * r)}`, `V ${f(yE - vs * r)}`,
    `Q ${f(bowX)} ${f(yE)} ${f(bowX - dirX * r)} ${f(yE)}`, `H ${f(ex + dirX * r)}`,
    `Q ${f(ex)} ${f(yE)} ${f(ex)} ${f(yE + vs * Math.min(r, approach - 1))}`, `V ${f(ey)}`,
  ].join(' ');
  return { d, vs };
}
