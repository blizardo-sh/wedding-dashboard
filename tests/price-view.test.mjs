import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SCENARIO,
  quoteOffering,
  scenarioKey,
} from "../src/domain/pricing.mjs";
import { EMPTY_FILTERS, offeringPasses } from "../src/domain/filters.mjs";
import {
  normalizePriceMode,
  priceView,
  priceBudget,
  comparePriceRows,
  selectPriceCandidate,
} from "../src/domain/price-view.mjs";
const rule = (kind, amount, fields = {}) => ({
  id: kind + (fields.service_id || ""),
  kind,
  amount,
  unit: "per_stay",
  review_status: "checked_against_description",
  value_type: "published",
  evidence: { quote: "Synthetic fixture" },
  ...fields,
});
const base = () =>
  rule("rent_base", 56000, { unit: "per_night", included_guests: 15 });
const extra = () =>
  rule("extra_guests", 3000, {
    unit: "per_guest",
    period: "per_night",
    included_guests: 15,
    guest_scope: "all_guests",
  });
const cleaning = (kind = "mandatory_fee") =>
  rule(kind, 5000, { service_id: "cleaning", optional: kind === "service" });
const hotTub = () =>
  rule("service", 8000, {
    service_id: "hot_tub",
    unit: "per_session",
    optional: true,
  });
const offer = (
  rules = [base(), extra(), cleaning(), hotTub()],
  fields = {},
) => ({
  id: "fixture_1",
  publishedPrice: 56000,
  source: "cian",
  searchText: "fixture",
  numbers: { event: 50, sleep: 20 },
  features: { hot_tub: { value: true } },
  rules,
  photos: [],
  requiredCostsComplete: true,
  ...fields,
});
const scenario = (fields = {}) => ({
  ...structuredClone(DEFAULT_SCENARIO),
  services: ["hot_tub"],
  quantities: { hot_tub: 2 },
  ...fields,
});

