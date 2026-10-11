import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors.js';
import {
  assertSupportedUpload,
  kindFromFilename,
  normalizeText,
  parseResumeUpload,
} from '../src/services/resumeParser.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (name: string) => fs.readFileSync(path.join(fixtures, name));

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('parseResumeUpload', () => {
  it('extracts text from a PDF', async () => {
    const text = await parseResumeUpload('sample-resume.pdf', PDF_MIME, read('sample-resume.pdf'));

    expect(text).toContain('Jane Doe');
    expect(text).toContain('TypeScript, JavaScript, React');
    expect(text).toContain('B.Sc. Computer Science');
  });

  it('leaves no page markers in the PDF text', async () => {
    const text = await parseResumeUpload('sample-resume.pdf', PDF_MIME, read('sample-resume.pdf'));
    expect(text).not.toMatch(/-- \d+ of \d+ --/);
  });

  it('extracts text from a DOCX', async () => {
    const text = await parseResumeUpload(
      'sample-resume.docx',
      DOCX_MIME,
      read('sample-resume.docx'),
    );

    expect(text).toContain('Jane Doe');
    expect(text).toContain('Northwind');
    expect(text).not.toMatch(/\n{3,}/);
  });

  it('reads the same resume out of both formats', async () => {
    const fromPdf = await parseResumeUpload('r.pdf', PDF_MIME, read('sample-resume.pdf'));
    const fromDocx = await parseResumeUpload('r.docx', DOCX_MIME, read('sample-resume.docx'));

    const words = (s: string) => s.replace(/\s+/g, ' ').trim();
    expect(words(fromDocx)).toBe(words(fromPdf));
  });

  it('rejects a text file renamed to .pdf', async () => {
    await expect(
      parseResumeUpload('not-really.pdf', PDF_MIME, read('not-really.pdf')),
    ).rejects.toMatchObject({ code: 'PARSE_FAILED', status: 422 });
  });

  it('rejects an unsupported extension', async () => {
    await expect(
      parseResumeUpload('resume.txt', 'text/plain', Buffer.from('hello')),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('rejects a PDF sent under a bogus MIME type', () => {
    expect(() => assertSupportedUpload('r.pdf', 'image/png', read('sample-resume.pdf'))).toThrow(
      ApiError,
    );
  });

  it('accepts the generic octet-stream MIME when the bytes check out', () => {
    expect(
      assertSupportedUpload('r.docx', 'application/octet-stream', read('sample-resume.docx')),
    ).toBe('docx');
  });

  it('never leaks resume text into the thrown message', async () => {
    const err = await parseResumeUpload('not-really.pdf', PDF_MIME, read('not-really.pdf')).then(
      () => null,
      (e: unknown) => e as ApiError,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err?.message).not.toContain('plain text wearing');
  });
});

describe('kindFromFilename', () => {
  it('is case insensitive', () => {
    expect(kindFromFilename('Resume.PDF')).toBe('pdf');
    expect(kindFromFilename('Resume.DocX')).toBe('docx');
    expect(kindFromFilename('resume.pages')).toBeUndefined();
  });
});

describe('normalizeText', () => {
  it('normalizes line endings and trims trailing spaces', () => {
    expect(normalizeText('a  \r\nb\r\n')).toBe('a\nb');
  });

  it('collapses runs of blank lines to one', () => {
    expect(normalizeText('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('turns tabs and non-breaking spaces into plain spaces', () => {
    expect(normalizeText('a\tb\u00a0c')).toBe('a b c');
  });
});
