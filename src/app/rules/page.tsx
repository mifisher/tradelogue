import { RulesManager } from '@/components/rules-manager';
import { getLatestPatternAnalysis } from '@/lib/pattern-analysis-actions';
import { getTradingRules } from '@/lib/trading-rules';

export const dynamic = 'force-dynamic';

function ruleCandidatesFromAnalysis(
  analysis: Awaited<ReturnType<typeof getLatestPatternAnalysis>>,
) {
  return (analysis?.nextExperiments ?? []).map((experiment) => ({
    title: experiment.title,
    description: [
      `Hypothesis: ${experiment.hypothesis}`,
      `Protocol: ${experiment.protocol}`,
      `Success metric: ${experiment.successMetric}`,
    ].join('\n'),
  }));
}

export default async function RulesPage() {
  const [rules, patternAnalysis] = await Promise.all([
    getTradingRules(),
    getLatestPatternAnalysis(),
  ]);

  const ruleRows = rules.map((rule) => ({
    id: rule.id,
    ruleNumber: rule.ruleNumber,
    title: rule.title,
    description: rule.description,
    enabled: rule.enabled,
    detector: rule.detector,
    source: rule.source,
  }));

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-12">
      <div className="mb-8">
        <h1 className="font-display text-3xl text-ondark">Rules</h1>
        <p className="mt-2 max-w-3xl text-sm text-stone leading-relaxed">
          Edit the rulebook that drives discipline scoring. Auto-scored rules are checked from fills and session context; manual rules capture constraints you want to review until a detector is added.
        </p>
      </div>

      <RulesManager
        initialRules={ruleRows}
        candidates={ruleCandidatesFromAnalysis(patternAnalysis)}
      />
    </main>
  );
}
