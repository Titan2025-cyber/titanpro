import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";

const app = express();
const httpServer = createServer(app);

// Trust the deploy proxy so req.ip / x-forwarded-for resolve to the real client
// (needed for accurate per-IP rate limiting behind the hosting proxy).
app.set("trust proxy", 1);

// ── Security headers (helmet) ────────────────────────────────────────────────
// Sets HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and a
// Content-Security-Policy. CSP is tuned to the app's needs: it must run in the
// Perplexity app preview iframe, load its own hashed assets, and talk to its own
// API, while blocking injected third-party scripts (XSS defense).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Vite emits a tiny inline module-preload bootstrap; allow inline + eval
        // for the bundled runtime. Scripts are otherwise same-origin only.
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "https:", "wss:"],
        workerSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // Allow embedding inside the Perplexity preview/app frames.
        frameAncestors: ["'self'", "https://*.perplexity.ai", "https://*.pplx.app"],
      },
    },
    // The app is framed by the Perplexity preview, so a hard DENY would break it.
    frameguard: false,
    // Let the browser upgrade insecure requests but don't force COEP (would block
    // some data:/blob: PDF and image flows).
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Brute-force defense on auth endpoints (per IP) plus a generous global API cap.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20, // max 20 login/auth attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts from this device. Please wait a few minutes and try again." },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 600, // generous ceiling to stop scripted abuse without hurting real use
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/change-password", authLimiter);
// 2FA code-entry endpoints get the same brute-force cap as password login.
app.use("/api/auth/2fa/verify", authLimiter);
app.use("/api/auth/2fa/setup/verify", authLimiter);
app.use("/api/", apiLimiter);

// Gzip/deflate every response (HTML, JS, CSS, JSON API payloads).
// Cuts transfer size ~65-75% on the large JS bundles. Must be first
// so it wraps all downstream responses.
app.use(compression());

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
