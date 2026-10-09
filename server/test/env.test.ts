import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/env.js';

describe('parseEnv', () => {
  it('fails with an actionable message when GROQ_API_KEY is missing', () => {
    expect(() => parseEnv({})).toThrow(/GROQ_API_KEY/);
    expect(() => parseEnv({})).toThrow(/server\/\.env/);
  });

  it('treats a blank key as missing', () => {
    expect(() => parseEnv({ GROQ_API_KEY: '   ' })).toThrow(/GROQ_API_KEY/);
  });

  it('defaults PORT and GROQ_MODEL', () => {
    const env = parseEnv({ GROQ_API_KEY: 'k' });

    expect(env.PORT).toBe(3001);
    expect(env.GROQ_MODEL).toBe('openai/gpt-oss-120b');
  });

  it('coerces PORT and keeps an overridden model', () => {
    const env = parseEnv({ GROQ_API_KEY: 'k', PORT: '4000', GROQ_MODEL: 'openai/gpt-oss-20b' });

    expect(env.PORT).toBe(4000);
    expect(env.GROQ_MODEL).toBe('openai/gpt-oss-20b');
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => parseEnv({ GROQ_API_KEY: 'k', PORT: 'abc' })).toThrow(/PORT/);
  });
});
