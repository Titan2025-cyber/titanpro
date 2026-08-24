// ─────────────────────────────────────────────────────────────────────────────
// Pending Signatures header badge.
//
// A small pen icon next to the notification bell that surfaces every
// signature_request row still in 'pending' or 'viewed' status (not expired,
// not cancelled). Clicking opens a dropdown listing the outstanding docs
// grouped by job — clicking a row deep-links to the job's Documents tab so
// ops can chase the customer or copy the link and resend.
//
// Polls /api/signature-requests/pending every 45s. Rendered in Layout.tsx.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { PenSquare, X, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";

interface PendingRequest {
  id: number;
  jobId: number;
  title: string;
  recipientName: string | null;
  recipientEmail: string;
  status: "pending" | "viewed";
  createdAt: string;
  expiresAt: string;
  viewedAt: string | null;
  jobNumber: string | null;
  jobAddress: string | null;
}

interface PendingResponse {
  count: number;
  requests: PendingRequest[];
}

function fmtAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function fmtExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.max(0, Math.round(ms / 86_400_000));
  if (days === 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  return `expires in ${days}d`;
}

export function PendingSignaturesBadge() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);

  const { data } = useQuery<PendingResponse>({
    queryKey: ["/api/signature-requests/pending"],
    queryFn: () => apiRequest("GET", "/api/signature-requests/pending").then(r => r.json()),
    refetchInterval: 45_000,
    enabled: !!user,
  });

  const count = data?.count || 0;
  const requests = data?.requests || [];

  if (!user) return null;

  function onOpenRequest(req: PendingRequest) {
    setOpen(false);
    setLocation(`/jobs/${req.jobId}#documents`);
  }

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-full hover:bg-muted transition"
        aria-label="Pending signatures"
        title={count === 0 ? "No pending signatures" : `${count} pending signature${count === 1 ? "" : "s"}`}
        data-testid="button-pending-signatures"
      >
        <PenSquare className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop — click anywhere else to close */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 w-[380px] max-h-[520px] bg-background border rounded-lg shadow-xl z-50 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <p className="font-semibold text-sm">Pending signatures</p>
                <p className="text-[11px] text-muted-foreground">
                  {count === 0 ? "All caught up." : `${count} document${count === 1 ? "" : "s"} awaiting the customer`}
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1 hover:bg-muted rounded"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {requests.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  Nothing waiting on the customer right now.
                </div>
              ) : (
                <ul className="divide-y">
                  {requests.map(req => (
                    <li key={req.id}>
                      <button
                        onClick={() => onOpenRequest(req)}
                        className="w-full text-left px-4 py-3 hover:bg-muted/60 transition flex items-start gap-3"
                      >
                        <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                          req.status === "viewed" ? "bg-blue-500" : "bg-amber-500"
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{req.title}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {req.jobNumber ? `#${req.jobNumber}` : ""}
                            {req.jobNumber && req.jobAddress ? " · " : ""}
                            {req.jobAddress || (!req.jobNumber ? `Job ${req.jobId}` : "")}
                          </p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {req.recipientName || req.recipientEmail}
                            <span className="text-muted-foreground/70"> · sent {fmtAge(req.createdAt)}</span>
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                              req.status === "viewed"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                            }`}>
                              {req.status === "viewed" ? "Opened, not signed" : "Not yet opened"}
                            </span>
                            <span className="text-[10px] text-muted-foreground">{fmtExpiry(req.expiresAt)}</span>
                          </div>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/60 mt-1 shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
