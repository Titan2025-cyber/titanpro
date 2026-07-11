import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { apiRequest } from "@/lib/queryClient";

export interface AuthUser {
  id: number;
  name: string;
  role: "owner" | "admin" | "tech" | "sales" | "office";
  position: string | null;
  gmailEmail: string | null;
  phone: string | null;
  avatarInitials: string;
  permissions: string[];
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (name: string, credential: string, isPin?: boolean) => Promise<void>;
  loginWeb: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = "titan_pro_staff_token";

// ── Token persistence ─────────────────────────────────────────────────────────
// Persist the staff session token in localStorage so it survives page refreshes
// and new tabs (needed for a real deploy, e.g. Railway). We ALSO mirror the token
// into window.__titanToken__ because queryClient.buildAuthHeaders() reads it from
// there to attach the Authorization header to every API request.
// localStorage can throw (private mode, blocked sandbox iframe) so every access is
// wrapped in try/catch and falls back to the in-memory var.
function persistToken(tok: string | null) {
  (window as any).__titanToken__ = tok ?? undefined;
  try {
    if (tok) localStorage.setItem(TOKEN_KEY, tok);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // localStorage unavailable — in-memory var above is the fallback
  }
}

function readPersistedToken(): string | undefined {
  try {
    const ls = localStorage.getItem(TOKEN_KEY);
    if (ls) return ls;
  } catch {
    // ignore — fall through to in-memory var
  }
  return (window as any).__titanToken__ as string | undefined;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount — restore session from localStorage (falls back to in-memory var).
  // Re-mirror into window.__titanToken__ so API requests carry the token immediately.
  useEffect(() => {
    const stored = readPersistedToken();
    if (stored) {
      (window as any).__titanToken__ = stored;
      setToken(stored);
      fetchMe(stored).finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  async function fetchMe(tok: string) {
    try {
      const res = await apiRequest("GET", "/api/auth/me");
      if (!res.ok) throw new Error("expired");
      const data = await res.json();
      setUser(data);
    } catch {
      setUser(null);
      setToken(null);
      persistToken(null);
    }
  }

  async function login(name: string, credential: string, isPin = false) {
    const body = isPin
      ? { name, pin: credential }
      : { name, password: credential };
    await doLogin(body);
  }

  // Web-based login: single identifier field (email or name) + password
  async function loginWeb(identifier: string, password: string) {
    await doLogin({ identifier, password });
  }

  async function doLogin(body: Record<string, string>) {
    const res = await apiRequest("POST", "/api/auth/login", body);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Login failed");
    }
    const data = await res.json();
    const tok = data.token as string;
    persistToken(tok);
    setToken(tok);
    setUser(data.employee);
  }

  async function logout() {
    if (token) {
      await apiRequest("POST", "/api/auth/logout").catch(() => {});
    }
    setUser(null);
    setToken(null);
    persistToken(null);
  }

  async function refreshUser() {
    if (token) await fetchMe(token);
  }

  function can(permission: string): boolean {
    if (!user) return false;
    return user.permissions.includes(permission);
  }

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, loginWeb, logout, can, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
