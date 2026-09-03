'use client';

import { useState, useTransition } from 'react';
import { Section, Field, TestButton, SaveBar } from './field';
import { useSectionForm } from './use-section-form';
import { testDatabase, runMigrations } from '@/lib/setup/actions';

const NATIVE = 'postgresql://trader:trader@localhost:5432/tradelogue';
// docker-compose.yml publishes 5433 so it does not fight a native install.
const DOCKER = 'postgresql://trader:trader@localhost:5433/tradelogue';

export function DatabaseSection({
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
    area: 'database',
  });
  const [schemaReady, setSchemaReady] = useState<boolean | null>(null);
  const [migrating, startMigration] = useTransition();
  const [migrationOutput, setMigrationOutput] = useState<string | null>(null);

  const url = values.DATABASE_URL ?? '';

  return (
    <Section
      title="Database"
      done={done}
      blurb={
        <>
          Tradelogue keeps everything in your own Postgres — nothing is hosted.
          Install it natively with{' '}
          <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">
            brew install postgresql@16
          </code>{' '}
          then{' '}
          <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">
            createdb -O trader tradelogue
          </code>
          , or run{' '}
          <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">docker compose up -d</code>{' '}
          from the repo.
        </>
      }
    >
      <Field
        label="Connection string"
        value={url}
        onChange={(v) => set('DATABASE_URL', v)}
        placeholder={NATIVE}
        secret
        help="Contains your database password, so it is stored masked."
      />

      <div className="flex gap-2 flex-wrap">
        {[
          { label: 'Use native default (5432)', value: NATIVE },
          { label: 'Use Docker default (5433)', value: DOCKER },
        ].map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => set('DATABASE_URL', preset.value)}
            className="rounded-full border border-hairline px-4 py-1.5 text-[13px] text-mute hover:text-ondark"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <TestButton
        label="Test connection"
        run={() => testDatabase(url)}
        onResult={(result) => setSchemaReady(result.ok ? result.schemaReady : null)}
      />

      {schemaReady === false && (
        <div className="space-y-3">
          <button
            type="button"
            disabled={migrating}
            onClick={() =>
              startMigration(async () => {
                const result = await runMigrations(url);
                setMigrationOutput(result.output || 'Done.');
                if (result.ok) setSchemaReady(true);
              })
            }
            className="h-10 rounded-full bg-cobalt px-5 text-sm font-semibold text-on-cobalt disabled:opacity-50"
          >
            {migrating ? 'Creating schema…' : 'Create schema & seed'}
          </button>
          <p className="text-[13px] text-stone">
            Runs <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">npm run db:push</code>{' '}
            and{' '}
            <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">npm run seed:setups</code>.
            You can run those yourself in a terminal instead.
          </p>
        </div>
      )}

      {migrationOutput && (
        <pre className="rounded-[12px] bg-deep p-4 text-[12px] text-mute overflow-x-auto max-h-64">
          {migrationOutput}
        </pre>
      )}

      <SaveBar onSave={save} saving={saving} message={message} fallback={fallback} />
    </Section>
  );
}
