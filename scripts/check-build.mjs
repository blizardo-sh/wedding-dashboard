import fs from "node:fs/promises";
import path from "node:path";
async function files(dir) {
  return (
    await Promise.all(
      (await fs.readdir(dir, { withFileTypes: true })).map((d) =>
        d.isDirectory()
          ? files(path.join(dir, d.name))
          : [path.join(dir, d.name)],
      ),
    )
  ).flat();
}
const all = await files("dist");
let access;
try {
  access = JSON.parse(
    await fs.readFile("../.private/deployment-access.json", "utf8"),
  );
} catch {}
const privateEmails = [
  access?.owner?.email,
  ...(access?.members || []).map((m) => m.email),
].filter(Boolean);
for (const name of all) {
  if (
    /(?:catalog|cloud-import|deployment-access|all-listings|\.xlsx|\.html\.gz)/i.test(
      name,
    )
  )
    throw new Error("Private dataset in build: " + name);
  const text = await fs.readFile(name, "utf8");
  if (privateEmails.some((email) => text.includes(email)))
    throw new Error("Participant address in build");
  if (/"(?:descriptionSha256|searchText)"\s*:/.test(text))
    throw new Error("Raw listing content in build");
}
console.log(
  "Build verified: " +
    all.length +
    " files, no private datasets or participant addresses.",
);
