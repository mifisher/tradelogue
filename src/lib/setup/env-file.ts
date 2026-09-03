import { readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';

export const ENV_PATH = join(process.cwd(), '.env');
export const ENV_EXAMPLE_PATH = join(process.cwd(), '.env.example');

const ASSIGNMENT = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const COMMENTED_ASSIGNMENT = /^\s*#\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** Read a single value the way dotenv does, so the wizard never shows a value
 * that differs from the one the running process actually loaded. */
function readValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length > 1)
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  // Unquoted values end at an inline comment; quoted ones keep the '#'.
  const hash = trimmed.indexOf('#');
  return (hash === -1 ? trimmed : trimmed.slice(0, hash)).trim();
}

export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    const match = ASSIGNMENT.exec(line);
    if (match) out[match[1]] = readValue(match[2]);
  }
  return out;
}

/** Quote only when the bare form would not survive a re-read. A '#' is the
 * dangerous one: written bare, dotenv truncates the value at it. */
function writeValue(value: string): string {
  if (value === '') return '';
  if (/^[A-Za-z0-9_\-./:@+,=?&%[\]~]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function upsertEnvContents(
  contents: string,
  updates: Record<string, string>,
): string {
  const lines = contents.split('\n');
  const pending = new Set(Object.keys(updates));

  const replaceFirst = (test: (line: string) => boolean, key: string) => {
    const index = lines.findIndex(test);
    if (index === -1) return false;
    lines[index] = `${key}=${writeValue(updates[key])}`;
    return true;
  };

  for (const key of Object.keys(updates)) {
    const assigned = (line: string) => ASSIGNMENT.exec(line)?.[1] === key;
    const commented = (line: string) => COMMENTED_ASSIGNMENT.exec(line)?.[1] === key;
    if (replaceFirst(assigned, key) || replaceFirst(commented, key)) pending.delete(key);
  }

  if (pending.size > 0) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    for (const key of pending) lines.push(`${key}=${writeValue(updates[key])}`);
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function readEnvFile(envPath: string = ENV_PATH): Promise<Record<string, string>> {
  return parseEnvFile((await readIfPresent(envPath)) ?? '');
}

export async function writeEnvUpdates(
  updates: Record<string, string>,
  opts: { envPath?: string; examplePath?: string } = {},
): Promise<void> {
  const envPath = opts.envPath ?? ENV_PATH;
  const examplePath = opts.examplePath ?? ENV_EXAMPLE_PATH;

  // Seeding from the template means a first-time user ends up with the
  // annotated file the README describes, not a bare list of keys.
  const base =
    (await readIfPresent(envPath)) ?? (await readIfPresent(examplePath)) ?? '';

  await writeFile(envPath, upsertEnvContents(base, updates), { mode: 0o600 });
  await chmod(envPath, 0o600); // An existing file keeps its old mode without this.
}
