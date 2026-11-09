# Development

Setup, scripts, API reference and deployment for AI Job Evaluator. See [SPEC.md](SPEC.md) for the
full build spec, and the [README](README.md) for the user guide.

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

### Why the limits are what they are

The length limits are set to fit the Groq free plan's 8,000 tokens/minute, which works out to
about one evaluation per minute. Short rate-limit waits are retried automatically by the server.

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
server/   Express, SQLite over libSQL (@libsql/client), Groq integration
shared/   DTOs both sides import as @app/shared
```

The database is a single file at `server/data/app.db`, created and migrated on startup. It is
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
| `Groq rejected the API key in server/.env` | The key is wrong or revoked. Make a new one |
| Port 3001 or 5173 already in use | Stop the other process, or change `PORT` in `server/.env` |

## Deploying

The app ships as one process: Express serves both the API and the built client on a single port.
Where the **database** goes is the only real decision, because SQLite is a file and most free hosts
have no persistent disk.

The app reads whichever is configured:

| Configuration | Database | Use for |
|---|---|---|
| neither variable set | `server/data/app.db` on local disk | local development |
| `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | hosted libSQL, over the network | any host with no persistent disk |
| `DB_PATH` on a mounted volume | SQLite on that volume | a host that gives you a real disk |

Nothing in the app code branches on this: libSQL speaks the same SQL and the same client API to a
local file and to a remote database, so the only difference is the connection string.

### Render free tier + Turso (current host)

Render's free web services cannot attach a disk and wipe local files on every spin-down, so the
database lives on Turso and survives both. `render.yaml` describes the service.

First create the database (once, on your own machine):

```bash
npm i -g @tursodatabase/turso-cli   # or: brew install tursodatabase/tap/turso
turso auth signup
turso db create ai-job-evaluator
turso db show ai-job-evaluator --url        # -> TURSO_DATABASE_URL
turso db tokens create ai-job-evaluator     # -> TURSO_AUTH_TOKEN
```

Then on Render: **New → Blueprint**, point it at this repository, and supply `GROQ_API_KEY`,
`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. `SESSION_SECRET` is generated for you and then left
alone — see the warning below about rotating it.

Migrations run at startup against whatever database is configured, so the first boot creates the
schema on Turso. Nothing has to be applied by hand.

Two things about the free tier that are not bugs:

1. **The service sleeps after 15 minutes of no traffic** and takes roughly a minute to answer the
   next request. The data is unaffected — it is on Turso, not on the sleeping instance.
2. **A restart loses nothing**, which is the whole reason for Turso. Verify it by redeploying and
   checking that a saved evaluation is still listed.

### Oracle Cloud Always Free (a VM, if you want one)

Everything needed is in `deploy/`: `setup-vm.sh`, a Docker Compose file and a Caddy TLS proxy. This
path keeps SQLite on a real disk and has no cold start, at the cost of running a Linux box. Two
prerequisites fail silently: the **OCI Security List** is a second firewall that must also allow
TCP 80 and 443, and Caddy needs a **real hostname** (a free DuckDNS subdomain will do) because it
cannot issue a certificate for a bare IP — and without HTTPS the `Secure` session cookie is dropped
by every browser, so the site appears to work while losing every session.

### Fly.io

`Dockerfile` and `fly.toml` remain correct and use a mounted volume rather than Turso. Fly bills
pay-as-you-go after the trial, but waives personal bills under $5/month, which this app sits well
inside with `min_machines_running = 0`.

### Two constraints that will bite on any host

1. **Never rotate `SESSION_SECRET` casually.** Every visitor cookie is signed with it. Changing it
   invalidates all of them at once: every session resets and every saved row is orphaned. Set it
   once, and never generate it in a build step.
2. **One machine per *volume*.** With `DB_PATH` on a mounted disk, a second machine gets its own
   empty volume and would serve an empty app to anyone routed there — keep the count at 1. This
   does not apply when the database is on Turso, which is reached over the network and shared
   correctly by any number of instances.

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
