import { describe, it, expect } from 'vitest';
import { setupPayload } from './form-payload';

const INITIAL = {
  OPENROUTER_API_KEY: 'sk-or-…cdef', // as displayed: a mask, not the real key
  OPENROUTER_MODEL: 'openrouter/free',
};
const MASKED = ['OPENROUTER_API_KEY'];

describe('setupPayload', () => {
  // The one that would destroy a working install: submitting the mask writes
  // the literal string "sk-or-…cdef" over the user's real key.
  it('drops an untouched masked secret', () => {
    expect(setupPayload({ ...INITIAL }, INITIAL, MASKED)).toEqual({});
  });

  it('includes a secret the user actually retyped', () => {
    const values = { ...INITIAL, OPENROUTER_API_KEY: 'sk-or-new' };
    expect(setupPayload(values, INITIAL, MASKED)).toEqual({ OPENROUTER_API_KEY: 'sk-or-new' });
  });

  // Belt and braces: even if a field is somehow marked changed, a value that is
  // still the mask is never a real credential.
  it('never submits a value that still looks like its mask', () => {
    const values = { ...INITIAL, OPENROUTER_API_KEY: 'sk-or-…cdef' };
    // initial is empty, so every other field counts as changed — the claim
    // here is only that the masked one is withheld regardless.
    expect(setupPayload(values, {}, MASKED)).not.toHaveProperty('OPENROUTER_API_KEY');
  });

  it('drops an unchanged plain value', () => {
    expect(setupPayload({ ...INITIAL }, INITIAL, MASKED)).not.toHaveProperty('OPENROUTER_MODEL');
  });

  it('includes a changed plain value', () => {
    const values = { ...INITIAL, OPENROUTER_MODEL: 'z-ai/glm-5.3-flash' };
    expect(setupPayload(values, INITIAL, MASKED)).toEqual({ OPENROUTER_MODEL: 'z-ai/glm-5.3-flash' });
  });

  // Clearing a field is a change the user meant, so it has to reach the file.
  it('includes a value the user cleared', () => {
    const values = { ...INITIAL, OPENROUTER_MODEL: '' };
    expect(setupPayload(values, INITIAL, MASKED)).toEqual({ OPENROUTER_MODEL: '' });
  });

  it('includes a key that was not present before', () => {
    expect(setupPayload({ FINNHUB_API_KEY: 'fh-1' }, {}, [])).toEqual({ FINNHUB_API_KEY: 'fh-1' });
  });
});
