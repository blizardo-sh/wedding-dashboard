import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
  collection,
  getDocs,
} from "firebase/firestore";
let env;
const email = (role) => role + "@example.test";
const db = (role = "editor", claims = {}) =>
  env
    .authenticatedContext(role, {
      email: email(role),
      email_verified: true,
      firebase: { sign_in_provider: "google.com" },
      ...claims,
    })
    .firestore();
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-wedding-dashboard",
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });
});
after(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    for (const role of ["owner", "editor"])
      await setDoc(doc(context.firestore(), "members", email(role)), {
        role,
        active: true,
      });
    await setDoc(
      doc(
        context.firestore(),
        "catalogVersions",
        "published",
        "chunks",
        "00000",
      ),
      { items: [{ id: "synthetic-house" }] },
    );
    await setDoc(doc(context.firestore(), "runtime", "catalog"), {
      version: "published",
      stats: { houses: 1 },
    });
  });
});
function auditBatch(
  database,
  {
    revision = 1,
    actor = "editor",
    eventId = "event-1",
    at = serverTimestamp(),
    audit = true,
    afterPatch = {},
    patch = { note: "Synthetic QA note", favorite: true },
  } = {},
) {
  const next = {
    ...patch,
    revision,
    updatedBy: actor,
    updatedAt: at,
    lastEventId: eventId,
  };
  const batch = writeBatch(database);
  batch.set(doc(database, "decisions", "synthetic-house"), next);
  if (audit)
    batch.set(doc(database, "history", eventId), {
      houseId: "synthetic-house",
      revision,
      actorUid: actor,
      at,
      changes: patch,
      after: { ...next, ...afterPatch },
    });
  return batch;
}
test("outsider, anonymous, unverified email and non-Google identities cannot read private data", async () => {
  for (const database of [
    db("outsider"),
    env.unauthenticatedContext().firestore(),
    db("editor", { email_verified: false }),
    db("editor", { firebase: { sign_in_provider: "password" } }),
  ]) {
    await assertFails(getDoc(doc(database, "runtime", "catalog")));
    await assertFails(getDocs(collection(database, "decisions")));
  }
  await assertSucceeds(getDoc(doc(db(), "runtime", "catalog")));
});
test("editor cannot import, invite, promote self or revoke membership", async () => {
  const database = db();
  await assertFails(
    setDoc(doc(database, "catalogVersions", "new", "chunks", "00000"), {
      items: [],
    }),
  );
  await assertFails(
    setDoc(doc(database, "members", email("outsider")), {
      role: "editor",
      active: true,
      updatedBy: "editor",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    updateDoc(doc(database, "members", email("editor")), {
      role: "owner",
      updatedBy: "editor",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(deleteDoc(doc(database, "members", email("owner"))));
});
test("editor can save a decision only with its immutable matching audit snapshot", async () => {
  const database = db();
  await assertSucceeds(auditBatch(database).commit());
  assert.equal(
    (await getDoc(doc(database, "decisions", "synthetic-house"))).data().note,
    "Synthetic QA note",
  );
  await assertFails(
    updateDoc(doc(database, "history", "event-1"), {
      changes: { note: "rewritten" },
    }),
  );
  await assertFails(deleteDoc(doc(database, "history", "event-1")));
  await assertFails(deleteDoc(doc(database, "decisions", "synthetic-house")));
});
test("missing audit, forged actor/time/state and invalid fields are rejected", async () => {
  const database = db();
  for (const options of [
    { audit: false },
    { actor: "owner" },
    { at: Timestamp.fromMillis(0) },
    { afterPatch: { note: "different" } },
    { patch: { note: 42 } },
    { patch: { role: "owner" } },
  ])
    await assertFails(auditBatch(database, options).commit());
});
test("revision must advance exactly once; source-specific answers survive separate writes", async () => {
  const database = db();
  const confirmations = {
    cian_1: {
      offeringId: "cian_1",
      total: 100000,
      scenarioKey: "synthetic",
      comment: "Synthetic owner response",
    },
  };
  await assertSucceeds(
    auditBatch(database, { patch: { confirmations } }).commit(),
  );
  await assertFails(
    auditBatch(database, { revision: 1, eventId: "event-2" }).commit(),
  );
  await assertSucceeds(
    auditBatch(database, {
      revision: 2,
      eventId: "event-2",
      patch: { confirmations, note: "Second update" },
    }).commit(),
  );
  assert.equal(
    (await getDoc(doc(database, "decisions", "synthetic-house"))).data()
      .confirmations.cian_1.total,
    100000,
  );
});
test("owner can stage then atomically publish, but current raw version is immutable", async () => {
  const database = db("owner");
  await assertSucceeds(
    setDoc(doc(database, "catalogVersions", "new", "chunks", "00000"), {
      items: [{ id: "synthetic-house" }],
    }),
  );
  await assertSucceeds(
    setDoc(doc(database, "catalogVersions", "new", "listings", "cian_1"), {
      id: "cian_1",
      description: "Synthetic only",
      source: "cian",
    }),
  );
  await assertFails(
    setDoc(doc(database, "catalogVersions", "published", "chunks", "00000"), {
      items: [],
    }),
  );
  await assertFails(
    setDoc(doc(database, "runtime", "catalog"), { version: "new" }),
  );
  const batch = writeBatch(database),
    at = serverTimestamp();
  batch.set(doc(database, "runtime", "catalog"), {
    schemaVersion: "2.0",
    version: "new",
    generatedAt: "synthetic",
    stats: { houses: 1 },
    chunkCount: 1,
    updatedAt: at,
    updatedBy: "owner",
    lastImportEventId: "import-1",
  });
  batch.set(doc(database, "imports", "import-1"), {
    version: "new",
    actorUid: "owner",
    at,
    stats: { houses: 1 },
  });
  await assertSucceeds(batch.commit());
  await assertFails(
    updateDoc(doc(database, "catalogVersions", "new", "listings", "cian_1"), {
      description: "overwrite published",
    }),
  );
});
test("only the owner can manage members; revoked editor immediately loses access", async () => {
  const database = db("owner");
  await assertSucceeds(
    setDoc(doc(database, "members", email("outsider")), {
      role: "editor",
      active: true,
      updatedBy: "owner",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(getDoc(doc(db("outsider"), "runtime", "catalog")));
  await assertSucceeds(
    updateDoc(doc(database, "members", email("editor")), {
      active: false,
      updatedBy: "owner",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(getDoc(doc(db(), "runtime", "catalog")));
});
