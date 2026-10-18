import { selectQuote } from "./pricing.mjs";

export const PRICE_MODES = {
  full: "Полная стоимость",
  listing: "Стоимость в объявлении",
};
export const normalizePriceMode = (mode) =>
  mode === "listing" ? "listing" : "full";

export function priceView(offering, quote, mode = "full") {
  if (normalizePriceMode(mode) === "listing") {
    const amount =
      Number.isFinite(offering.publishedPrice) && offering.publishedPrice > 0
        ? offering.publishedPrice
        : null;
    return {
      amount,
      from: amount !== null,
      status: "listing",
      label:
        amount !== null
          ? "По условиям объявления"
          : "Цена в объявлении не указана",
    };
  }
  const hasRent = quote.components.some((c) =>
    ["rent_base", "owner_quote"].includes(c.kind),
  );
  const amount = hasRent ? (quote.total ?? quote.knownSubtotal) : null;
  return {
    amount,
    from: false,
    status: quote.status,
    label:
      amount === null
        ? "Недостаточно условий для расчёта"
        : quote.status === "confirmed"
          ? "Подтверждено для сценария"
          : quote.status === "estimate"
            ? "Ориентир полной стоимости"
            : "Известная часть · итог уточнить",
  };
}

export function priceBudget(offering, quote, filters, mode = "full") {
  const min = filters.minPrice,
    max = filters.maxPrice;
  if ((min === "" || min == null) && (max === "" || max == null)) return true;
  const price = priceView(offering, quote, mode);
  if (price.amount === null) return "unknown";
  if (max !== "" && max != null && price.amount > Number(max)) return false;
  if (normalizePriceMode(mode) === "full" && quote.status === "partial")
    return "unknown";
  if (min !== "" && min != null && price.amount < Number(min)) return false;
  return true;
}

export function comparePriceRows(a, b, mode = "full", descending = false) {
  const left = priceView(a.offering || a.o, a.q, mode);
  const right = priceView(b.offering || b.o, b.q, mode);
  if (left.amount === null || right.amount === null)
    return Number(left.amount === null) - Number(right.amount === null);
  if (normalizePriceMode(mode) === "full" && a.q.confidence !== b.q.confidence)
    return b.q.confidence - a.q.confidence;
  return (left.amount - right.amount) * (descending ? -1 : 1);
}

export function selectPriceCandidate(candidates, preferredId, mode = "full") {
  const preferred = candidates.find((c) => c.q.offeringId === preferredId);
  if (preferred) return preferred;
  if (normalizePriceMode(mode) === "listing")
    return [...candidates].sort((a, b) => comparePriceRows(a, b, mode))[0];
  const quote = selectQuote(candidates.map((c) => c.q));
  return candidates.find((c) => c.q === quote);
}
