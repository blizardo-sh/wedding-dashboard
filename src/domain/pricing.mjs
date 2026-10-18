export const DEFAULT_SCENARIO = {
  checkIn: "2027-02-21",
  checkOut: "2027-02-22",
  guests: 35,
  overnightGuests: 20,
  childrenAges: [],
  days: [],
  services: [],
  quantities: {},
  quantityUnits: {},
  servicePeople: {},
};
export const SERVICES = [
  {
    id: "cleaning",
    label: "Уборка",
    unit: "сеанс",
    defaultQuantity: 1,
  },
  { id: "sauna", label: "Сауна", unit: "ч", defaultQuantity: 3 },
  { id: "banya", label: "Баня", unit: "ч", defaultQuantity: 3 },
  { id: "hammam", label: "Хамам", unit: "ч", defaultQuantity: 2 },
  { id: "hot_tub", label: "Чан", unit: "сеанс", defaultQuantity: 1 },
  { id: "pool", label: "Бассейн", unit: "сеанс", defaultQuantity: 1 },
  { id: "cook", label: "Повар площадки", unit: "ч", defaultQuantity: 4 },
  { id: "waiter", label: "Официант", unit: "ч", defaultQuantity: 4 },
  {
    id: "linen",
    label: "Постельное бельё",
    unit: "компл.",
    defaultQuantity: 10,
  },
  { id: "early_checkin", label: "Ранний заезд", unit: "ч", defaultQuantity: 2 },
  {
    id: "late_checkout",
    label: "Поздний выезд",
    unit: "ч",
    defaultQuantity: 2,
  },
];
const labels = {
  rent_base: "Аренда",
  extra_guests: "Доплата за гостей",
  mandatory_fee: "Обязательный платёж",
  included_service: "Включено",
  refundable_deposit: "Возвратный залог",
  prepayment: "Предоплата",
};
const serviceLabel = (id) =>
  SERVICES.find((x) => x.id === id)?.label ||
  { cleaning: "Уборка", service_fee: "Сервисный сбор" }[id] ||
  id;
const iso = (date) => new Date(date + "T00:00:00Z");
const dateString = (d) => d.toISOString().slice(0, 10);
const integer = (n, min, max = 10000) =>
  n !== null &&
  n !== "" &&
  n !== undefined &&
  Number.isInteger(Number(n)) &&
  Number(n) >= min &&
  Number(n) <= max;
