export const DECISION_FIELDS = [
  "favorite",
  "status",
  "note",
  "preferredOfferingId",
  "confirmation",
  "terms",
  "confirmations",
  "termsByOffering",
  "splitListingIds",
  "mergedInto",
];
export function validatePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("Некорректные изменения");
  if (Object.keys(patch).some((k) => !DECISION_FIELDS.includes(k)))
    throw new Error("Недопустимое поле изменения");
  if (
    "note" in patch &&
    (typeof patch.note !== "string" || patch.note.length > 20000)
  )
    throw new Error("Заметка: не больше 20 000 символов");
  if ("favorite" in patch && typeof patch.favorite !== "boolean")
    throw new Error("Некорректное избранное");
  if (
    "status" in patch &&
    !["new", "contacted", "rejected", "finalist"].includes(patch.status)
  )
    throw new Error("Некорректный статус");
  if (patch.confirmation) {
    const c = patch.confirmation;
    if (
      !Number.isFinite(c.total) ||
      c.total < 0 ||
      c.total > 100000000 ||
      typeof c.scenarioKey !== "string" ||
      !c.offeringId ||
      !c.comment?.trim()
    )
      throw new Error(
        "Для сметы нужны сумма, сценарий, объявление и пояснение ответа владельца",
      );
    if (c.deposit != null && (!Number.isFinite(c.deposit) || c.deposit < 0))
      throw new Error("Проверьте залог");
  }
  if (patch.terms) {
    const t = patch.terms;
    if (!t.offeringId || !t.comment?.trim())
      throw new Error("Укажите объявление и основание уточнений");
    for (const value of Object.values(t.numbers || {}))
      if (value != null && (!Number.isFinite(value) || value < 0))
        throw new Error("Проверьте числовые условия");
    for (const value of Object.values(t.features || {}))
      if (![true, false, null].includes(value))
        throw new Error("Проверьте удобства");
  }
  for (const [field, single] of [
    ["confirmations", "confirmation"],
    ["termsByOffering", "terms"],
  ])
    if (field in patch) {
      const entries = patch[field];
      if (
        !entries ||
        typeof entries !== "object" ||
        Array.isArray(entries) ||
        Object.keys(entries).length > 100
      )
        throw new Error("Некорректные уточнения по объявлениям");
      for (const [id, value] of Object.entries(entries)) {
        if (!/^[a-z]+_\d+$/.test(id) && !/^fixture_\d+$/.test(id))
          throw new Error("Некорректный идентификатор объявления");
        if (value !== null) {
          if (value.offeringId !== id)
            throw new Error("Уточнение относится к другому объявлению");
          validatePatch({ [single]: value });
        }
      }
    }
  if (
    patch.splitListingIds &&
    (!Array.isArray(patch.splitListingIds) ||
      patch.splitListingIds.length > 100 ||
      patch.splitListingIds.some((x) => typeof x !== "string"))
  )
    throw new Error("Некорректное разделение объявлений");
  if (JSON.stringify(patch).length > 100000)
    throw new Error("Изменение слишком большое");
  return patch;
}

// Manual links never move or delete the original decisions. Root edits override
// inherited values; source-specific answers and original notes remain visible.
export function decisionForHouse(house, decisions = {}) {
  const ids = [...new Set([...(house.originalHouseIds || []), house.id])];
  const root = decisions[house.id] || {},
    confirmations = {},
    termsByOffering = {},
    linkedNotes = [];
  for (const id of ids.filter((id) => id !== house.id).concat(house.id)) {
    const d = decisions[id] || {};
    if (d.confirmation)
      confirmations[d.confirmation.offeringId] = d.confirmation;
    if (d.terms) termsByOffering[d.terms.offeringId] = d.terms;
    Object.assign(confirmations, d.confirmations);
    Object.assign(termsByOffering, d.termsByOffering);
    if (id !== house.id && d.note)
      linkedNotes.push({ houseId: id, note: d.note, status: d.status });
  }
  return {
    ...root,
    confirmations,
    termsByOffering,
    linkedNotes,
    favorite: root.favorite ?? ids.some((id) => decisions[id]?.favorite),
    relatedRevisionKey: ids
      .map((id) => id + ":" + (decisions[id]?.revision || 0))
      .join("|"),
  };
}

export function nextDecision(previous, patch, { actorUid, eventId, at }) {
  validatePatch(patch);
  return {
    ...previous,
    ...patch,
    revision: (previous.revision || 0) + 1,
    updatedBy: actorUid,
    updatedAt: at,
    lastEventId: eventId,
  };
}
