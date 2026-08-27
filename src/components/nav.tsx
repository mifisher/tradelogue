'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BriefRefreshButton } from '@/components/brief-refresh-button';
import { ModeToggle } from '@/components/mode-toggle';
import type { HeaderStatus } from '@/lib/header-status';
import { headerWidth } from '@/lib/layout';

const links = [
  { label: 'Dashboard', href: '/' },
  { label: 'Coach', href: '/coach' },
  { label: 'Market', href: '/market' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Trades', href: '/trades' },
  { label: 'Setups', href: '/setups' },
  { label: 'Rules', href: '/rules' },
  { label: 'Import', href: '/import' },
];

const STATE_DOT: Record<HeaderStatus['state'], string> = {
  fresh: 'bg-gain',
  stale: 'bg-loss',
  none: 'bg-stone',
};

/** Which session you are looking at, and whether the brief behind it is that
 * session's. The date is the load-bearing half: everything on the dashboard is
 * bucketed by PT session, so seeing the day named removes the "is this
 * yesterday's run?" doubt without repeating it on every card. */
function SessionStamp({ status }: { status: HeaderStatus }) {
  return (
    <div className="hidden md:block shrink-0 text-right leading-tight">
      <div className="text-[13px] text-ondark whitespace-nowrap">{status.dateLabel}</div>
      <div className="flex items-center justify-end gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${STATE_DOT[status.state]}`} aria-hidden />
        <span
          className={`text-[11px] whitespace-nowrap ${
            status.state === 'stale' ? 'text-loss' : 'text-stone'
          }`}
        >
          {status.updatedLabel}
        </span>
        <BriefRefreshButton compact />
      </div>
    </div>
  );
}

export function Nav({ status }: { status: HeaderStatus | null }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 bg-canvas/90 backdrop-blur border-b border-hairline">
      {/* px-6 matches the pages exactly: the brand sits on the hero's left edge
          and the session stamp on the right rail's right edge. */}
      <div className={`${headerWidth(pathname)} mx-auto px-6 h-16 flex items-center justify-between gap-3`}>
        <span className="font-display text-lg sm:text-xl text-ondark whitespace-nowrap shrink-0">
          Trading Journal
        </span>
        <nav className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {links.map(({ label, href }) => {
            const isActive =
              href === '/' ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`shrink-0 rounded-full px-3 sm:px-4 py-1.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-cobalt text-on-cobalt'
                    : 'text-mute hover:bg-elevated hover:text-ondark'
                }`}
              >
                {label}
              </Link>
            );
          })}
          <ModeToggle />
        </nav>
        {status && <SessionStamp status={status} />}
      </div>
    </header>
  );
}
