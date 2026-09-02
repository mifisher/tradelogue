import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import 'dotenv/config';

// Without this, pg silently falls back to its defaults and fails much later
// with `database "<your-username>" does not exist`, which points at nothing.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Copy the template and fill it in:\n' +
      '  cp .env.example .env\n' +
      'See "Getting started" in the README for creating the database.',
  );
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);
