import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SCENARIO,
  quoteOffering,
  scenarioKey,
  scenarioDays,
  selectQuote,
  matchesBudget,
} from "../src/domain/pricing.mjs";
import {
  EMPTY_FILTERS,
  offeringPasses,
  projectHouses,
} from "../src/domain/filters.mjs";
import { nextDecision, validatePatch } from "../src/domain/decisions.mjs";
const scenario = (patch = {}) => ({
  ...structuredClone(DEFAULT_SCENARIO),
  ...patch,
});
const rule = (id, kind, amount, extra = {}) => ({
  id,
  kind,
  amount,
  unit: "per_stay",
  review_status: "checked_against_description",
  value_type: "published",
  evidence: { quote: "Synthetic test fixture" },
  ...extra,
});
const listing = (rules, extra = {}) => ({
  id: "fixture_1",
  url: "https://example.test/1",
  source: "cian",
  title: "Fixture",
  searchText: "дом с сауной",
  numbers: { event: 50, sleep: 33 },
  features: { sauna: { value: true } },
  availability: "unknown",
  eventPermission: "mentioned",
  photos: [],
  rules,
  requiredCostsComplete: true,
  ...extra,
});
const clean = () =>
  rule("clean", "mandatory_fee", 5000, {
    service_id: "cleaning",
    optional: false,
  });
const base = (amount = 22500) =>
  rule("base", "rent_base", amount, { unit: "per_night", included_guests: 10 });
const extra = (patch = {}) =>
  rule("extra", "extra_guests", 2000, {
    unit: "per_guest",
    guest_scope: "all_guests",
    included_guests: 10,
    period: "per_night",
    ...patch,
  });