export function scenarioDays(s) {
  for (const key of ["checkIn", "checkOut"]) {
    const value = s[key];
    const d = iso(value);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value || "") ||
      !Number.isFinite(d.getTime()) ||
      dateString(d) !== value
    )
      throw new Error("Укажите корректные даты заезда и выезда");
  }
  const nights = Math.round((iso(s.checkOut) - iso(s.checkIn)) / 86400000);
  if (!integer(nights, 1, 2))
    throw new Error("Выберите аренду на одну или две ночи");
  if (
    !integer(s.guests, 1) ||
    !integer(s.overnightGuests, 0, 20) ||
    Number(s.overnightGuests) > Number(s.guests)
  )
    throw new Error(
      "Проверьте гостей: ночующих не больше всех гостей и не больше 20",
    );
  return Array.from({ length: nights }, (_, index) => {
    const d = new Date(iso(s.checkIn).getTime() + index * 86400000);
    const date = dateString(d);
    const custom = (s.days || []).find((x) => x.date === date) || {};
    const guests = Number(custom.guests ?? s.guests),
      overnightGuests = Number(custom.overnightGuests ?? s.overnightGuests);
    const childrenAges = custom.childrenAges ?? s.childrenAges ?? [];
    if (
      !integer(guests, 1) ||
      !integer(overnightGuests, 0, 20) ||
      overnightGuests > guests
    )
      throw new Error("Проверьте количество гостей по дням");
    if (
      !Array.isArray(childrenAges) ||
      childrenAges.length > guests ||
      childrenAges.some((x) => !integer(x, 0, 17))
    )
      throw new Error(
        "Возраст детей — от 0 до 17; дети входят в общее число гостей",
      );
    return {
      date,
      guests,
      overnightGuests,
      childrenAges,
      weekday: d.getUTCDay(),
    };
  });
}
export function scenarioKey(s) {
  const days = scenarioDays(s).map(
    ({ date, guests, overnightGuests, childrenAges }) => ({
      date,
      guests,
      overnightGuests,
      childrenAges: [...childrenAges].map(Number).sort((a, b) => a - b),
    }),
  );
  const services = [...(s.services || [])].sort();
  const numeric = (v) =>
    v !== "" && v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  return JSON.stringify({
    checkIn: s.checkIn,
    checkOut: s.checkOut,
    days,
    services,
    quantities: Object.fromEntries(
      services.map((x) => [x, numeric(s.quantities?.[x])]),
    ),
    quantityUnits: Object.fromEntries(
      services.map((x) => [
        x,
        s.quantityUnits?.[x] || SERVICES.find((v) => v.id === x)?.unit || null,
      ]),
    ),
    servicePeople: Object.fromEntries(
      services.map((x) => [x, numeric(s.servicePeople?.[x])]),
    ),
  });
}
function applies(r, day, s, days) {
  const c = r.conditions || {};
  return (
    !c.unknown_weekdays &&
    (!c.weekdays?.length || c.weekdays.includes(day.weekday)) &&
    (!c.date_from || day.date >= c.date_from) &&
    (!c.date_to || day.date <= c.date_to) &&
    (!c.min_nights || days.length >= c.min_nights) &&
    (!c.nights || days.length === c.nights)
  );
}
const reviewed = (r) =>
  r.review_status === "confirmed_by_owner"
    ? 3
    : r.review_status === "checked_against_description"
      ? 2
      : 1;
