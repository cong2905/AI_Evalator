# AI Job Evaluator

Local web app that compares your resume against a job description using an LLM on the Groq API.
See [SPEC.md](SPEC.md) for the full build spec.

## Setup

```bash
npm install
cp .env.example server/.env   # then paste your key from https://console.groq.com/keys
npm run dev
```

- Client: http://localhost:5173
- API: http://127.0.0.1:3001 (loopback only; `/api/health` to check it)

The server refuses to start with a blank `GROQ_API_KEY` and tells you how to fix it.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Express (tsx watch) + Vite together; Vite proxies `/api` to the API |
| `npm test` | Server tests (vitest). No test calls the real Groq API. |
| `npm run typecheck` | `tsc --noEmit` across all three workspaces |
| `npm run build` | Typechecks the server, builds the client bundle |

## Layout

```
client/   React 18 + Vite (pages, components, api.ts)
server/   Express, SQLite (better-sqlite3), Groq integration
shared/   DTOs imported by both sides as @app/shared
```

The database lives at `server/data/app.db` (gitignored) and is migrated on startup.

## Build status

Milestone 1 (skeleton) is done: workspaces, Express + Vite, `/api/health`, DB migrations, `.env`
check. Milestones 2-6 (resume, evaluate backend, evaluate UI, jobs database, polish) are next.
