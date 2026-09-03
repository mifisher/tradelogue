'use client';

import { Section, Field, SelectField, TestButton, SaveBar } from './field';
import { useSectionForm } from './use-section-form';
import { testAi } from '@/lib/setup/actions';

const PROVIDERS = [
  {
    value: 'openrouter',
    label: 'OpenRouter — recommended, one key reaches every model',
    keyVar: 'OPENROUTER_API_KEY',
    prefix: 'OPENROUTER',
    where: 'openrouter.ai/settings/keys',
    url: 'https://openrouter.ai/settings/keys',
  },
  {
    value: 'anthropic',
    label: 'Anthropic — direct Claude access',
    keyVar: 'ANTHROPIC_API_KEY',
    prefix: 'ANTHROPIC',
    where: 'console.anthropic.com',
    url: 'https://console.anthropic.com/settings/keys',
  },
  {
    value: 'moonshot',
    label: 'Moonshot — direct Kimi access',
    keyVar: 'MOONSHOT_API_KEY',
    prefix: 'MOONSHOT',
    where: 'the Kimi Open Platform',
    url: 'https://platform.moonshot.ai/console/api-keys',
  },
];

const SLOTS = [
  { slot: 'MODEL', label: 'Default model', help: 'Used for any slot left blank below.' },
  { slot: 'VOICE_MODEL', label: 'Voice / Fill with AI', help: 'You watch this one fill in fields, so latency is the whole game. Use a fast, non-reasoning model.' },
  { slot: 'COACH_MODEL', label: 'Session coaching + patterns', help: 'Nobody watches this generate. Quality over speed; long context, so input pricing dominates.' },
  { slot: 'BRIEF_MODEL', label: 'Market brief', help: 'One long structured JSON document. Pin this — most small models mangle the schema.' },
  { slot: 'CHAT_MODEL', label: 'Chat with your journal', help: 'A tool-use loop, so it needs dependable function calling.' },
  { slot: 'JUDGE_MODEL', label: 'Eval judge', help: 'Only spent when you run the eval harness. Pick a different family from the coach, so nothing grades its own work.' },
];

// From the README's recommended starting configuration. Offered, not prefilled:
// free-tier model names turn over constantly and this should not become a
// second place where stale ones live.
const RECOMMENDED: Record<string, string> = {
  OPENROUTER_MODEL: 'openrouter/free',
  OPENROUTER_VOICE_MODEL: 'google/gemini-2.5-flash-lite',
  OPENROUTER_COACH_MODEL: 'z-ai/glm-5.3-flash',
  OPENROUTER_BRIEF_MODEL: 'z-ai/glm-5.3-flash',
  OPENROUTER_JUDGE_MODEL: 'moonshotai/kimi-k2.6',
};

export function AiSection({
  initial,
  masked,
  done,
}: {
  initial: Record<string, string>;
  masked: readonly string[];
  done: boolean;
}) {
  const { values, set, save, saving, message, fallback } = useSectionForm({ initial, masked, area: 'ai' });

  const providerValue = values.AI_PROVIDER || 'openrouter';
  const provider = PROVIDERS.find((p) => p.value === providerValue) ?? PROVIDERS[0];
  const apiKey = values[provider.keyVar] ?? '';

  return (
    <Section
      title="AI"
      done={done}
      blurb="Optional — every AI feature degrades gracefully without a key, and the rest of the app is unaffected. Nothing leaves your machine except the calls you configure here."
    >
      <SelectField
        label="Provider"
        value={providerValue}
        onChange={(v) => set('AI_PROVIDER', v)}
        options={PROVIDERS.map((p) => ({ value: p.value, label: p.label }))}
      />

      <Field
        label="API key"
        value={apiKey}
        onChange={(v) => set(provider.keyVar, v)}
        secret
        help={
          <>
            Get one at{' '}
            <a
              href={provider.url}
              target="_blank"
              rel="noreferrer"
              className="text-cobalt underline underline-offset-2"
            >
              {provider.where}
            </a>
            . Stored in <code className="bg-deep rounded px-1 text-ondark">.env</code> on this
            machine.
          </>
        }
      />

      <TestButton
        label="Test key"
        run={() =>
          testAi({
            provider: providerValue,
            apiKey,
            model: values[`${provider.prefix}_COACH_MODEL`] || values[`${provider.prefix}_MODEL`] || '',
          })
        }
      />

      <div className="pt-2 border-t border-hairline space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap pt-4">
          <p className="text-[13px] text-stone leading-relaxed max-w-xl">
            Five slots, because the features want opposite things. Leave a slot
            blank to fall back to the default model. Model names go stale — the
            free tier especially — so treat any suggestion as a starting point.
          </p>
          {providerValue === 'openrouter' && (
            <button
              type="button"
              onClick={() => {
                for (const [key, value] of Object.entries(RECOMMENDED)) set(key, value);
              }}
              className="rounded-full border border-hairline px-4 py-1.5 text-[13px] text-mute hover:text-ondark shrink-0"
            >
              Use the recommended starting set
            </button>
          )}
        </div>

        {SLOTS.map((s) => {
          const key = `${provider.prefix}_${s.slot}`;
          return (
            <Field
              key={key}
              label={s.label}
              value={values[key] ?? ''}
              onChange={(v) => set(key, v)}
              help={s.help}
            />
          );
        })}
      </div>

      <SaveBar onSave={save} saving={saving} message={message} fallback={fallback} />
    </Section>
  );
}
