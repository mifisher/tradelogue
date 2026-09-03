'use client';

import { Section, Field, TestButton, SaveBar } from './field';
import { useSectionForm } from './use-section-form';
import { testIbkr } from '@/lib/setup/actions';

const FIELDS =
  'Account ID, Asset Class, Symbol, Underlying Symbol, Description, Conid, Put/Call, ' +
  'Strike, Expiry, Multiplier, Date/Time, Quantity, Trade Price, Proceeds, IB Commission, ' +
  'Buy/Sell, Transaction Type, IB Exec ID, Notes/Codes';

export function IbkrSection({
  initial,
  masked,
  done,
}: {
  initial: Record<string, string>;
  masked: readonly string[];
  done: boolean;
}) {
  const { values, set, save, saving, message, fallback } = useSectionForm({ initial, masked, area: 'ibkr' });

  const token = values.IBKR_FLEX_TOKEN ?? '';
  const activityId = values.IBKR_FLEX_QUERY_ID ?? '';
  const confirmId = values.IBKR_TRADE_CONFIRM_QUERY_ID ?? '';

  return (
    <Section
      title="Interactive Brokers"
      done={done}
      blurb="Tradelogue reads your fills through the IBKR Flex Web Service, which is read-only and separate from your trading credentials. It cannot place orders."
    >
      <div className="rounded-[12px] bg-deep p-5 text-[13px] text-mute leading-relaxed space-y-3">
        <p className="text-ondark font-semibold">Creating the Flex Query</p>
        <p>
          In Client Portal → Performance &amp; Reports → Flex Queries, create an{' '}
          <span className="text-ondark">Activity Flex Query</span> (your end-of-day history) and,
          once that works, a <span className="text-ondark">Trade Confirmation Flex Query</span>{' '}
          (same-day fills, so you can journal intraday instead of waiting for the statement).
        </p>
        <p>
          For either one — <span className="text-ondark">Section:</span> Trades, with the{' '}
          <span className="text-ondark">Executions</span> option enabled.{' '}
          <span className="text-ondark">Period:</span> Last 365 Calendar Days.
        </p>
        <p>
          <span className="text-ondark">Fields:</span> {FIELDS}.
        </p>
        <p className="text-loss">
          These three are not cosmetic — the parser expects exactly this shape. Date format{' '}
          <code className="bg-canvas rounded px-1">yyyyMMdd</code>, time format{' '}
          <code className="bg-canvas rounded px-1">HHmmss</code>, date/time separator{' '}
          <code className="bg-canvas rounded px-1">;</code> (semicolon). If an import fails to
          parse, check these first.
        </p>
        <p>
          Then enable the service under Settings → FlexWeb Service and generate a token.
        </p>
      </div>

      <Field
        label="Flex token"
        value={token}
        onChange={(v) => set('IBKR_FLEX_TOKEN', v)}
        secret
        help="From Settings → FlexWeb Service. Read-only; it cannot place orders."
      />
      <Field
        label="Activity query ID"
        value={activityId}
        onChange={(v) => set('IBKR_FLEX_QUERY_ID', v)}
        help="End-of-day history — the backbone of your journal."
      />
      <Field
        label="Trade confirmation query ID (optional)"
        value={confirmId}
        onChange={(v) => set('IBKR_TRADE_CONFIRM_QUERY_ID', v)}
        help="Same-day fills. The Sync button prefers this; without it, it falls back to the activity query."
      />

      <TestButton
        label="Test connection"
        run={() => testIbkr({ token, queryId: confirmId || activityId })}
      />
      <p className="text-[13px] text-stone">
        IBKR throttles per token and its statement generation is often slow around the
        midnight-ET maintenance window. A &ldquo;try again in a minute&rdquo; here usually means
        exactly that.
      </p>

      <SaveBar onSave={save} saving={saving} message={message} fallback={fallback} />
    </Section>
  );
}
