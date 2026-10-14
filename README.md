# AI Job Evaluator

Find out how well your resume matches a job before you apply. Paste a job description, and the
app reads it next to your resume and goes through it requirement by requirement: what the job asks
for, how much it matters, what you have that covers it, and what's missing. It ends with a match
percentage and a list of keywords to think about adding.

Every evaluation is saved, so you build up a list of the jobs you've checked and can compare them
later.

## User guide

### 1. Add your resume

- **Upload** a PDF or Word (`.docx`) file up to 5 MB, or **paste** the text.
- The text from your upload is shown so you can check it before you go on. A scanned PDF has no
  real text in it. If the app says "No text found", paste your resume instead.
- Leave **Save as my default resume** ticked and your resume will be filled in for you next time.

Just looking around? Press **Try with sample data** to fill in a made-up resume and job.

### 2. Describe the job

Fill in the **job name**, the **company**, and paste the full **job description**. The **Evaluate**
button turns on once every field is filled in and within its length limit.

### 3. Read the result

An evaluation usually takes a few seconds. You get:

- **Match score**: a percentage based on how many of the job's requirements you meet.
- **Summary**: a short plain-language overview.
- **Comparison table**: one row per requirement:

  | Column | Meaning |
  |---|---|
  | What they ask | A requirement taken from the job description |
  | Importance | **Must-have** or **nice-to-have** |
  | What you have | The part of your resume that covers it, if any |
  | Status | **Met**, **Partial**, or **Missing** |

- **Missing keywords**: words from the job description that your resume doesn't use.

#### How the score is calculated

A must-have requirement counts twice as much as a nice-to-have. A met requirement gets full
credit, a partial one gets half, and a missing one gets nothing. So two people can meet the same
number of requirements and still get different scores, depending on which ones they meet.

### 4. Look through your saved jobs

Open **Jobs** to see every evaluation, newest first.

- **Search** by job name or company.
- **View details** opens the full comparison table again.
- **Delete** removes one evaluation for good.

### Using it on another device

Your data is tied to the browser you use, and there's no account or password. To see the same
jobs on your phone or another browser:

1. On the device that has your data, press **Get a code**.
2. On the other device, type the code under **Have a code?** and press **Use code**.

A code works once and expires after **10 minutes**. Any evaluations already on the second device
are hidden once you use a code there.

**Delete everything** removes every evaluation and resume stored for this device.

### Limits

| Field | Limit |
|---|---|
| Resume text | 200 – 10,000 characters |
| Job description | 50 – 8,000 characters |
| Job name / company | 1 – 120 characters |
| Upload | 5 MB, `.pdf` or `.docx` |
| Evaluations | 5 per person per day on the public site |

If a field is too long, the app tells you how many characters to cut. If the AI service is busy,
the **Evaluate** button shows a countdown and turns back on when it's done. You don't have to do
anything.

### Your privacy

- Your resume is sent to the AI service only when you press **Evaluate**, and only for that one
  evaluation.
- Your resume text is never written to the server logs.
- On the public site, your data is deleted after **7 days without a visit**. Each visit resets
  the timer.
- You can delete one job, or everything, whenever you like.

### Common problems

| What you see | What to do |
|---|---|
| "No text found in that PDF" | The PDF is probably a scan. Paste the text instead |
| "Cut N characters" | Shorten that field by the amount shown |
| A countdown on the Evaluate button | The AI service is busy. Wait and it turns back on |
| Daily limit reached | The limit resets at midnight UTC |
| Your jobs are gone on a new browser | Use **Get a code** to move them across |

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | **React 18**, **TypeScript**, **Vite**, CSS Modules | Fast, typed UI. CSS Modules keep each component's styles separate |
| Routing | **React Router** | Switches between the Evaluate and Jobs pages without reloading |
| Backend | **Node.js** + **Express** | A small API that handles uploads, evaluations, and saved jobs |
| AI model | **Groq API** running `openai/gpt-oss-120b` | Very fast responses, which keeps an evaluation down to a few seconds |
| Database | **SQLite** via `better-sqlite3` | A single file with no separate database server |
| File parsing | **pdf-parse**, **mammoth** | Pull the text out of PDF and Word files |
| Validation | **Zod** | Checks every request and every AI response before it's used |
| Protection | **express-rate-limit**, signed cookies | Limits per IP address, per visitor, and for the whole site |
| Testing | **Vitest** | Server and component tests. The tests never call the real AI service |
| Hosting | **Docker** on **Fly.io** | One container that serves both the website and the API |

### How it works

```
 Browser (React)                Server (Express)                  Groq
 ───────────────                ────────────────                  ────
 resume + job  ──── POST ────▶  check lengths & limits
                                build prompt  ─────────────────▶  model reads both,
                                                                  returns JSON
                                check JSON with Zod  ◀──────────
                                calculate score (in code, not by the model)
                                save to SQLite
 result table  ◀─── JSON ─────
```

- **The AI compares, the code scores.** The model only judges each requirement as met, partial, or
  missing. The percentage is calculated by the server, so the same judgements always give the
  same score.
- **Structured output.** The model has to answer in a fixed JSON shape. If the answer doesn't
  match, the request is retried before you'd ever see an error.
- **Sessions without accounts.** Each browser gets a signed cookie that links it to its own data.
  A transfer code links a second browser to the same data.
- **Shared types.** Request and response types are defined once
  (`shared/`) and used by both, so the two sides can't fall out of step.

---

Running, testing, or deploying the app yourself? See [DEVELOPMENT.md](DEVELOPMENT.md).
