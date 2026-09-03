import { describe, it, expect, afterEach, vi } from 'vitest';

// src/db/index.ts imports 'dotenv/config' for the CLI scripts' benefit. Without
// this, deleting DATABASE_URL below would be undone the moment the module is
// imported, because dotenv reads the developer's real .env back in — the suite
// would pass on a machine with no .env and fail on every machine with one.
vi.mock('dotenv/config', () => ({}));

const ORIGINAL = process.env.DATABASE_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL;
});

describe('db', () => {
  // The bug this guards: the previous version threw during module evaluation,
  // so importing anything that touched the database crashed the whole route
  // tree before a setup page could render.
  it('imports without a DATABASE_URL', async () => {
    delete process.env.DATABASE_URL;
    await expect(import('./index')).resolves.toBeDefined();
  });

  it('throws a named, catchable error when a query is attempted unconfigured', async () => {
    delete process.env.DATABASE_URL;
    const { db, DatabaseNotConfiguredError } = await import('./index');
    expect(() => db.select()).toThrow(DatabaseNotConfiguredError);
  });

  it('names the fix in the message', async () => {
    delete process.env.DATABASE_URL;
    const { db } = await import('./index');
    expect(() => db.select()).toThrow(/DATABASE_URL is not set/);
  });
});
