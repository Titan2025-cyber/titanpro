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

  // Fall through to index.html for SPA routes.
  //
  // BUT: never fall through for /assets/* or other file-typed URLs. If a
  // hashed chunk from an old build is requested (stale service-worker cache
  // on a tech's phone), we MUST return 404 with the right content-type
  // instead of sending index.html as text/html. Otherwise the browser tries
  // to parse HTML as JavaScript and blows up with the notorious
  // "'text/html' is not a valid JavaScript MIME type" error, which nukes
  // whichever page it was trying to render.
  app.use("/{*path}", (req, res, next) => {
    const p = req.path || "";
    // Anything under /assets/ that missed static is a stale chunk — hard 404.
    if (p.startsWith("/assets/")) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    // File-typed URLs anywhere in the tree (chunks, source maps, images,
    // fonts, JSON, css). Never respond with an HTML shell for these.
    if (/\.(?:js|mjs|css|map|json|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf|pdf|wasm)$/i.test(p)) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
