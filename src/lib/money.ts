import DecimalBase from "decimal.js-light";

/** Isolated Decimal constructor so global configuration never leaks between modules. */
export const Decimal = DecimalBase.clone({ precision: 28, rounding: DecimalBase.ROUND_HALF_UP });
export type Decimal = InstanceType<typeof Decimal>;
export type Numeric = Decimal | number | string;

export type RoundingMode = "half_up" | "half_even" | "down" | "up";

export const ROUNDING_LABELS: Record<RoundingMode, string> = {
  half_up: "Round half up (0.005 → 0.01)",
  half_even: "Banker's rounding (half to even)",
  down: "Truncate toward zero",
  up: "Round away from zero",
};

function rm(mode: RoundingMode): number {
  switch (mode) {
    case "half_up":
      return DecimalBase.ROUND_HALF_UP;
    case "half_even":
      return DecimalBase.ROUND_HALF_EVEN;
    case "down":
      return DecimalBase.ROUND_DOWN;
    case "up":
      return DecimalBase.ROUND_UP;
  }
}

export function d(value: Numeric | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  return value instanceof Decimal ? value : new Decimal(value);
}

export function round(value: Numeric, mode: RoundingMode = "half_up", dp = 2): Decimal {
  return d(value).toDecimalPlaces(dp, rm(mode));
}

/** Round to cents and return a JS number (safe for amounts well below 2^53 cents). */
export function money(value: Numeric, mode: RoundingMode = "half_up"): number {
  return Number(round(value, mode, 2).toFixed(2));
}

export function sum(values: Numeric[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(d(v)), new Decimal(0));
}

export function sumMoney(values: number[]): number {
  return money(sum(values));
}

export function maxD(a: Numeric, b: Numeric): Decimal {
  return d(a).gte(d(b)) ? d(a) : d(b);
}

export function minD(a: Numeric, b: Numeric): Decimal {
  return d(a).lte(d(b)) ? d(a) : d(b);
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, fractionDigits: number): Intl.NumberFormat {
  const key = `${currency}:${fractionDigits}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    formatters.set(key, f);
  }
  return f;
}

/** "$1,234.50" — negative values render as "−$1,234.50". */
export function formatMoney(
  value: number | null | undefined,
  currency = "USD",
  opts: { decimals?: number; signed?: boolean } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const decimals = opts.decimals ?? 2;
  const abs = formatter(currency, decimals).format(Math.abs(value));
  if (value < 0 || Object.is(value, -0)) return value === 0 ? abs : `−${abs}`;
  if (opts.signed && value > 0) return `+${abs}`;
  return abs;
}

/** Compact amount for dashboards: "$48.2k", "$1.25M". */
export function formatMoneyCompact(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 1,
  }).format(value);
}

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(rate: number | null | undefined, decimals = 2): string {
  if (rate === null || rate === undefined) return "—";
  return `${formatNumber(rate * 100, decimals)}%`;
}
