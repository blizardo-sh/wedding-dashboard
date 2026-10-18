import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useDeferredValue,
} from "react";
import { createPortal } from "react-dom";
import {
  House,
  Search,
  SlidersHorizontal,
  Users,
  BedDouble,
  CalendarDays,
  LayoutGrid,
  Table2,
  Heart,
  X,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ExternalLink,
  Plus,
  Check,
  Info,
  ShieldCheck,
  Download,
  Upload,
  LogOut,
  Settings,
  MessageSquare,
  FileText,
  GitMerge,
  Undo2,
  AlertCircle,
  RefreshCw,
  ImageOff,
  Columns3,
  Waves,
  Flame,
  MapPin,
  ArrowUpDown,
} from "lucide-react";
import { createRepository } from "./lib/repository.mjs";
import {
  DEFAULT_SCENARIO,
  SERVICES,
  scenarioDays,
  scenarioKey,
  quoteOffering,
} from "./domain/pricing.mjs";
import {
  FILTERS,
  EMPTY_FILTERS,
  SOURCE_LABELS,
  STATUS_LABELS,
  featureLabel,
  offeringPasses,
  projectHouses,
} from "./domain/filters.mjs";
import { decisionForHouse } from "./domain/decisions.mjs";
import {
  PRICE_MODES,
  normalizePriceMode,
  priceView,
  comparePriceRows,
  selectPriceCandidate,
} from "./domain/price-view.mjs";

const rub = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("ru-RU");
const money = (value) =>
  Number.isFinite(value) ? rub.format(value) : "Неизвестно";
const formatDate = (date, long = false) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: long ? "long" : "short",
    timeZone: "UTC",
  }).format(new Date(date + "T00:00:00Z"));
const stamp = (value) =>
  value?.toDate
    ? value.toDate().toLocaleString("ru-RU")
    : value
      ? new Date(value).toLocaleString("ru-RU")
      : "";
