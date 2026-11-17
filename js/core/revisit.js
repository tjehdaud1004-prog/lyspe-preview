// 앞 글을 스크롤로 다시 보는 것을 한 번씩만 알아채는 규칙. 순수 함수 — 화면(IntersectionObserver)·시계는 밖에서 넣는다.
//
// 규칙: 읽는 위치(지금 열린 단계의 블록)보다 앞의 블록이 '보는 띠'(화면 가운데 부분)에 들어와 REVISIT_DWELL_MS 이상
// 계속 머물면 그 블록을 한 번 알린다. 스쳐 지나가는 스크롤(머문 시간이 모자람)과 스크롤 이벤트 하나하나는 세지 않는다.
// 같은 블록은 한 방문에 한 번이다. '방문' = 앞 글로 거슬러 올라간 한 번의 구간 — 읽는 위치의 블록이 화면에 다시 보이면
// 구간이 끝나고(= 지금으로 돌아옴) 다음에 다시 거슬러 가면 새 방문이다.
// 읽는 위치의 블록이 화면 어딘가에 보이는 동안은 '앞 글을 보러 간 것'이 아니라 지금 글을 읽는 중으로 보고 세지 않는다
// (조작 줄 위로 앞 블록의 끝이 조금 걸쳐 보이는 것만으로 기록되지 않게).

// 근거 없는 출발점: 사람이 앞 글을 '다시 읽는다'고 볼 만한 최소 머문 시간. 기록이 쌓인 뒤 분포를 보고 고친다.
export const REVISIT_DWELL_MS = 1500;

export function createRevisitTracker({ dwellMs = REVISIT_DWELL_MS } = {}) {
  const since = new Map(); // blockId → 보는 띠에 들어온 시각
  const fired = new Set(); // 이번 방문에서 이미 알린 블록
  return {
    // now: ms · inBand: 보는 띠에 있는 블록 id 들 · order: blockId → 읽는 순서 번호 · frontier: 읽는 위치의 블록 id
    // frontierVisible: 읽는 위치의 블록이 화면(어디든)에 보이는가
    // 돌려주는 값: 이번 호출에서 새로 알릴 블록 id 배열(대개 비어 있다)
    update({ now, inBand, order, frontier, frontierVisible }) {
      const fi = order.get(frontier);
      if (frontierVisible === true || fi === undefined) { since.clear(); fired.clear(); return []; }
      const candidates = new Set();
      for (const id of inBand) { const oi = order.get(id); if (oi !== undefined && oi < fi) candidates.add(id); }
      for (const id of [...since.keys()]) if (!candidates.has(id)) since.delete(id); // 띠를 벗어나면 머문 시간을 다시 센다
      const out = [];
      for (const id of candidates) {
        if (!since.has(id)) since.set(id, now);
        if (!fired.has(id) && now - since.get(id) >= dwellMs) { fired.add(id); out.push(id); }
      }
      return out;
    },
    reset() { since.clear(); fired.clear(); },
  };
}
