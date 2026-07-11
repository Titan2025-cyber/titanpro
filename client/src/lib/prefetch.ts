/**
 * prefetch.ts — hover-to-prefetch route chunks.
 *
 * Each page is lazy-loaded (code-split), so navigating to a page normally
 * triggers a network request for its JS chunk at click time. By prefetching
 * that chunk when the user *hovers* the nav link, the chunk is usually already
 * in the browser cache by the time they click — so the page renders instantly.
 *
 * Uses Vite's import.meta.glob to build a map of page module loaders without
 * having to hand-maintain a path→import table. Only the *matching* chunk is
 * fetched on hover; nothing is eagerly loaded at startup.
 */

// Lazy (non-eager) glob: returns a map of module path -> () => import(module)
const pageLoaders = import.meta.glob("/src/pages/*.tsx");

// Map a route href (e.g. "/jobs") to a page module key. Route paths don't map
// 1:1 to filenames, so we resolve by matching the page component name that the
// router uses. We build a normalized lookup: lowercased filename -> loader.
const loaderByName = new Map<string, () => Promise<unknown>>();
for (const [path, loader] of Object.entries(pageLoaders)) {
  const file = path.split("/").pop()?.replace(/\.tsx$/, "") ?? "";
  loaderByName.set(file.toLowerCase(), loader as () => Promise<unknown>);
}

// Best-effort href -> filename hints for routes whose path differs from the
// page component filename. Anything not listed falls back to a slug guess.
const HREF_TO_FILE: Record<string, string> = {
  "/": "dashboard",
  "/jobs": "jobs",
  "/contacts": "contacts",
  "/estimates": "estimates",
  "/invoices": "invoices",
  "/payments": "payments",
  "/scheduling": "scheduling",
  "/technician": "technician",
  "/photos": "photos",
  "/safety": "safety",
  "/equipment": "equipment",
  "/supplements": "supplements",
  "/marketing": "marketing",
  "/messaging": "messaging",
  "/time-clock": "timeclock",
  "/follow-ups": "followups",
  "/job-costing": "jobcosting",
  "/global-search": "globalsearch",
};

const prefetched = new Set<string>();

/** Prefetch the JS chunk for a given nav href. Safe to call repeatedly. */
export function prefetchRoute(href: string): void {
  if (prefetched.has(href)) return;

  // Resolve a candidate filename from the explicit map, else a slug guess:
  // "/tech-daily" -> "techdaily"
  const candidate =
    HREF_TO_FILE[href] ?? href.replace(/^\//, "").replace(/-/g, "").toLowerCase();

  const loader = loaderByName.get(candidate);
  if (loader) {
    prefetched.add(href);
    // Fire and forget; ignore errors (offline, etc.)
    loader().catch(() => {});
  }
}
