import { importGroups } from "../domain/import-plan.mjs";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  runTransaction,
  serverTimestamp,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
} from "firebase/firestore";
import { nextDecision, validatePatch } from "../domain/decisions.mjs";

export function firebaseRepository(config) {
  const app = initializeApp(config),
    auth = getAuth(app),
    db = getFirestore(app);
  let role = null,
    version = null;
  const memberRef = (email) => doc(db, "members", email.toLowerCase());
  const requireOwner = () => {
    if (role !== "owner") throw new Error("Действие доступно только владельцу");
  };
  async function membership(user) {
    if (!user || !user.emailVerified) return null;
    const snapshot = await getDoc(memberRef(user.email));
    if (!snapshot.exists() || !snapshot.data().active) return null;
    return snapshot.data().role;
  }
  return {
    mode: "firebase",
    get role() {
      return role;
    },
    get user() {
      return auth.currentUser;
    },
    async login() {
      await signInWithPopup(auth, new GoogleAuthProvider());
    },
    async logout() {
      await signOut(auth);
      role = null;
    },
    subscribeAuth(callback) {
      return onAuthStateChanged(auth, async (user) => {
        try {
          role = await membership(user);
          callback(
            user
              ? {
                  uid: user.uid,
                  displayName: user.displayName || "Участник",
                  role,
                  denied: !role,
                }
              : null,
          );
        } catch (error) {
          callback(
            user
              ? {
                  uid: user.uid,
                  displayName: user.displayName || "Участник",
                  role: null,
                  denied: true,
                  error: error.code,
                }
              : null,
          );
        }
      });
    },
    async loadCatalog() {
      const snapshot = await getDoc(doc(db, "runtime", "catalog"));
      if (!snapshot.exists())
        return {
          schemaVersion: "2.0",
          version: null,
          stats: { listings: 0, houses: 0 },
          houses: [],
        };
      const manifest = snapshot.data();
      version = manifest.version;
      const chunks = await getDocs(
        collection(db, "catalogVersions", version, "chunks"),
      );
      const houses = chunks.docs
        .sort((a, b) => a.id.localeCompare(b.id))
        .flatMap((d) => d.data().items);
      if (houses.length !== manifest.stats.houses)
        throw new Error("Каталог загружен не полностью. Обновите страницу.");
      return { ...manifest, houses };
    },
    subscribeDecisions(callback, onError) {
      return onSnapshot(
        collection(db, "decisions"),
        (snapshot) =>
          callback(
            Object.fromEntries(snapshot.docs.map((d) => [d.id, d.data()])),
          ),
        onError,
      );
    },
    async getDetail(id) {
      if (!version) throw new Error("Каталог ещё не выбран");
      const snapshot = await getDoc(
        doc(db, "catalogVersions", version, "listings", id),
      );
      if (!snapshot.exists())
        throw new Error("Описание отсутствует в опубликованной версии");
      return snapshot.data();
    },
    async saveDecision(
      houseId,
      patch,
      { expectedRevision, expectedNote } = {},
    ) {
      validatePatch(patch);
      const actorUid = auth.currentUser?.uid;
      if (!actorUid) throw new Error("Войдите в Google-аккаунт");
      const eventId = crypto.randomUUID(),
        ref = doc(db, "decisions", houseId),
        eventRef = doc(db, "history", eventId);
      return runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(ref),
          previous = snapshot.exists() ? snapshot.data() : {};
        if (
          expectedRevision != null &&
          (previous.revision || 0) !== expectedRevision
        )
          throw new Error(
            "Запись уже изменили. Обновите форму перед сохранением.",
          );
        if (expectedNote != null && (previous.note || "") !== expectedNote)
          throw new Error(
            "Заметка уже изменена другим участником. Загрузите свежую версию перед сохранением.",
          );
        const at = serverTimestamp(),
          next = nextDecision(previous, patch, { actorUid, eventId, at });
        transaction.set(ref, next);
        transaction.set(eventRef, {
          houseId,
          revision: next.revision,
          actorUid,
          at,
          changes: patch,
          after: next,
        });
        return next;
      });
    },
    async history(houseId) {
      // One-field query avoids requiring an index for small per-house histories.
      const snapshot = await getDocs(
        query(collection(db, "history"), where("houseId", "==", houseId)),
      );
      return snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => b.revision - a.revision)
        .slice(0, 100);
    },
    async listMembers() {
      requireOwner();
      const snapshot = await getDocs(collection(db, "members"));
      return snapshot.docs.map((d) => ({ email: d.id, ...d.data() }));
    },
    async invite(email) {
      requireOwner();
      email = email.trim().toLowerCase();
      if (!/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(email))
        throw new Error("Укажите Google-email");
      const ref = memberRef(email);
      const existing = await getDoc(ref);
      if (existing.exists() && existing.data().role === "owner")
        throw new Error("Этот аккаунт уже владелец");
      await setDoc(ref, {
        role: "editor",
        active: true,
        updatedBy: auth.currentUser.uid,
        updatedAt: serverTimestamp(),
      });
    },
    async revoke(email) {
      requireOwner();
      if (email.toLowerCase() === auth.currentUser.email?.toLowerCase())
        throw new Error("Нельзя отключить свой аккаунт владельца");
      await setDoc(
        memberRef(email),
        {
          active: false,
          updatedBy: auth.currentUser.uid,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    },
    async importMembers(access) {
      requireOwner();
      for (const m of access.members || []) await this.invite(m.email);
    },
    async importBundle(bundle, onProgress = () => {}) {
      requireOwner();
      const { catalog, details } = bundle;
      if (
        catalog?.schemaVersion !== "2.0" ||
        !Array.isArray(catalog.houses) ||
        !Array.isArray(details)
      )
        throw new Error("Нужен подготовленный пакет cloud-import.json");
      const ids = new Set(
        catalog.houses.flatMap((h) => h.offerings.map((o) => o.id)),
      );
      if (
        ids.size !== details.length ||
        new Set(details.map((d) => d.id)).size !== ids.size ||
        details.some((d) => !ids.has(d.id))
      )
        throw new Error("Каталог и описания не совпадают");
      const target = catalog.version;
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(target))
        throw new Error("Некорректная версия");
      const current = await getDoc(doc(db, "runtime", "catalog"));
      if (current.exists() && current.data().version === target)
        throw new Error("Эта версия уже опубликована");
      const rows = [];
      let chunk = [],
        size = 0,
        index = 0;
      const flush = () => {
        if (chunk.length) {
          rows.push([
            doc(
              db,
              "catalogVersions",
              target,
              "chunks",
              String(index++).padStart(5, "0"),
            ),
            { items: chunk },
          ]);
          chunk = [];
          size = 0;
        }
      };
      for (const house of catalog.houses) {
        const bytes = new TextEncoder().encode(JSON.stringify(house)).length;
        if (bytes > 650000)
          throw new Error("Слишком большая группа дома: " + house.id);
        if (size + bytes > 650000) flush();
        chunk.push(house);
        size += bytes;
      }
      flush();
      for (const detail of details) {
        if (new TextEncoder().encode(JSON.stringify(detail)).length > 800000)
          throw new Error("Слишком большое описание: " + detail.id);
        rows.push([
          doc(db, "catalogVersions", target, "listings", detail.id),
          detail,
        ]);
      }
      let written = 0;
      for (const group of importGroups(rows)) {
        const batch = writeBatch(db);
        for (const [ref, data] of group) batch.set(ref, data);
        await batch.commit();
        written += group.length;
        onProgress(Math.min(99, Math.round((written / rows.length) * 100)));
      }
      const eventId = crypto.randomUUID(),
        manifestRef = doc(db, "runtime", "catalog");
      await runTransaction(db, async (transaction) => {
        await transaction.get(manifestRef);
        transaction.set(manifestRef, {
          schemaVersion: "2.0",
          version: target,
          generatedAt: catalog.generatedAt,
          stats: catalog.stats,
          chunkCount: index,
          updatedAt: serverTimestamp(),
          updatedBy: auth.currentUser.uid,
          lastImportEventId: eventId,
        });
        transaction.set(doc(db, "imports", eventId), {
          version: target,
          actorUid: auth.currentUser.uid,
          at: serverTimestamp(),
          stats: catalog.stats,
        });
      });
      version = target;
      onProgress(100);
    },
    dispose() {},
  };
}