test("30/35 attendees include overnight guests; refund and prepayment stay separate", () => {
  const l = listing([
    base(),
    extra(),
    clean(),
    rule("deposit", "refundable_deposit", 15000),
    rule("prepay", "prepayment", 0.5, { unit: "percent", basis: "rent_base" }),
  ]);
  const q30 = quoteOffering(l, scenario({ guests: 30 })),
    q35 = quoteOffering(l, scenario());
  assert.equal(q30.total, 67500);
  assert.equal(q35.total, 77500);
  assert.equal(q35.deposits[0].amount, 15000);
  assert.equal(q35.payments[0].amount, 11250);
  assert.equal(
    q35.components.find((c) => c.kind === "extra_guests").quantity,
    25,
  );
});
test("different Friday and Saturday tariffs are added by night", () => {
  const l = listing([
    rule("fri", "rent_base", 50000, {
      unit: "per_night",
      included_guests: 40,
      conditions: { weekdays: [5] },
    }),
    rule("sat", "rent_base", 60000, {
      unit: "per_night",
      included_guests: 40,
      conditions: { weekdays: [6] },
    }),
    rule("clean0", "included_service", 0, { service_id: "cleaning" }),
  ]);
  assert.equal(
    quoteOffering(
      l,
      scenario({ checkIn: "2027-02-19", checkOut: "2027-02-21" }),
    ).total,
    110000,
  );
});
test("a stated two-night package replaces nightly bases rather than stacking", () => {
  const l = listing([
    rule("package", "rent_base", 100000, {
      unit: "package",
      included_guests: 40,
      conditions: { nights: 2, weekdays: [5] },
    }),
    rule("night", "rent_base", 60000, {
      unit: "per_night",
      included_guests: 40,
    }),
    clean(),
  ]);
  assert.equal(
    quoteOffering(
      l,
      scenario({ checkIn: "2027-02-19", checkOut: "2027-02-21" }),
    ).total,
    105000,
  );
});
test("stay-level extra guest payment is charged once using the highest applicable count", () => {
  const l = listing([base(), extra({ period: "per_stay" }), clean()]);
  const q = quoteOffering(
    l,
    scenario({
      checkIn: "2027-02-19",
      checkOut: "2027-02-21",
      days: [
        { date: "2027-02-19", guests: 20, overnightGuests: 20 },
        { date: "2027-02-20", guests: 35, overnightGuests: 20 },
      ],
    }),
  );
  assert.equal(q.total, 100000);
  assert.equal(q.components.filter((c) => c.kind === "extra_guests").length, 1);
});
test("nightly guests can vary and overnight-only charges use overnight counts", () => {
  const l = listing([
    base(),
    extra({ guest_scope: "overnight_guests" }),
    clean(),
  ]);
  const q = quoteOffering(
    l,
    scenario({
      checkIn: "2027-02-19",
      checkOut: "2027-02-21",
      days: [
        { date: "2027-02-19", guests: 35, overnightGuests: 20 },
        { date: "2027-02-20", guests: 20, overnightGuests: 15 },
      ],
    }),
  );
  assert.equal(q.total, 80000);
});
test("unknown mandatory cost gives null total, not zero", () => {
  const q = quoteOffering(
    listing([base(), extra()], { requiredCostsComplete: false }),
    scenario(),
  );
  assert.equal(q.total, null);
  assert.equal(q.knownSubtotal, 72500);
  assert(q.issues.some((i) => i.code === "cleaning_unknown"));
  assert.equal(matchesBudget(q, "", 90000), "unknown");
});
test("a cleaning-only subtotal is never used to sort a house as a 500-ruble rental", () => {
  const q = quoteOffering(
    listing([rule("clean", "mandatory_fee", 500, { service_id: "cleaning" })], {
      publishedPrice: 40000,
    }),
    scenario(),
  );
  assert.equal(q.knownSubtotal, 500);
  assert.equal(q.sortAmount, 40000);
  assert.equal(q.total, null);
});
test("unknown scope of extra guests cannot produce a complete quote", () => {
  const q = quoteOffering(
    listing([base(), extra({ guest_scope: "unknown" }), clean()]),
    scenario(),
  );
  assert.equal(q.total, null);
  assert(q.issues.some((i) => i.code === "extra_scope"));
});
test("included sauna hours are subtracted from requested paid hours", () => {
  const l = listing([
    base(),
    extra(),
    clean(),
    rule("free", "included_service", 0, {
      service_id: "sauna",
      included_hours: 2,
    }),
    rule("paid", "service", 1000, {
      service_id: "sauna",
      unit: "per_hour",
      optional: true,
    }),
  ]);
  const q = quoteOffering(
    l,
    scenario({ services: ["sauna"], quantities: { sauna: 4 } }),
  );
  assert.equal(q.total, 79500);
  assert.equal(q.components.find((c) => c.ruleId === "paid").amount, 2000);
});
test("included hours do not make an unlimited sauna implicitly free", () => {
  const l = listing([
    base(),
    extra(),
    clean(),
    rule("free", "included_service", 0, {
      service_id: "sauna",
      included_hours: 2,
    }),
  ]);
  const q = quoteOffering(
    l,
    scenario({ services: ["sauna"], quantities: { sauna: 4 } }),
  );
  assert.equal(q.total, null);
  assert(q.issues.some((i) => i.code === "included_limit_sauna"));
});
test("unknown selected service remains an unresolved cost", () => {
  const q = quoteOffering(
    listing([base(), extra(), clean()]),
    scenario({ services: ["cook"], quantities: { cook: 4 } }),
  );
  assert.equal(q.total, null);
  assert(q.issues.some((i) => i.code === "service_price_cook"));
});
test("summer pool availability follows dates, rather than hard-coded February", () => {
  const l = listing([base(), extra(), clean()], {
    features: { pool: { value: true }, summer_pool: { value: true } },
  });
  const winter = quoteOffering(
    l,
    scenario({ checkIn: "2028-01-10", checkOut: "2028-01-11" }),
  );
  const summer = quoteOffering(
    l,
    scenario({ checkIn: "2027-07-10", checkOut: "2027-07-11" }),
  );
  assert.equal(winter.features.pool_on_dates.value, false);
  assert.equal(summer.features.pool_on_dates.value, true);
});
test("a confirmed quote applies only to its exact dates, guests, services and offering", () => {
  const l = listing([base(), extra(), clean()]),
    s = scenario();
  const d = {
    confirmation: {
      offeringId: l.id,
      scenarioKey: scenarioKey(s),
      total: 90000,
      deposit: 20000,
      comment: "Synthetic confirmation",
    },
  };
  assert.equal(quoteOffering(l, s, d).status, "confirmed");
  assert.notEqual(
    quoteOffering(l, scenario({ guests: 30 }), d).status,
    "confirmed",
  );
  assert.notEqual(
    quoteOffering({ ...l, id: "fixture_2" }, s, d).status,
    "confirmed",
  );
  assert.notEqual(
    quoteOffering(
      l,
      scenario({ services: ["sauna"], quantities: { sauna: 3 } }),
      d,
    ).status,
    "confirmed",
  );
});
test("source rules are not mixed across offerings; reliable total beats cheaper partial", () => {
  const s = scenario();
  const a = quoteOffering(listing([base(), extra(), clean()]), s, {
    confirmation: {
      offeringId: "fixture_1",
      scenarioKey: scenarioKey(s),
      total: 100000,
      comment: "Fixture",
    },
  });
  const b = quoteOffering(
    listing([base(10000)], { id: "fixture_2", requiredCostsComplete: false }),
    s,
  );
  assert.equal(selectQuote([a, b]).offeringId, "fixture_1");
  assert.equal(selectQuote([a, b], "fixture_2").offeringId, "fixture_2");
});
test("unknown amenities do not become false and strict filters can include unknown explicitly", () => {
  const o = listing([base(), extra(), clean()]);
  const q = quoteOffering(o, scenario());
  const f = { ...structuredClone(EMPTY_FILTERS), features: { pool: "yes" } };
  assert.equal(offeringPasses(o, q, f), false);
  assert.equal(offeringPasses(o, q, { ...f, includeUnknown: true }), true);
  assert.equal(offeringPasses(o, q, { ...f, features: { pool: "no" } }), false);
});
test("invalid dates, more than two nights and inconsistent attendee counts are rejected", () => {
  for (const s of [
    scenario({ checkIn: "2027-02-30" }),
    scenario({ checkOut: "2027-02-24" }),
    scenario({ overnightGuests: 21 }),
    scenario({ guests: 10, overnightGuests: 20 }),
    scenario({ childrenAges: [18] }),
  ])
    assert.throws(() => scenarioDays(s));
});
test("ambiguous or contradictory tariffs never silently select the lowest amount", () => {
  const q = quoteOffering(
    listing([base(), { ...base(40000), id: "another" }, clean()]),
    scenario(),
  );
  assert.equal(q.total, null);
  assert(q.issues.some((i) => i.code === "conflicting_rules"));
});
test("merge is reversible and splitting does not discard an offering", () => {
  const houses = [
    { id: "h1", offerings: [{ id: "a" }, { id: "b" }] },
    { id: "h2", offerings: [{ id: "c" }] },
  ];
  const merged = projectHouses(houses, { h2: { mergedInto: "h1" } });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].offerings.length, 3);
  assert.equal(projectHouses(houses, { h2: { mergedInto: null } }).length, 2);
  const split = projectHouses(houses, { h1: { splitListingIds: ["b"] } });
  assert.equal(split.length, 3);
  assert.equal(split.flatMap((h) => h.offerings).length, 3);
});
test("metadata cannot be forged through normal decision patches", () => {
  assert.throws(() => validatePatch({ updatedBy: "someone-else" }));
  const next = nextDecision(
    { revision: 5, note: "Keep me" },
    { favorite: true },
    { actorUid: "u1", eventId: "e1", at: "now" },
  );
  assert.equal(next.revision, 6);
  assert.equal(next.note, "Keep me");
  assert.equal(next.updatedBy, "u1");
});

