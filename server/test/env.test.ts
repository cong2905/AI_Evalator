import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/env.js';

const VALID = { GROQ_API_KEY: 'k', SESSION_SECRET: 'x'.repeat(32) };

describe('parseEnv', () => {
  it('fails with an actionable message when GROQ_API_KEY is missing', () => {
    expect(() => parseEnv({})).toThrow(/GROQ_API_KEY/);
    expect(() => parseEnv({})).toThrow(/server\/\.env/);
  });

  it('treats a blank key as missing', () => {
    expect(() => parseEnv({ ...VALID, GROQ_API_KEY: '   ' })).toThrow(/GROQ_API_KEY/);
  });

  it('refuses to start without a session secret', () => {
    // Without it the visitor cookie could be forged, so this is fail-fast too.
    expect(() => parseEnv({ GROQ_API_KEY: 'k' })).toThrow(/SESSION_SECRET/);
  });

  it('refuses a session secret that is too short to be random', () => {
    expect(() => parseEnv({ GROQ_API_KEY: 'k', SESSION_SECRET: 'short' })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it('defaults PORT and GROQ_MODEL', () => {
    const env = parseEnv(VALID);

    expect(env.PORT).toBe(3001);
    expect(env.GROQ_MODEL).toBe('openai/gpt-oss-120b');
  });

  it('coerces PORT and keeps an overridden model', () => {
    const env = parseEnv({ ...VALID, PORT: '4000', GROQ_MODEL: 'openai/gpt-oss-20b' });

    expect(env.PORT).toBe(4000);
    expect(env.GROQ_MODEL).toBe('openai/gpt-oss-20b');
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => parseEnv({ ...VALID, PORT: 'abc' })).toThrow(/PORT/);
  });
});
