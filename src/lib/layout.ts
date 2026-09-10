/** Page shell widths. The dashboard runs wide to fit its two-column rail; the
 * coach transcript runs narrow for reading; everything else is the standard
 * column.
 *
 * The header always uses PAGE_WIDE, whatever page is mounted. It used to track
 * each page's width so the brand lined up with the content below, but that
 * moved the brand on every navigation — and at the narrower widths squeezed the
 * nav into its scroll container, where the active link scrolled its neighbours
 * out of view. */
export const PAGE_WIDE = 'max-w-[1600px]';
export const PAGE_DEFAULT = 'max-w-[1200px]';
export const PAGE_NARROW = 'max-w-[1100px]';
