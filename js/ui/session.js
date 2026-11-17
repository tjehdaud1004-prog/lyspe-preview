// 한 모듈의 진행·노트·설정을 들고 있는 저장 계층. 값을 바꿀 때마다 localStorage 에 쓰고, 구독자에게 알린다.
import { createProgress, serialize, deserialize } from '../core/progress.js';
import { createNotes, sanitizeNotes } from '../core/notes.js';
import { defaultSettings, sanitizeSettings, diffSettings } from '../core/settings.js';
import { keys } from '../core/storage.js';
import { moduleIndex } from '../core/module.js';
import { withShuffleSeed } from '../core/shuffle.js';

function readJson(storage, key) {
  const text = storage.read(key);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export function createSession({ mod, storage, reducedMotion = false, now = () => Date.now(), random = Math.random }) {
  const index = moduleIndex(mod);
  const listeners = new Set();
  const emit = (what, detail) => listeners.forEach((fn) => fn(what, detail));

  const savedProgress = storage.read(keys.progress(mod.id));
  let progress = savedProgress === null ? null : deserialize(savedProgress, mod.id, index);
  const resumed = progress !== null;
  if (!progress) progress = createProgress(mod.id, now());
  // 보기 섞기를 켠 모듈만: 이 시작의 씨앗을 한 번 만들어 저장해 둔다(새로 고쳐도 같은 차례).
  const seeded = withShuffleSeed(mod, progress, random);
  const needsSave = seeded !== progress;
  progress = seeded;

  let notes = sanitizeNotes(readJson(storage, keys.notes(mod.id)));
  let settings = sanitizeSettings(readJson(storage, keys.settings()), defaultSettings({ reducedMotion }));

  const persist = {
    progress: () => storage.write(keys.progress(mod.id), serialize(progress)),
    notes: () => storage.write(keys.notes(mod.id), JSON.stringify(notes)),
    settings: () => storage.write(keys.settings(), JSON.stringify(settings)),
  };

  if (needsSave) persist.progress();

  return {
    mod, index, resumed, now,
    get progress() { return progress; },
    get notes() { return notes; },
    get settings() { return settings; },
    // fn: 상태 → 새 상태. 같은 객체를 돌려주면 아무것도 하지 않는다.
    // silent: 시간 누적처럼 화면을 다시 그릴 필요 없는 저장.
    update(fn, { silent = false } = {}) {
      const next = fn(progress);
      if (next === progress) return;
      progress = next;
      persist.progress();
      if (!silent) emit('progress');
    },
    updateNotes(fn, { silent = false } = {}) {
      const next = fn(notes);
      if (next === notes) return;
      notes = next;
      persist.notes();
      if (!silent) emit('notes');
    },
    // 바뀐 항목 목록 [{key, from, to}] 을 구독자에게 함께 알린다(학습 기록의 setting_change 재료).
    updateSettings(patch) {
      const prev = settings;
      settings = sanitizeSettings({ ...settings, ...patch }, defaultSettings({ reducedMotion }));
      persist.settings();
      emit('settings', diffSettings(prev, settings));
    },
    // '처음부터': 이 모듈의 진행(과 선택하면 노트)만 지운다. 설정은 건드리지 않는다.
    reset({ keepNotes = true } = {}) {
      progress = withShuffleSeed(mod, createProgress(mod.id, now()), random); // 다시 시작하면 보기 차례도 새로 정한다
      persist.progress();
      if (!keepNotes) { notes = createNotes(); persist.notes(); }
      emit('reset');
    },
    flush() { persist.progress(); persist.notes(); },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
