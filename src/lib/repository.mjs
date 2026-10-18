import { nextDecision, validatePatch } from "../domain/decisions.mjs";
const STORAGE = "wedding:workspace:v2",
  LEGACY_DECISIONS = "wedding:decisions:v1",
  LEGACY_HISTORY = "wedding:history:v1";
const parse = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const json = async (response) => {
  if (!response.ok)
    throw new Error("Не удалось загрузить данные (" + response.status + ")");
  return response.json();
};
export async function createRepository() {
  if (
    import.meta.env.DEV &&
    ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
  ) {
    const response = await fetch("/__local__/catalog");
    if (response.ok)
      return localRepository(await response.json(), {
        qa: new URLSearchParams(location.search).get("qa") === "1",
      });
  }
  const config = await fetch(import.meta.env.BASE_URL + "firebase-config.json")
    .then(json)
    .catch(() => null);
  if (!config?.projectId || !config?.apiKey) throw new Error("SETUP_REQUIRED");
  const { firebaseRepository } = await import("./firebase-repository.mjs");
  return firebaseRepository(config);
}
export function localRepository(catalog, { qa = false } = {}) {
  const storage = qa ? "wedding:qa-workspace:v2" : STORAGE;
  const state = () =>
    parse(storage, {
      decisions: qa ? {} : parse(LEGACY_DECISIONS, {}),
      history: qa ? {} : parse(LEGACY_HISTORY, {}),
    });
  const callbacks = new Set(),
    actorUid = "local-device";
  const emit = () => callbacks.forEach((cb) => cb(state().decisions));
  const storageListener = (e) => {
    if (e.key === storage) emit();
  };
  window.addEventListener("storage", storageListener);
  return {
    mode: "local",
    isQa: qa,
    role: "owner",
    user: { uid: actorUid, displayName: "Локальная версия" },
    catalog,
    login: async () => {},
    logout: async () => {},
    subscribeAuth(cb) {
      cb({ uid: actorUid, displayName: "Локальная версия", role: "owner" });
      return () => {};
    },
    async loadCatalog() {
      return catalog;
    },
    subscribeDecisions(cb) {
      callbacks.add(cb);
      cb(state().decisions);
      return () => callbacks.delete(cb);
    },
    async getDetail(id) {
      return fetch("/__local__/detail/" + encodeURIComponent(id)).then(json);
    },
    async saveDecision(
      houseId,
      patch,
      { expectedRevision, expectedNote } = {},
    ) {
      validatePatch(patch);
      const current = state(),
        all = current.decisions,
        previous = all[houseId] || {};
      if (
        expectedRevision != null &&
        (previous.revision || 0) !== expectedRevision
      )
        throw new Error(
          "Запись уже изменили. Обновите форму, чтобы сохранить свои правки.",
        );
      if (expectedNote != null && (previous.note || "") !== expectedNote)
        throw new Error(
          "Заметка уже изменена другим участником. Загрузите свежую версию перед сохранением.",
        );
      const eventId = crypto.randomUUID(),
        at = new Date().toISOString();
      const next = nextDecision(previous, patch, { actorUid, eventId, at });
      const history = current.history;
      (history[houseId] ??= []).unshift({
        id: eventId,
        houseId,
        revision: next.revision,
        actorUid,
        at,
        changes: patch,
        after: next,
      });
      // Storage failures propagate: UI must not claim a successful save.
      localStorage.setItem(
        storage,
        JSON.stringify({ decisions: { ...all, [houseId]: next }, history }),
      );
      emit();
      return next;
    },
    async history(houseId) {
      return (state().history[houseId] || []).slice(0, 100);
    },
    async listMembers() {
      return [];
    },
    async invite() {
      throw new Error(
        "Приглашения станут доступны после подключения Google-входа",
      );
    },
    async revoke() {
      throw new Error(
        "Управление участниками доступно после подключения Firebase",
      );
    },
    dispose() {
      window.removeEventListener("storage", storageListener);
      callbacks.clear();
    },
  };
}
