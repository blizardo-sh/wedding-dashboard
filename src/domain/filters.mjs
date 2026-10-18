export const SOURCE_LABELS = {
  mosarend: "Mosarend",
  yandex: "Яндекс Недвижимость",
  cian: "Циан",
  avito: "Авито",
  sutochno: "Суточно.ру",
};
export const STATUS_LABELS = {
  new: "Изучить",
  contacted: "Связались",
  rejected: "Отказ",
  finalist: "Финалист",
};
const feature = (id, label, group) => ({ id, label, group, type: "feature" });
const numeric = (id, label, group, unit) => ({
  id,
  label,
  group,
  type: "number",
  unit,
});
export const FILTERS = [
  feature("banya", "Баня", "Баня и вода"),
  feature("sauna", "Сауна", "Баня и вода"),
  feature("hammam", "Хамам", "Баня и вода"),
  feature("hot_tub", "Чан", "Баня и вода"),
  feature("plunge_pool", "Купель", "Баня и вода"),
  feature("jacuzzi", "Джакузи", "Баня и вода"),
  feature("pool", "Бассейн", "Баня и вода"),
  feature("pool_on_dates", "Бассейн доступен на даты", "Баня и вода"),
  feature("indoor_pool", "Крытый бассейн", "Баня и вода"),
  feature("heated_pool", "Бассейн с подогревом", "Баня и вода"),
  feature("summer_pool", "Летний бассейн", "Баня и вода"),
  feature("outdoor_pool", "Открытый бассейн", "Баня и вода"),
  feature("year_round_pool", "Круглогодичный бассейн", "Баня и вода"),
  feature("bbq", "Мангал / барбекю", "Кухня и питание"),
  feature("covered_bbq", "Крытая зона барбекю", "Кухня и питание"),
  feature("kitchen", "Кухня", "Кухня и питание"),
  feature("stove", "Плита", "Кухня и питание"),
  feature("fridge", "Холодильник", "Кухня и питание"),
  feature("dishes", "Посуда", "Кухня и питание"),
  feature("dishwasher", "Посудомоечная машина", "Кухня и питание"),
  feature("external_catering", "Свой кейтеринг", "Кухня и питание"),
  feature("own_alcohol", "Свой алкоголь", "Кухня и питание"),
  feature("event_hall", "Зал для мероприятия", "Мероприятие и досуг"),
  feature("dance_floor", "Танцпол", "Мероприятие и досуг"),
  feature("terrace", "Терраса / веранда", "Мероприятие и досуг"),
  feature("gazebo", "Беседка", "Мероприятие и досуг"),
  feature("fireplace", "Камин", "Мероприятие и досуг"),
  feature("karaoke", "Караоке", "Мероприятие и досуг"),
  feature("billiards", "Бильярд", "Мероприятие и досуг"),
  feature("table_tennis", "Настольный теннис", "Мероприятие и досуг"),
  feature("sound", "Музыкальное оборудование", "Мероприятие и досуг"),
  feature("projector", "Проектор / кинозал", "Мероприятие и досуг"),
  feature("wifi", "Wi-Fi", "Мероприятие и досуг"),
  feature("parking", "Парковка", "Участок и правила"),
  feature("heating", "Отопление", "Участок и правила"),
  feature("winter_access", "Зимний подъезд", "Участок и правила"),
  feature("playground", "Детская площадка", "Участок и правила"),
  feature("fenced", "Огороженный участок", "Участок и правила"),
  feature("pets", "Можно с животными", "Участок и правила"),
  feature("children", "Можно с детьми", "Участок и правила"),
  numeric("event", "Вместимость мероприятия", "Размещение", "чел."),
  numeric("sleep", "Спальные места, всего", "Размещение", "чел."),
  numeric("bedrooms", "Спальни", "Размещение", ""),
  numeric("bathrooms", "Санузлы", "Размещение", ""),
  numeric("area", "Площадь дома", "Размещение", "м²"),
  numeric("plot", "Площадь участка", "Размещение", "сот."),
  numeric("parking_spaces", "Парковочных мест", "Размещение", ""),
  numeric("distance", "От МКАД", "Расположение", "км"),
  feature("cook", "Повар площадки", "Услуги и платежи"),
  feature("waiter", "Официанты", "Услуги и платежи"),
  feature("cleaning_included", "Уборка включена", "Услуги и платежи"),
  feature("linen_included", "Бельё включено", "Услуги и платежи"),
];
export function featureLabel(id) {
  return FILTERS.find((f) => f.id === id)?.label || id;
}
export const EMPTY_FILTERS = {
  search: "",
  source: "",
  status: "",
  favorite: false,
  withPhotos: false,
  priceStatus: "",
  availability: "",
  permission: "",
  minPrice: "",
  maxPrice: "",
  maxDeposit: "",
  direction: "",
  includeUnknown: false,
  hideUnavailable: true,
  includeOutsideRegion: false,
  features: {},
  numbers: {},
};
export function offeringPasses(o, q, filters, decision = {}) {
  const text = filters.search?.trim().toLowerCase();
  if (text && !o.searchText.includes(text)) return false;
  if (filters.source && o.source !== filters.source) return false;
  if (filters.direction && !o.direction?.includes(filters.direction))
    return false;
  if (!filters.includeOutsideRegion && o.regionScope === "outside")
    return false;
  if (filters.withPhotos && !o.photos?.length) return false;
  if (
    filters.hideUnavailable &&
    (q.availability === "booked" ||
      q.availability === "inactive" ||
      q.eventPermission === "no")
  )
    return false;
  if (filters.priceStatus && q.status !== filters.priceStatus) return false;
  if (filters.availability && q.availability !== filters.availability)
    return false;
  if (filters.permission && q.eventPermission !== filters.permission)
    return false;
  if (filters.favorite && !decision.favorite) return false;
  if (filters.status && (decision.status || "new") !== filters.status)
    return false;
  for (const [id, wanted] of Object.entries(filters.features || {})) {
    if (!wanted) continue;
    let actual = q.features[id]?.value;
    if (wanted === "unknown") {
      if (actual !== undefined && actual !== null) return false;
    } else if (
      actual !== (wanted === "yes") &&
      !(filters.includeUnknown && (actual === undefined || actual === null))
    )
      return false;
  }
  for (const [id, range] of Object.entries(filters.numbers || {})) {
    const val = q.numbers[id];
    if (
      (range.min !== "" && range.min != null) ||
      (range.max !== "" && range.max != null)
    ) {
      if (val == null) {
        if (!filters.includeUnknown) return false;
      } else if (
        (range.min !== "" && range.min != null && val < Number(range.min)) ||
        (range.max !== "" && range.max != null && val > Number(range.max))
      )
        return false;
    }
  }
  if (filters.maxDeposit !== "") {
    if (!q.deposits.length && !filters.includeUnknown) return false;
    if (
      q.deposits.reduce((a, x) => a + x.amount, 0) > Number(filters.maxDeposit)
    )
      return false;
  }
  // A partial amount cannot pass a budget as if it were a full quote. It stays in the uncertain group.
  if (q.status !== "partial") {
    if (filters.minPrice !== "" && q.total < Number(filters.minPrice))
      return false;
    if (filters.maxPrice !== "" && q.total > Number(filters.maxPrice))
      return false;
  }
  return true;
}

