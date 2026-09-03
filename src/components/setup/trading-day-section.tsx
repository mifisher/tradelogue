'use client';

import { useMemo, useState } from 'react';
import { Section, Field, SelectField, SaveBar } from './field';
import { useSectionForm } from './use-section-form';

const THRESHOLDS = [
  { key: 'RULE_OUTLAY_CAP', label: 'Max position cost ($)', help: 'contracts × entry × 100' },
  { key: 'RULE_REENTRY_PAUSE_MIN', label: 'Re-entry pause (minutes)', help: 'after a losing exit on the same name' },
  { key: 'RULE_CIRCUIT_BREAKER', label: 'Daily loss limit ($)', help: 'negative; stop opening once running P&L reaches it' },
  { key: 'RULE_CHOP_TRADE_CAP', label: 'Max trades on a chop day', help: 'on an Uncertain tape' },
  { key: 'RULE_SESSION_OPEN_HOUR', label: 'Opening-chop cutoff (hour)', help: '24h clock; 10 = the first 30 min of a 09:30 open' },
];

export function TradingDaySection({
  initial,
  masked,
  done,
}: {
  initial: Record<string, string>;
  masked: readonly string[];
  done: boolean;
}) {
  const { values, set, save, saving, message, fallback } = useSectionForm({
    initial,
    masked,
    area: 'timezone',
  });
  const [showThresholds, setShowThresholds] = useState(false);

  const zones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const detected = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const zone = values.NEXT_PUBLIC_TRADING_TIMEZONE || detected;

  return (
    <Section
      title="Your trading day"
      done={done}
      blurb="Every session date, day boundary, and rule time is evaluated in this zone. Get it right first — if it is wrong, trades land on the wrong day and everything downstream inherits the error."
    >
      <SelectField
        label="Trading timezone"
        value={zone}
        onChange={(v) => set('NEXT_PUBLIC_TRADING_TIMEZONE', v)}
        options={zones.map((z) => ({ value: z, label: z }))}
        help={`Your browser reports ${detected}. Most US options traders want America/New_York regardless of where they sit.`}
      />

      <button
        type="button"
        onClick={() => setShowThresholds((s) => !s)}
        className="text-[13px] text-mute hover:text-ondark"
      >
        {showThresholds ? 'Hide' : 'Show'} rule thresholds
      </button>

      {showThresholds && (
        <div className="space-y-5 border-l border-hairline pl-5">
          <p className="text-[13px] text-stone leading-relaxed">
            These feed the mechanical detectors. The shipped values are round
            placeholders, not advice — set them to what you actually trade. They
            apply to whichever rule carries the matching detector.
          </p>
          {THRESHOLDS.map((t) => (
            <Field
              key={t.key}
              label={t.label}
              value={values[t.key] ?? ''}
              onChange={(v) => set(t.key, v)}
              help={t.help}
            />
          ))}
        </div>
      )}

      <SaveBar onSave={save} saving={saving} message={message} fallback={fallback} />
    </Section>
  );
}
