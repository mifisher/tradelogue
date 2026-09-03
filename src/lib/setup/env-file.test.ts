import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseEnvFile,
  upsertEnvContents,
  readEnvFile,
  writeEnvUpdates,
} from './env-file';

const SAMPLE = `# A comment worth keeping
DATABASE_URL=postgresql://trader:trader@localhost:5432/tradelogue

# ── AI provider ──
OPENROUTER_API_KEY=
# OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
`;

describe('parseEnvFile', () => {
  it('reads keys and skips comments and blanks', () => {
    expect(parseEnvFile(SAMPLE)).toEqual({
      DATABASE_URL: 'postgresql://trader:trader@localhost:5432/tradelogue',
      OPENROUTER_API_KEY: '',
    });
  });

  it('strips surrounding quotes', () => {
    expect(parseEnvFile('K="a value"')).toEqual({ K: 'a value' });
  });

  // Matches how dotenv itself loads the file, which is what actually populates
  // process.env at boot — diverging here would mean the wizard shows one value
  // and the app uses another.
  it('drops an inline comment from an unquoted value but keeps it inside quotes', () => {
    expect(parseEnvFile('K=value # trailing')).toEqual({ K: 'value' });
    expect(parseEnvFile('K="value # kept"')).toEqual({ K: 'value # kept' });
  });
});

describe('upsertEnvContents', () => {
  it('replaces an existing key in place, leaving everything else alone', () => {
    const out = upsertEnvContents(SAMPLE, { OPENROUTER_API_KEY: 'sk-or-abc' });
    expect(out).toContain('OPENROUTER_API_KEY=sk-or-abc');
    expect(out).toContain('# A comment worth keeping');
    expect(out).toContain('DATABASE_URL=postgresql://trader:trader@localhost:5432/tradelogue');
    expect(out.match(/^OPENROUTER_API_KEY=/gm)).toHaveLength(1);
  });

  it('uncomments a commented-out key rather than appending a duplicate', () => {
    const out = upsertEnvContents(SAMPLE, { OPENROUTER_BASE_URL: 'https://example.test/v1' });
    expect(out).toContain('OPENROUTER_BASE_URL=https://example.test/v1');
    expect(out).not.toContain('# OPENROUTER_BASE_URL=https://openrouter.ai/api/v1');
    expect(out.match(/OPENROUTER_BASE_URL=/gm)).toHaveLength(1);
  });

  it('appends a key that is absent entirely', () => {
    const out = upsertEnvContents(SAMPLE, { FINNHUB_API_KEY: 'fh-1' });
    expect(out).toMatch(/FINNHUB_API_KEY=fh-1\n$/);
  });

  // A '#' in a value is the case that silently truncates if it is written bare:
  // dotenv would read everything before the '#' and the key would look wrong
  // for no visible reason.
  it('quotes a value containing a comment character so it survives a round trip', () => {
    const out = upsertEnvContents(SAMPLE, { DATABASE_URL: 'postgresql://u:p#1@localhost/db' });
    expect(parseEnvFile(out).DATABASE_URL).toBe('postgresql://u:p#1@localhost/db');
  });

  it('quotes a value containing whitespace', () => {
    expect(parseEnvFile(upsertEnvContents(SAMPLE, { K: 'two words' })).K).toBe('two words');
  });

  it('escapes an embedded double quote', () => {
    expect(parseEnvFile(upsertEnvContents(SAMPLE, { K: 'a"b' })).K).toBe('a"b');
  });

  it('writes an empty value as a bare assignment', () => {
    expect(upsertEnvContents(SAMPLE, { OPENROUTER_API_KEY: '' })).toContain('OPENROUTER_API_KEY=\n');
  });

  it('applies several updates at once', () => {
    const parsed = parseEnvFile(
      upsertEnvContents(SAMPLE, { OPENROUTER_API_KEY: 'a', FINNHUB_API_KEY: 'b' }),
    );
    expect(parsed).toMatchObject({ OPENROUTER_API_KEY: 'a', FINNHUB_API_KEY: 'b' });
  });
});

describe('writeEnvUpdates', () => {
  it('seeds from the example template when .env does not exist yet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tradelogue-env-'));
    const envPath = join(dir, '.env');
    const examplePath = join(dir, '.env.example');
    await writeFile(examplePath, SAMPLE);

    await writeEnvUpdates({ OPENROUTER_API_KEY: 'sk-or-abc' }, { envPath, examplePath });

    const written = await readFile(envPath, 'utf8');
    // The point of seeding: the user inherits the template's comments rather
    // than a bare key dump they cannot navigate later.
    expect(written).toContain('# A comment worth keeping');
    expect(written).toContain('OPENROUTER_API_KEY=sk-or-abc');
  });

  it('writes the file owner-only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tradelogue-env-'));
    const envPath = join(dir, '.env');
    await writeFile(envPath, SAMPLE);

    await writeEnvUpdates({ OPENROUTER_API_KEY: 'sk-or-abc' }, { envPath, examplePath: join(dir, '.env.example') });

    expect((await stat(envPath)).mode & 0o777).toBe(0o600);
  });

  it('round-trips through readEnvFile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tradelogue-env-'));
    const envPath = join(dir, '.env');
    await writeFile(envPath, SAMPLE);

    await writeEnvUpdates({ FINNHUB_API_KEY: 'fh-1' }, { envPath, examplePath: join(dir, '.env.example') });

    expect(await readEnvFile(envPath)).toMatchObject({ FINNHUB_API_KEY: 'fh-1' });
  });

  it('starts an empty file when neither .env nor the template exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tradelogue-env-'));
    const envPath = join(dir, '.env');

    await writeEnvUpdates({ FINNHUB_API_KEY: 'fh-1' }, { envPath, examplePath: join(dir, '.env.example') });

    expect(await readEnvFile(envPath)).toEqual({ FINNHUB_API_KEY: 'fh-1' });
  });
});
