// localStorage 래퍼. backend 는 getItem/setItem/removeItem 만 있으면 되므로 시험에서 가짜로 바꿀 수 있다.
// 모든 접근을 try/catch 로 감싼다 — 사생활 보호 모드·용량 초과에서도 화면은 떠야 한다.

export const PREFIX = 'lyon.v0.';
export const keys = {
  settings: () => `${PREFIX}settings`,
  progress: (moduleId) => `${PREFIX}progress.${moduleId}`,
  notes: (moduleId) => `${PREFIX}notes.${moduleId}`,
  // 복습 일정·회차(core/review.js). 모듈마다 하나. 시험 날짜는 모듈 공통이라 settings 에 있다.
  review: (moduleId) => `${PREFIX}review.${moduleId}`,
  // 학습 기록(기기 안에만 남는다). 기록 동의가 꺼져 있으면 아래 키들은 만들어지지 않는다.
  consent: () => `${PREFIX}consent`,
  learnerKey: () => `${PREFIX}learnerKey`,
  events: (moduleId) => `${PREFIX}events.${moduleId}`,
  recmeta: (moduleId) => `${PREFIX}recmeta.${moduleId}`,
};

export function createStorage(backend) {
  return {
    read(key) {
      try { return backend.getItem(key); } catch { return null; }
    },
    write(key, text) {
      try { backend.setItem(key, text); return true; } catch { return false; }
    },
    remove(key) {
      try { backend.removeItem(key); return true; } catch { return false; }
    },
  };
}

// 메모리 저장소: localStorage 를 못 쓸 때의 대체(새로고침하면 사라진다).
export function createMemoryBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

// 실제로 쓰고 지워 보아야 막힌 저장소를 알 수 있다. 쓸 수 없으면 null.
export function probeBackend(candidate) {
  try {
    const probe = `${PREFIX}probe`;
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return candidate;
  } catch { return null; }
}
