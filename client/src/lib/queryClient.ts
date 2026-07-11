import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// ── Auth token injection ──────────────────────────────────────────────────────
// The staff session token lives at window.__titanToken__ (set by AuthProvider) and
// the customer/partner portal token at window.__titanPortalToken__. We attach them
// to every same-origin API request automatically so protected endpoints receive
// credentials without every call site having to remember to add headers.
function buildAuthHeaders(url: string): Record<string, string> {
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

  const res = await fetch(`${API_BASE}${url}`, options);
  await throwIfResNotOk(res);
  return res;
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
