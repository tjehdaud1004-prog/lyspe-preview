// 본문 보기 방식: '장면별로 보기'(scene, 기본 — 한 번에 한 장면만 보인다) / '이어서 쌓기'(stack — 지난 장면이 같은 흐름
// 위쪽에 남는 긴 스크롤). 순수 함수 — DOM 을 모른다. 어느 장면이 보이는가만 정하고, 진행·문항 상태·노트는 건드리지 않는다.
//
// 장면별로 볼 때도 지난 장면은 '앞 장면 보기'로 언제든 돌아가 볼 수 있다(되읽기를 막지 않는다 — parts/04 근거 [A6]).
// browsing: 지금 장면 대신 보고 있는 지난 장면 번호(0부터). null 이면 지금 읽는 장면이다.

export const FLOW_VIEWS = Object.freeze(['scene', 'stack']);
export const FLOW_VIEW_LABELS = Object.freeze({ scene: '장면별로 보기', stack: '이어서 쌓기' });
// 1.05: 기본을 장면별로 보기로(사용자 결정 U-1006e — 긴 스크롤이 불리할 수 있다는 근거 parts/04 [VAB-2][VAB-3][A19]).
// 어느 쪽이 낫다고 확인된 것은 아니다. 긴 스크롤은 설정에서 고를 수 있다.
export const DEFAULT_FLOW_VIEW = 'scene';

// 이 장면이 지금 보이는가.
export function isSceneShown({ view, sceneIndex, currentScene, browsing = null }) {
  if (view !== 'scene') return true;
  return sceneIndex === (browsing ?? currentScene);
}

// 앞(-1)·뒤(+1)로 한 장면 옮긴 browsing 값. 지금 장면보다 뒤로는 갈 수 없고(아직 안 열렸다), 지금 장면에 닿으면 null.
export function browseBy({ view, currentScene, browsing = null, delta }) {
  if (view !== 'scene') return null;
  const target = Math.min(currentScene, Math.max(0, (browsing ?? currentScene) + delta));
  return target === currentScene ? null : target;
}

// 이동 막대에 필요한 값. 첫 장면에서는 갈 곳이 없으므로 막대를 내지 않는다(누를 수 없는 단추만 보이지 않게).
export function sceneNav({ view, currentScene, browsing = null, sceneCount }) {
  if (view !== 'scene' || currentScene === 0) return { visible: false };
  const shown = browsing ?? currentScene;
  return {
    visible: true, shown, atCurrent: shown === currentScene,
    canPrev: shown > 0, canNext: shown < currentScene,
    label: shown === currentScene ? `장면 ${shown + 1} / ${sceneCount}` : `장면 ${shown + 1} / ${sceneCount} (지금 읽는 장면은 ${currentScene + 1})`,
  };
}
