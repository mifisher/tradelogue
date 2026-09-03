'use client';

import Link from 'next/link';

/** The state this exists for: DATABASE_URL is set, so the wizard gate lets the
 * app through, but the schema has never been pushed. Without this the user
 * meets a Next.js stack trace on their first page load. */
export default function Error({ error }: { error: Error & { digest?: string } }) {
  const databaseProblem = /DATABASE_URL|relation .* does not exist|ECONNREFUSED/i.test(
    error.message,
  );

  return (
    <main className="max-w-xl mx-auto px-6 py-16 space-y-5">
      <h1 className="font-display text-2xl text-ondark">
        {databaseProblem ? 'The database is not ready' : 'Something went wrong'}
      </h1>
      <p className="text-mute text-sm leading-relaxed">
        {databaseProblem
          ? 'Tradelogue could reach this page but not its database. The setup page can test the connection and create the schema.'
          : error.message}
      </p>
      {databaseProblem && (
        <Link
          href="/setup"
          className="h-11 inline-flex items-center rounded-full bg-ondark px-6 font-semibold text-canvas"
        >
          Open setup
        </Link>
      )}
    </main>
  );
}
