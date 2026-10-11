import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { ApiError } from '../errors.js';

export type UploadKind = 'pdf' | 'docx';

type UploadRules = {
  /** MIME types browsers realistically send for this kind. */
  mimeTypes: readonly string[];
  /** First bytes of a valid file, checked so a renamed .txt cannot sneak through. */
  magic: readonly number[];
};

const RULES: Record<UploadKind, UploadRules> = {
  pdf: {
    mimeTypes: ['application/pdf', 'application/x-pdf', 'application/octet-stream'],
    magic: [0x25, 0x50, 0x44, 0x46], // %PDF
  },
  docx: {
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/octet-stream',
    ],
    magic: [0x50, 0x4b, 0x03, 0x04], // PK.. (zip container)
  },
};

export function kindFromFilename(filename: string): UploadKind | undefined {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  return undefined;
}

/**
 * Extension, MIME type and magic bytes must all agree before we hand the
 * buffer to a parser (SPEC.md section 9).
 */
export function assertSupportedUpload(
  filename: string,
  mimetype: string,
  buffer: Buffer,
): UploadKind {
  const kind = kindFromFilename(filename);
  if (!kind) {
    throw new ApiError('VALIDATION_ERROR', 'Only .pdf and .docx resumes are supported.');
  }

  const rules = RULES[kind];
  if (!rules.mimeTypes.includes(mimetype)) {
    throw new ApiError(
      'VALIDATION_ERROR',
      `That .${kind} file was sent as "${mimetype}", which is not a ${kind.toUpperCase()} content type.`,
    );
  }

  const header = rules.magic.every((byte, i) => buffer[i] === byte);
  if (!header) {
    throw new ApiError('PARSE_FAILED', `That file is not really a ${kind.toUpperCase()} file.`);
  }

  return kind;
}

/** Keeps the textarea readable: one line ending, no runs of blank lines. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0\u200b]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    // pageJoiner defaults to per-page "-- 1 of 3 --" markers; a resume wants plain text.
    const result = await parser.getText({ pageJoiner: '' });
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

/**
 * Parses an uploaded resume to plain text. Throws PARSE_FAILED when the file is
 * unreadable or holds no text (a scanned PDF, typically).
 */
export async function parseResumeUpload(
  filename: string,
  mimetype: string,
  buffer: Buffer,
): Promise<string> {
  const kind = assertSupportedUpload(filename, mimetype, buffer);

  let raw: string;
  try {
    raw = kind === 'pdf' ? await extractPdf(buffer) : await extractDocx(buffer);
  } catch (err) {
    // Don't surface library internals (or any resume content) to the client.
    console.error(`[resume] ${kind} parse failed:`, err instanceof Error ? err.message : err);
    throw new ApiError('PARSE_FAILED', `Could not read that ${kind.toUpperCase()} file.`);
  }

  const text = normalizeText(raw);
  if (!text) {
    throw new ApiError(
      'PARSE_FAILED',
      `No text found in that ${kind.toUpperCase()}. If it is a scan, paste the text instead.`,
    );
  }
  return text;
}