test("nightly per-person service sums actual attendance instead of maximum times nights", () => {
  const l = listing([
    base(),
    extra(),
    clean(),
    rule("service", "service", 100, {
      service_id: "pool",
      unit: "per_guest",
      guest_scope: "all_guests",
      period: "per_night",
      optional: true,
    }),
  ]);
  const s = scenario({
    checkIn: "2027-02-19",
    checkOut: "2027-02-21",
    services: ["pool"],
    days: [
      { date: "2027-02-19", guests: 35 },
      { date: "2027-02-20", guests: 20 },
    ],
  });
  assert.equal(
    quoteOffering(l, s).components.find((c) => c.ruleId === "service").amount,
    5500,
  );
});
test("hour quantities cover the entire stay and are not charged twice for two nights", () => {
  const l = listing([
    base(),
    extra(),
    clean(),
    rule("service", "service", 1000, {
      service_id: "sauna",
      unit: "per_hour",
      period: "per_night",
      optional: true,
    }),
  ]);
  const q = quoteOffering(
    l,
    scenario({
      checkIn: "2027-02-19",
      checkOut: "2027-02-21",
      services: ["sauna"],
      quantities: { sauna: 4 },
    }),
  );
  assert.equal(q.components.find((c) => c.ruleId === "service").amount, 4000);
});
test("confirmations remain separate by offering and null explicitly revokes one", () => {
  const s = scenario(),
    l = listing([base(), extra(), clean()]);
  const confirmations = {
    fixture_1: {
      offeringId: "fixture_1",
      scenarioKey: scenarioKey(s),
      total: 90000,
      comment: "A",
    },
    fixture_2: {
      offeringId: "fixture_2",
      scenarioKey: scenarioKey(s),
      total: 85000,
      comment: "B",
    },
  };
  validatePatch({ confirmations });
  assert.equal(quoteOffering(l, s, { confirmations }).total, 90000);
  assert.equal(
    quoteOffering({ ...l, id: "fixture_2" }, s, { confirmations }).total,
    85000,
  );
  assert.notEqual(
    quoteOffering(l, s, {
      confirmations: { ...confirmations, fixture_1: null },
    }).status,
    "confirmed",
  );
});
test("manual links preserve inherited source answers, notes and explicit root favorite choices", async () => {
  const { decisionForHouse } = await import("../src/domain/decisions.mjs");
  const child = {
    favorite: true,
    note: "Keep this note",
    confirmation: { offeringId: "fixture_2", total: 85000 },
  };
  const house = { id: "root", originalHouseIds: ["root", "child"] };
  const projected = decisionForHouse(house, {
    child,
    root: { favorite: false },
  });
  assert.equal(projected.confirmations.fixture_2.total, 85000);
  assert.equal(projected.linkedNotes[0].note, child.note);
  assert.equal(projected.favorite, false);
  assert.equal(child.note, "Keep this note");
});
test("summer-only free services cannot become free for February", () => {
  const l = listing([
    base(),
    extra(),
    clean(),
    rule("summer", "included_service", 0, {
      service_id: "pool",
      conditions: { date_from: "2027-06-01", date_to: "2027-08-31" },
    }),
  ]);
  const q = quoteOffering(l, scenario({ services: ["pool"] }));
  assert.equal(q.total, null);
  assert(q.issues.some((i) => i.code === "service_price_pool"));
});
test("two-night daily free quotas require allocation instead of inventing pooling", () => {
  const l = listing([
    base(),
    extra(),
    clean(),
    rule("free", "included_service", 0, {
      service_id: "sauna",
      included_hours: 2,
      period: "per_night",
    }),
    rule("hour", "service", 1000, { service_id: "sauna", unit: "per_hour" }),
  ]);
  const q = quoteOffering(
    l,
    scenario({
      checkIn: "2027-02-19",
      checkOut: "2027-02-21",
      services: ["sauna"],
      quantities: { sauna: 4 },
    }),
  );
  assert.equal(q.total, null);
  assert(q.issues.some((i) => i.code === "service_allocation_sauna"));
});