export function projectHouses(houses, decisions = {}) {
  const map = new Map(
    houses.map((h) => [
      h.id,
      { ...h, offerings: [...h.offerings], originalHouseIds: [h.id] },
    ]),
  );
  for (const [id, d] of Object.entries(decisions)) {
    for (const oid of d.splitListingIds || []) {
      if (map.has("split_" + oid)) continue;
      const source = [...map.values()].find((h) =>
        h.offerings.some((o) => o.id === oid),
      );
      if (!source) continue;
      const offer = source.offerings.find((o) => o.id === oid);
      if (!offer) continue;
      source.offerings = source.offerings.filter((o) => o.id !== oid);
      map.set("split_" + oid, {
        id: "split_" + oid,
        title: offer.title,
        offerings: [offer],
        identityStatus: "user_split",
        originalHouseIds: [...source.originalHouseIds],
      });
    }
  }
  for (const [id, d] of Object.entries(decisions)) {
    if (!d.mergedInto || d.mergedInto === id) continue;
    const seen = new Set([id]);
    let targetId = d.mergedInto;
    while (decisions[targetId]?.mergedInto && !seen.has(targetId)) {
      seen.add(targetId);
      targetId = decisions[targetId].mergedInto;
    }
    if (seen.has(targetId)) continue;
    const source = map.get(id),
      target = map.get(targetId);
    if (source && target) {
      target.offerings.push(...source.offerings);
      target.originalHouseIds = [
        ...new Set([
          ...target.originalHouseIds,
          source.id,
          ...source.originalHouseIds,
        ]),
      ];
      map.delete(id);
    }
  }
  return [...map.values()].filter((h) => h.offerings.length);
}
