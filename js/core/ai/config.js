// 어떤 서비스를 연결할지 정하는 한 곳. 실제 서비스가 정해지면 여기 한 곳을 바꾼다.
// 지금은 연결된 서비스가 없다: 로컬 주소(localhost·127.0.0.1·[::1])에서 ?ai=fake 일 때만 가짜 응답기를 켜고, 그 밖에는 null 이다.
// null 이면 학습자 화면에 '질문하기' 칸이 나타나지 않는다.
import { createFakeProvider } from './fake-provider.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function resolveProvider({ search = '', hostname = '' } = {}) {
  let wanted = null;
  try { wanted = new URLSearchParams(String(search)).get('ai'); } catch { wanted = null; }
  if (wanted === 'fake' && LOCAL_HOSTS.has(String(hostname).toLowerCase())) return createFakeProvider();
  return null;
}
