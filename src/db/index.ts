import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import 'dotenv/config';

/** Distinct from a query failure: the app is not set up yet, and the caller
 * (root layout, error boundary) should send the user to /setup rather than
 * report a broken database. */
export class DatabaseNotConfiguredError extends Error {}

let real: NodePgDatabase | null = null;

function connect(): NodePgDatabase {
  if (!process.env.DATABASE_URL) {
    // Without this, pg silently falls back to its defaults and fails much later
    // with `database "<your-username>" does not exist`, which points at nothing.
    throw new DatabaseNotConfiguredError(
      'DATABASE_URL is not set. Open http://localhost:3000 and the setup wizard ' +
        'will walk you through it, or copy the template and fill it in:\n' +
        '  cp .env.example .env',
    );
  }
  real ??= drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));
  return real;
}

/** Lazy so that a missing DATABASE_URL is a catchable runtime error rather than
 * a module-evaluation crash that takes down every route including /setup. */
export const db = new Proxy({} as NodePgDatabase, {
  get(_target, prop) {
    const target = connect();
    const value = Reflect.get(target, prop) as unknown;
    // Drizzle's query builders are `this`-dependent; handing back an unbound
    // function reference breaks every call site.
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
