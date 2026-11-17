// 표시용 서식. 로캘 의존(toLocaleString)을 피해 어느 환경에서나 같은 문자열이 나오게 한다.

export function formatNumber(n) {
  if (!Number.isFinite(n)) return String(n);
  const sign = n < 0 ? '-' : '';
  const [int, frac] = Math.abs(n).toString().split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + grouped + (frac ? '.' + frac : '');
}

// 걸린 시간은 보여 주기만 하고 평가하지 않는다. 1분 미만은 초로 적는다.
export function formatDuration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}초`;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}
