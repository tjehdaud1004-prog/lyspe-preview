// LySpe 모듈의 낱말 목록 — 인지 작업 아홉 묶음과 지식의 종류 네 가지. 의존 없음(schema.mjs 와 같은 원칙).
// 근거와 한계는 LySpe/parts/03_knowledge_and_cognitive_work.md. 이 목록은 모듈을 만드는 사람의 점검표이고,
// 뇌의 부품 목록·학습자 유형·진단 척도가 아니다. 학습자 화면에는 learner 글만 낸다(maker 글은 제작용).

export const WORK = Object.freeze({
  attend:       { maker: '주의 선택·해독',   learner: '필요한 글·수 찾아 읽기' },
  hold:         { maker: '유지·갱신·조작',   learner: '중간 값을 붙들고 쓰기' },
  retrieve:     { maker: '인출',             learner: '아는 것 떠올리기' },
  discriminate: { maker: '변별·범주화',      learner: '비슷한 것 가려내기' },
  relate:       { maker: '관계 구성·추론',   learner: '서로 이어 이유 대기' },
  procedure:    { maker: '절차 실행·숙련',   learner: '방법대로 풀어내기' },
  plan:         { maker: '계획·전략 선택',   learner: '무엇부터 할지 정하기' },
  integrate:    { maker: '통합·전이',        learner: '이어 붙여 새 상황에 쓰기' },
  monitor:      { maker: '점검·조절',        learner: '결과와 내 이해 살피기' },
});

// 지식의 종류 — 개정 Bloom 의 지식 차원 네 가지(parts/03 근거 [E4]). 방식을 자동으로 정하는 데 쓰지 않는다.
export const KNOWLEDGE = Object.freeze({
  fact:      { maker: '사실',     note: '낱낱의 값·용어' },
  concept:   { maker: '개념',     note: '관계·원리·구조' },
  procedure: { maker: '절차',     note: '하는 방법·순서' },
  meta:      { maker: '메타인지', note: '자기 이해와 전략에 대한 앎' },
});

export const WORK_IDS = Object.freeze(Object.keys(WORK));
export const KNOWLEDGE_IDS = Object.freeze(Object.keys(KNOWLEDGE));

// 학습자가 무언가 하는 블록 — work·knowledge 가 필수다. round(묶음 돌리기)는 문항을 푸는 블록이라 태그를 갖고, passage(지문)는 읽을 글이라 text 처럼 갖지 않는다.
export const TAGGED_BLOCK_TYPES = Object.freeze(['predict', 'check', 'link', 'problem', 'transfer', 'lookback', 'round']);

const PROBE_FIELDS = ['preCheck', 'delayedCheck'];

// 태그가 붙은 항목의 색인. id = 태그 대상 블록 id, 그리고 preCheck·delayedCheck 문항 id.
// scene = 장면 id(문항 묶음은 'preCheck' / 'delayedCheck'). 이벤트의 module·moduleVersion·block 과 맞춰 붙이는 데 쓴다.
export function tagIndex(mod) {
  const items = {};
  for (const scene of mod.scenes ?? []) {
    for (const block of scene.blocks ?? []) {
      if (!TAGGED_BLOCK_TYPES.includes(block.type)) continue;
      items[block.id] = { scene: scene.id, work: [...(block.work ?? [])], knowledge: [...(block.knowledge ?? [])] };
    }
  }
  for (const field of PROBE_FIELDS) {
    for (const item of mod[field]?.items ?? []) items[item.id] = { scene: field, work: [...(item.work ?? [])], knowledge: [...(item.knowledge ?? [])] };
  }
  return { module: mod.id, moduleVersion: mod.version, items };
}

// 경고(막지는 않는다): (a) 장면 focus 가운데 그 장면의 어떤 블록도 work 로 받치지 않는 것
// (b) 모듈 전체에서 한 번도 쓰이지 않은 인지 작업 묶음 (c) 한 번도 쓰이지 않은 지식의 종류.
export function tagWarnings(mod) {
  const warnings = [];
  for (const scene of mod.scenes ?? []) {
    const backed = new Set();
    for (const block of scene.blocks ?? []) if (TAGGED_BLOCK_TYPES.includes(block.type)) for (const w of block.work ?? []) backed.add(w);
    for (const f of scene.focus ?? []) if (!backed.has(f)) warnings.push(`장면 ${scene.id}: focus '${f}' 를 work 로 받치는 블록이 없다`);
  }
  const { items } = tagIndex(mod);
  const usedWork = new Set(Object.values(items).flatMap((i) => i.work));
  const usedKnowledge = new Set(Object.values(items).flatMap((i) => i.knowledge));
  for (const id of WORK_IDS) if (!usedWork.has(id)) warnings.push(`인지 작업 '${id}'(${WORK[id].maker}) 가 모듈 어디에도 쓰이지 않았다`);
  for (const id of KNOWLEDGE_IDS) if (!usedKnowledge.has(id)) warnings.push(`지식의 종류 '${id}'(${KNOWLEDGE[id].maker}) 가 모듈 어디에도 쓰이지 않았다`);
  return warnings;
}
