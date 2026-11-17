// 보기 섞기(모듈 머리의 shuffleOptions). 순수 함수 — DOM 을 모른다.
//  - 섞는 순서는 결정적이다: 이 모듈 시작(세션)마다 한 번 만든 씨앗(progress.shuffleSeed) + 문항 key 로 정한다.
//    새로 고침·이어 하기에서 같은 순서가 나오고, '처음부터'(새 진행)에서는 새 씨앗이라 바뀔 수 있다.
//  - 모듈이 shuffleOptions: true 를 켜지 않으면 아무것도 하지 않는다(null). 문항에 fixedOrder: true 면 그 문항만 섞지 않는다.
//  - 답·오답 맞춤은 보기 id 로 하므로 섞어도 바뀌지 않는다. 학습자에게 보인 차례(id 배열)는 shownOrder 로 기록에 더한다.
//  - 가르기 묶음(sort)의 갈래 단추는 섞지 않는다(그것은 answer 가 없는 문항이라 여기 오지 않는다).
import { blankEntries } from './link.js';

const SEED_PATTERN = /^[0-9a-f]{8}$/;
export const isShuffleSeed = (s) => typeof s === 'string' && SEED_PATTERN.test(s);

/** 새 씨앗(16진 8자). random 은 시험에서 바꿔 끼운다. */
export function newShuffleSeed(random = Math.random) {
  let out = '';
  for (let i = 0; i < 8; i += 1) out += Math.floor(random() * 16).toString(16);
  return out;
}

// 문자열 → 32비트 정수(FNV-1a), 정수 → 0~1 난수열(mulberry32).
function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  let t = a >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** id 배열을 씨앗 + key 로 결정적으로 섞은 새 배열. */
export function shuffleIds(ids, seed, key) {
  const out = [...ids];
  const next = mulberry32(hash32(`${seed}|${key}`));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 이 문항의 보기를 학습자에게 보일 차례(id 배열). 섞지 않는 경우(모듈이 안 켬 · 고르는 문항이 아님 · fixedOrder · 씨앗 없음)는 null.
 * item: answer 와 (선택) fixedOrder 를 가진 것(확인 문항 블록 · 문제의 부분 · 연결 빈칸 · 묶음 문항 · 본문 밖 문항 …).
 */
export function optionOrder(mod, progress, key, item) {
  if (mod?.shuffleOptions !== true) return null;
  if (item?.answer?.kind !== 'choice' || item.fixedOrder === true) return null;
  const seed = progress?.shuffleSeed;
  if (!isShuffleSeed(seed)) return null;
  return shuffleIds(item.answer.options.map((o) => o.id), seed, key);
}

/** 진행 상태에 씨앗을 갖춰 돌려준다(모듈이 켰고 아직 없을 때만). 같은 객체를 돌려주면 바뀐 게 없다. */
export function withShuffleSeed(mod, progress, random = Math.random) {
  if (mod?.shuffleOptions !== true || isShuffleSeed(progress.shuffleSeed)) return progress;
  return { ...progress, shuffleSeed: newShuffleSeed(random) };
}

/**
 * 보기를 가진 문항의 목록 [{ key, item }] (all: true 면 답 종류를 가리지 않는 모든 채점 문항). 화면이 key 로 섞고, 점검(check-module)이 같은 목록을 센다.
 * key 의 꼴은 걷기 도구의 답안지와 같다: check `블록`, problem·transfer `블록#부분`, link 빈칸 `블록#단계`, round `블록/문항`,
 * 여는 카드 `opener`(끝 화면의 다시 보기는 `opener/revisit`), 시작 전 `pre/문항`, 며칠 뒤 `delayed/문항`, 건너뛰기 확인 `skip/문항`, 복습 `review/문항`.
 */
export function choiceItems(mod, { all = false } = {}) {
  const out = [];
  const add = (key, item) => { if (all ? item?.answer !== undefined : item?.answer?.kind === 'choice') out.push({ key, item }); };
  for (const scene of mod.scenes ?? []) {
    for (const block of scene.blocks ?? []) {
      if (block.type === 'check') add(block.id, block);
      else if (block.type === 'problem' || block.type === 'transfer') for (const part of block.parts ?? []) add(`${block.id}#${part.id}`, part);
      else if (block.type === 'link' && block.mode === 'complete') for (const { key, blank } of blankEntries(block)) add(key, blank);
      else if (block.type === 'round' && block.mode !== 'sort') for (const item of block.items ?? []) add(`${block.id}/${item.id}`, item);
    }
  }
  if (mod.opener?.answer) add('opener', mod.opener); // 여는 카드(core/opener.js)
  for (const item of mod.preCheck?.items ?? []) add(`pre/${item.id}`, item);
  for (const item of mod.delayedCheck?.items ?? []) add(`delayed/${item.id}`, item);
  for (const goal of mod.skipCheck?.goals ?? []) for (const item of goal.items ?? []) add(`skip/${item.id}`, item);
  for (const item of mod.review?.items ?? []) add(`review/${item.id}`, item);
  return out;
}

/**
 * 정답 자리가 한쪽으로 쏠렸는데 섞지 않는 모듈에 대한 경고 문장(없으면 null).
 * 조건: shuffleOptions 가 없고, 고르는 문항이 4개 이상이고, 정답이 놓인 자리(보기 차례) 하나가 문항의 절반을 넘는다.
 */
/** 형식 오류 목록: shuffleOptions 는 true|false, fixedOrder 는 true|false 이고 고르는 문항에만. 앞의 형식 검증을 통과한 모듈에만 돌린다. */
export function shuffleFlagErrors(mod) {
  const errors = [];
  if (mod.shuffleOptions !== undefined && typeof mod.shuffleOptions !== 'boolean') errors.push('shuffleOptions 는 true|false');
  for (const { key, item } of choiceItems(mod, { all: true })) {
    if (item.fixedOrder === undefined) continue;
    if (typeof item.fixedOrder !== 'boolean') errors.push(`${key}: fixedOrder 는 true|false`);
    else if (item.answer?.kind !== 'choice') errors.push(`${key}: fixedOrder 는 고르는(choice) 문항에만 쓴다`);
  }
  return errors;
}

export function answerPositionWarning(mod) {
  if (mod.shuffleOptions === true) return null;
  const items = choiceItems(mod).filter(({ item }) => Array.isArray(item.answer.options));
  if (items.length < 4) return null;
  const counts = new Map();
  for (const { item } of items) {
    const at = item.answer.options.findIndex((o) => o.id === item.answer.value);
    counts.set(at, (counts.get(at) ?? 0) + 1);
  }
  const [at, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n * 2 <= items.length) return null;
  return `고르는 문항 ${items.length}개 중 ${n}개의 정답이 ${at + 1}번째 보기다(절반 넘음). 모듈 머리에 "shuffleOptions": true 를 켜거나 정답 자리를 고르게 흩으세요`;
}
