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
server/   Express, SQLite (better-sqlite3), Groq integration
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

The app ships as one container: Express serves both the API and the built client on a single port.
It needs a **persistent disk** for the SQLite file, which rules out free tiers that only offer
ephemeral storage — Render's free web services, for instance, have no disk and wipe local files on
every spin-down. The setup below uses an Oracle Cloud Always Free VM, which provides a real disk at
no cost.

### Oracle Cloud Always Free

Everything needed is in `deploy/`. On a fresh Ubuntu VM:

```bash
git clone https://github.com/cong2905/AI_Evalator.git
cd AI_Evalator
bash deploy/setup-vm.sh          # docker, swap if needed, host firewall
cp deploy/.env.example deploy/.env
nano deploy/.env                 # GROQ_API_KEY, SESSION_SECRET, SITE_DOMAIN, ACME_EMAIL
cd deploy && docker compose up -d --build
docker compose logs -f app       # expect: database ready / serving client / listening
```

Two prerequisites are easy to miss, and each fails silently:

1. **Both firewalls must allow 80 and 443.** `setup-vm.sh` opens the host's iptables rules, but the
   OCI console has a *separate* Security List that blocks them by default
   (Networking → Virtual Cloud Networks → your VCN → Security Lists → default → add ingress rules
   for TCP 80 and 443 from `0.0.0.0/0`). Open only one and the site is unreachable with nothing in
   the logs to explain it.
2. **You need a hostname, not just the IP.** Caddy cannot issue a TLS certificate for a bare IP
   address, and without HTTPS the `Secure` session cookie is dropped by every browser — the site
   would look like it works while losing every visitor's session on every request. A free DuckDNS
   subdomain pointed at the VM's public IP is enough.

Updating after a push:

```bash
git pull && cd deploy && docker compose up -d --build
```

The database lives in the `app-data` Docker volume, so it survives restarts and rebuilds.
`docker compose down` keeps it; `docker compose down -v` destroys it.

### Fly.io (previous host)

`Dockerfile` and `fly.toml` remain correct. Fly's trial ends and then requires a card; with one
added, `fly deploy` restores the same app on a managed volume with no VM to maintain.

### Two constraints that will bite on any host

1. **Never rotate `SESSION_SECRET` casually.** Every visitor cookie is signed with it. Changing it
   invalidates all of them at once: every session resets and every saved row is orphaned. Set it
   once, and never generate it in a build step.
2. **Stay on a single machine.** The SQLite file lives on one volume attached to one machine. A
   second machine gets its own empty volume and would serve an empty app to anyone routed there.
   `fly scale count 1` is the only safe setting until the database moves to Postgres or Turso.

### Testing the production build locally

```bash
npm run build -w client
NODE_ENV=production PORT=3100 DB_PATH=./tmp.db npx tsx server/src/index.ts
```

`NODE_ENV=production` marks the session cookie `Secure`, so a browser will refuse to store it over
plain `http://localhost`. The pages and the API work, but sessions won't persist until the app is
behind HTTPS. That is correct behaviour, not a bug.
