import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { DEFAULT_SCENARIO, quoteOffering } from "../src/domain/pricing.mjs";
const directory = path.resolve(process.argv[2] || "../.private/dashboard");
if (directory.split(path.sep).some((x) => ["public", "dist"].includes(x)))
  throw new Error("Export directory must be private");
const catalog = JSON.parse(
  await fs.readFile(path.join(directory, "catalog.json"), "utf8"),
);
const ids = new Set(),
  details = [],
  statusCounts = {},
  issues = {};
let maxDetailBytes = 0,
  maxHouseBytes = 0;
for (const house of catalog.houses) {
  maxHouseBytes = Math.max(
    maxHouseBytes,
    Buffer.byteLength(JSON.stringify(house)),
  );
  for (const offering of house.offerings) {
    if (ids.has(offering.id))
      throw new Error("Duplicate source ID " + offering.id);
    ids.add(offering.id);
    const detail = JSON.parse(
      await fs.readFile(
        path.join(directory, "details", offering.id + ".json"),
        "utf8",
      ),
    );
    if (detail.id !== offering.id || detail.houseId !== house.id)
      throw new Error("Mismatched detail " + offering.id);
    if (
      !detail.description ||
      createHash("sha256").update(detail.description).digest("hex") !==
        detail.descriptionSha256
    )
      throw new Error("Description integrity error " + detail.id);
    if (
      detail.rules.some(
        (r) =>
          (r.listing_id && r.listing_id !== detail.id) || !r.evidence?.quote,
      )
    )
      throw new Error("Missing or cross-source rule evidence " + detail.id);
    for (const scenario of [
      DEFAULT_SCENARIO,
      { ...DEFAULT_SCENARIO, checkIn: "2027-02-19", checkOut: "2027-02-21" },
      {
        ...DEFAULT_SCENARIO,
        services: ["sauna", "cook"],
        quantities: { sauna: 4, cook: 4 },
      },
    ]) {
      const q = quoteOffering(offering, scenario);
      if (
        !Number.isFinite(q.knownSubtotal) ||
        q.knownSubtotal < 0 ||
        (q.total != null && (!Number.isFinite(q.total) || q.issues.length))
      )
        throw new Error("Invalid calculation " + detail.id);
      if (q.status === "confirmed")
        throw new Error("Source data cannot create an owner confirmation");
    }
    const q = quoteOffering(offering, DEFAULT_SCENARIO);
    statusCounts[q.status] = (statusCounts[q.status] || 0) + 1;
    for (const i of q.issues) issues[i.code] = (issues[i.code] || 0) + 1;
    maxDetailBytes = Math.max(
      maxDetailBytes,
      Buffer.byteLength(JSON.stringify(detail)),
    );
    details.push(detail);
  }
}
if (
  ids.size !== catalog.stats.listings ||
  catalog.houses.length !== catalog.stats.houses
)
  throw new Error("Wrong counts");
if (maxDetailBytes > 800000 || maxHouseBytes > 650000)
  throw new Error("Firestore size safety threshold exceeded");
await fs.writeFile(
  path.join(directory, "cloud-import.json"),
  JSON.stringify({ catalog, details }),
);
const report = {
  status: "passed",
  schemaVersion: "2.0",
  stats: catalog.stats,
  uniqueListingIds: ids.size,
  descriptionHashesVerified: details.length,
  calculationsChecked: details.length * 3,
  statusCounts,
  issues,
  maxDetailBytes,
  maxHouseBytes,
};
await fs.writeFile(
  path.join(directory, "dataset-validation.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      ...report,
      issues: Object.fromEntries(
        Object.entries(issues)
          .filter(([key]) => !key.includes(":"))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
      ),
    },
    null,
    2,
  ),
);
