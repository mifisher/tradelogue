interface StatProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'gain' | 'loss' | 'neutral';
}

const toneClass: Record<NonNullable<StatProps['tone']>, string> = {
  gain: 'text-gain',
  loss: 'text-loss',
  neutral: 'text-ondark',
};

export function Stat({ label, value, sub, tone = 'neutral' }: StatProps) {
  return (
    <div>
      <p className="text-[13px] text-stone uppercase tracking-wide">{label}</p>
      <p className={`font-display text-3xl tabular ${toneClass[tone]}`}>{value}</p>
      {sub && <p className="text-sm text-mute">{sub}</p>}
    </div>
  );
}
