import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { SERVER_ROOT } from './env.js';

/** Where `npm run build -w client` leaves the bundle, overridable for Docker. */
function resolveClientDist(): string | undefined {
  const candidate =
    process.env.CLIENT_DIST ?? path.join(SERVER_ROOT, '..', 'client', 'dist');

  return fs.existsSync(path.join(candidate, 'index.html')) ? candidate : undefined;
}

/**
 * In production the API also serves the built client, so the whole app is one
 * process on one port. In development Vite serves it instead and this is a
 * no-op, because there is no dist directory to find.
 */
export function mountClient(app: Express): void {
  const dist = resolveClientDist();

  if (!dist) {
    console.log('[startup] no client build found — serving the API only');
    return;
  }

  // Hashed asset filenames can be cached hard; index.html must not be.
  app.use(express.static(dist, { index: false, maxAge: '1y' }));

  app.get('*', (req, res, next) => {
    // Never shadow the API: an unknown /api path stays a JSON 404.
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(dist, 'index.html'), { maxAge: 0 });
  });

  console.log(`[startup] serving client from ${dist}`);
}
