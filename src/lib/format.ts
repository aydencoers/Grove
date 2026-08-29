const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const usdPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number): string {
  return usd.format(value);
}

export function formatPrice(value: number): string {
  return usdPrecise.format(value);
}

/** Signed percentage, e.g. "+18.68%" / "-4.20%". */
export function formatSignedPct(value: number, digits = 2): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

/** Signed currency, e.g. "+$2,976.00". */
export function formatSignedCurrency(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${usdPrecise.format(Math.abs(value))}`;
}

export function formatDate(iso: string): string {
  // Date-only strings ("2024-03-12") parse as UTC midnight; pin the display to
  // UTC so it doesn't slip a day in western timezones.
  const utc = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(utc ? { timeZone: "UTC" } : {}),
  });
}

/** Wall-clock time in US market time, e.g. "3:58 PM ET". */
export function formatEtTime(iso: string): string {
  const t = new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  return `${t} ET`;
}

/** "2 years, 5 months" between an ISO date and now (or a given reference). */
export function formatDuration(fromISO: string, toISO?: string): string {
  const from = new Date(fromISO);
  const to = toISO ? new Date(toISO) : new Date();
  let months =
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  months = Math.max(0, months);

  const years = Math.floor(months / 12);
  const rem = months % 12;
  const parts: string[] = [];
  if (years) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (rem) parts.push(`${rem} month${rem === 1 ? "" : "s"}`);
  if (!parts.length) return "less than a month";
  return parts.join(", ");
}
