'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BriefRefreshButton } from '@/components/brief-refresh-button';
import { ModeToggle } from '@/components/mode-toggle';
import type { HeaderStatus } from '@/lib/header-status';

/** Outline glyphs in the same 24-unit, 2px round-stroke style as the theme
 * toggle, so the sidebar reads as one set. Paths from Feather Icons (MIT). */
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

const links = [
  {
    label: 'Dashboard',
    href: '/',
    icon: (
      <>
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </>
    ),
  },
  {
    label: 'Coach',
    href: '/coach',
    icon: (
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    ),
  },
  {
    label: 'Market',
    href: '/market',
    icon: (
      <>
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </>
    ),
  },
  {
    label: 'Calendar',
    href: '/calendar',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </>
    ),
  },
  {
    label: 'Trades',
    href: '/trades',
    icon: (
      <>
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </>
    ),
  },
  {
    label: 'Setups',
    href: '/setups',
    icon: (
      <>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </>
    ),
  },
  {
    label: 'Rules',
    href: '/rules',
    icon: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <polyline points="9 12 11 14 15 10" />
      </>
    ),
  },
  {
    label: 'Import',
    href: '/import',
    icon: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </>
    ),
  },
];

const SETTINGS_ICON = (
  <>
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </>
);

const ALERT_ICON = (
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </>
);

const STATE_DOT: Record<HeaderStatus['state'], string> = {
  fresh: 'bg-gain',
  stale: 'bg-loss',
  none: 'bg-stone',
};

/** Which session you are looking at, and whether the brief behind it is that
 * session's. The date is the load-bearing half: everything on the dashboard is
 * bucketed by session, so seeing the day named removes the "is this
 * yesterday's run?" doubt without repeating it on every card. */
function SessionStamp({ status }: { status: HeaderStatus }) {
  return (
    <div className="hidden md:block text-right leading-tight">
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

/** The frame around every page: a full-width header with the brand, the
 * session stamp and the theme toggle, and a navigation sidebar beside the
 * page. Below lg the sidebar folds away behind the header's menu button and
 * opens over the page, so it appears wherever you have scrolled to. */
export function AppShell({
  status,
  incomplete,
  children,
}: {
  status: HeaderStatus | null;
  incomplete?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const item = (href: string) => {
    const active = href === '/' ? pathname === href : pathname.startsWith(href);
    return `flex items-center gap-3 rounded-[12px] px-3 py-2 text-sm font-semibold transition-colors ${
      active ? 'bg-cobalt text-on-cobalt' : 'text-mute hover:bg-elevated hover:text-ondark'
    }`;
  };

  return (
    <>
      <header className="sticky top-0 z-50 h-16 bg-canvas/90 backdrop-blur border-b border-hairline">
        <div className="h-full px-4 lg:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls="sidebar-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              className="lg:hidden rounded-full p-2 text-mute hover:bg-elevated hover:text-ondark"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                {open ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 5h14M3 10h14M3 15h14" />}
              </svg>
            </button>
            <span className="font-display text-lg sm:text-xl text-ondark whitespace-nowrap">
              Tradelogue
            </span>
          </div>
          <div className="flex items-center gap-4">
            {status && <SessionStamp status={status} />}
            <ModeToggle />
          </div>
        </div>
      </header>

      <div className="lg:flex">
        <aside
          id="sidebar-menu"
          className={`${open ? 'block' : 'hidden'} fixed inset-x-0 top-16 bottom-0 z-40 bg-canvas lg:block lg:sticky lg:inset-auto lg:top-16 lg:h-[calc(100vh-4rem)] lg:w-60 lg:shrink-0 lg:bg-transparent lg:border-r border-hairline`}
        >
          <div className="h-full flex flex-col gap-6 px-3 py-4 overflow-y-auto">
            <nav className="flex flex-col gap-0.5">
              {links.map(({ label, href, icon }) => (
                <Link key={href} href={href} onClick={close} className={item(href)}>
                  <Icon>{icon}</Icon>
                  {label}
                </Link>
              ))}
            </nav>

            <div className="mt-auto flex flex-col gap-0.5">
              {/* AI or IBKR still unconfigured: the app works, but a headline
                  feature is switched off and nothing else would say so. Exact
                  match, because '/setups'.startsWith('/setup') is true. */}
              {incomplete && pathname !== '/setup' && (
                <Link
                  href="/setup"
                  onClick={close}
                  className="flex items-center gap-3 rounded-[12px] border border-loss px-3 py-2 text-sm font-semibold text-loss"
                >
                  <Icon>{ALERT_ICON}</Icon>
                  Finish setup
                </Link>
              )}
              <Link href="/settings" onClick={close} className={item('/settings')}>
                <Icon>{SETTINGS_ICON}</Icon>
                Settings
              </Link>
            </div>
          </div>
        </aside>

        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </>
  );
}
