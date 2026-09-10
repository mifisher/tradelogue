/** The one frame every page renders through, so moving between pages never
 * shifts a title or resizes the content under it.
 *
 * The rail column is reserved on wide screens whether or not the page fills
 * it. That is what keeps the main column the same width on the dashboard,
 * which has a rail, and on every page that does not. Below lg the rail stacks
 * under the main column. */
export function PageShell({
  children,
  rail,
  className = '',
}: {
  children: React.ReactNode;
  rail?: React.ReactNode;
  /** Applied to the main column: spacing, or a reading width for a form. The
   * column stays left-aligned, so a narrow form never re-centres itself. */
  className?: string;
}) {
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 lg:px-8 pt-10 pb-24 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
      <div className={`min-w-0 ${className}`}>{children}</div>
      {rail && <aside className="flex flex-col gap-8">{rail}</aside>}
    </main>
  );
}
