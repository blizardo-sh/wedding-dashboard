import fs from "node:fs/promises";
let raw = process.env.FIREBASE_WEB_CONFIG;
if (!raw) {
  try {
    raw = await fs.readFile("public/firebase-config.json", "utf8");
  } catch {}
}
if (!raw) {
  console.log("Firebase not connected: build will show setup screen.");
  process.exit(0);
}
const value = JSON.parse(raw);
const allowed = [
  "apiKey",
  "authDomain",
  "projectId",
  "appId",
  "messagingSenderId",
  "measurementId",
];
if (
  !value.apiKey ||
  !value.authDomain ||
  !value.projectId ||
  !value.appId ||
  Object.keys(value).some((k) => !allowed.includes(k))
)
  throw new Error(
    "Expected public Firebase WEB config, never a service account key",
  );
await fs.mkdir("public", { recursive: true });
await fs.writeFile("public/firebase-config.json", JSON.stringify(value));
console.log(
  "Public web configuration prepared; no private credentials accepted.",
);
