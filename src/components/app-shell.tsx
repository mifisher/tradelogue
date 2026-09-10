'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BriefRefreshButton } from '@/components/brief-refresh-button';
import { ModeToggle } from '@/components/mode-toggle';
import type { HeaderStatus } from '@/lib/header-status';

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
    return `block rounded-[12px] px-3 py-2 text-sm font-semibold transition-colors ${
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
              {links.map(({ label, href }) => (
                <Link key={href} href={href} onClick={close} className={item(href)}>
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
                  className="block rounded-[12px] border border-loss px-3 py-2 text-sm font-semibold text-loss"
                >
                  Finish setup
                </Link>
              )}
              <Link href="/settings" onClick={close} className={item('/settings')}>
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
