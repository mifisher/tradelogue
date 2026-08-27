import { dailySummaries, journaledDates } from '@/lib/queries';
import { monthView } from '@/lib/calendar';
import { Pnl } from '@/components/pnl';
import { PillLink } from '@/components/pill-link';
import { MonthGrid } from '@/components/month-grid';

export const dynamic = 'force-dynamic';

/** Validate that a string is a YYYY-MM month param */
function isValidYm(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);
}

/** Return current month as 'YYYY-MM' */
function currentYm(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return `${y}-${m < 10 ? `0${m}` : m}`;
}

interface CalendarPageProps {
  searchParams: Promise<{ m?: string }>;
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const { m: mParam } = await searchParams;
  const [days, journaledSet] = await Promise.all([
    dailySummaries(),
    journaledDates(),
  ]);
  const journaledDatesArr = [...journaledSet];

  // Determine default month: the month of the last session, else current month
  const defaultYm =
    days.length > 0
      ? days[days.length - 1].day.slice(0, 7) // 'YYYY-MM' from last day
      : currentYm();

  const ym = isValidYm(mParam) ? mParam : defaultYm;

  // Filter summaries to this month
  const monthDays = days.filter((d) => d.day.startsWith(ym));

  const mv = monthView(ym, monthDays);

  // Build prev/next labels (short month name + year if different)
  const prevLabel = prevNextLabel(mv.prevYm);
  const nextLabel = prevNextLabel(mv.nextYm);

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="font-display text-3xl text-ondark">{mv.title}</h1>
          <div className="flex items-center gap-3 mt-2">
            <Pnl value={mv.monthTotal} className="text-base" />
            <span className="text-mute text-sm">
              · {mv.greenDays} green · {mv.redDays} red
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PillLink href={`/calendar?m=${mv.prevYm}`} active={false}>
            ← {prevLabel}
          </PillLink>
          <PillLink href={`/calendar?m=${currentYm()}`} active={false}>
            Today
          </PillLink>
          <PillLink href={`/calendar?m=${mv.nextYm}`} active={false}>
            {nextLabel} →
          </PillLink>
        </div>
      </div>

      {/* Empty state */}
      {days.length === 0 ? (
        <p className="text-mute text-center py-16">No sessions in {mv.title}.</p>
      ) : monthDays.length === 0 ? (
        <>
          <MonthGrid mv={mv} journaledDates={journaledDatesArr} />
          <p className="text-mute text-center py-8">No sessions in {mv.title}.</p>
        </>
      ) : (
        <MonthGrid mv={mv} journaledDates={journaledDatesArr} />
      )}
    </main>
  );
}

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function prevNextLabel(ym: string): string {
  const month = parseInt(ym.slice(5, 7), 10) - 1; // 0-based
  return SHORT_MONTHS[month] ?? ym;
}
