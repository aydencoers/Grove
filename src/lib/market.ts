/*
 * US equity market clock — a rough open/closed check for the header badge and
 * the quote-cache TTL. Regular session only (09:30–16:00 ET, Mon–Fri).
 * Exchange holidays are NOT handled; on a holiday this reports "open" and the
 * quote simply doesn't move. That's an acceptable simplification for a
 * read-only visualiser — see SPEC "designed, not built".
 */

export interface MarketClock {
  open: boolean;
  /** Short human note, e.g. "Opens 9:30 AM ET" / "Closes 4:00 PM ET". */
  note: string;
}

/** Wall-clock parts in America/New_York for an instant. */
function etParts(at: Date): { weekday: number; minutes: number } {
  // en-US with an explicit TZ gives us ET regardless of server locale.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = weekdayMap[get("weekday")] ?? 0;
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0; // some ICU builds emit "24" at midnight
  const minutes = hour * 60 + Number(get("minute"));
  return { weekday, minutes };
}

const OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const CLOSE_MIN = 16 * 60; // 16:00 ET

export function marketClock(at: Date = new Date()): MarketClock {
  const { weekday, minutes } = etParts(at);
  const weekend = weekday === 0 || weekday === 6;
  const open = !weekend && minutes >= OPEN_MIN && minutes < CLOSE_MIN;

  let note: string;
  if (open) {
    note = "Closes 4:00 PM ET";
  } else if (weekend) {
    note = "Opens Monday 9:30 AM ET";
  } else if (minutes < OPEN_MIN) {
    note = "Opens 9:30 AM ET";
  } else {
    note = "Opens 9:30 AM ET tomorrow";
  }
  return { open, note };
}
