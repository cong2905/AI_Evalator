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

describe('the hosted database settings', () => {
  it('refuses a remote database with no auth token', () => {
    // Otherwise the app boots happily and every query fails with an auth error,
    // which reads as a database fault rather than a missing variable.
    expect(() =>
      parseEnv({ ...VALID, TURSO_DATABASE_URL: 'libsql://db-example.turso.io' }),
    ).toThrow(/TURSO_AUTH_TOKEN/);
  });

  it('accepts a remote database with a token', () => {
    const env = parseEnv({
      ...VALID,
      TURSO_DATABASE_URL: 'libsql://db-example.turso.io',
      TURSO_AUTH_TOKEN: 'token',
    });

    expect(env.TURSO_DATABASE_URL).toBe('libsql://db-example.turso.io');
  });

  it('does not ask for a token for a local libSQL url', () => {
    expect(() => parseEnv({ ...VALID, TURSO_DATABASE_URL: 'file:./local.db' })).not.toThrow();
    expect(() => parseEnv({ ...VALID, TURSO_DATABASE_URL: ':memory:' })).not.toThrow();
  });

  it('is entirely optional, so local development needs neither', () => {
    const env = parseEnv(VALID);

    expect(env.TURSO_DATABASE_URL).toBeUndefined();
    expect(env.TURSO_AUTH_TOKEN).toBeUndefined();
  });
});
