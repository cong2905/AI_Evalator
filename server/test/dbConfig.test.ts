import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '../src/env.js';
import { describeDbTarget, resolveDbConfig } from '../src/db/db.js';

/**
 * Where the database lives is the one thing that differs between a developer's
 * machine and the deployed app, so it is worth pinning down rather than
 * discovering on a host.
 */
const ORIGINAL = {
  DB_PATH: process.env.DB_PATH,
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
};

function configure(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
}

afterEach(() => {
  configure(ORIGINAL);
});

describe('resolveDbConfig', () => {
  it('uses the local file named by DB_PATH', () => {
    configure({ DB_PATH: ':memory:', TURSO_DATABASE_URL: undefined, TURSO_AUTH_TOKEN: undefined });

    expect(resolveDbConfig()).toEqual({ url: ':memory:' });
  });

  it('prefers the hosted database over DB_PATH, and carries the token', () => {
    configure({
      DB_PATH: ':memory:',
      TURSO_DATABASE_URL: 'libsql://db-example.turso.io',
      TURSO_AUTH_TOKEN: 'secret-token',
    });

    expect(resolveDbConfig()).toEqual({
      url: 'libsql://db-example.turso.io',
      authToken: 'secret-token',
    });
  });

  it('turns a filesystem path into a url libSQL accepts', () => {
    // Windows path separators are not URL separators, so a raw path would be
    // read as an escape sequence rather than a directory.
    configure({ DB_PATH: 'data/app.db', TURSO_DATABASE_URL: undefined });

    const { url } = resolveDbConfig();
    expect(url.startsWith('file:')).toBe(true);
    expect(url).not.toContain('\\');
  });
});

describe('describeDbTarget', () => {
  it('names the host, and never leaks the auth token into the startup log', () => {
    configure({
      TURSO_DATABASE_URL: 'libsql://db-example.turso.io',
      TURSO_AUTH_TOKEN: 'secret-token',
    });

    const described = describeDbTarget();
    expect(described).toBe('db-example.turso.io');
    expect(described).not.toContain('secret-token');
  });

  it('reports a local database as its url', () => {
    configure({ DB_PATH: ':memory:', TURSO_DATABASE_URL: undefined, TURSO_AUTH_TOKEN: undefined });

    expect(describeDbTarget()).toBe(':memory:');
  });
});
