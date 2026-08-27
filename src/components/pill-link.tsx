import Link from 'next/link';

interface PillLinkProps {
  href: string;
  active: boolean;
  children: React.ReactNode;
}

export function PillLink({ href, active, children }: PillLinkProps) {
  const colorClass = active
    ? 'bg-ondark text-canvas'
    : 'bg-elevated text-mute hover:text-ondark';
  return (
    <Link
      href={href}
      className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${colorClass}`}
    >
      {children}
    </Link>
  );
}
