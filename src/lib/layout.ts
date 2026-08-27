/** Page shell widths, in one place so the header can line up with the content
 * beneath it. The dashboard runs wide to fit its two-column rail; the coach
 * transcript runs narrow for reading; everything else is the standard column.
 *
 * The header is a fixed bar above whichever page is mounted, so it has to pick
 * the matching width itself — otherwise the brand and the session stamp float
 * 120px inside the dashboard's hero and rail. */
export const PAGE_WIDE = 'max-w-[1600px]';
export const PAGE_DEFAULT = 'max-w-[1200px]';
export const PAGE_NARROW = 'max-w-[1100px]';

/** The container width the header should adopt for a given route. Keep this in
 * step with the page's own shell: a route whose page uses a non-default width
 * imports the same constant, so the two cannot drift apart silently. */
export function headerWidth(pathname: string): string {
  if (pathname === '/') return PAGE_WIDE;
  if (pathname === '/coach' || pathname.startsWith('/coach/')) return PAGE_NARROW;
  return PAGE_DEFAULT;
}
