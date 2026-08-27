export interface DailySummaryLike {
  day: string;
  pnl: number;
  tradeCount: number;
}

export interface CalendarCell {
  date: string; // '' = placeholder (keeps grid alignment)
  summary?: DailySummaryLike;
}

export interface CalendarWeek {
  cells: CalendarCell[]; // always 5 cells, Mon–Fri
  weekPnl: number | null; // null if no sessions that week
}

export interface MonthView {
  ym: string;      // '2026-05'
  title: string;   // 'May 2026'
  weeks: CalendarWeek[];
  monthTotal: number;
  greenDays: number;
  redDays: number;
  prevYm: string;
  nextYm: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Zero-pad a number to 2 digits */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Format a Date as 'YYYY-MM-DD' using UTC fields (TZ-safe) */
function fmtDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Add N months to a YYYY-MM string, handling year rollover */
function addMonths(ym: string, delta: number): string {
  const year = parseInt(ym.slice(0, 4), 10);
  const month = parseInt(ym.slice(5, 7), 10); // 1-based
  const totalMonths = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = totalMonths % 12; // 0-based
  return `${newYear}-${pad2(newMonth + 1)}`;
}

/**
 * Build a MonthView for the given ym ('YYYY-MM') and set of daily summaries.
 * Only weekday (Mon–Fri) cells appear in the grid. Weekend summaries are
 * included in monthTotal/greenDays/redDays but excluded from the grid.
 */
export function monthView(ym: string, days: DailySummaryLike[]): MonthView {
  const year = parseInt(ym.slice(0, 4), 10);
  const month = parseInt(ym.slice(5, 7), 10); // 1-based

  // Build a lookup map: date string → summary
  const summaryMap = new Map<string, DailySummaryLike>();
  for (const d of days) {
    if (d.day.startsWith(ym)) {
      summaryMap.set(d.day, d);
    }
  }

  // Determine the first and last day of the month (UTC-safe)
  const firstDay = new Date(`${ym}-01T00:00:00Z`);

  // Build all weekday dates of the month
  const weekdayDates: string[] = [];
  const cur = new Date(firstDay);
  while (cur.getUTCMonth() + 1 === month) {
    const dow = cur.getUTCDay(); // 0=Sun, 1=Mon..5=Fri, 6=Sat
    if (dow >= 1 && dow <= 5) {
      weekdayDates.push(fmtDate(cur));
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  // Group weekday dates into weeks (Mon=1..Fri=5 aligned)
  // Each week is identified by the Monday of that ISO week.
  // We group by computing: weekStart = date - (dow-1) days
  const weekMap = new Map<string, string[]>();
  for (const dateStr of weekdayDates) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    const dow = d.getUTCDay(); // 1..5
    const mondayMs = d.getTime() - (dow - 1) * 86_400_000;
    const monday = new Date(mondayMs);
    const mondayKey = fmtDate(monday);
    if (!weekMap.has(mondayKey)) weekMap.set(mondayKey, []);
    weekMap.get(mondayKey)!.push(dateStr);
  }

  // Sort weeks by Monday date
  const sortedMondays = [...weekMap.keys()].sort();

  const weeks: CalendarWeek[] = [];
  for (const mondayKey of sortedMondays) {
    const datesInWeek = weekMap.get(mondayKey)!;
    // Build a set for quick lookup
    const dateSet = new Set(datesInWeek);

    // Build 5 cells Mon..Fri
    const monday = new Date(`${mondayKey}T00:00:00Z`);
    const cells: CalendarCell[] = [];
    for (let i = 0; i < 5; i++) {
      const cellDate = new Date(monday.getTime() + i * 86_400_000);
      const cellDateStr = fmtDate(cellDate);
      if (dateSet.has(cellDateStr)) {
        // In-month weekday
        cells.push({
          date: cellDateStr,
          summary: summaryMap.get(cellDateStr),
        });
      } else {
        // Placeholder: either out-of-month or weekend (shouldn't happen for Mon-Fri)
        cells.push({ date: '' });
      }
    }

    // weekPnl: sum of traded days in this week
    let weekPnl: number | null = null;
    for (const cell of cells) {
      if (cell.date && cell.summary) {
        weekPnl = (weekPnl ?? 0) + cell.summary.pnl;
      }
    }

    weeks.push({ cells, weekPnl });
  }

  // monthTotal, greenDays, redDays — include ALL in-month summaries (even weekend)
  let monthTotal = 0;
  let greenDays = 0;
  let redDays = 0;
  for (const d of days) {
    if (d.day.startsWith(ym)) {
      monthTotal += d.pnl;
      if (d.pnl > 0) greenDays++;
      else redDays++; // pnl <= 0 counts as red per project semantics
    }
  }
  // Round to avoid floating point drift
  monthTotal = Math.round(monthTotal * 100) / 100;

  const title = `${MONTH_NAMES[month - 1]} ${year}`;

  return {
    ym,
    title,
    weeks,
    monthTotal,
    greenDays,
    redDays,
    prevYm: addMonths(ym, -1),
    nextYm: addMonths(ym, +1),
  };
}