test("full mode sums rent, extra guests, mandatory cleaning and selected hot-tub sessions", () => {
  const o = offer(),
    q = quoteOffering(o, scenario());
  assert.equal(q.total, 137000);
  assert.equal(priceView(o, q, "full").amount, 137000);
  assert.equal(priceView(o, q, "listing").amount, 56000);
  assert.deepEqual(
    q.components.map((c) => c.amount),
    [56000, 60000, 5000, 16000],
  );
});
test("listing mode stays at source price while guests, nights and options change full cost", () => {
  const o = offer();
  const quotes = [
    quoteOffering(o, scenario()),
    quoteOffering(o, scenario({ guests: 30 })),
    quoteOffering(o, scenario({ services: [] })),
    quoteOffering(
      o,
      scenario({
        checkOut: "2027-02-23",
        days: [{ date: "2027-02-22", guests: 20, overnightGuests: 20 }],
      }),
    ),
  ];
  assert.deepEqual(
    quotes.map((q) => priceView(o, q, "full").amount),
    [137000, 122000, 121000, 208000],
  );
  assert.deepEqual(
    quotes.map((q) => priceView(o, q, "listing").amount),
    [56000, 56000, 56000, 56000],
  );
});
test("mandatory cleaning cannot be disabled and selecting it does not charge twice", () => {
  const o = offer();
  const q = quoteOffering(o, scenario({ services: ["cleaning"] }));
  assert.equal(q.total, 121000);
  assert.equal(
    q.components.filter((c) => c.label.includes("Уборка")).length,
    1,
  );
});
test("explicitly optional cleaning is charged only when selected", () => {
  const o = offer([base(), extra(), cleaning("service")]);
  assert.equal(quoteOffering(o, scenario({ services: [] })).total, 116000);
  assert.equal(
    quoteOffering(o, scenario({ services: ["cleaning"] })).total,
    121000,
  );
});
test("unknown optional service or cleaning is not a free complete total", () => {
  const o = offer([base(), extra(), cleaning()]);
  const q = quoteOffering(o, scenario());
  assert.equal(q.total, null);
  assert.equal(priceView(o, q).amount, 121000);
  assert.equal(priceView(o, q).status, "partial");
  const noClean = quoteOffering(
    offer([base(), extra()]),
    scenario({ services: [] }),
  );
  assert.equal(noClean.total, null);
  assert(noClean.issues.some((i) => i.code === "cleaning_unknown"));
});
test("full mode never substitutes a listing price or a cleaning-only subtotal for rent", () => {
  const o = offer([cleaning()]),
    q = quoteOffering(o, scenario({ services: [] }));
  assert.equal(q.knownSubtotal, 5000);
  assert.equal(priceView(o, q).amount, null);
  assert.equal(priceView(o, q, "listing").amount, 56000);
});
test("budget uses selected mode and leaves an incomplete total explicitly unknown", () => {
  const o = offer(),
    q = quoteOffering(o, scenario());
  const filters = { ...structuredClone(EMPTY_FILTERS), maxPrice: 90000 };
  assert.equal(offeringPasses(o, q, filters, {}, "full"), false);
  assert.equal(offeringPasses(o, q, filters, {}, "listing"), true);
  const partial = quoteOffering(
    { ...o, requiredCostsComplete: false },
    scenario(),
  );
  assert.equal(
    priceBudget(o, partial, { maxPrice: 150000 }, "full"),
    "unknown",
  );
  assert.equal(priceBudget(o, partial, { maxPrice: 90000 }, "full"), false);
  assert.equal(
    priceBudget(o, partial, { minPrice: 140000 }, "full"),
    "unknown",
  );
});
test("source selection follows the mode and preserves an explicit source choice", () => {
  const a = offer(),
    b = offer(undefined, { id: "fixture_2", publishedPrice: 40000 });
  const s = scenario();
  const qa = quoteOffering(a, s, {
      confirmation: {
        offeringId: a.id,
        scenarioKey: scenarioKey(s),
        total: 150000,
        comment: "Fixture",
      },
    }),
    qb = quoteOffering(b, s);
  const candidates = [
    { o: a, q: qa },
    { o: b, q: qb },
  ];
  assert.equal(selectPriceCandidate(candidates, null, "full").o.id, a.id);
  assert.equal(selectPriceCandidate(candidates, null, "listing").o.id, b.id);
  assert.equal(selectPriceCandidate(candidates, a.id, "listing").o.id, a.id);
});
test("unknown prices stay last in either sorting direction and source price controls listing sorting", () => {
  const a = offer(),
    b = offer(undefined, { id: "fixture_2", publishedPrice: 40000 }),
    unknown = offer(undefined, { id: "fixture_3", publishedPrice: null });
  const rows = [a, b, unknown].map((o) => ({
    offering: o,
    q: quoteOffering(o, scenario()),
  }));
  assert.deepEqual(
    [...rows]
      .sort((a, b) => comparePriceRows(a, b, "listing"))
      .map((r) => r.offering.id),
    ["fixture_2", "fixture_1", "fixture_3"],
  );
  assert.deepEqual(
    [...rows]
      .sort((a, b) => comparePriceRows(a, b, "listing", true))
      .map((r) => r.offering.id),
    ["fixture_1", "fixture_2", "fixture_3"],
  );
});
test("zero source placeholders stay unknown while a confirmed zero full quote remains valid", () => {
  const o = offer(undefined, { publishedPrice: 0 }),
    s = scenario();
  const q = quoteOffering(o, s, {
    confirmation: {
      offeringId: o.id,
      scenarioKey: scenarioKey(s),
      total: 0,
      comment: "Fixture",
    },
  });
  assert.equal(priceView(o, q, "listing").amount, null);
  assert.equal(priceView(o, q, "full").amount, 0);
  assert.equal(normalizePriceMode("invalid"), "full");
  assert.equal(normalizePriceMode("listing"), "listing");
});
