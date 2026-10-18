import fs from "node:fs/promises";
import path from "node:path";
const ignored = new Set([
  "node_modules",
  "dist",
  ".git",
  ".firebase",
  ".private",
  "__pycache__",
]);
async function walk(dir) {
  return (
    await Promise.all(
      (await fs.readdir(dir, { withFileTypes: true }))
        .filter((x) => !ignored.has(x.name))
        .map((x) =>
          x.isDirectory()
            ? walk(path.join(dir, x.name))
            : [path.join(dir, x.name)],
        ),
    )
  ).flat();
}
let access;
try {
  access = JSON.parse(
    await fs.readFile("../.private/deployment-access.json", "utf8"),
  );
} catch {}
const emails = [
  access?.owner?.email,
  ...(access?.members || []).map((x) => x.email),
].filter(Boolean);
const files = (await walk(".")).filter(
  (f) => !f.endsWith(".log") && !/^\.env/.test(f),
);
for (const file of files) {
  if (
    /\.(xlsx?|csv|tsv|html\.gz)$/.test(file) ||
    /(?:^|\/)(?:catalog|cloud-import|deployment-access|all-listings)\.json$/.test(
      file,
    )
  )
    throw new Error("Private data file: " + file);
  const body = await fs.readFile(file, "utf8");
  if (emails.some((x) => body.toLowerCase().includes(x.toLowerCase())))
    throw new Error("Participant address in public source: " + file);
  if (/-----BEGIN (?:RSA )?PRIVATE KEY-----|"refresh_token"\s*:/.test(body))
    throw new Error("Credential in source: " + file);
  if (file.endsWith(".json") && /"descriptionSha256"\s*:/.test(body))
    throw new Error("Listing export in public source: " + file);
}
console.log(
  "Public source checked: " +
    files.length +
    " files; no private exports, participant addresses or credentials.",
);
