import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";

export function mountFrontend(app: Express): void {
  const dist = path.resolve(process.cwd(), `dist_frontend`);
  if (!fs.existsSync(dist)) {
    console.warn(`[static] dist_frontend not found at ${dist} — skipping frontend mount`);
    return;
  }

  app.use(express.static(dist));

  // SPA fallback: any non-API GET that didn't match a static file → index.html
  app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(dist, `index.html`));
  });
}
