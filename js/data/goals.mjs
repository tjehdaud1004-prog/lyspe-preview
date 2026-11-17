// LySpe 모듈의 건너뛰기 확인 색인 — 목표(skipCheck.goals)와, 그 목표를 건너뛴 뒤 다시 묻는 문항(goals 연결). 의존 없음(tags.mjs 와 같은 원칙).
// 이벤트에는 목표를 넣지 않는다. 이벤트의 module·moduleVersion·block·data.part·data.item 을 이 색인과 맞춰 붙인다(태그와 같은 원칙).
//
// goalIndex(mod) → {
//   module, moduleVersion,
//   goals: { 목표 id: { kind, label, scenes: [장면 id], items: [건너뛰기 문항 id] } },
//   followups: { '블록id#부분id' | '문항id': [목표 id…] }   // 뒤에서 다시 묻는 자리: 문제·전이 문제의 부분(본문), 시작 전·며칠 뒤 문항
// }

export function goalIndex(mod) {
  const goals = {};
  for (const g of mod.skipCheck?.goals ?? []) {
    goals[g.id] = { kind: g.kind, label: g.label, scenes: [...(g.scenes ?? [])], items: (g.items ?? []).map((it) => it.id) };
  }
  const followups = {};
  const link = (key, list) => { if (Array.isArray(list) && list.length > 0) followups[key] = [...list]; };
  for (const scene of mod.scenes ?? []) {
    for (const block of scene.blocks ?? []) {
      if (block.type !== 'problem' && block.type !== 'transfer') continue;
      for (const part of block.parts ?? []) link(`${block.id}#${part.id}`, part.goals);
    }
  }
  for (const field of ['preCheck', 'delayedCheck']) {
    for (const item of mod[field]?.items ?? []) link(item.id, item.goals);
  }
  return { module: mod.id, moduleVersion: mod.version, goals, followups };
}

// 경고(막지는 않는다): 건너뛴 뒤 다시 묻는 문항이 없는 목표, 본문 쪽과 며칠 뒤 쪽 가운데 한쪽에만 연결이 있는 목표.
// 본문 쪽 = 문제·전이 문제의 부분(키에 '#'), 며칠 뒤 쪽 = delayedCheck 문항. 시작 전(preCheck) 문항은 건너뛰기 전에 묻는 자리라 '다시 묻는' 쪽에 세지 않는다.
export function goalWarnings(mod) {
  const idx = goalIndex(mod);
  const delayedIds = new Set((mod.delayedCheck?.items ?? []).map((i) => i.id));
  const warnings = [];
  for (const id of Object.keys(idx.goals)) {
    let body = 0, delayed = 0;
    for (const [key, list] of Object.entries(idx.followups)) {
      if (!list.includes(id)) continue;
      if (key.includes('#')) body += 1; else if (delayedIds.has(key)) delayed += 1;
    }
    if (body + delayed === 0) warnings.push(`목표 ${id}: 건너뛴 뒤 다시 묻는 문항이 없다`);
    else if (body === 0) warnings.push(`목표 ${id}: 본문 쪽(도움 없이 먼저)에는 다시 묻는 문항이 없고 며칠 뒤 문항(${delayed}개)에만 있다`);
    else if (delayed === 0) warnings.push(`목표 ${id}: 며칠 뒤 쪽에는 다시 묻는 문항이 없고 본문 쪽(${body}개 부분)에만 있다`);
  }
  return warnings;
}
