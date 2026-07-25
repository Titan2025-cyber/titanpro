import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { enqueueRequest, isQueueableMethod, isOnline } from "./offlineQueue";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// ── Auth token injection ──────────────────────────────────────────────────────
// The staff session token lives at window.__titanToken__ (set by AuthProvider) and
// the customer/partner portal token at window.__titanPortalToken__. We attach them
// to every same-origin API request automatically so protected endpoints receive
// credentials without every call site having to remember to add headers.
export function buildAuthHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window === "undefined") return headers;
  const staffTok = (window as any).__titanToken__ as string | undefined;
  const portalTok = (window as any).__titanPortalToken__ as string | undefined;
  if (staffTok) headers["Authorization"] = `Bearer ${staffTok}`;
  // Portal endpoints authenticate with a separate, contact-scoped token.
  if (portalTok && (url.includes("/api/customer-portal") || url.includes("/api/portal") || url.includes("/api/partner"))) {
    headers["X-Portal-Token"] = portalTok;
  }
  return headers;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

/**
 * Dual-signature apiRequest — accepts BOTH calling conventions used throughout the app:
 *
 * Old (correct) signature:  apiRequest("POST", "/api/jobs", { ...data })
 * New (fetch-style) signature: apiRequest("/api/jobs", { method: "POST", body: ... })
 * GET shorthand: apiRequest("/api/jobs")          → GET, no body
 * GET shorthand: apiRequest("GET", "/api/jobs")   → GET, no body
 */
export async function apiRequest(
  methodOrUrl: string,
  urlOrOptions?: string | RequestInit,
  data?: unknown,
): Promise<Response> {
  let method: string;
  let url: string;
  let options: RequestInit = {};

  if (
    typeof urlOrOptions === "string" ||
    (urlOrOptions === undefined && !methodOrUrl.startsWith("/"))
  ) {
    // Old signature: apiRequest(method, url, data?)
    method = methodOrUrl.toUpperCase();
    url = (urlOrOptions as string) ?? methodOrUrl;
    options = {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
    };
  } else if (typeof urlOrOptions === "object") {
    // New fetch-style: apiRequest(url, { method, headers, body })
    url = methodOrUrl;
    const init = urlOrOptions as RequestInit;
    method = (init.method ?? "GET").toUpperCase();
    options = init;
  } else {
    // GET shorthand: apiRequest("/api/jobs")
    url = methodOrUrl;
    method = "GET";
    options = { method: "GET" };
  }

  // Merge auth headers without clobbering any caller-supplied headers.
  options.headers = { ...buildAuthHeaders(url), ...(options.headers as Record<string, string> | undefined) };

  const fullUrl = `${API_BASE}${url}`;

  // ── Offline-first write path ────────────────────────────────────────────────
  // For mutating requests, if the device is offline OR the network throws, we
  // persist the request to the durable outbox and return a synthetic "202
  // Queued" response so the field UI shows success instead of an error. The
  // request replays automatically (in order) when connectivity returns. Reads
  // (GET/HEAD) are never queued — they simply fail as before when offline.
  const queueable = isQueueableMethod(method);

  if (queueable && !isOnline()) {
    await queueWrite(fullUrl, method, options);
    return queuedResponse();
  }

  try {
    const res = await fetch(fullUrl, options);
    await throwIfResNotOk(res);
    return res;
  } catch (err) {
    // A network-level failure (TypeError: Failed to fetch) on a write while the
    // browser thinks it *might* be online — queue it rather than lose it.
    if (queueable && isNetworkError(err)) {
      await queueWrite(fullUrl, method, options);
      return queuedResponse();
    }
    throw err;
  }
}

function isNetworkError(err: unknown): boolean {
  // fetch() rejects with a TypeError on network failure (DNS, offline, CORS-less
  // connection drop). HTTP error statuses do NOT reject — they're thrown by
  // throwIfResNotOk as Error("<status>: ..."), which we deliberately do not queue.
  return err instanceof TypeError;
}

async function queueWrite(fullUrl: string, method: string, options: RequestInit) {
  const headers = (options.headers as Record<string, string>) || {};
  const body = typeof options.body === "string" ? options.body : options.body ? String(options.body) : null;
  await enqueueRequest({ url: fullUrl, method, headers, body });
}

// Synthetic response returned for a queued write so callers `.json()` cleanly
// and mutation onSuccess handlers fire optimistically.
function queuedResponse(): Response {
  return new Response(JSON.stringify({ queued: true, offline: true }), {
    status: 202,
    headers: { "Content-Type": "application/json", "X-Titan-Queued": "1" },
  });
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = `${queryKey[0]}${queryKey.slice(1).map(k => `/${k}`).join("")}`;
    const res = await fetch(`${API_BASE}${url}`, { headers: buildAuthHeaders(url) });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// Global mutation error handler — surfaces API errors as console warnings
// Individual pages can override with their own onError handlers
queryClient.setMutationDefaults([], {
  onError: (error: unknown) => {
    if (error instanceof Error) {
      console.warn("[Mutation error]", error.message);
    }
  },
});
