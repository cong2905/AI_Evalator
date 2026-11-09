import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db.js';
import { count, get, run } from '../sql.js';

/** Crockford base32: no I, L, O or U, so the code cannot be misread aloud. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

/** Short enough to type on a phone, long enough that guessing is hopeless. */
export const TRANSFER_CODE_TTL_MS = 10 * 60 * 1000;

function generateCode(): string {
  // 32 symbols is a power of two, so 5 bits per character is unbiased.
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Accepts what a human types: lower case, missing dash, Crockford look-alikes. */
export function normalizeCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}

function hash(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}

export type NewTransferCode = { code: string; expiresAt: string };

export async function createTransferCode(
  db: Db,
  sessionId: string,
  now = new Date(),
): Promise<NewTransferCode> {
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + TRANSFER_CODE_TTL_MS).toISOString();

  await run(
    db,
    `INSERT INTO transfer_codes (code_hash, session_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`,
    [hash(normalizeCode(code)), sessionId, now.toISOString(), expiresAt],
  );

  return { code, expiresAt };
}

/**
 * Returns the session the code belongs to and burns the code, or undefined if
 * it is unknown, already used, or past its ten minutes. The caller must not
 * distinguish those cases to the client.
 */
export async function redeemTransferCode(
  db: Db,
  input: string,
  now = new Date(),
): Promise<string | undefined> {
  const codeHash = hash(normalizeCode(input));

  const row = await get<{ session_id: string; expires_at: string; used_at: string | null }>(
    db,
    'SELECT session_id, expires_at, used_at FROM transfer_codes WHERE code_hash = ?',
    [codeHash],
  );

  if (!row || row.used_at !== null || row.expires_at <= now.toISOString()) {
    return undefined;
  }

  // Conditional on used_at so that two devices racing the same code cannot both
  // win: whichever UPDATE lands second changes nothing and is refused.
  const burned = await run(
    db,
    'UPDATE transfer_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL',
    [now.toISOString(), codeHash],
  );
  if (burned.changes === 0) return undefined;

  return row.session_id;
}

export async function countLiveCodes(db: Db, now = new Date()): Promise<number> {
  return count(
    db,
    'SELECT COUNT(*) AS n FROM transfer_codes WHERE used_at IS NULL AND expires_at > ?',
    [now.toISOString()],
  );
}