test("one offering can be separated from a manually merged group, then rejoined without loss", () => {
  const houses = [
    { id: "h1", offerings: [{ id: "a" }, { id: "b" }] },
    { id: "h2", offerings: [{ id: "c" }] },
  ];
  const decisions = {
    h1: { splitListingIds: ["c"] },
    h2: { mergedInto: "h1" },
  };
  const separated = projectHouses(houses, decisions);
  assert.equal(separated.length, 2);
  assert.equal(separated.find((h) => h.id === "split_c").offerings[0].id, "c");
  const rejoined = projectHouses(houses, {
    ...decisions,
    split_c: { mergedInto: "h2", note: "Keep split note" },
  });
  assert.equal(rejoined.flatMap((h) => h.offerings).length, 3);
  assert.equal(rejoined.length, 1);
  assert(rejoined[0].originalHouseIds.includes("split_c"));
});

test("two pool sessions are not confused with the duration of one session", () => {
  const l = listing([
    base(),
    extra(),
    clean(),
    rule("pool", "service", 3000, {
      service_id: "pool",
      unit: "per_session",
      session_hours: 2,
      optional: true,
    }),
  ]);
  assert.equal(
    quoteOffering(
      l,
      scenario({ services: ["pool"], quantities: { pool: 2 } }),
    ).components.find((c) => c.ruleId === "pool").amount,
    6000,
  );
});
test("hourly pool charges need hours rather than silently treating a session as an hour", () => {
  const l = listing([
    base(),
    extra(),
    clean(),
    rule("pool", "service", 1000, {
      service_id: "pool",
      unit: "per_hour",
      optional: true,
    }),
  ]);
  const s = scenario({ services: ["pool"], quantities: { pool: 3 } });
  assert(
    quoteOffering(l, s).issues.some((i) => i.code === "quantity_unit_pool"),
  );
  assert.equal(
    quoteOffering(l, { ...s, quantityUnits: { pool: "ч" } }).components.find(
      (c) => c.ruleId === "pool",
    ).amount,
    3000,
  );
});
test("a summer pool does not disable a separately advertised year-round pool", () => {
  const l = listing([base(), extra(), clean()], {
    features: {
      pool: { value: true },
      summer_pool: { value: true },
      year_round_pool: { value: true },
    },
  });
  assert.equal(quoteOffering(l, scenario()).features.pool_on_dates.value, true);
});

test("zero source rental placeholders cannot advertise a free stay", () => {
  const q = quoteOffering(
    listing([base(0), clean()], { publishedPrice: 30000 }),
    scenario(),
  );
  assert.equal(q.total, null);
  assert.equal(q.sortAmount, 30000);
  assert(!q.components.some((c) => c.kind === "rent_base"));
});

test("an hourly or per-person rental rate is never treated as a flat nightly price", () => {
  for (const unit of ["per_hour", "per_guest"]) {
    const q = quoteOffering(
      listing(
        [
          rule("rent", "rent_base", 1500, { unit, included_guests: 40 }),
          clean(),
        ],
        { publishedPrice: 40000 },
      ),
      scenario(),
    );
    assert.equal(q.total, null);
    assert(!q.components.some((c) => c.kind === "rent_base"));
    assert.equal(q.sortAmount, 40000);
  }
});
