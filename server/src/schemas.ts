import { z } from 'zod';
import { LIMITS } from '@app/shared';
import { ApiError } from './errors.js';

/** Multipart fields arrive as strings, so accept both shapes. */
const booleanish = z.union([
  z.boolean(),
  z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1'),
]);

export const saveResumeBodySchema = z.object({
  text: z.string().optional(),
  label: z.string().trim().min(1).max(200).optional(),
  setDefault: booleanish.default(true),
});
export type SaveResumeBody = z.infer<typeof saveResumeBodySchema>;

export const idParamSchema = z.coerce.number().int().positive();

/** Turns a zod failure into the API's VALIDATION_ERROR shape. */
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ');
    throw new ApiError('VALIDATION_ERROR', detail);
  }
  return result.data;
}

const nf = new Intl.NumberFormat('en-US');

/**
 * Length rules live here rather than in zod because under-length is a 400 and
 * over-length is a 413 that must say how much to cut (SPEC.md section 5).
 */
export function assertLength(
  value: string,
  fieldLabel: string,
  { min, max }: { min: number; max: number },
): string {
  const text = value.trim();

  if (text.length > max) {
    const over = text.length - max;
    throw new ApiError(
      'INPUT_TOO_LONG',
      `${fieldLabel} is ${nf.format(text.length)} characters. Cut ${nf.format(over)} to fit the ${nf.format(max)} character limit.`,
    );
  }
  if (text.length < min) {
    throw new ApiError(
      'VALIDATION_ERROR',
      `${fieldLabel} is ${nf.format(text.length)} characters; at least ${nf.format(min)} are needed.`,
    );
  }
  return text;
}

export const RESUME_LIMITS = LIMITS.resumeText;
