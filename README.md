# AI Job Evaluator

Compare your resume against a job description with an LLM on the Groq API, and keep every
evaluation in a local jobs database. Runs on your machine — no accounts, no hosting, no cloud
storage. See [SPEC.md](SPEC.md) for the full build spec.

- **Evaluate** — upload or paste your resume, paste a job description, get a requirement-by-requirement
  comparison and a match percentage.
- **Jobs database** — every evaluation is saved, searchable, and openable in a detail popup.

## Setup

Needs **Node 20 or newer**.

```bash
npm install
cp .env.example server/.env
```

Open `server/.env` and paste your key from [console.groq.com/keys](https://console.groq.com/keys):

```
GROQ_API_KEY=gsk_your_key_here
GROQ_MODEL=openai/gpt-oss-120b
PORT=3001
```

Then:

```bash
npm run dev
```

- App: **http://localhost:5173**
- API: http://127.0.0.1:3001 (loopback only)

The server refuses to start with a blank `GROQ_API_KEY` and prints what to fix.

## Using it

1. **Resume** — upload a PDF or DOCX, or paste the text. The upload is parsed and shown so you can
   check it before saving. "Save as my default resume" is on by default, so the resume is stored
   when you press Evaluate and reloaded automatically next time.
2. **Job** — fill in job name, company, and paste the job description. Evaluate stays disabled until
   everything is within its limits.
3. **Result** — a score, a short summary, the comparison table (what they ask · importance · what you
   have · status), and the keywords missing from your resume. The evaluation is saved automatically.
4. **Jobs database** — search by job or company, press **View details** for the full table, and
   delete anything you no longer want.

### Limits

Chosen to fit the Groq free plan's 8,000 tokens/minute, which works out to roughly one evaluation
per minute. Going over returns a clear "cut N characters" message rather than failing at the API.

| Field | Limit |
|---|---|
| Resume text | 200 – 10,000 characters |
| Job description | 50 – 8,000 characters |
| Job name / company | 1 – 120 characters |
| Upload size | 5 MB, `.pdf` or `.docx` |

If you hit the rate limit, the Evaluate button shows a countdown and re-enables itself — short waits
are retried automatically by the server.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Express (tsx watch) + Vite together; Vite proxies `/api` to the API |
| `npm test` | Server tests + client component tests (vitest). No test calls the real Groq API. |
| `npm run typecheck` | `tsc --noEmit` across all three workspaces |
| `npm run build` | Typechecks the server, builds the client bundle |

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Server, model and database check |
| GET | `/api/resume/default` | The saved default resume, or 404 |
| POST | `/api/resume` | Save a resume (multipart file, or JSON `{ text }`) |
| POST | `/api/resume/parse` | Parse an upload to text without saving it |
| POST | `/api/evaluate` | Run an evaluation and save it |
| GET | `/api/jobs?q=` | Saved jobs, newest first, optionally filtered |
| GET | `/api/jobs/:id` | One evaluation in full |
| DELETE | `/api/jobs/:id` | Delete an evaluation and its rows |

Errors always come back as `{ "error": { "code", "message", "retryAfter?" } }`.

## Layout

```
client/   React 18 + Vite — pages, components, api.ts
server/   Express, SQLite (better-sqlite3), Groq integration
shared/   DTOs both sides import as @app/shared
```

The database is a single file at `server/data/app.db`, created and migrated on startup. It is
gitignored, along with `server/.env`.

### Test fixtures

`server/test/fixtures/` holds a small PDF, a DOCX and a deliberately fake PDF. They are generated,
not hand-made binaries — regenerate with:

```bash
node server/test/fixtures/make-fixtures.mjs
```

## Privacy

Your resume stays on your machine, in `server/data/app.db`. It is sent to Groq only as part of an
evaluation you ask for. On the public demo, a visitor's data is kept while they keep using the app
and deleted after **7 days without a visit** — the session cookie rolls forward on each visit, so
the cookie never expires while the data behind it is still alive. The API key lives only in `server/.env`, is never bundled into the client,
and is never logged. Resume text is never written to the logs either — only the model name, token
usage and latency of each call.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Invalid server environment … GROQ_API_KEY` | `server/.env` is missing or the key is blank |
| `Groq rejected the API key in server/.env` | The key is wrong or revoked — make a new one |
| "Groq is busy, try again in Ns" | Free-plan rate limit; the countdown finishes on its own |
| "No text found in that PDF" | It is probably a scan — paste the text instead |
| Port 3001 or 5173 already in use | Stop the other process, or change `PORT` in `server/.env` |

## Deploying

The app ships as one container: Express serves both the API and the built client on a single port.
It needs a **persistent disk** for the SQLite file, which rules out Vercel and Netlify, and makes
Render's free tier a poor fit (no disk, plus ~50s cold starts). These steps use Fly.io.

**Install flyctl first** — it is a separate program, not an npm package. In PowerShell:

```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

It lands in `%USERPROFILE%\.fly\bin` and is added to your PATH. **Open a new terminal afterwards**,
or the `fly` command will still not be found in the one you already had open.

Then, in PowerShell from the project root:

```powershell
fly auth login                  # opens a browser; a card on file is required even on the free tier

fly launch --no-deploy          # answer NO to deploying now - the secrets are not set yet

fly volumes create ai_evaluator_data --size 1

fly secrets set GROQ_API_KEY="gsk_your_key_here"

# Generate the session secret, then paste it into the next command.
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
fly secrets set SESSION_SECRET="paste_the_value_here"

fly deploy

fly open                        # opens the live URL
fly logs                        # startup lines: database ready / serving client / listening
```

In Git Bash the secret can be generated inline instead:

```bash
fly secrets set SESSION_SECRET="$(node -e 'console.log(crypto.randomUUID()+crypto.randomUUID())')"
```

### Two constraints that will bite if ignored

1. **Never rotate `SESSION_SECRET` casually.** Every visitor cookie is signed with it. Changing it
   invalidates all of them at once: every session resets and every saved row is orphaned. Set it
   once, never generate it in a build step.
2. **Stay on a single machine.** The SQLite file lives on one volume attached to one machine. A
   second machine gets its own empty volume and would serve an empty app to anyone routed there.
   `fly scale count 1` is the only safe setting until the database moves to Postgres or Turso.

### Testing the production build locally

```bash
npm run build -w client
NODE_ENV=production PORT=3100 DB_PATH=./tmp.db npx tsx server/src/index.ts
```

Note that `NODE_ENV=production` marks the session cookie `Secure`, so a browser will refuse to
store it over plain `http://localhost`. The pages and the API work; sessions will not persist until
it is behind HTTPS. That is correct behaviour, not a bug.

## Build status

All six milestones from SPEC.md are complete.

- [x] 1 · Skeleton — workspaces, Express + Vite, `/api/health`, DB migrations, `.env` check
- [x] 2 · Resume — PDF/DOCX/text parsing, save + load default, resume panel UI
- [x] 3 · Evaluate backend — Groq client with retries, prompt, scoring, `POST /api/evaluate`
- [x] 4 · Evaluate UI — job form, loading / error / rate-limit states, result table
- [x] 5 · Jobs database — list, search, detail modal, delete
- [x] 6 · Polish — empty states, responsive pass, this README
