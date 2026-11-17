// 실제 서비스용 접속부의 '자리'. 지금은 어디에도 연결하지 않는다(core/ai/config.js 가 이것을 쓰지 않는다).
// 규칙:
//  · endpoint 는 같은 출처의 상대 경로만 받는다('/' 로 시작, '//' 와 역슬래시 금지). 바깥 주소는 예외로 막는다.
//  · 키는 브라우저에 두지 않는다. 키는 서버 쪽 중계기에 둔다. 중계기는 아직 없다.
//  · 기본 요청 함수를 두지 않는다. 반드시 넘겨받는다 — 실수로 실제 요청이 나가지 않게. 시험은 가짜 함수로만 돈다.
//  · 쿠키·인증 정보를 싣지 않는다(credentials: 'omit').
const SAME_ORIGIN_PATH = /^\/(?![/\\])[^\s\\]*$/;

export function createHttpProvider({ endpoint, fetchImpl, label = 'AI 도우미', id = 'http' } = {}) {
  if (typeof endpoint !== 'string' || !SAME_ORIGIN_PATH.test(endpoint)) throw new Error('endpoint 는 같은 출처의 상대 경로(슬래시로 시작)만 받는다');
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl 을 넘겨야 한다(기본 요청 함수는 없다)');
  return {
    id, label, isReal: true,
    async ask(request, { signal } = {}) {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal,
        credentials: 'omit',
      });
      if (!res || res.ok !== true) throw new Error(`서비스 응답 오류(${res?.status ?? '없음'})`);
      return res.json();
    },
  };
}
