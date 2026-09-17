// Global Express Request augmentation.
// Handlers in routes_auth.ts and requireStaffAuth attach `req.employee` after
// verifying the session. Every downstream route file (routes_hr, routes_suite5,
// etc.) reads it — declaring it here gives them typed access instead of
// falling back to `(req as any).employee` throughout.

import "express";

declare global {
  namespace Express {
    interface Request {
      employee?: {
        id: number;
        name: string;
        role?: string;
        email?: string;
      };
    }
  }
}

export {};