function chooseRules(rules, issue, group) {
  const usable = rules.filter(
    (r) =>
      Number.isFinite(r.amount) &&
      r.amount >= 0 &&
      (r.kind !== "rent_base" ||
        (r.amount > 0 &&
          ["per_night", "per_stay", "package"].includes(r.unit))) &&
      !r.ambiguous,
  );
  if (!usable.length) {
    if (rules.length)
      issue(
        "ambiguous_rule",
        "Условие нужно разобрать вручную: " + group,
        rules[0],
      );
    return null;
  }
  usable.sort(
    (a, b) =>
      reviewed(b) -
      reviewed(a) +
      (Boolean(b.conditions?.weekdays?.length) -
        Boolean(a.conditions?.weekdays?.length)) /
        10,
  );
  const top = usable.filter(
    (r) =>
      reviewed(r) === reviewed(usable[0]) &&
      Boolean(r.conditions?.weekdays?.length) ===
        Boolean(usable[0].conditions?.weekdays?.length),
  );
  if (
    new Set(
      top.map((r) =>
        [
          r.amount,
          r.unit,
          r.period,
          r.included_guests,
          r.guest_scope,
          r.included_hours,
          r.included_quantity,
          r.basis,
          r.minimum_quantity,
        ].join("|"),
      ),
    ).size > 1
  ) {
    issue("conflicting_rules", "Противоречащие тарифы: " + group, top[0]);
    return null;
  }
  return usable[0];
}
export function quoteOffering(offering, s, decision = {}) {
  const days = scenarioDays(s),
    selected = new Set(s.services || []),
    components = [],
    deposits = [],
    payments = [],
    issues = [],
    warnings = [];
  const issue = (code, message, rule) => {
    if (!issues.some((x) => x.code === code && x.ruleId === rule?.id))
      issues.push({
        code,
        message,
        ruleId: rule?.id,
        evidence: rule?.evidence,
      });
  };
  const warning = (code, message) => {
    if (!warnings.some((x) => x.code === code))
      warnings.push({ code, message });
  };
  const allRules = [...(offering.rules || [])];
  const override = Object.hasOwn(decision.confirmations || {}, offering.id)
    ? decision.confirmations[offering.id]
    : decision.confirmation;
  const currentKey = scenarioKey(s);
  const confirmed =
    override?.offeringId === offering.id &&
    override?.scenarioKey === currentKey &&
    Number.isFinite(override?.total) &&
    override.total >= 0;
  if (override && !confirmed)
    warning(
      "confirmation_other_scenario",
      "Ответ владельца относится к другому сценарию или объявлению",
    );
  const sourceTerms = Object.hasOwn(decision.termsByOffering || {}, offering.id)
    ? decision.termsByOffering[offering.id]
    : decision.terms;
  const applicableTerms =
    sourceTerms?.offeringId === offering.id ? sourceTerms : {};
  const availability =
    applicableTerms.availabilityCheckIn === s.checkIn &&
    applicableTerms.availabilityCheckOut === s.checkOut
      ? applicableTerms.availability
      : offering.availability;
  const effectiveNumbers = { ...offering.numbers, ...applicableTerms.numbers };
  const maxGuests = Math.max(...days.map((d) => d.guests)),
    maxSleep = Math.max(...days.map((d) => d.overnightGuests));
  const mismatch = [];
  if (effectiveNumbers.event && effectiveNumbers.event < maxGuests)
    mismatch.push(
      "На мероприятие заявлено " +
        effectiveNumbers.event +
        " мест, нужно " +
        maxGuests,
    );
  if (effectiveNumbers.sleep && effectiveNumbers.sleep < maxSleep)
    mismatch.push(
      "На ночь заявлено " + effectiveNumbers.sleep + " мест, нужно " + maxSleep,
    );
  const effectiveFeatures = { ...offering.features };
  for (const [id, value] of Object.entries(applicableTerms.features || {}))
    effectiveFeatures[id] = {
      value,
      claims: [
        {
          value,
          quote: applicableTerms.comment || "Уточнено участником",
          review: "user",
        },
      ],
    };
  const permission =
    applicableTerms.eventPermission || offering.eventPermission;
  const winter = days.some((d) =>
    [0, 1, 2, 10, 11].includes(iso(d.date).getUTCMonth()),
  );
  let poolOnDates = null;
  if (effectiveFeatures.pool?.value === false) poolOnDates = false;
  else if (effectiveFeatures.year_round_pool?.value === true)
    poolOnDates = true;
  else if (effectiveFeatures.summer_pool?.value === true && winter)
    poolOnDates = false;
  else if (
    effectiveFeatures.summer_pool?.value === true &&
    days.every((d) => [5, 6, 7].includes(iso(d.date).getUTCMonth()))
  )
    poolOnDates = true;
  if (
    applicableTerms.availabilityCheckIn === s.checkIn &&
    applicableTerms.availabilityCheckOut === s.checkOut &&
    typeof applicableTerms.poolOnDates === "boolean"
  )
    poolOnDates = applicableTerms.poolOnDates;
  effectiveFeatures.pool_on_dates = {
    value: poolOnDates,
    claims: effectiveFeatures.pool?.claims || [],
  };
  if (permission === "no") mismatch.push("Мероприятия запрещены");
  if (!effectiveNumbers.event)
    warning("event_capacity_unknown", "Вместимость мероприятия нужно уточнить");
  if (!effectiveNumbers.sleep && maxSleep)
    warning("sleep_capacity_unknown", "Число спальных мест нужно уточнить");
  if (permission === "unknown")
    warning(
      "event_permission_unknown",
      "Разрешение мероприятия нужно уточнить",
    );
  if (!["available", "booked", "inactive"].includes(availability))
    warning("dates_unknown", "Доступность на даты не проверена");
  if (["booked", "inactive"].includes(availability))
    mismatch.push(
      availability === "booked"
        ? "Занят на выбранные даты"
        : "Объявление неактивно",
    );
  for (const id of selected) {
    if (effectiveFeatures[id]?.value === false)
      mismatch.push(serviceLabel(id) + ": услуги нет");
    if (id === "pool" && poolOnDates === false)
      mismatch.push("Бассейн недоступен на выбранные даты");
  }
  if (confirmed) {
    components.push({
      kind: "owner_quote",
      label: "Смета владельца для этого сценария",
      amount: override.total,
      evidence: {
        quote: override.comment || "Ответ владельца",
        source_url: offering.url,
      },
    });
    if (Number.isFinite(override.deposit))
      deposits.push({ label: "Возвратный залог", amount: override.deposit });
    return {
      offeringId: offering.id,
      status: "confirmed",
      total: override.total,
      knownSubtotal: override.total,
      sortAmount: override.total,
      components,
      deposits,
      payments,
      issues,
      warnings,
      mismatch,
      availability,
      eventPermission: permission,
      numbers: effectiveNumbers,
      features: effectiveFeatures,
      confidence: 3,
      scenarioKey: currentKey,
    };
  }
  if (days.some((d) => d.childrenAges.length))
    warning(
      "children_unconfirmed",
      "Дети включены в число гостей; возрастные скидки требуют подтверждения",
    );
  if (allRules.some((r) => reviewed(r) === 1))
    warning(
      "machine_rules",
      "Часть условий распознана автоматически — проверьте цитаты",
    );
  const bases = [];
  const packages = allRules.filter(
    (r) =>
      r.kind === "rent_base" &&
      (r.unit === "package" || r.conditions?.nights) &&
      applies(r, days[0], s, days),
  );
  let packageRule = null;
  if (packages.length)
    packageRule = chooseRules(packages, issue, "пакет аренды");
  if (packageRule) {
    bases.push({ rule: packageRule, days });
    components.push({
      kind: "rent_base",
      label: "Аренда · пакет " + days.length + " ночи",
      amount: packageRule.amount,
      evidence: packageRule.evidence,
      ruleId: packageRule.id,
    });
    if (packageRule.value_type && packageRule.value_type !== "published")
      issue("base_from", "Пакет указан «от» или диапазоном", packageRule);
  } else {
    for (const day of days) {
      const candidates = allRules.filter(
        (r) =>
          r.kind === "rent_base" &&
          r.unit !== "package" &&
          !r.conditions?.nights &&
          applies(r, day, s, days),
      );
      const base = chooseRules(candidates, issue, "аренда " + day.date);
      if (!base) {
        issue(
          "base_missing_" + day.date,
          "Нет однозначного тарифа на " + day.date,
        );
        continue;
      }
      if (base.unit === "per_stay" && days.length > 1) {
        issue(
          "stay_tariff_duration",
          "Длительность разового тарифа не определена",
          base,
        );
        continue;
      }
      bases.push({ rule: base, days: [day] });
      components.push({
        kind: "rent_base",
        label: "Аренда · " + day.date,
        amount: base.amount,
        evidence: base.evidence,
        ruleId: base.id,
      });
      if (base.value_type && base.value_type !== "published")
        issue("base_from", "Тариф указан «от» или диапазоном", base);
      if (base.conditions?.date_policy_requires_confirmation)
        issue(
          "holiday_tariff",
          "Условия праздничного тарифа нужно подтвердить",
          base,
        );
    }
  }
  const extraStayCharged = new Set();
  for (const entry of bases) {
    const base = entry.rule;
    for (const day of entry.days) {
      const extraCandidates = allRules.filter(
        (r) =>
          r.kind === "extra_guests" &&
          (!r.tariff_id || r.tariff_id === base.id) &&
          applies(r, day, s, days),
      );
      const extra = extraCandidates.length
        ? chooseRules(extraCandidates, issue, "доплата за гостей " + day.date)
        : null;
      const threshold = extra?.included_guests ?? base.included_guests;
      if (!integer(threshold, 0)) {
        issue(
          "included_guests_unknown",
          "Неизвестно, сколько гостей включает аренда",
          base,
        );
        continue;
      }
      if (!extra) {
        if (day.guests > threshold)
          issue(
            "extra_guests_unknown",
            "Нет ставки для гостей сверх " + threshold,
            base,
          );
        continue;
      }
      const countByScope = {
        all_guests: day.guests,
        overnight_guests: day.overnightGuests,
        day_only_guests: day.guests - day.overnightGuests,
      };
      let people = countByScope[extra.guest_scope];
      if (people === undefined) {
        issue("extra_scope", "Неясно, за каких гостей берётся доплата", extra);
        continue;
      }
      if (packageRule && extra.period !== "per_night") {
        issue(
          "package_extra_period",
          "Доплата за гостей для пакета требует уточнения",
          extra,
        );
        continue;
      }
      if (extra.period !== "per_night") {
        if (extraStayCharged.has(extra.id)) continue;
        extraStayCharged.add(extra.id);
        const relevant = days.filter((d) => applies(extra, d, s, days));
        people = Math.max(
          ...relevant.map((d) =>
            extra.guest_scope === "all_guests"
              ? d.guests
              : extra.guest_scope === "overnight_guests"
                ? d.overnightGuests
                : d.guests - d.overnightGuests,
          ),
        );
      }
      const quantity = Math.max(0, people - threshold);
      if (quantity)
        components.push({
          kind: "extra_guests",
          label: "Гости сверх " + threshold + " · " + day.date,
          amount: quantity * extra.amount,
          quantity,
          evidence: extra.evidence,
          ruleId: extra.id,
        });
      if (extra.value_type && extra.value_type !== "published")
        issue(
          "extra_from",
          "Доплата за гостей указана «от» или диапазоном",
          extra,
        );
    }
  }
  const groups = new Map();
  for (const r of allRules) {
    if (["rent_base", "extra_guests"].includes(r.kind)) continue;
    if (
      r.kind === "service" &&
      !selected.has(r.service_id) &&
      r.optional !== false
    )
      continue;
    if (
      r.kind === "included_service" &&
      r.service_id !== "cleaning" &&
      !selected.has(r.service_id)
    )
      continue;
    if (r.kind === "unresolved") {
      issue("unresolved_" + r.id, "Неоднозначное условие в описании", r);
      continue;
    }
    if (!days.some((d) => applies(r, d, s, days))) continue;
    const key = r.kind + ":" + (r.service_id || r.kind);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const baseAmount = components
    .filter((c) => c.kind === "rent_base")
    .reduce((a, c) => a + c.amount, 0);
  for (const [group, candidates] of groups) {
    const r = chooseRules(
      candidates,
      issue,
      serviceLabel(candidates[0].service_id) || group,
    );
    if (!r) continue;
    if (r.optional === null && ["service", "mandatory_fee"].includes(r.kind)) {
      issue("optional_unknown", "Неясно, обязателен ли платёж", r);
      continue;
    }
    let quantity = 1,
      amount = r.amount;
    if (r.kind === "included_service") amount = 0;
    else if (["per_hour", "per_session", "per_bed_set"].includes(r.unit)) {
      const entered = s.quantities?.[r.service_id];
      let requested = Number(entered);
      if (
        entered === "" ||
        entered == null ||
        !Number.isFinite(requested) ||
        requested < 0
      ) {
        issue(
          "quantity_" + r.service_id,
          "Укажите количество: " + serviceLabel(r.service_id),
          r,
        );
        continue;
      }
      const unit =
        s.quantityUnits?.[r.service_id] ||
        SERVICES.find((x) => x.id === r.service_id)?.unit;
      if (
        (r.unit === "per_hour" && unit !== "ч") ||
        (r.unit === "per_bed_set" && unit !== "компл.") ||
        (r.unit === "per_session" && !["ч", "сеанс"].includes(unit)) ||
        (r.unit === "per_session" && unit === "ч" && !r.session_hours)
      ) {
        issue(
          "quantity_unit_" + r.service_id,
          "Единица количества не совпадает с тарифом; выберите часы, сеансы или комплекты",
          r,
        );
        continue;
      }
      const included = allRules.find(
        (x) =>
          x.kind === "included_service" &&
          x.service_id === r.service_id &&
          !x.ambiguous &&
          days.some((d) => applies(x, d, s, days)),
      );
      if (
        days.length > 1 &&
        included?.period === "per_night" &&
        (included.included_hours || included.included_quantity)
      ) {
        issue(
          "service_allocation_" + r.service_id,
          "Для ежедневного включённого лимита нужно уточнить распределение услуги по ночам",
          included,
        );
        continue;
      }
      if (included?.included_hours)
        if (unit !== "ч") {
          issue(
            "included_unit_" + r.service_id,
            "Включённый лимит указан в часах; для расчёта выберите часы",
            included,
          );
          continue;
        }
      if (included?.included_hours)
        requested = Math.max(
          0,
          requested -
            included.included_hours *
              (included.period === "per_night" ? days.length : 1),
        );
      if (included?.included_quantity)
        requested = Math.max(
          0,
          requested -
            included.included_quantity *
              (included.period === "per_night" ? days.length : 1),
        );
      quantity =
        r.unit === "per_session" && unit === "ч"
          ? Math.ceil(requested / (r.session_hours || 1))
          : r.unit === "per_session"
            ? Math.ceil(requested)
            : requested;
      quantity = Math.max(quantity, r.minimum_quantity || 0);
      amount = r.amount * quantity;
    } else if (r.unit === "per_guest") {
      const relevant = days.filter((d) => applies(r, d, s, days));
      const counts = relevant.map((d) =>
        r.guest_scope === "all_guests"
          ? d.guests
          : r.guest_scope === "overnight_guests"
            ? d.overnightGuests
            : r.guest_scope === "day_only_guests"
              ? d.guests - d.overnightGuests
              : null,
      );
      if (counts.every((x) => x != null))
        quantity =
          r.period === "per_night"
            ? counts.reduce((a, b) => a + b, 0)
            : Math.max(...counts);
      else if (
        s.servicePeople?.[r.service_id] !== "" &&
        s.servicePeople?.[r.service_id] != null &&
        Number.isFinite(Number(s.servicePeople[r.service_id])) &&
        Number(s.servicePeople[r.service_id]) >= 0
      )
        quantity =
          Number(s.servicePeople[r.service_id]) *
          (r.period === "per_night" ? relevant.length : 1);
      else {
        issue(
          "service_scope_" + r.service_id,
          "Укажите число людей для услуги " + serviceLabel(r.service_id),
          r,
        );
        continue;
      }
      amount = r.amount * quantity;
    } else if (r.unit === "percent") {
      if (r.basis !== "rent_base" || !baseAmount) {
        issue("percent_basis", "Неизвестна база процента", r);
        continue;
      }
      amount = baseAmount * r.amount;
    } else if (!["per_stay", undefined].includes(r.unit)) {
      issue("unit_unknown", "Неизвестна единица оплаты", r);
      continue;
    }
    // Hour/session quantities describe the whole stay. Nightly flat fees repeat;
    // per-person amounts above already sum the actual attendance of each night.
    if (
      r.period === "per_night" &&
      !["per_guest", "per_hour", "per_session", "per_bed_set"].includes(r.unit)
    )
      amount *= days.filter((d) => applies(r, d, s, days)).length;
    const component = {
      kind: r.kind,
      label: r.service_id
        ? serviceLabel(r.service_id)
        : labels[r.kind] || "Платёж",
      amount,
      quantity,
      ruleId: r.id,
      evidence: r.evidence,
    };
    if (r.kind === "refundable_deposit") deposits.push(component);
    else if (r.kind === "prepayment") payments.push(component);
    else components.push(component);
    if (r.value_type && r.value_type !== "published")
      issue(
        "from_" + r.id,
        "Сумма указана «от» или диапазоном: " + component.label,
        r,
      );
  }
  for (const service of selected) {
    const applicable = allRules.filter(
      (r) =>
        r.service_id === service &&
        !r.ambiguous &&
        days.some((d) => applies(r, d, s, days)),
    );
    if (
      !applicable.some((r) =>
        ["service", "mandatory_fee", "included_service"].includes(r.kind),
      )
    )
      issue(
        "service_price_" + service,
        "Нет цены или подтверждения включения на эти даты: " +
          serviceLabel(service),
      );
    const included = applicable.find((r) => r.kind === "included_service");
    const quota = included?.included_hours ?? included?.included_quantity;
    if (quota != null) {
      const unit =
        s.quantityUnits?.[service] ||
        SERVICES.find((x) => x.id === service)?.unit;
      if (included.included_hours != null && unit !== "ч")
        issue(
          "included_unit_" + service,
          "Включённый лимит указан в часах; для расчёта выберите часы",
          included,
        );
      const requested = Number(s.quantities?.[service]);
      if (!Number.isFinite(requested))
        issue(
          "quantity_" + service,
          "Укажите количество: " + serviceLabel(service),
          included,
        );
      else if (
        days.length > 1 &&
        included.period === "per_night" &&
        requested > 0
      )
        issue(
          "service_allocation_" + service,
          "Для ежедневного включённого лимита нужно уточнить распределение услуги по ночам",
          included,
        );
      else if (
        requested >
          quota * (included.period === "per_night" ? days.length : 1) &&
        !applicable.some((r) => r.kind === "service")
      )
        issue(
          "included_limit_" + service,
          "Для " +
            serviceLabel(service) +
            " известен включённый лимит, но нет цены сверх него",
          included,
        );
    }
  }
  if (
    !allRules.some(
      (r) =>
        r.service_id === "cleaning" &&
        (["mandatory_fee", "included_service"].includes(r.kind) ||
          (r.kind === "service" && r.optional === true)) &&
        !r.ambiguous &&
        days.some((d) => applies(r, d, s, days)),
    )
  )
    issue(
      "cleaning_unknown",
      "Уборка: стоимость и обязательность не подтверждены",
    );
  if (!(offering.requiredCostsComplete || applicableTerms.completeInventory))
    issue(
      "inventory_unknown",
      "Полнота обязательных расходов требует подтверждения",
    );
  const knownSubtotal = components.reduce((a, x) => a + x.amount, 0);
  const status = issues.length ? "partial" : "estimate";
  const hasBase = components.some((c) => c.kind === "rent_base");
  return {
    offeringId: offering.id,
    status,
    total: issues.length ? null : knownSubtotal,
    knownSubtotal,
    sortAmount: hasBase ? knownSubtotal : offering.publishedPrice || Infinity,
    components,
    deposits,
    payments,
    issues,
    warnings,
    mismatch,
    availability,
    eventPermission: permission,
    numbers: effectiveNumbers,
    features: effectiveFeatures,
    confidence: status === "estimate" ? 2 : hasBase ? 1 : 0,
    scenarioKey: currentKey,
  };
}
export function selectQuote(quotes, preferredId) {
  const preferred = quotes.find((q) => q.offeringId === preferredId);
  if (preferred) return preferred;
  return [...quotes].sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.mismatch.length - b.mismatch.length ||
      a.sortAmount - b.sortAmount,
  )[0];
}
export function quoteAmount(q) {
  return q.total ?? q.knownSubtotal;
}
export function matchesBudget(q, min, max) {
  if (q.status === "partial") return "unknown";
  if (min !== "" && min != null && q.total < Number(min)) return false;
  if (max !== "" && max != null && q.total > Number(max)) return false;
  return true;
}
