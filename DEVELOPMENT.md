# Development

Setup, scripts, API reference and deployment for AI Job Evaluator. See [SPEC.md](SPEC.md) for the
full build spec, and the [README](README.md) for the user guide.

## Setup

Needs **Node 20 or newer**.

```bash
npm install
cp .env.example server/.env
```

Open `server/.env` and fill in two values:

- `GROQ_API_KEY`: your key from [console.groq.com/keys](https://console.groq.com/keys)
- `SESSION_SECRET`: any random string of 16+ characters, which signs the visitor cookie. Generate one with
  `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`

```
GROQ_API_KEY=gsk_your_key_here
GROQ_MODEL=openai/gpt-oss-120b
PORT=3001
SESSION_SECRET=paste_the_generated_value_here
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
```

Leave both `TURSO_*` values blank locally. The app then uses a file at `server/data/app.db`.

Then:

```bash
npm run dev
```

- App: **http://localhost:5173**
- API: http://127.0.0.1:3001 (loopback only)

The server refuses to start with a blank `GROQ_API_KEY` or a missing/short `SESSION_SECRET`, and
prints what to fix.

### Why the limits are what they are

The length limits are set to fit the Groq free plan's 8,000 tokens/minute, which works out to
about one evaluation per minute. Short rate-limit waits are retried automatically by the server.

On top of that, the server protects the shared Groq quota itself (`server/src/limits.ts`):

| Limit | Value |
|---|---|
| All `/api` requests, per IP | 120 / minute |
| `POST /api/evaluate`, per IP | 3 / minute |
| Evaluations per visitor | 5 / day (resets at midnight UTC) |
| Evaluations for the whole site | 150 / day |
| `POST /api/session/adopt`, per IP | 10 / 15 minutes |

Data belonging to a visitor who hasn't been back for **7 days** is deleted
(`server/src/retention.ts`), checked at startup and once a day after that.

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
| POST | `/api/session/transfer-code` | Create a one-time code (10 minutes) to move this visitor's data to another device |
| POST | `/api/session/adopt` | Redeem a transfer code (`{ code }`) on the new device |
| DELETE | `/api/session/data` | Delete every evaluation and resume for this visitor |

There are no accounts. Each browser gets a signed, `httpOnly` session cookie on its first `/api`
request, and every row is scoped to that session.

Errors always come back as `{ "error": { "code", "message", "retryAfter?" } }`.

## Layout

```
client/   React 18 + Vite — pages, components, api.ts
server/   Express, SQLite over libSQL (@libsql/client), Groq integration
shared/   DTOs both sides import as @app/shared
```

In development the database is a single file at `server/data/app.db`, created and migrated on
startup (in production it is on Turso, see [Deploying](#deploying)). It is
gitignored, along with `server/.env`. The API key lives only in `server/.env`, is never bundled
into the client, and is never logged.

### Test fixtures

`server/test/fixtures/` holds a small PDF, a DOCX and a deliberately fake PDF. They are generated,
not hand-made binaries. Regenerate them with:

```bash
node server/test/fixtures/make-fixtures.mjs
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `Invalid server environment … GROQ_API_KEY` | `server/.env` is missing or the key is blank |
| `Invalid server environment … SESSION_SECRET` | Missing or shorter than 16 characters. Generate one (see [Setup](#setup)) |
| `Groq rejected the API key in server/.env` | The key is wrong or revoked. Make a new one |
| Port 3001 or 5173 already in use | Stop the other process, or change `PORT` in `server/.env` |

## Deploying

The app ships as one process: Express serves both the API and the built client on a single port.
The production host is Render's free tier, which has no persistent disk, so the database lives on
Turso (hosted libSQL).

The app reads whichever is configured:

| Configuration | Database | Use for |
|---|---|---|
| neither variable set | `server/data/app.db` on local disk | local development |
| `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | hosted libSQL, over the network | any host with no persistent disk |

Nothing in the app code branches on this: libSQL speaks the same SQL and the same client API to a
local file and to a remote database, so the only difference is the connection string.

### Render free tier + Turso (current host)

Render's free web services cannot attach a disk and wipe local files on every spin-down, so the
database lives on Turso and survives both. [`render.yaml`](render.yaml) describes the service.
Render, Turso and Groq all have free plans that don't need a card.

**1. Groq key.** Create one at [console.groq.com/keys](https://console.groq.com/keys). It starts
with `gsk_` and is shown only once.

**2. Turso database.** Use the dashboard at [app.turso.tech](https://app.turso.tech) (the CLI does
not run natively on Windows):

1. **Create Database** named `ai-job-evaluator`. Pick a location near Render's default region,
   **US West (Oregon)**, which keeps every query fast.
2. Copy its URL (`libsql://…turso.io`). This is `TURSO_DATABASE_URL`.
3. **Create Token** with no expiry and read/write access. This is `TURSO_AUTH_TOKEN`.

The CLI does the same on macOS, Linux or WSL:

```bash
turso auth signup
turso db create ai-job-evaluator
turso db show ai-job-evaluator --url        # -> TURSO_DATABASE_URL
turso db tokens create ai-job-evaluator     # -> TURSO_AUTH_TOKEN
```

**3. Render service.** Sign in at [render.com](https://render.com) with GitHub, then
**New → Blueprint**, pick this repository and supply `GROQ_API_KEY`, `TURSO_DATABASE_URL` and
`TURSO_AUTH_TOKEN`. `SESSION_SECRET` is generated for you and then left alone (see the warning
below about rotating it). The first build takes a few minutes.

Migrations run at startup against whatever database is configured, so the first boot creates the
schema on Turso. Nothing has to be applied by hand.

**4. Check it.** `https://<your-app>.onrender.com/api/health` should return
`{"status":"ok", …}`, which proves the env is valid and Turso is reachable. Then run an evaluation
with **Try with sample data**.

**Updating:** every push to `main` redeploys automatically.

Two things about the free tier that are not bugs:

1. **The service sleeps after 15 minutes of no traffic** and takes roughly a minute to answer the
   next request. The data is unaffected, because it is on Turso, not on the sleeping instance. To
   avoid the wait, point a free uptime monitor (e.g. UptimeRobot) at `/api/health` every 5–10
   minutes. Render's 750 free hours a month cover one service running all month.
2. **A restart loses nothing**, which is the whole reason for Turso. Verify it by redeploying and
   checking that a saved evaluation is still listed.

#### Deploy troubleshooting

| Problem | Fix |
|---|---|
| Build fails with `vite: not found` or `tsx: not found` | The build command must keep `--include=dev`: Render sets `NODE_ENV=production` during the build too, which makes npm skip dev dependencies |
| Logs show `Invalid server environment` | A variable is missing in Render's **Environment** tab. The log names it |
| `/api/health` fails with an auth error | `TURSO_AUTH_TOKEN` is wrong or expired, or the URL has a typo. Create a new token |
| Evaluations fail with a Groq auth error | `GROQ_API_KEY` is wrong. Create a new key and update it |

### Never rotate `SESSION_SECRET` casually

Every visitor cookie is signed with it. Changing it invalidates all of them at once: every session
resets and every saved row is orphaned. Set it once, and never generate it in a build step.

### Testing the production build locally

```bash
npm run build -w client
NODE_ENV=production PORT=3100 DB_PATH=./tmp.db npx tsx server/src/index.ts
```

To rehearse the deployed setup instead, point the same command at Turso by setting
`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` rather than `DB_PATH`. Use a throwaway database: it
runs the real migrations.

`NODE_ENV=production` marks the session cookie `Secure`, so a browser will refuse to store it over
plain `http://localhost`. The pages and the API work, but sessions won't persist until the app is
behind HTTPS. That is correct behaviour, not a bug.
