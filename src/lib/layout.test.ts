import { describe, it, expect } from 'vitest';
import { headerWidth, PAGE_WIDE, PAGE_DEFAULT, PAGE_NARROW } from './layout';

describe('headerWidth', () => {
  it('matches the dashboard\'s wide shell so the brand lines up with the hero', () => {
    expect(headerWidth('/')).toBe(PAGE_WIDE);
  });

  it('matches the coach transcript\'s narrow shell', () => {
    expect(headerWidth('/coach')).toBe(PAGE_NARROW);
    expect(headerWidth('/coach/anything')).toBe(PAGE_NARROW);
  });

  it('uses the standard column everywhere else', () => {
    for (const path of ['/market', '/calendar', '/trades', '/setups', '/rules', '/import']) {
      expect(headerWidth(path)).toBe(PAGE_DEFAULT);
    }
  });

  it('keeps nested routes on the standard column, like their pages', () => {
    expect(headerWidth('/day/2026-07-30')).toBe(PAGE_DEFAULT);
    expect(headerWidth('/trade/12345')).toBe(PAGE_DEFAULT);
    expect(headerWidth('/setups/3')).toBe(PAGE_DEFAULT);
  });

  // '/' is the dashboard only when it is exactly '/', or every route would
  // inherit the wide shell from a prefix match.
  it('does not treat every route as the dashboard', () => {
    expect(headerWidth('/coaching-notes')).toBe(PAGE_DEFAULT);
  });
});
