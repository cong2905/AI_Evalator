import type { InValue, ResultSet } from '@libsql/client';

/**
 * libSQL is an async, network-capable driver, so every query returns a promise
 * even when it is talking to a local file. These four helpers put the shapes the
 * repositories actually want — a row, a list, a count, a write result — back on
 * top of `execute`, so the SQL stays the thing you read in each repository
 * rather than ResultSet plumbing.
 *
 * `Queryable` is deliberately narrower than `Client`: a libSQL `Transaction`
 * exposes the same `execute`, so every helper works unchanged inside one.
 */
export type Queryable = {
  execute(stmt: { sql: string; args: InValue[] }): Promise<ResultSet>;
};

export type WriteResult = {
  /** Rows the statement changed, named to match what the callers already expect. */
  changes: number;
  /** Narrowed from libSQL's bigint; SQLite rowids here are far inside Number range. */
  lastInsertRowid: number;
};

/**
 * Rows arrive as libSQL `Row` objects, which are addressable by column name but
 * carry an index signature that fights the precise row types the repositories
 * declare. The cast is the one place that bridges the two.
 */
function asRows<T>(rs: ResultSet): T[] {
  return rs.rows as unknown as T[];
}

export async function all<T>(db: Queryable, sql: string, args: InValue[] = []): Promise<T[]> {
  return asRows<T>(await db.execute({ sql, args }));
}

export async function get<T>(
  db: Queryable,
  sql: string,
  args: InValue[] = [],
): Promise<T | undefined> {
  return asRows<T>(await db.execute({ sql, args }))[0];
}

export async function run(
  db: Queryable,
  sql: string,
  args: InValue[] = [],
): Promise<WriteResult> {
  const rs = await db.execute({ sql, args });
  return { changes: rs.rowsAffected, lastInsertRowid: Number(rs.lastInsertRowid ?? 0) };
}

/** For `SELECT COUNT(*) AS n ...`, which is otherwise three lines of unwrapping. */
export async function count(db: Queryable, sql: string, args: InValue[] = []): Promise<number> {
  const row = await get<{ n: number | bigint }>(db, sql, args);
  return Number(row?.n ?? 0);
}
