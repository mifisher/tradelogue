// ── ViolationsCard — server component ────────────────────────────────────────
// Renders detected rule violations or a clean-state message.
// Used on the day page inside a <Card title="Discipline">.

import type { RuleViolation } from '@/lib/rules';

interface ViolationsCardProps {
  violations: RuleViolation[];
  /** Whether this session has a journal entry (affects footnote text). */
  journaled: boolean;
  /** When false, trades haven't loaded yet — show a neutral placeholder instead of empty-state. */
  hasTrades?: boolean;
  /** Active mechanical rule numbers used for this calculation. */
  checkedRuleNumbers?: number[];
}

export function ViolationsCard({
  violations,
  journaled,
  hasTrades = true,
  checkedRuleNumbers = [1, 4, 6, 13, 15, 18, 21],
}: ViolationsCardProps) {
  const checkedRulesText = checkedRuleNumbers.length > 0
    ? checkedRuleNumbers.map((rule) => rule.toString()).join(', ')
    : 'none';

  return (
    <div>
      {!hasTrades ? (
        <p className="text-sm text-mute">Violations appear once trades are synced.</p>
      ) : violations.length === 0 ? (
        <p className="text-sm text-gain">✓ No mechanical violations detected</p>
      ) : (
        <div className="divide-y divide-divider">
          {violations.map((v, i) => (
            <div key={`${v.rule}-${v.firstExecId ?? 'session'}-${i}`} className="py-3 first:pt-0 last:pb-0 flex items-start gap-3">
              {/* Rule badge */}
              <span className="shrink-0 bg-deep rounded-full px-2.5 py-0.5 text-[13px] text-loss font-semibold tabular">
                R{v.rule}
              </span>

              {/* Title + detail */}
              <div className="min-w-0">
                <p className="text-ondark text-sm font-semibold leading-tight">{v.title}</p>
                <p className="text-mute text-sm mt-0.5 leading-snug">{v.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footnote */}
      <p className="text-[12px] text-stone mt-4 pt-3 border-t border-divider leading-relaxed">
        Active mechanical rules checked: {checkedRulesText}. Tape-dependent rules need the session&apos;s classification.
        {!journaled && (
          <span className="block mt-0.5">
            (session not journaled — tape-dependent rules are skipped)
          </span>
        )}
      </p>
    </div>
  );
}
