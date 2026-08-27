'use client';

import { useEffect, useState } from 'react';

interface EventTimeProps {
  utc: string;                 // ISO 8601 UTC instant
  mode?: 'time' | 'datetime';  // '8:30 AM' vs 'Jul 20, 8:30 AM'
}

/** Renders a UTC instant in the browser's local timezone. Client-only to
 * avoid a server/client hydration mismatch. */
export function EventTime({ utc, mode = 'time' }: EventTimeProps) {
  const [text, setText] = useState('');
  useEffect(() => {
    const d = new Date(utc);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(
      mode === 'time'
        ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    );
  }, [utc, mode]);
  return <span suppressHydrationWarning>{text || '—'}</span>;
}
