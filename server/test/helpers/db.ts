import type { InValue } from '@libsql/client';
import { getDb } from '../../src/db/db.js';
import { all, count, get, run } from '../../src/db/sql.js';

/**
 * Raw-SQL access for assertions, so a test can check what actually landed in a
 * table without repeating the await-the-connection-then-unwrap-the-ResultSet
 * dance on every line.
 */
export async function one<T>(sql: string, args: InValue[] = []): Promise<T | undefined> {
  return get<T>(await getDb(), sql, args);
}

export async function many<T>(sql: string, args: InValue[] = []): Promise<T[]> {
  return all<T>(await getDb(), sql, args);
}

export async function exec(sql: string, args: InValue[] = []): Promise<void> {
  await run(await getDb(), sql, args);
}

/** `rows('jobs')`, or `rows('resumes', 'is_default = 1')`. */
export async function rows(table: string, where?: string, args: InValue[] = []): Promise<number> {
  const sql = `SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ''}`;
  return count(await getDb(), sql, args);
}
