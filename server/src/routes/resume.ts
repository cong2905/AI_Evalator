import { Router } from "express";
import multer from "multer";
import {
  LIMITS,
  type DefaultResume,
  type ParseResumeResponse,
  type Resume,
} from "@app/shared";
import { ApiError, wrap } from "../errors.js";
import { getDb } from "../db/db.js";
import {
  getDefaultResume,
  insertResume,
} from "../db/repositories/resumeRepo.js";
import { parseResumeUpload } from "../services/resumeParser.js";
import {
  assertLength,
  parseOrThrow,
  saveResumeBodySchema,
} from "../schemas.js";

/** Memory storage — resume files are never written to disk (SPEC.md section 9). */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.uploadBytes, files: 1 },
});

/** Passes non-multipart requests straight through, so POST /api/resume takes JSON too. */
const singleFile = upload.single("file");

export const resumeRouter: Router = Router();

resumeRouter.get("/resume/default", (req, res) => {
  const resume = getDefaultResume(getDb(), req.sessionId);
  if (!resume) {
    throw new ApiError("NOT_FOUND", "No default resume saved yet.");
  }

  const body: DefaultResume = {
    id: resume.id,
    label: resume.label,
    content: resume.content,
    updatedAt: resume.updatedAt,
  };
  res.json(body);
});

resumeRouter.post(
  "/resume/parse",
  singleFile,
  wrap(async (req, res) => {
    if (!req.file) {
      throw new ApiError(
        "VALIDATION_ERROR",
        'Attach a PDF or DOCX file as "file".',
      );
    }

    const text = await parseResumeUpload(
      req.file.originalname,
      req.file.mimetype,
      req.file.buffer,
    );
    const body: ParseResumeResponse = { text };
    res.json(body);
  }),
);

resumeRouter.post(
  "/resume",
  singleFile,
  wrap(async (req, res) => {
    const body = parseOrThrow(saveResumeBodySchema, req.body ?? {});

    let text: string;
    let label: string;

    if (req.file) {
      text = await parseResumeUpload(
        req.file.originalname,
        req.file.mimetype,
        req.file.buffer,
      );
      label = body.label ?? req.file.originalname;
    } else if (body.text !== undefined) {
      text = body.text;
      label = body.label ?? "Pasted resume";
    } else {
      throw new ApiError(
        "VALIDATION_ERROR",
        'Send a resume file or a "text" field.',
      );
    }

    const content = assertLength(text, "Resume text", LIMITS.resumeText);
    const saved: Resume = insertResume(getDb(), {
      label: label.slice(0, 200),
      content,
      setDefault: body.setDefault,
      sessionId: req.sessionId,
    });

    console.log(
      `[resume] saved #${saved.id} "${saved.label}" (${content.length} chars, default=${saved.isDefault})`,
    );
    res.status(201).json(saved);
  }),
);