const clone = (x) => JSON.parse(JSON.stringify(x));
const detailCache = new Map();
function getDetail(repo, id) {
  if (!detailCache.has(id))
    detailCache.set(
      id,
      repo.getDetail(id).catch((e) => {
        detailCache.delete(id);
        throw e;
      }),
    );
  return detailCache.get(id);
}
function stored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveFile(name, value, type = "application/json") {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([value], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function Modal({ children, onClose, className = "", label }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    return () => d.close();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
function IconButton({ label, children, ...props }) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
function Select({ label, value, onChange, children, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}
function Numeric({ label, value, onChange, min = 0, max, unit, ...props }) {
  return (
    <label className="field">
      <span>
        {label}
        {unit && <small> · {unit}</small>}
      </span>
      <input
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        onChange={(e) =>
          onChange(e.target.value === "" ? "" : Number(e.target.value))
        }
        {...props}
      />
    </label>
  );
}
function Toggle({ checked, onChange, children }) {
  return (
    <label className="check-label">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}
function ChildrenInput({
  value = [],
  onChange,
  label = "Возраст детей через запятую",
}) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => setText(value.join(", ")), [JSON.stringify(value)]);
  const commit = () => {
    const ages = text
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => (/^\d{1,2}$/.test(x) ? Number(x) : NaN));
    onChange(ages);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        placeholder="Например: 4, 7"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
function Source({ id }) {
  return (
    <span className={"source source-" + id}>{SOURCE_LABELS[id] || id}</span>
  );
}
function PriceModeSwitch({ priceMode, setPriceMode }) {
  return (
    <div
      className="price-mode-switch"
      role="group"
      aria-label="Какую стоимость показывать"
    >
      {Object.entries(PRICE_MODES).map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={priceMode === id}
          className={priceMode === id ? "active" : ""}
          onClick={() => setPriceMode(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
function QuotePrice({ q, offering, large = false, priceMode = "full" }) {
  const price = priceView(offering, q, priceMode);
  return (
    <div className={"quote-price " + (large ? "large" : "")}>
      <strong>
        {price.amount === null
          ? priceMode === "listing"
            ? "Не указана"
            : "Не рассчитана"
          : `${price.from ? "от " : ""}${money(price.amount)}`}
      </strong>
      <span className={price.status === "confirmed" ? "good" : "muted"}>
        {price.status === "confirmed" && <ShieldCheck size={13} />}{" "}
        {price.label}
      </span>
    </div>
  );
}

function Photos({
  photos = [],
  count = photos.length,
  compact = false,
  onOpen,
}) {
  const [index, setIndex] = useState(0),
    [failed, setFailed] = useState({});
  useEffect(() => {
    setIndex(0);
    setFailed({});
  }, [photos[0]?.url]);
  const picture = photos[index % Math.max(1, photos.length)];
  return (
    <div className={"photo " + (compact ? "compact" : "")}>
      {picture && !failed[picture.url] ? (
        <img
          src={picture.url}
          alt={picture.alt || "Фотография дома из объявления"}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed((s) => ({ ...s, [picture.url]: true }))}
          onClick={onOpen}
        />
      ) : compact ? (
        <span className="photo-placeholder">
          <House size={26} strokeWidth={1} />
        </span>
      ) : (
        <button className="photo-placeholder" onClick={onOpen}>
          <House size={42} strokeWidth={1} />
          <span>Фотографии в источнике</span>
        </button>
      )}
      {!compact && photos.length > 1 && (
        <>
          <button
            className="photo-arrow prev"
            aria-label="Предыдущее фото"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((index - 1 + photos.length) % photos.length);
            }}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="photo-arrow next"
            aria-label="Следующее фото"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((index + 1) % photos.length);
            }}
          >
            <ChevronRight size={18} />
          </button>
          <span className="photo-count">
            {index + 1} / {photos.length}
            {count > photos.length ? " · всего " + count : ""}
          </span>
        </>
      )}
    </div>
  );
}

function ScenarioBar({ scenario, setScenario }) {
  const [advanced, setAdvanced] = useState(false),
    [servicesOpen, setServicesOpen] = useState(false);
  let days = [];
  try {
    days = scenarioDays(scenario);
  } catch {}
  const change = (key, value) => setScenario((s) => ({ ...s, [key]: value }));
  const changeDay = (date, key, value) =>
    setScenario((s) => ({
      ...s,
      days: [
        ...(s.days || []).filter((x) => x.date !== date),
        { ...(s.days || []).find((x) => x.date === date), date, [key]: value },
      ],
    }));
  const setIn = (date) => {
    if (!date) return;
    setScenario((s) => {
      const end = new Date(date + "T00:00:00Z");
      end.setUTCDate(end.getUTCDate() + 1);
      return {
        ...s,
        checkIn: date,
        checkOut: end.toISOString().slice(0, 10),
        days: [],
      };
    });
  };
  return (
    <section className="scenario" aria-label="Сценарий аренды">
      <div className="scenario-main">
        <div className="scenario-caption">
          <CalendarDays size={19} />
          <span>
            Наш сценарий<small>Все цены для этих условий</small>
          </span>
        </div>
        <label className="field date-field">
          <span>Заезд</span>
          <input
            type="date"
            value={scenario.checkIn}
            onChange={(e) => setIn(e.target.value)}
          />
        </label>
        <label className="field date-field">
          <span>Выезд</span>
          <input
            type="date"
            value={scenario.checkOut}
            onChange={(e) => change("checkOut", e.target.value)}
          />
        </label>
        <Numeric
          label="Гостей всего"
          min={1}
          value={scenario.guests}
          onChange={(v) => change("guests", v)}
        />
        <Numeric
          label="Останутся ночевать"
          max={20}
          value={scenario.overnightGuests}
          onChange={(v) => change("overnightGuests", v)}
        />
        <button
          className={"button soft " + (servicesOpen ? "active" : "")}
          onClick={() => setServicesOpen(!servicesOpen)}
        >
          <Plus size={16} /> Услуги
          {scenario.services.length > 0 && (
            <b className="count-dot">{scenario.services.length}</b>
          )}
        </button>
        <button
          className="text-button scenario-more"
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced ? "Свернуть" : "По дням и дети"}
          <ChevronDown size={14} />
        </button>
      </div>
      {servicesOpen && (
        <div className="services-panel">
          <div>
            <h3>Добавить в смету</h3>
            <p>
              Услуги самой площадки. Количество указано за весь заезд.
              Обязательные платежи и обязательная уборка учитываются всегда,
              независимо от переключателей услуг.
            </p>
          </div>
          <div className="service-options">
            {SERVICES.map((service) => (
              <div className="service-option" key={service.id}>
                <Toggle
                  checked={scenario.services.includes(service.id)}
                  onChange={(yes) =>
                    setScenario((s) => ({
                      ...s,
                      services: yes
                        ? [...s.services, service.id]
                        : s.services.filter((x) => x !== service.id),
                      quantities: {
                        ...s.quantities,
                        [service.id]:
                          s.quantities[service.id] ?? service.defaultQuantity,
                      },
                    }))
                  }
                >
                  {service.label}
                </Toggle>
                {scenario.services.includes(service.id) && (
                  <>
                    <Select
                      label="Единица количества"
                      value={
                        scenario.quantityUnits?.[service.id] || service.unit
                      }
                      onChange={(value) =>
                        setScenario((s) => ({
                          ...s,
                          quantityUnits: {
                            ...s.quantityUnits,
                            [service.id]: value,
                          },
                        }))
                      }
                    >
                      <option value="ч">Часы</option>
                      <option value="сеанс">Сеансы</option>
                      <option value="компл.">Комплекты</option>
                    </Select>
                    <Numeric
                      label="Количество"
                      unit={
                        scenario.quantityUnits?.[service.id] || service.unit
                      }
                      value={scenario.quantities[service.id]}
                      onChange={(v) =>
                        setScenario((s) => ({
                          ...s,
                          quantities: { ...s.quantities, [service.id]: v },
                        }))
                      }
                    />
                    <Numeric
                      label="Людей, если оплата за гостя"
                      value={scenario.servicePeople?.[service.id] ?? ""}
                      onChange={(v) =>
                        setScenario((s) => ({
                          ...s,
                          servicePeople: {
                            ...s.servicePeople,
                            [service.id]: v,
                          },
                        }))
                      }
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {advanced && (
        <div className="scenario-advanced">
          <div>
            <h3>Состав гостей</h3>
            <p>
              Ночующие и дети входят в общее число гостей. Матрасы и раскладушки
              учитываются в ночлеге.
            </p>
          </div>
          <ChildrenInput
            value={scenario.childrenAges}
            onChange={(v) => change("childrenAges", v)}
          />
          <div className="day-list">
            {days.map((day) => (
              <div className="day-row" key={day.date}>
                <strong>{formatDate(day.date, true)}</strong>
                <Numeric
                  label="Всего людей"
                  min={1}
                  value={day.guests}
                  onChange={(v) => changeDay(day.date, "guests", v)}
                />
                <Numeric
                  label="Ночуют"
                  max={20}
                  value={day.overnightGuests}
                  onChange={(v) => changeDay(day.date, "overnightGuests", v)}
                />
                <ChildrenInput
                  key={day.date}
                  label="Возраст детей в этот день"
                  value={day.childrenAges}
                  onChange={(v) => changeDay(day.date, "childrenAges", v)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function AdvancedFilters({
  filters,
  setFilters,
  onClose,
  coverage,
  directions = [],
  priceMode,
}) {
  const [search, setSearch] = useState("");
  const groups = [...new Set(FILTERS.map((f) => f.group))];
  const set = (key, value) => setFilters((s) => ({ ...s, [key]: value }));
  return (
    <Modal onClose={onClose} label="Все фильтры" className="filters-dialog">
      <header className="modal-header">
        <div>
          <span className="eyebrow">Настроить подборку</span>
          <h2>Все фильтры — по желанию</h2>
        </div>
        <IconButton label="Закрыть фильтры" onClick={onClose}>
          <X />
        </IconButton>
      </header>
      <div className="modal-scroll">
        <div className="search filter-search">
          <Search size={17} />
          <input
            aria-label="Найти фильтр"
            placeholder="Найти фильтр: бассейн, спальни…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="unknown-note">
          <Info size={17} />
          <div>
            Неуказанное остаётся неизвестным.
            <Toggle
              checked={filters.includeUnknown}
              onChange={(v) => set("includeUnknown", v)}
            >
              Добавлять варианты, где нужно уточнить
            </Toggle>
          </div>
        </div>
        <section className="filter-group">
          <h3>Поиск и источники</h3>
          <div className="filter-grid">
            <label className="field">
              <span>Поиск по домам и описаниям</span>
              <input
                value={filters.search}
                onChange={(e) => set("search", e.target.value)}
                placeholder="Название, адрес, полный текст…"
              />
            </label>
            <Select
              label="Источник"
              value={filters.source}
              onChange={(v) => set("source", v)}
            >
              <option value="">Все площадки</option>
              {Object.entries(SOURCE_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              label="Направление"
              value={filters.direction}
              onChange={(v) => set("direction", v)}
            >
              <option value="">Любое</option>
              {directions.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </Select>
            <Select
              label="Наш статус"
              value={filters.status}
              onChange={(v) => set("status", v)}
            >
              <option value="">Все</option>
              {Object.entries(STATUS_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </section>
        <section className="filter-group">
          <h3>Цена, проверка и выбор</h3>
          <p className="fine-print">
            Бюджет: {PRICE_MODES[priceMode]}. Полнота сметы проверяется
            отдельно.
          </p>
          <div className="filter-grid">
            <Numeric
              label="Цена от"
              unit="₽"
              value={filters.minPrice}
              onChange={(v) => set("minPrice", v)}
            />
            <Numeric
              label="Цена до"
              unit="₽"
              value={filters.maxPrice}
              onChange={(v) => set("maxPrice", v)}
            />
            <Numeric
              label="Залог не больше"
              unit="₽"
              value={filters.maxDeposit}
              onChange={(v) => set("maxDeposit", v)}
            />
            <Select
              label="Полнота цены"
              value={filters.priceStatus}
              onChange={(v) => set("priceStatus", v)}
            >
              <option value="">Неважно</option>
              <option value="confirmed">Подтверждена владельцем</option>
              <option value="estimate">Полный ориентир</option>
              <option value="partial">Неполный расчёт</option>
            </Select>
            <Select
              label="Доступность на даты"
              value={filters.availability}
              onChange={(v) => set("availability", v)}
            >
              <option value="">Неважно</option>
              <option value="available">Подтверждённо свободен</option>
              <option value="unknown">Не проверена</option>
              <option value="booked">Занят</option>
              <option value="inactive">Неактивен</option>
            </Select>
            <Select
              label="Мероприятия"
              value={filters.permission}
              onChange={(v) => set("permission", v)}
            >
              <option value="">Неважно</option>
              <option value="yes">Разрешение уточнено</option>
              <option value="mentioned">Упомянуты в объявлении</option>
              <option value="unknown">Нужно уточнить</option>
              <option value="no">Запрещены</option>
            </Select>
          </div>
          <div className="toggle-row">
            <Toggle
              checked={filters.withPhotos}
              onChange={(v) => set("withPhotos", v)}
            >
              С фотографиями
            </Toggle>
            <Toggle
              checked={filters.favorite}
              onChange={(v) => set("favorite", v)}
            >
              Избранное
            </Toggle>
            <Toggle
              checked={filters.includeOutsideRegion}
              onChange={(v) => set("includeOutsideRegion", v)}
            >
              Показать другие регионы
            </Toggle>
            <Toggle
              checked={!filters.hideUnavailable}
              onChange={(v) => set("hideUnavailable", !v)}
            >
              Показать занятые и запрещённые
            </Toggle>
          </div>
        </section>
        {groups.map((group) => {
          const fields = FILTERS.filter(
            (f) =>
              f.group === group &&
              (!search || f.label.toLowerCase().includes(search.toLowerCase())),
          );
          return (
            fields.length > 0 && (
              <section className="filter-group" key={group}>
                <h3>{group}</h3>
                <div className="filter-grid">
                  {fields.map((f) =>
                    f.type === "feature" ? (
                      <Select
                        key={f.id}
                        label={
                          <>
                            {f.label}
                            <small>
                              {" "}
                              · есть сведения: {coverage[f.id] || 0}
                            </small>
                          </>
                        }
                        value={filters.features[f.id] || ""}
                        onChange={(v) =>
                          setFilters((s) => ({
                            ...s,
                            features: { ...s.features, [f.id]: v },
                          }))
                        }
                      >
                        <option value="">Неважно</option>
                        <option value="yes">Есть / да</option>
                        <option value="no">Нет</option>
                        <option value="unknown">Неизвестно</option>
                      </Select>
                    ) : (
                      <div key={f.id} className="number-range">
                        <span>
                          {f.label}
                          {f.unit && " · " + f.unit}
                        </span>
                        <div>
                          <input
                            aria-label={f.label + ": от"}
                            placeholder="От"
                            type="number"
                            min="0"
                            value={filters.numbers[f.id]?.min ?? ""}
                            onChange={(e) =>
                              setFilters((s) => ({
                                ...s,
                                numbers: {
                                  ...s.numbers,
                                  [f.id]: {
                                    ...s.numbers[f.id],
                                    min: e.target.value,
                                  },
                                },
                              }))
                            }
                          />
                          <span>—</span>
                          <input
                            aria-label={f.label + ": до"}
                            placeholder="До"
                            type="number"
                            min="0"
                            value={filters.numbers[f.id]?.max ?? ""}
                            onChange={(e) =>
                              setFilters((s) => ({
                                ...s,
                                numbers: {
                                  ...s.numbers,
                                  [f.id]: {
                                    ...s.numbers[f.id],
                                    max: e.target.value,
                                  },
                                },
                              }))
                            }
                          />
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </section>
            )
          );
        })}
      </div>
      <footer className="modal-footer">
        <button
          className="text-button"
          onClick={() => setFilters(clone(EMPTY_FILTERS))}
        >
          Сбросить всё
        </button>
        <button className="button primary" onClick={onClose}>
          Показать варианты <Check size={16} />
        </button>
      </footer>
    </Modal>
  );
}

function AmenityBadges({ features, limit = 4 }) {
  const priority = [
    "pool",
    "sauna",
    "banya",
    "hot_tub",
    "hammam",
    "bbq",
    "event_hall",
    "karaoke",
    "billiards",
    "parking",
  ];
  return (
    <div className="amenity-badges">
      {priority
        .filter((k) => features[k]?.value === true)
        .slice(0, limit)
        .map((k) => (
          <span key={k} title={features[k]?.quote || featureLabel(k)}>
            {k === "pool" ? (
              <Waves size={13} />
            ) : ["sauna", "banya", "bbq", "hot_tub"].includes(k) ? (
              <Flame size={13} />
            ) : (
              <Check size={12} />
            )}{" "}
            {featureLabel(k)}
          </span>
        ))}
    </div>
  );
}

function ResultCard({
  row,
  decision,
  onOpen,
  onFavorite,
  selected,
  onSelect,
  priceMode,
}) {
  const { house, offering, q } = row;
  const images = offering.photos?.length
    ? offering.photos
    : house.offerings.find((o) => o.photos?.length)?.photos || [];
  return (
    <article className="house-card">
      <div className="card-photo">
        <Photos
          photos={images}
          count={offering.photoCount || images.length}
          onOpen={onOpen}
        />
        <button
          className={"favorite-button " + (decision.favorite ? "selected" : "")}
          aria-label={
            decision.favorite ? "Убрать из избранного" : "В избранное"
          }
          onClick={onFavorite}
        >
          <Heart size={19} fill={decision.favorite ? "currentColor" : "none"} />
        </button>
        {decision.status === "finalist" && (
          <span className="finalist-label">Финалист</span>
        )}
      </div>
      <div className="card-content">
        <div className="card-topline">
          <Source id={offering.source} />
          {house.offerings.length > 1 && (
            <span className="muted small">
              {house.offerings.length} объявления
            </span>
          )}
        </div>
        <button className="title-button" onClick={onOpen}>
          <h3>{house.title}</h3>
        </button>
        <p className="address clamp">
          <MapPin size={13} />
          {offering.address}
        </p>
        <div className="capacity">
          <span>
            <Users size={15} />
            {q.numbers.event ? `до ${q.numbers.event}` : "Уточнить гостей"}
          </span>
          <span>
            <BedDouble size={15} />
            {q.numbers.sleep
              ? `до ${q.numbers.sleep} на ночь`
              : "Ночлег уточнить"}
          </span>
          {q.numbers.distance && <span>{q.numbers.distance} км</span>}
        </div>
        <AmenityBadges features={q.features} />
        <div className="card-price">
          <QuotePrice q={q} offering={offering} priceMode={priceMode} />
          <button
            className="open-arrow"
            onClick={onOpen}
            aria-label="Открыть дом"
          >
            <ChevronRight size={21} />
          </button>
        </div>
        <div className="card-foot">
          <Toggle checked={selected} onChange={onSelect}>
            Сравнить
          </Toggle>
          <span className={q.mismatch.length ? "danger" : "muted"}>
            {q.mismatch.length
              ? "Не всё подходит"
              : q.issues.length
                ? `${q.issues.length} условий уточнить`
                : "Даты уточнить"}
          </span>
        </div>
      </div>
    </article>
  );
}

function ResultTable({
  rows,
  decisions,
  selectedIds,
  toggleSelect,
  open,
  save,
  columns,
  priceMode,
}) {
  return (
    <div className="table-wrap">
      <table className="results-table">
        <thead>
          <tr>
            <th className="check-column"></th>
            <th className="house-column">Дом</th>
            {columns.includes("location") && <th>Расположение</th>}
            {columns.includes("capacity") && <th>Гости / ночлег</th>}
            {columns.includes("amenities") && <th>На площадке</th>}
            <th className="price-column">{PRICE_MODES[priceMode]}</th>
            {columns.includes("deposit") && <th>Возвратный залог</th>}
            {columns.includes("status") && <th>Наш выбор</th>}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { house, offering, q } = row;
            const d = decisions[house.id] || {};
            const photo = offering.photos?.length
              ? offering.photos
              : house.offerings.find((o) => o.photos?.length)?.photos || [];
            return (
              <tr key={house.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={"Сравнить " + house.title}
                    checked={selectedIds.includes(house.id)}
                    onChange={() => toggleSelect(house.id)}
                  />
                </td>
                <td className="house-column">
                  <button
                    className="table-house"
                    onClick={() => open(house.id)}
                  >
                    <Photos compact photos={photo} />
                    <span>
                      <strong>{house.title}</strong>
                      <small>
                        <Source id={offering.source} />
                        {house.offerings.length > 1 &&
                          ` · ещё ${house.offerings.length - 1}`}
                      </small>
                      {q.mismatch.length > 0 && <em>{q.mismatch[0]}</em>}
                    </span>
                  </button>
                </td>
                {columns.includes("location") && (
                  <td className="table-address">
                    <span className="clamp">{offering.address}</span>
                    <small>
                      {q.numbers.distance
                        ? `${q.numbers.distance} км от МКАД`
                        : "Расстояние уточнить"}
                    </small>
                  </td>
                )}
                {columns.includes("capacity") && (
                  <td>
                    <span className="table-capacity">
                      <Users size={14} />
                      {q.numbers.event || "?"}
                    </span>
                    <span className="table-capacity">
                      <BedDouble size={14} />
                      {q.numbers.sleep || "?"}
                    </span>
                  </td>
                )}
                {columns.includes("amenities") && (
                  <td>
                    <AmenityBadges features={q.features} limit={3} />
                  </td>
                )}
                <td className="price-column">
                  <button
                    className="price-button"
                    onClick={() => open(house.id, "price")}
                  >
                    <QuotePrice
                      q={q}
                      offering={offering}
                      priceMode={priceMode}
                    />
                    <small className="price-hint">
                      {q.issues.length
                        ? `${q.issues.length} условий уточнить`
                        : q.warnings.length
                          ? "Проверить условия"
                          : "Расшифровка"}{" "}
                      <ChevronRight size={11} />
                    </small>
                  </button>
                </td>
                {columns.includes("deposit") && (
                  <td>
                    {q.deposits.length ? (
                      money(q.deposits.reduce((a, x) => a + x.amount, 0))
                    ) : (
                      <span className="muted">Не указан</span>
                    )}
                  </td>
                )}
                {columns.includes("status") && (
                  <td>
                    <select
                      aria-label={"Статус " + house.title}
                      className={"status-select status-" + (d.status || "new")}
                      value={d.status || "new"}
                      onChange={(e) =>
                        act(() => save(house.id, { status: e.target.value }))
                      }
                    >
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    {d.note && (
                      <small className="has-note">
                        <MessageSquare size={12} />
                        Есть заметка
                      </small>
                    )}
                  </td>
                )}
                <td>
                  <IconButton
                    label={d.favorite ? "Убрать из избранного" : "В избранное"}
                    className={
                      "icon-button " + (d.favorite ? "favorite-active" : "")
                    }
                    onClick={() => save(house.id, { favorite: !d.favorite })}
                  >
                    <Heart
                      size={17}
                      fill={d.favorite ? "currentColor" : "none"}
                    />
                  </IconButton>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Evidence({ evidence, url }) {
  return evidence?.quote ? (
    <details className="evidence">
      <summary>Условие из источника</summary>
      <blockquote>{evidence.quote}</blockquote>
      <a href={evidence.source_url || url} target="_blank" rel="noreferrer">
        Открыть объявление <ExternalLink size={12} />
      </a>
    </details>
  ) : null;
}
function Breakdown({ q, offering, detail, priceMode }) {
  const fullEvidence = (component) =>
    detail?.rules?.find((r) => r.id === component.ruleId)?.evidence ||
    component.evidence;
  return (
    <div className="breakdown">
      <div className="quote-summary">
        <QuotePrice q={q} offering={offering} large priceMode={priceMode} />
        <span
          className={
            "tag " +
            (priceMode === "full" && q.status === "confirmed"
              ? "green"
              : "amber")
          }
        >
          {priceMode === "listing"
            ? "Без пересчёта сценария"
            : q.status === "confirmed"
              ? "Ответ владельца"
              : q.status === "estimate"
                ? "Ориентир по описанию"
                : "Расчёт неполный"}
        </span>
      </div>
      {priceMode === "listing" && (
        <div className="full-price-reference">
          <h4>Расчёт полной стоимости</h4>
          <QuotePrice q={q} offering={offering} priceMode="full" />
        </div>
      )}
      <p className="fine-print">
        Аренда + доплата за гостей + обязательные платежи + выбранные услуги.
        Залог отдельно.
      </p>
      {q.components.map((c, i) => (
        <div className="cost-item" key={i}>
          <div>
            <strong>{c.label}</strong>
            <b>{money(c.amount)}</b>
          </div>
          <Evidence evidence={fullEvidence(c)} url={offering.url} />
        </div>
      ))}
      {!q.components.length && (
        <p className="muted">
          Для выбранного сценария пока недостаточно условий. Нужны тариф на даты
          и условия доплат.
        </p>
      )}
      {q.deposits.length > 0 && (
        <section className="deposit-box">
          <h4>Возвратный залог · отдельно</h4>
          {q.deposits.map((c, i) => (
            <div key={i}>
              <strong>{money(c.amount)}</strong>
              <Evidence evidence={fullEvidence(c)} url={offering.url} />
            </div>
          ))}
        </section>
      )}
      {q.payments.length > 0 && (
        <section className="deposit-box">
          <h4>Предоплата · уже входит в расходы</h4>
          {q.payments.map((c, i) => (
            <div key={i}>
              <strong>{money(c.amount)}</strong>
              <Evidence evidence={fullEvidence(c)} url={offering.url} />
            </div>
          ))}
        </section>
      )}
      {(q.issues.length > 0 || q.mismatch.length > 0) && (
        <div className="issues-box">
          <h4>
            <AlertCircle size={16} /> Что нужно уточнить
          </h4>
          <ul>
            {q.mismatch.map((x, i) => (
              <li key={"m" + i}>{x}</li>
            ))}
            {q.issues.map((x, i) => (
              <li key={"i" + i}>
                {x.message}
                <Evidence evidence={x.evidence} url={offering.url} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {q.warnings.length > 0 && (
        <div className="warnings">
          {q.warnings.map((x) => (
            <p key={x.code}>
              <Info size={14} />
              {x.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function HouseDrawer({
  row,
  decision,
  repo,
  scenario,
  onClose,
  save,
  initialTab = "summary",
  notify,
  unlink,
  split,
  rejoin,
  priceMode,
  setPriceMode,
}) {
  const { house } = row;
  const [offeringId, setOfferingId] = useState(row.offering.id),
    [sourceSelected, setSourceSelected] = useState(false),
    [tab, setTab] = useState(initialTab),
    [detail, setDetail] = useState(null),
    [detailError, setDetailError] = useState("");
  const [note, setNote] = useState(decision.note || ""),
    [baseNote, setBaseNote] = useState(decision.note || ""),
    [events, setEvents] = useState([]),
    [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(""),
    [deposit, setDeposit] = useState(""),
    [comment, setComment] = useState(""),
    [receivedAt, setReceivedAt] = useState(
      new Date().toISOString().slice(0, 10),
    );
  const [terms, setTerms] = useState({
      event: "",
      sleep: "",
      permission: "",
      availability: "",
      pool: "",
      feature: "sauna",
      featureValue: "",
    }),
    [termsComment, setTermsComment] = useState("");
  useEffect(() => {
    if (!sourceSelected) setOfferingId(row.offering.id);
  }, [row.offering.id, sourceSelected]);
  const offering =
    house.offerings.find((o) => o.id === offeringId) || row.offering;
  const q = useMemo(
    () => quoteOffering(offering, scenario, decision),
    [offering, scenario, decision],
  );
  useEffect(() => {
    let active = true;
    setDetail(null);
    setDetailError("");
    getDetail(repo, offering.id)
      .then((x) => {
        if (active) setDetail(x);
      })
      .catch((e) => {
        if (active) setDetailError(e.message);
      });
    return () => {
      active = false;
    };
  }, [offering.id]);
  useEffect(() => {
    if (note === baseNote) {
      setNote(decision.note || "");
      setBaseNote(decision.note || "");
    }
  }, [decision.note]);
  useEffect(() => {
    if (tab === "history")
      Promise.all(
        [...new Set([house.id, ...(house.originalHouseIds || [])])].map((id) =>
          repo.history(id),
        ),
      )
        .then((parts) =>
          setEvents(
            parts
              .flat()
              .sort(
                (a, b) =>
                  (b.at?.toMillis?.() || Date.parse(b.at) || 0) -
                  (a.at?.toMillis?.() || Date.parse(a.at) || 0),
              )
              .slice(0, 150),
          ),
        )
        .catch((e) => notify(e.message, true));
  }, [tab, decision.relatedRevisionKey]);
  const photos = detail?.photos?.length ? detail.photos : offering.photos;
  async function act(callback) {
    setBusy(true);
    try {
      await callback();
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  const saveNote = () =>
    act(async () => {
      await save(house.id, { note }, { expectedNote: baseNote });
      setBaseNote(note);
    });
  const saveConfirmation = () =>
    act(async () => {
      if (total === "")
        throw new Error("Укажите полную сумму ответа владельца");
      await save(
        house.id,
        {
          confirmations: {
            ...decision.confirmations,
            [offering.id]: {
              offeringId: offering.id,
              scenarioKey: scenarioKey(scenario),
              total: Number(total),
              deposit: deposit === "" ? null : Number(deposit),
              comment,
              receivedAt,
            },
          },
        },
        { expectedRevision: decision.revision || 0 },
      );
      setTab("price");
    });
  const saveTerms = () =>
    act(async () => {
      const existing = decision.termsByOffering?.[offering.id] || {};
      const numbers = { ...existing.numbers };
      if (terms.event !== "") numbers.event = Number(terms.event);
      if (terms.sleep !== "") numbers.sleep = Number(terms.sleep);
      const features = { ...existing.features };
      if (terms.featureValue !== "")
        features[terms.feature] = terms.featureValue === "yes";
      const update = {
        ...existing,
        offeringId: offering.id,
        numbers,
        features,
        comment: termsComment,
      };
      if (terms.permission) update.eventPermission = terms.permission;
      if (terms.availability || terms.pool) {
        update.availabilityCheckIn = scenario.checkIn;
        update.availabilityCheckOut = scenario.checkOut;
      }
      if (terms.availability) update.availability = terms.availability;
      if (terms.pool) update.poolOnDates = terms.pool === "yes";
      await save(
        house.id,
        {
          termsByOffering: {
            ...decision.termsByOffering,
            [offering.id]: update,
          },
        },
        { expectedRevision: decision.revision || 0 },
      );
      setTermsComment("");
    });
  return (
    <Modal className="house-dialog" label={house.title} onClose={onClose}>
      <div className="drawer-top">
        <Source id={offering.source} />
        <span>
          {house.offerings.length}{" "}
          {house.offerings.length === 1 ? "объявление" : "объявлений"} ·{" "}
          {house.identityStatus === "single_unverified"
            ? "Связи не проверены"
            : "Есть связи источников"}
        </span>
        <IconButton label="Закрыть карточку дома" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div className="drawer-scroll">
        <div className="drawer-gallery">
          <Photos photos={photos} count={photos?.length} />
          <a
            className="photo-source"
            href={offering.url}
            target="_blank"
            rel="noreferrer"
          >
            Фото и объявление <ExternalLink size={12} />
          </a>
        </div>
        <div className="drawer-content">
          <div className="drawer-title">
            <div>
              <h2>{house.title}</h2>
              <p className="address">
                <MapPin size={14} />
                {offering.address}
              </p>
            </div>
            <IconButton
              label="Избранное"
              className={
                "icon-button " + (decision.favorite ? "favorite-active" : "")
              }
              onClick={() =>
                act(() => save(house.id, { favorite: !decision.favorite }))
              }
            >
              <Heart fill={decision.favorite ? "currentColor" : "none"} />
            </IconButton>
          </div>
          {house.offerings.length > 1 && (
            <div className="source-picker">
              <Select
                label="Условия конкретного объявления"
                value={offering.id}
                onChange={(id) => {
                  setSourceSelected(true);
                  setOfferingId(id);
                }}
              >
                {house.offerings.map((o) => (
                  <option key={o.id} value={o.id}>
                    {SOURCE_LABELS[o.source]} ·{" "}
                    {o.publishedPrice
                      ? money(o.publishedPrice)
                      : "цена не указана"}{" "}
                    · #{o.sourceId}
                  </option>
                ))}
              </Select>
              <button
                className="text-button"
                onClick={() =>
                  act(() =>
                    save(house.id, { preferredOfferingId: offering.id }),
                  )
                }
              >
                <Check size={14} />
                {decision.preferredOfferingId === offering.id
                  ? "Выбрано основным"
                  : "Сделать основным"}
              </button>
            </div>
          )}
          <div className="drawer-tabs">
            {[
              ["summary", "Обзор"],
              ["price", "Смета"],
              ["description", "Описание"],
              ["edit", "Уточнения"],
              ["history", "История"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <PriceModeSwitch priceMode={priceMode} setPriceMode={setPriceMode} />
          {tab === "summary" && (
            <>
              <div className="facts-grid">
                <div>
                  <Users />
                  <strong>{q.numbers.event || "?"}</strong>
                  <span>на мероприятие</span>
                </div>
                <div>
                  <BedDouble />
                  <strong>{q.numbers.sleep || "?"}</strong>
                  <span>на ночь, включая доп. места</span>
                </div>
                <div>
                  <MapPin />
                  <strong>
                    {q.numbers.distance ? `${q.numbers.distance} км` : "?"}
                  </strong>
                  <span>от МКАД, по источнику</span>
                </div>
              </div>
              <QuotePrice
                q={q}
                offering={offering}
                large
                priceMode={priceMode}
              />
              <button className="text-button" onClick={() => setTab("price")}>
                Посмотреть расчёт и неизвестные условия{" "}
                <ChevronRight size={15} />
              </button>
              <div className="detail-features">
                {FILTERS.filter(
                  (f) =>
                    f.type === "feature" &&
                    (q.features[f.id]?.value != null ||
                      [
                        "pool_on_dates",
                        "sauna",
                        "banya",
                        "bbq",
                        "kitchen",
                      ].includes(f.id)),
                ).map((f) => {
                  const claim = q.features[f.id];
                  const evidence =
                    claim?.claims?.find((c) => c.review === "user")?.quote ||
                    detail?.features?.[f.id]?.claims?.[0]?.quote ||
                    claim?.quote;
                  return (
                    <div key={f.id}>
                      <span>{f.label}</span>
                      <b
                        className={
                          claim?.value === true
                            ? "good"
                            : claim?.value === false
                              ? "muted"
                              : "unknown"
                        }
                      >
                        {claim?.value === true
                          ? "Есть / да"
                          : claim?.value === false
                            ? "Нет"
                            : "Уточнить"}
                      </b>
                      {evidence && (
                        <details>
                          <summary>Основание</summary>
                          <p>{evidence}</p>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="fine-print">
                Сведения из объявления, если не отмечено уточнение. Наличие
                удобства и его включение в аренду различаются.
              </p>
            </>
          )}
          {tab === "price" && (
            <Breakdown
              q={q}
              offering={offering}
              detail={detail}
              priceMode={priceMode}
            />
          )}
          {tab === "description" && (
            <>
              <div className="description-caption">
                <FileText size={17} />
                <span>
                  {offering.descriptionStatus ===
                  "user_export_text_from_listing_feed"
                    ? "Текст пользовательского экспорта; полнота относительно отдельной карточки не проверена"
                    : "Сохранённый текст карточки"}
                  <small>
                    Получено:{" "}
                    {String(offering.collectedAt || "не указано").slice(0, 10)}
                  </small>
                </span>
              </div>
              {detailError ? (
                <p className="error-text">{detailError}</p>
              ) : detail ? (
                <div className="full-description">{detail.description}</div>
              ) : (
                <p className="muted">Загружаю описание…</p>
              )}
              <a
                className="button soft"
                href={offering.url}
                target="_blank"
                rel="noreferrer"
              >
                Открыть источник <ExternalLink size={14} />
              </a>
            </>
          )}
          {tab === "edit" && (
            <>
              <section className="edit-section">
                <h3>Ответ владельца о полной цене</h3>
                <p>
                  Для текущих дат, состава гостей и услуг. При изменении
                  сценария ответ сохранится, но потребуется новый расчёт.
                </p>
                <div className="form-grid">
                  <Numeric
                    label="Все обязательные расходы и выбранные услуги"
                    unit="₽"
                    value={total}
                    onChange={setTotal}
                  />
                  <Numeric
                    label="Возвратный залог отдельно"
                    unit="₽"
                    value={deposit}
                    onChange={setDeposit}
                  />
                  <label className="field">
                    <span>Когда получен ответ</span>
                    <input
                      type="date"
                      value={receivedAt}
                      onChange={(e) => setReceivedAt(e.target.value)}
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Что подтвердил владелец</span>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Полная сумма, что входит, откуда получен ответ…"
                  />
                </label>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={saveConfirmation}
                >
                  <ShieldCheck size={16} /> Сохранить смету владельца
                </button>
                {decision.confirmations?.[offering.id] && (
                  <button
                    className="text-button danger"
                    onClick={() =>
                      act(() =>
                        save(
                          house.id,
                          {
                            confirmations: {
                              ...decision.confirmations,
                              [offering.id]: null,
                            },
                          },
                          { expectedRevision: decision.revision || 0 },
                        ),
                      )
                    }
                  >
                    Снять подтверждение цены
                  </button>
                )}
              </section>
              <section className="edit-section">
                <h3>Уточнить условия дома</h3>
                <div className="form-grid">
                  <Numeric
                    label="Вместимость мероприятия"
                    value={terms.event}
                    onChange={(v) => setTerms((t) => ({ ...t, event: v }))}
                  />
                  <Numeric
                    label="Ночлег, всего с доп. местами"
                    value={terms.sleep}
                    onChange={(v) => setTerms((t) => ({ ...t, sleep: v }))}
                  />
                  <Select
                    label="Мероприятие"
                    value={terms.permission}
                    onChange={(v) => setTerms((t) => ({ ...t, permission: v }))}
                  >
                    <option value="">Без изменения</option>
                    <option value="yes">Разрешено</option>
                    <option value="no">Запрещено</option>
                  </Select>
                  <Select
                    label="Свободен на выбранные даты"
                    value={terms.availability}
                    onChange={(v) =>
                      setTerms((t) => ({ ...t, availability: v }))
                    }
                  >
                    <option value="">Без изменения</option>
                    <option value="available">Да</option>
                    <option value="booked">Нет, занят</option>
                    <option value="unknown">Нужно уточнить</option>
                  </Select>
                  <Select
                    label="Бассейн работает на эти даты"
                    value={terms.pool}
                    onChange={(v) => setTerms((t) => ({ ...t, pool: v }))}
                  >
                    <option value="">Без изменения</option>
                    <option value="yes">Да</option>
                    <option value="no">Нет</option>
                  </Select>
                  <Select
                    label="Какое удобство уточнить"
                    value={terms.feature}
                    onChange={(v) => setTerms((t) => ({ ...t, feature: v }))}
                  >
                    {FILTERS.filter((f) => f.type === "feature").map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label="Результат уточнения удобства"
                    value={terms.featureValue}
                    onChange={(v) =>
                      setTerms((t) => ({ ...t, featureValue: v }))
                    }
                  >
                    <option value="">Без изменения</option>
                    <option value="yes">Есть / да</option>
                    <option value="no">Нет</option>
                  </Select>
                </div>
                <label className="field">
                  <span>Основание уточнений</span>
                  <textarea
                    value={termsComment}
                    onChange={(e) => setTermsComment(e.target.value)}
                    placeholder="Ответ владельца, дата, что именно выяснили…"
                  />
                </label>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={saveTerms}
                >
                  Сохранить условия
                </button>
              </section>
            </>
          )}
          {tab === "history" && (
            <div className="history-list">
              <h3>История изменений</h3>
              {!events.length && <p className="muted">Изменений пока нет</p>}
              {events.map((event) => (
                <article key={event.id}>
                  <span className="history-dot" />
                  <strong>Версия {event.revision}</strong>
                  <small>
                    {stamp(event.at)} ·{" "}
                    {event.actorUid === "local-device"
                      ? "Это устройство"
                      : "Участник " + event.actorUid.slice(0, 6)}
                  </small>
                  <p>
                    {Object.keys(event.changes || {})
                      .map(
                        (k) =>
                          ({
                            favorite: "Избранное",
                            note: "Заметка",
                            status: "Статус",
                            confirmation: "Смета владельца",
                            confirmations: "Сметы по объявлениям",
                            terms: "Условия",
                            termsByOffering: "Условия по объявлениям",
                            mergedInto: "Объединение",
                            splitListingIds: "Разделение",
                            preferredOfferingId: "Основное объявление",
                          })[k] || k,
                      )
                      .join(", ")}
                  </p>
                  <details>
                    <summary>Состояние после изменения</summary>
                    <pre>
                      {JSON.stringify(event.after || event.changes, null, 2)}
                    </pre>
                  </details>
                </article>
              ))}
            </div>
          )}
          <section className="notes-section">
            <div>
              <h3>
                <MessageSquare size={17} /> Общая заметка
              </h3>
              <select
                aria-label="Статус дома"
                value={decision.status || "new"}
                onChange={(e) =>
                  act(() => save(house.id, { status: e.target.value }))
                }
              >
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              aria-label="Заметка о доме"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Что понравилось, вопросы владельцу, договорённости…"
            />
            {(decision.note || "") !== baseNote && note !== baseNote && (
              <p className="error-text">
                Заметка изменилась у другого участника. Ваш текст сохранён в
                форме; обновите его перед записью.
              </p>
            )}
            <button
              className="button soft"
              disabled={busy || note === (decision.note || "")}
              onClick={saveNote}
            >
              Сохранить заметку
            </button>
            {(decision.note || "") !== baseNote && (
              <button
                className="text-button"
                onClick={() => {
                  setNote(decision.note || "");
                  setBaseNote(decision.note || "");
                }}
              >
                Загрузить свежую заметку
              </button>
            )}
          </section>
          {decision.linkedNotes?.length > 0 && (
            <section className="notes-section">
              <h3>Заметки связанных карточек</h3>
              {decision.linkedNotes.map((n) => (
                <article key={n.houseId}>
                  <small>
                    {n.houseId} · {STATUS_LABELS[n.status || "new"]}
                  </small>
                  <p className="full-description">{n.note}</p>
                </article>
              ))}
            </section>
          )}
          <details className="identity-section">
            <summary>Объявления и связи дома</summary>
            <p>
              Совпадения по адресу или тексту могут требовать дополнительной
              проверки.
            </p>
            {house.offerings.map((o) => (
              <div key={o.id}>
                <a href={o.url} target="_blank" rel="noreferrer">
                  {SOURCE_LABELS[o.source]} #{o.sourceId}{" "}
                  <ExternalLink size={12} />
                </a>
                {house.offerings.length > 1 && (
                  <button
                    className="text-button"
                    onClick={() => act(() => split(house, o.id))}
                  >
                    Отделить объявление
                  </button>
                )}
              </div>
            ))}
            {house.id.startsWith("split_") && (
              <button
                className="text-button"
                onClick={() => act(() => rejoin(house))}
              >
                Вернуть в исходную группу
              </button>
            )}
            {house.originalHouseIds?.length > 1 && (
              <button className="text-button" onClick={() => unlink(house)}>
                Вернуть раздельные карточки
              </button>
            )}
            {offering.possibleDuplicates?.length > 0 && (
              <p>
                Возможные совпадения: {offering.possibleDuplicates.join(", ")}
              </p>
            )}
          </details>
        </div>
      </div>
    </Modal>
  );
}

function Compare({
  rows,
  onClose,
  decisions,
  open,
  merge,
  priceMode,
  setPriceMode,
}) {
  const features = [
    "pool_on_dates",
    "pool",
    "sauna",
    "banya",
    "hammam",
    "hot_tub",
    "bbq",
    "kitchen",
    "external_catering",
    "parking",
  ];
  const line = (title, render) => (
    <tr key={title}>
      <th>{title}</th>
      {rows.map((r) => (
        <td key={r.house.id}>{render(r)}</td>
      ))}
    </tr>
  );
  return (
    <Modal className="compare-dialog" label="Сравнение домов" onClose={onClose}>
      <header className="modal-header">
        <div>
          <span className="eyebrow">Один сценарий для всех</span>
          <h2>Сравнить {rows.length} дома</h2>
        </div>
        <div className="button-row">
          <button className="button soft" onClick={merge}>
            <GitMerge size={15} /> Это один дом
          </button>
          <IconButton label="Закрыть сравнение" onClick={onClose}>
            <X />
          </IconButton>
        </div>
      </header>
      <PriceModeSwitch priceMode={priceMode} setPriceMode={setPriceMode} />
      <div className="compare-scroll">
        <table className="compare-table">
          <thead>
            <tr>
              <th>Условия</th>
              {rows.map((r) => (
                <th key={r.house.id}>
                  <Photos photos={r.offering.photos} compact />
                  <button
                    className="title-button"
                    onClick={() => {
                      onClose();
                      open(r.house.id);
                    }}
                  >
                    {r.house.title}
                  </button>
                  <Source id={r.offering.source} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {line(PRICE_MODES[priceMode], (r) => (
              <QuotePrice q={r.q} offering={r.offering} priceMode={priceMode} />
            ))}
            {priceMode === "listing" &&
              line("Полный расчёт", (r) => (
                <QuotePrice q={r.q} offering={r.offering} priceMode="full" />
              ))}
            {line("Состав полной стоимости", (r) => (
              <>
                <div className="compare-costs">
                  {r.q.components.map((c, i) => (
                    <span key={i}>
                      {c.label}
                      <b>{money(c.amount)}</b>
                    </span>
                  ))}
                </div>
                <small className="unknown">
                  {r.q.issues.length} условий уточнить
                </small>
              </>
            ))}
            {line("Залог отдельно", (r) =>
              r.q.deposits.length
                ? money(r.q.deposits.reduce((a, c) => a + c.amount, 0))
                : "Уточнить",
            )}
            {line("Мероприятие / ночлег", (r) => (
              <>
                {r.q.numbers.event || "?"} / {r.q.numbers.sleep || "?"} чел.
              </>
            ))}
            {line("Адрес", (r) => r.offering.address)}
            {features.map((id) =>
              line(featureLabel(id), (r) =>
                r.q.features[id]?.value === true ? (
                  <span className="good">Да</span>
                ) : r.q.features[id]?.value === false ? (
                  "Нет"
                ) : (
                  <span className="unknown">Уточнить</span>
                ),
              ),
            )}
            {line(
              "Не всё подходит",
              (r) => r.q.mismatch.join("; ") || "Нет известных несоответствий",
            )}
            {line("Вопросы к владельцу", (r) => (
              <ul>
                {r.q.issues.map((x, i) => (
                  <li key={i}>{x.message}</li>
                ))}
              </ul>
            ))}
            {line("Наша заметка", (r) => decisions[r.house.id]?.note || "—")}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function Admin({ repo, onClose, notify, reload }) {
  const [members, setMembers] = useState([]),
    [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(null);
  const refresh = () =>
    repo
      .listMembers()
      .then(setMembers)
      .catch((e) => notify(e.message, true));
  useEffect(() => {
    if (repo.mode === "firebase") refresh();
  }, []);
  async function action(callback) {
    setBusy(true);
    try {
      await callback();
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  const importFile = (e) =>
    action(async () => {
      const file = e.target.files?.[0];
      if (!file) return;
      const bundle = JSON.parse(await file.text());
      if (bundle.owner && bundle.members) {
        await repo.importMembers(bundle);
        await refresh();
        notify("Участники добавлены");
      } else {
        await repo.importBundle(bundle, setProgress);
        await reload();
        notify("Новая версия каталога опубликована");
      }
    });
  return (
    <Modal
      className="admin-dialog"
      label="Управление доступом и импорт"
      onClose={onClose}
    >
      <header className="modal-header">
        <div>
          <span className="eyebrow">Только владельцу</span>
          <h2>Участники и данные</h2>
        </div>
        <IconButton label="Закрыть настройки" onClick={onClose}>
          <X />
        </IconButton>
      </header>
      <div className="modal-scroll">
        {repo.mode === "local" ? (
          <div className="unknown-note">
            <Info />
            <p>
              Сейчас открыт локальный просмотр. Заметки сохраняются на этом
              устройстве. Google-вход, приглашения и совместная синхронизация
              станут доступны после подключения облачного проекта.
            </p>
          </div>
        ) : (
          <>
            <h3>Доступ к подборке</h3>
            <p className="muted">
              Разрешение действует для Google-аккаунта, письмо не отправляется.
            </p>
            <div className="invite-row">
              <input
                type="email"
                value={email}
                placeholder="Google-email участника"
                onChange={(e) => setEmail(e.target.value)}
              />
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await repo.invite(email);
                    setEmail("");
                    await refresh();
                  })
                }
              >
                Добавить
              </button>
            </div>
            <div className="members-list">
              {members.map((m) => (
                <div key={m.email}>
                  <span>
                    {m.email}
                    <small>
                      {m.role === "owner"
                        ? "Владелец"
                        : m.active
                          ? "Участник · редактирование"
                          : "Доступ отключён"}
                    </small>
                  </span>
                  {m.role !== "owner" && m.active && (
                    <button
                      className="text-button danger"
                      onClick={() =>
                        action(async () => {
                          await repo.revoke(m.email);
                          await refresh();
                        })
                      }
                    >
                      Отключить
                    </button>
                  )}
                </div>
              ))}
            </div>
            <h3>Импорт подготовленного пакета</h3>
            <p className="muted">
              Новая версия исходных объявлений. Общие заметки и ответы
              владельцев сохраняются.
            </p>
            <label className="button soft file-button">
              <Upload size={16} /> Выбрать JSON-пакет
              <input
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={importFile}
              />
            </label>
            {progress != null && <p>Загружено {progress}%</p>}
          </>
        )}
        <div className="admin-foot">
          <ShieldCheck size={17} />
          <span>
            Закрытые данные и адреса участников не входят в публичную сборку
            интерфейса.
          </span>
        </div>
      </div>
    </Modal>
  );
}

export default function App() {
  const [repo, setRepo] = useState(null),
    [user, setUser] = useState(undefined),
    [catalog, setCatalog] = useState(null),
    [decisions, setDecisions] = useState({}),
    [failure, setFailure] = useState("");
  const [scenario, setScenario] = useState(() =>
      stored("wedding:scenario:v1", clone(DEFAULT_SCENARIO)),
    ),
    [filters, setFilters] = useState(() => clone(EMPTY_FILTERS));
  const [view, setView] = useState(() => stored("wedding:view:v1", "table")),
    [priceMode, setPriceMode] = useState(() =>
      normalizePriceMode(stored("wedding:price-mode:v1", "full")),
    ),
    [sort, setSort] = useState("recommended"),
    [page, setPage] = useState(0),
    [selectedIds, setSelectedIds] = useState([]),
    [openId, setOpenId] = useState(null),
    [initialTab, setInitialTab] = useState("summary");
  const [filtersOpen, setFiltersOpen] = useState(false),
    [compareOpen, setCompareOpen] = useState(false),
    [adminOpen, setAdminOpen] = useState(false),
    [columnsOpen, setColumnsOpen] = useState(false),
    [columns, setColumns] = useState(() =>
      stored("wedding:columns:v1", [
        "location",
        "capacity",
        "amenities",
        "status",
      ]),
    ),
    [toast, setToast] = useState(null),
    [group, setGroup] = useState("all");
  const toastTimer = useRef();
  const notify = (message, error = false) => {
    setToast({ message, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };
  useEffect(() => {
    let active = true,
      unsubAuth;
    createRepository()
      .then((r) => {
        if (!active) return;
        r.mode === "local" && setCatalog(r.catalog);
        setRepo(r);
        unsubAuth = r.subscribeAuth(setUser);
      })
      .catch((e) => setFailure(e.message));
    return () => {
      active = false;
      unsubAuth?.();
    };
  }, []);
  const reload = async () => {
    detailCache.clear();
    const data = await repo.loadCatalog();
    setCatalog(data);
  };
  useEffect(() => {
    if (!repo || !user?.role) {
      setCatalog(null);
      return;
    }
    let active = true;
    repo
      .loadCatalog()
      .then((d) => {
        if (active) setCatalog(d);
      })
      .catch((e) => setFailure(e.message));
    const unsubscribe = repo.subscribeDecisions(setDecisions, (e) =>
      notify("Не удалось синхронизировать изменения: " + e.message, true),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [repo, user?.uid, user?.role]);
  useEffect(() => {
    localStorage.setItem("wedding:scenario:v1", JSON.stringify(scenario));
  }, [scenario]);
  useEffect(() => {
    localStorage.setItem("wedding:view:v1", JSON.stringify(view));
  }, [view]);
  useEffect(() => {
    localStorage.setItem("wedding:columns:v1", JSON.stringify(columns));
  }, [columns]);
  useEffect(() => {
    localStorage.setItem("wedding:price-mode:v1", JSON.stringify(priceMode));
  }, [priceMode]);
  const deferredSearch = useDeferredValue(filters.search);
  const effectiveFilters = useMemo(
    () => ({ ...filters, search: deferredSearch }),
    [filters, deferredSearch],
  );
  const scenarioError = useMemo(() => {
    try {
      scenarioDays(scenario);
      return "";
    } catch (e) {
      return e.message;
    }
  }, [scenario]);
  const houses = useMemo(
    () => projectHouses(catalog?.houses || [], decisions),
    [catalog, decisions],
  );
  const projectedDecisions = useMemo(
    () =>
      Object.fromEntries(
        houses.map((h) => [h.id, decisionForHouse(h, decisions)]),
      ),
    [houses, decisions],
  );
  const allRows = useMemo(() => {
    if (scenarioError) return [];
    return houses
      .map((house) => {
        const decision = projectedDecisions[house.id] || {};
        const all = house.offerings.map((o) => ({
          o,
          q: quoteOffering(o, scenario, decision),
        }));
        const fitting = all.filter(({ o, q }) =>
          offeringPasses(o, q, effectiveFilters, decision, priceMode),
        );
        if (!fitting.length) return null;
        const { q, o: offering } = selectPriceCandidate(
          fitting,
          decision.preferredOfferingId,
          priceMode,
        );
        return {
          house,
          offering,
          q,
          uncertain:
            priceView(offering, q, priceMode).amount === null ||
            q.status === "partial" ||
            q.warnings.length > 0 ||
            q.mismatch.length > 0,
        };
      })
      .filter(Boolean);
  }, [
    houses,
    scenario,
    projectedDecisions,
    effectiveFilters,
    scenarioError,
    priceMode,
  ]);
  const rows = useMemo(() => {
    let result = allRows.filter(
      (r) =>
        group === "all" ||
        (group === "uncertain" && r.uncertain) ||
        (group === "finalist" &&
          projectedDecisions[r.house.id]?.status === "finalist"),
    );
    const score = (r) =>
      (r.q.mismatch.length ? 100 : 0) +
      (r.q.numbers.event ? 0 : 5) +
      (r.q.numbers.sleep ? 0 : 2) +
      (r.offering.photos?.length ? 0 : 1);
    return [...result].sort((a, b) =>
      sort === "title"
        ? a.house.title.localeCompare(b.house.title, "ru")
        : sort === "distance"
          ? (a.q.numbers.distance ?? Infinity) -
            (b.q.numbers.distance ?? Infinity)
          : sort === "price_desc"
            ? comparePriceRows(a, b, priceMode, true)
            : sort === "price"
              ? comparePriceRows(a, b, priceMode)
              : (priceMode === "full" ? b.q.confidence - a.q.confidence : 0) ||
                score(a) - score(b) ||
                comparePriceRows(a, b, priceMode),
    );
  }, [allRows, group, projectedDecisions, sort, priceMode]);
  const coverage = useMemo(() => {
    const c = {};
    for (const h of catalog?.houses || [])
      for (const o of h.offerings)
        for (const [key, v] of Object.entries(o.features || {}))
          if (v.value != null) c[key] = (c[key] || 0) + 1;
    return c;
  }, [catalog]);
  const directions = useMemo(
    () =>
      [
        ...new Set(
          (catalog?.houses || []).flatMap((h) =>
            h.offerings.map((o) => o.direction).filter(Boolean),
          ),
        ),
      ].sort(),
    [catalog],
  );
  useEffect(
    () => setPage(0),
    [effectiveFilters, scenario, group, sort, priceMode],
  );
  const pageSize = view === "cards" ? 18 : 30,
    pages = Math.max(1, Math.ceil(rows.length / pageSize)),
    safePage = Math.min(page, pages - 1),
    visibleRows = rows.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const activeCount =
    Object.values(filters.features).filter(Boolean).length +
    Object.values(filters.numbers).filter(
      (r) => (r.min !== "" && r.min != null) || (r.max !== "" && r.max != null),
    ).length +
    [
      "source",
      "status",
      "priceStatus",
      "availability",
      "permission",
      "minPrice",
      "maxPrice",
      "maxDeposit",
      "direction",
      "withPhotos",
      "favorite",
      "search",
      "includeOutsideRegion",
    ].filter(
      (k) => filters[k] !== "" && filters[k] !== false && filters[k] != null,
    ).length;
  async function save(id, patch, options) {
    try {
      const result = await repo.saveDecision(id, patch, options);
      notify("Сохранено");
      return result;
    } catch (e) {
      notify(e.message, true);
      throw e;
    }
  }
  const quickSave = (id, patch) => save(id, patch).catch(() => {});
  const open = (id, tab = "summary") => {
    setOpenId(id);
    setInitialTab(tab);
  };
  const rowForId = (id) =>
    allRows.find((r) => r.house.id === id) ||
    (() => {
      const house = houses.find((h) => h.id === id);
      if (!house || scenarioError) return null;
      const candidates = house.offerings.map((o) => ({
        o,
        q: quoteOffering(o, scenario, projectedDecisions[id] || {}),
      }));
      const { q } = selectPriceCandidate(
        candidates,
        projectedDecisions[id]?.preferredOfferingId,
        priceMode,
      );
      return {
        house,
        offering: house.offerings.find((o) => o.id === q.offeringId),
        q,
      };
    })();
  const openRow = openId ? rowForId(openId) : null;
  const comparedRows = selectedIds.map(rowForId).filter(Boolean);
  function toggleSelect(id) {
    setSelectedIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id);
      if (ids.length >= 5) {
        notify("Можно сравнить до пяти домов", true);
        return ids;
      }
      return [...ids, id];
    });
  }
  async function merge() {
    if (comparedRows.length < 2) return;
    if (
      !window.confirm(
        "Объединить выбранные карточки как один дом? Условия объявлений останутся раздельными. Это можно отменить.",
      )
    )
      return;
    try {
      const target = comparedRows[0].house.id;
      for (const row of comparedRows.slice(1))
        await save(row.house.id, { mergedInto: target });
      setCompareOpen(false);
      setSelectedIds([]);
      notify("Карточки объединены. Разделить можно в связях дома.");
    } catch {}
  }
  async function split(house, offeringId) {
    const previous = decisions[house.id] || {};
    await save(
      house.id,
      {
        splitListingIds: [
          ...new Set([...(previous.splitListingIds || []), offeringId]),
        ],
      },
      { expectedRevision: previous.revision || 0 },
    );
    if (decisions["split_" + offeringId]?.mergedInto)
      await save("split_" + offeringId, { mergedInto: null });
    notify("Объявление отделено. Исходные записи сохранены.");
  }
  async function rejoin(house) {
    const target = (house.originalHouseIds || []).find((id) => id !== house.id);
    if (target) await save(house.id, { mergedInto: target });
    notify("Объявление возвращено в исходную группу");
  }
  async function unlink(house) {
    try {
      for (const id of house.originalHouseIds || [])
        if (id !== house.id) await save(id, { mergedInto: null });
      notify("Карточки разделены");
    } catch {}
  }
  function exportRows(type) {
    const data = rows.map(({ house, offering, q }) => ({
      houseId: house.id,
      title: house.title,
      address: offering.address,
      source: SOURCE_LABELS[offering.source],
      url: offering.url,
      priceMode,
      displayedPrice: priceView(offering, q, priceMode).amount,
      displayedPriceStatus: priceView(offering, q, priceMode).label,
      publishedPrice: offering.publishedPrice ?? null,
      total: q.total,
      knownSubtotal: q.knownSubtotal,
      priceStatus: q.status,
      deposit: q.deposits.length
        ? q.deposits.reduce((a, c) => a + c.amount, 0)
        : null,
      eventCapacity: q.numbers.event ?? null,
      overnightCapacity: q.numbers.sleep ?? null,
      issues: q.issues.map((x) => x.message).join("; "),
      note: projectedDecisions[house.id]?.note || "",
    }));
    if (type === "json")
      saveFile(
        "wedding-selection.json",
        JSON.stringify(
          {
            scenario,
            priceMode,
            exportedAt: new Date().toISOString(),
            rows: data,
          },
          null,
          2,
        ),
      );
    else {
      const keys = Object.keys(data[0] || {});
      const cell = (x) =>
        '"' +
        String(x ?? "")
          .replace(/^[=+@-]/, "'$&")
          .replaceAll('"', '""') +
        '"';
      saveFile(
        "wedding-selection.csv",
        "\ufeff" +
          [
            keys.map(cell).join(";"),
            ...data.map((r) => keys.map((k) => cell(r[k])).join(";")),
          ].join("\r\n"),
        "text/csv;charset=utf-8",
      );
    }
  }
  if (failure || !repo || user === undefined)
    return (
      <div className="gate">
        <div className="brand-mark">
          <House />
        </div>
        <span className="eyebrow">Место для нас</span>
        <h1>
          {failure === "SETUP_REQUIRED"
            ? "Вход ещё не настроен"
            : failure
              ? "Не удалось открыть подборку"
              : "Готовим вашу подборку"}
        </h1>
        <p>
          {failure === "SETUP_REQUIRED"
            ? "Облачный проект подключается. Локальная версия доступна владельцу во время подготовки."
            : failure || "Загружаем дома, условия и фотографии…"}
        </p>
        {failure && (
          <button className="button primary" onClick={() => location.reload()}>
            <RefreshCw size={16} /> Повторить
          </button>
        )}
      </div>
    );
  if (!user || user.denied)
    return (
      <div className="gate login-gate">
        <div className="brand-mark">
          <House />
        </div>
        <span className="eyebrow">Закрытая свадебная подборка</span>
        <h1>
          Место, где
          <br />
          соберутся наши.
        </h1>
        <p>
          {user?.denied
            ? "Этот аккаунт не приглашён. Войдите другим Google-аккаунтом."
            : "Войдите приглашённым Google-аккаунтом, чтобы выбирать дома вместе."}
        </p>
        <button
          className="button primary"
          onClick={() => repo.login().catch((e) => notify(e.message, true))}
        >
          Войти через Google <ChevronRight size={16} />
        </button>
        {user && (
          <button className="text-button" onClick={() => repo.logout()}>
            Сменить аккаунт
          </button>
        )}
        {toast && <p className="error-text">{toast.message}</p>}
      </div>
    );
  return (
    <div className="app">
      <header className="app-header">
        <a className="brand" href="#">
          <span className="brand-mark">
            <House size={22} />
          </span>
          <span>
            Место для нас<small>СВАДЕБНАЯ ПОДБОРКА</small>
          </span>
        </a>
        <nav>
          <button
            className={!filters.favorite ? "active" : ""}
            onClick={() => setFilters((s) => ({ ...s, favorite: false }))}
          >
            Все дома
          </button>
          <button
            className={filters.favorite ? "active" : ""}
            onClick={() => setFilters((s) => ({ ...s, favorite: true }))}
          >
            <Heart size={15} />
            Избранное{" "}
            <b>
              {
                Object.values(projectedDecisions).filter((x) => x.favorite)
                  .length
              }
            </b>
          </button>
        </nav>
        <div className="header-right">
          {repo.mode === "local" ? (
            <span className="local-mode">
              <span />
              {repo.isQa
                ? "Проверочная копия · тестовые заметки"
                : "Локально · заметки на этом устройстве"}
            </span>
          ) : (
            <span className="member-name">
              <ShieldCheck size={15} />
              {user.displayName}
            </span>
          )}
          {user.role === "owner" && (
            <IconButton
              label="Участники и импорт"
              onClick={() => setAdminOpen(true)}
            >
              <Settings size={18} />
            </IconButton>
          )}
          {repo.mode === "firebase" && (
            <IconButton label="Выйти" onClick={() => repo.logout()}>
              <LogOut size={18} />
            </IconButton>
          )}
        </div>
      </header>
      <main className="workspace">
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              <span /> МОСКВА И ПОДМОСКОВЬЕ
            </div>
            <h1>
              Выбрать наш дом<span>.</span>
            </h1>
            <p>Соберём близких. Сравним условия. Найдём своё место.</p>
          </div>
          <div className="dataset-note">
            <strong>{num.format(catalog?.stats.listings || 0)}</strong>
            <span>
              объявлений из {Object.keys(catalog?.stats.sources || {}).length}{" "}
              источников<small>Группы домов требуют проверки</small>
            </span>
          </div>
        </div>
        <ScenarioBar scenario={scenario} setScenario={setScenario} />
        {scenarioError && (
          <div className="error-banner">
            <AlertCircle size={17} />
            {scenarioError}
          </div>
        )}
        <section className="price-mode-bar" aria-label="Режим стоимости">
          <PriceModeSwitch priceMode={priceMode} setPriceMode={setPriceMode} />
          <p>
            {priceMode === "full"
              ? "Аренда, доплата за гостей, уборка и выбранные услуги. Неизвестные суммы требуют уточнения; залог отдельно."
              : "Исходная цена из карточки, без пересчёта под даты, гостей и выбранные услуги."}
            <span>Сортировка и бюджет используют выбранную стоимость.</span>
          </p>
        </section>
        <div className="collection-layout">
          <aside className="sidebar">
            <div className="sidebar-heading">
              <h2>Подобрать дом</h2>
              {activeCount > 0 && (
                <button
                  className="text-button"
                  onClick={() => setFilters(clone(EMPTY_FILTERS))}
                >
                  Сбросить
                </button>
              )}
            </div>
            <div className="search">
              <Search size={17} />
              <input
                aria-label="Поиск по домам и описаниям"
                placeholder="Название, адрес, текст…"
                value={filters.search}
                onChange={(e) =>
                  setFilters((s) => ({ ...s, search: e.target.value }))
                }
              />
            </div>
            <section className="side-section">
              <h3>
                {priceMode === "full"
                  ? "Бюджет на сценарий"
                  : "Цена в объявлении"}
              </h3>
              <div className="budget-inputs">
                <Numeric
                  label="От"
                  value={filters.minPrice}
                  unit="₽"
                  onChange={(v) => setFilters((s) => ({ ...s, minPrice: v }))}
                />
                <Numeric
                  label="До"
                  value={filters.maxPrice}
                  unit="₽"
                  onChange={(v) => setFilters((s) => ({ ...s, maxPrice: v }))}
                />
              </div>
              <p className="fine-print">
                {priceMode === "full"
                  ? "Неполные суммы — отдельно, с неизвестными платежами."
                  : "Учитывается исходная цена объявления. Доплаты здесь не включаются."}
              </p>
            </section>
            <section className="side-section">
              <h3>На площадке</h3>
              {[
                ["pool_on_dates", "Бассейн на наши даты"],
                ["sauna", "Сауна"],
                ["banya", "Баня"],
                ["hot_tub", "Чан"],
                ["bbq", "Мангал / барбекю"],
                ["kitchen", "Кухня"],
              ].map(([id, label]) => (
                <Toggle
                  key={id}
                  checked={filters.features[id] === "yes"}
                  onChange={(v) =>
                    setFilters((s) => ({
                      ...s,
                      features: { ...s.features, [id]: v ? "yes" : "" },
                    }))
                  }
                >
                  {label}
                </Toggle>
              ))}
              <Toggle
                checked={filters.includeUnknown}
                onChange={(v) =>
                  setFilters((s) => ({ ...s, includeUnknown: v }))
                }
              >
                Добавить «нужно уточнить»
              </Toggle>
            </section>
            <section className="side-section">
              <Select
                label="Направление"
                value={filters.direction}
                onChange={(v) => setFilters((s) => ({ ...s, direction: v }))}
              >
                <option value="">Любое</option>
                {directions.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </Select>
              <Select
                label="Источник"
                value={filters.source}
                onChange={(v) => setFilters((s) => ({ ...s, source: v }))}
              >
                <option value="">Все площадки</option>
                {Object.entries(SOURCE_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
              <Select
                label="Наш статус"
                value={filters.status}
                onChange={(v) => setFilters((s) => ({ ...s, status: v }))}
              >
                <option value="">Все</option>
                {Object.entries(STATUS_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
            </section>
            <button
              className="button outlined full"
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal size={16} /> Все фильтры
              {activeCount > 0 && <b>{activeCount}</b>}
            </button>
            <div className="source-note">
              <ShieldCheck size={19} />
              <p>
                Цена видна по составу
                <small>
                  Цитаты, уборка и доплаты — внутри карточки. Залог отдельно.
                </small>
              </p>
            </div>
          </aside>
          <section className="results">
            <div className="results-header">
              <div>
                <h2>
                  {num.format(rows.length)} <span>групп домов</span>
                </h2>
                <p>
                  {priceMode === "full"
                    ? "Сметы для вашего сценария. Подтверждение у владельца — отдельно."
                    : "Цены из карточек объявлений. Полный расчёт доступен переключателем выше."}
                </p>
              </div>
              <div className="view-toggle" aria-label="Вид подборки">
                <button
                  aria-label="Таблица"
                  className={view === "table" ? "active" : ""}
                  onClick={() => setView("table")}
                >
                  <Table2 size={17} />
                  <span>Таблица</span>
                </button>
                <button
                  aria-label="Карточки"
                  className={view === "cards" ? "active" : ""}
                  onClick={() => setView("cards")}
                >
                  <LayoutGrid size={17} />
                  <span>Карточки</span>
                </button>
              </div>
            </div>
            <div className="results-toolbar">
              <div className="group-tabs">
                <button
                  className={group === "all" ? "active" : ""}
                  onClick={() => setGroup("all")}
                >
                  Все <b>{allRows.length}</b>
                </button>
                <button
                  className={group === "uncertain" ? "active" : ""}
                  onClick={() => setGroup("uncertain")}
                >
                  Нужно уточнить{" "}
                  <b>{allRows.filter((r) => r.uncertain).length}</b>
                </button>
                <button
                  className={group === "finalist" ? "active" : ""}
                  onClick={() => setGroup("finalist")}
                >
                  Финалисты
                </button>
              </div>
              <div className="results-actions">
                <select
                  aria-label="Сортировка"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="recommended">По пригодности</option>
                  <option value="price">Цена по возрастанию</option>
                  <option value="price_desc">Цена по убыванию</option>
                  <option value="distance">Ближе к МКАД</option>
                  <option value="title">По названию</option>
                </select>
                <div className="columns-anchor">
                  <IconButton
                    label="Колонки и экспорт"
                    onClick={() => setColumnsOpen(!columnsOpen)}
                  >
                    <Columns3 size={17} />
                  </IconButton>
                  {columnsOpen && (
                    <div className="columns-menu">
                      <h4>Колонки таблицы</h4>
                      {[
                        ["location", "Расположение"],
                        ["capacity", "Гости и ночлег"],
                        ["amenities", "Удобства"],
                        ["deposit", "Залог"],
                        ["status", "Статус"],
                      ].map(([id, label]) => (
                        <Toggle
                          key={id}
                          checked={columns.includes(id)}
                          onChange={(v) =>
                            setColumns((c) =>
                              v ? [...c, id] : c.filter((x) => x !== id),
                            )
                          }
                        >
                          {label}
                        </Toggle>
                      ))}
                      <hr />
                      <button
                        className="text-button"
                        onClick={() => exportRows("csv")}
                      >
                        <Download size={14} />
                        Экспорт CSV
                      </button>
                      <button
                        className="text-button"
                        onClick={() => exportRows("json")}
                      >
                        <Download size={14} />
                        Экспорт JSON
                      </button>
                    </div>
                  )}
                </div>
                <button
                  className="mobile-filters button soft"
                  onClick={() => setFiltersOpen(true)}
                >
                  <SlidersHorizontal size={16} />
                  Фильтры
                </button>
              </div>
            </div>
            {activeCount > 0 && (
              <div className="active-filters">
                <span>
                  {activeCount} {activeCount === 1 ? "фильтр" : "фильтров"}{" "}
                  включено
                </span>
                {Object.entries(filters.features)
                  .filter(([, v]) => v)
                  .map(([id, value]) => (
                    <button
                      key={id}
                      onClick={() =>
                        setFilters((s) => ({
                          ...s,
                          features: { ...s.features, [id]: "" },
                        }))
                      }
                    >
                      {featureLabel(id)} ·{" "}
                      {value === "yes"
                        ? "есть"
                        : value === "no"
                          ? "нет"
                          : "уточнить"}
                      <X size={12} />
                    </button>
                  ))}
              </div>
            )}
            {!catalog ? (
              <div className="empty-state">
                <RefreshCw className="spinning" />
                <h3>Загружаем подборку…</h3>
              </div>
            ) : !rows.length ? (
              <div className="empty-state">
                <Search size={35} />
                <h3>
                  {scenarioError
                    ? "Уточните сценарий"
                    : catalog.houses.length
                      ? "Варианты не найдены"
                      : "Каталог ещё не опубликован"}
                </h3>
                <p>
                  {catalog.houses.length
                    ? "Попробуйте убрать часть фильтров или добавить варианты с неизвестными условиями."
                    : "Владелец может загрузить подготовленный пакет через настройки."}
                </p>
                <button
                  className="button soft"
                  onClick={() => {
                    setFilters(clone(EMPTY_FILTERS));
                    setGroup("all");
                  }}
                >
                  Сбросить фильтры
                </button>
              </div>
            ) : view === "cards" ? (
              <div className="cards-grid">
                {visibleRows.map((row) => (
                  <ResultCard
                    key={row.house.id}
                    row={row}
                    priceMode={priceMode}
                    decision={projectedDecisions[row.house.id] || {}}
                    onOpen={() => open(row.house.id)}
                    onFavorite={() =>
                      quickSave(row.house.id, {
                        favorite: !projectedDecisions[row.house.id]?.favorite,
                      })
                    }
                    selected={selectedIds.includes(row.house.id)}
                    onSelect={() => toggleSelect(row.house.id)}
                  />
                ))}
              </div>
            ) : (
              <ResultTable
                rows={visibleRows}
                decisions={projectedDecisions}
                selectedIds={selectedIds}
                toggleSelect={toggleSelect}
                open={open}
                save={quickSave}
                columns={columns}
                priceMode={priceMode}
              />
            )}
            {rows.length > 0 && (
              <footer className="pagination">
                <span>
                  {safePage * pageSize + 1}–
                  {Math.min((safePage + 1) * pageSize, rows.length)} из{" "}
                  {num.format(rows.length)}
                </span>
                <div>
                  <button
                    className="button soft"
                    disabled={safePage === 0}
                    onClick={() => setPage(safePage - 1)}
                  >
                    <ChevronLeft size={15} />
                    Назад
                  </button>
                  <span>
                    {safePage + 1} / {pages}
                  </span>
                  <button
                    className="button soft"
                    disabled={safePage >= pages - 1}
                    onClick={() => setPage(safePage + 1)}
                  >
                    Дальше
                    <ChevronRight size={15} />
                  </button>
                </div>
              </footer>
            )}
            <p className="data-footnote">
              Публикации и их условия могут измениться. Подтверждённой ценой
              считается только ответ владельца для выбранного сценария.
            </p>
          </section>
        </div>
      </main>
      {selectedIds.length > 0 && (
        <div className="compare-tray">
          <span>
            <strong>{selectedIds.length}</strong> выбрано для сравнения
          </span>
          <div className="tray-names">
            {comparedRows.map((r) => (
              <button key={r.house.id} onClick={() => toggleSelect(r.house.id)}>
                {r.house.title}
                <X size={12} />
              </button>
            ))}
          </div>
          <button className="text-button" onClick={() => setSelectedIds([])}>
            Очистить
          </button>
          <button
            className="button primary"
            disabled={comparedRows.length < 2}
            onClick={() => setCompareOpen(true)}
          >
            Сравнить <ChevronRight size={15} />
          </button>
        </div>
      )}
      {filtersOpen && (
        <AdvancedFilters
          filters={filters}
          setFilters={setFilters}
          onClose={() => setFiltersOpen(false)}
          coverage={coverage}
          directions={directions}
          priceMode={priceMode}
        />
      )}
      {openRow && (
        <HouseDrawer
          key={openRow.house.id}
          row={openRow}
          decision={projectedDecisions[openRow.house.id] || {}}
          repo={repo}
          scenario={scenario}
          onClose={() => setOpenId(null)}
          save={save}
          initialTab={initialTab}
          notify={notify}
          unlink={unlink}
          split={split}
          rejoin={rejoin}
          priceMode={priceMode}
          setPriceMode={setPriceMode}
        />
      )}
      {compareOpen && comparedRows.length > 1 && (
        <Compare
          rows={comparedRows}
          onClose={() => setCompareOpen(false)}
          decisions={projectedDecisions}
          open={open}
          merge={merge}
          priceMode={priceMode}
          setPriceMode={setPriceMode}
        />
      )}
      {adminOpen && (
        <Admin
          repo={repo}
          onClose={() => setAdminOpen(false)}
          notify={notify}
          reload={reload}
        />
      )}
      {toast && (
        <div
          className={"toast " + (toast.error ? "error" : "")}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <AlertCircle size={17} /> : <Check size={17} />}{" "}
          {toast.message}
        </div>
      )}
    </div>
  );
}
