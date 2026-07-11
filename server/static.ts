import express from 'express';
import type { Express } from 'express';
import fs from "node:fs";
import path from "node:path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve Vite's hashed assets with a long-lived, immutable cache.
  // Filenames include a content hash, so a 1-year cache is safe — any
  // change produces a new filename and busts the cache automatically.
  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), {
      immutable: true,
      maxAge: "1y",
    }),
  );

  // Everything else (index.html, manifest, icons) — no long cache so
  // updates are picked up immediately.
  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
