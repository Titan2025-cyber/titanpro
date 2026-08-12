/**
 * PublicReport.tsx — Public, no-login photo report viewer.
 *
 * Route: /public/reports/:token
 *
 * Loads the share-token payload (which template + which photo IDs the creator
 * pre-selected), fetches the underlying photo rows through the token's
 * server-side scoped endpoint, and renders a clean scrollable viewer that
 * mirrors the PDF template.
 *
 * The token endpoint on the server tracks views + last-viewed-at so the
 * office can see when an adjuster or customer actually opened the report.
 * Revoked or expired tokens render a friendly denial screen with the
 * Titan Restoration contact.
 */
import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { Loader2, Lock, Download, Droplets, MapPin, Camera } from "lucide-react";
import type { Photo } from "@shared/schema";
import { generateAndDownloadPhotoReport, type ReportTemplate } from "@/lib/photoReport";

interface TokenPayload {
  token: string;
  jobNumber: string;
  jobAddress?: string | null;
  customerName?: string | null;
  template: ReportTemplate;
  photos: Photo[];
  createdAt?: string;
  expiresAt?: string | null;
  viewCount: number;
  revoked: boolean;
}

export default function PublicReport() {
  const [, params] = useRoute<{ token: string }>("/public/reports/:token");
  const token = params?.token || "";
  const [state, setState] = useState<{ loading: boolean; error?: string; data?: TokenPayload }>({
    loading: true,
  });

  useEffect(() => {
    if (!token) { setState({ loading: false, error: "Missing token." }); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/public/reports/${encodeURIComponent(token)}`, { credentials: "omit" });
        if (!res.ok) {
          if (cancelled) return;
          const msg = res.status === 403 || res.status === 410
            ? "This report link has been revoked or has expired."
            : "We couldn't load this report.";
          setState({ loading: false, error: msg });
          return;
        }
        const data: TokenPayload = await res.json();
        if (cancelled) return;
        setState({ loading: false, data });
      } catch {
        if (cancelled) return;
        setState({ loading: false, error: "Network error loading report." });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const groups = useMemo(() => {
    if (!state.data) return [] as { room: string; photos: Photo[] }[];
    const buckets = new Map<string, Photo[]>();
    for (const p of state.data.photos) {
      const room = ((p as any).room as string) || "Unassigned";
      if (!buckets.has(room)) buckets.set(room, []);
      buckets.get(room)!.push(p);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b))
      .map(([room, photos]) => ({ room, photos }));
  }, [state.data]);

  if (state.loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-slate-600">
          <Loader2 className="w-5 h-5 animate-spin"/> Loading report…
        </div>
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-sm border p-6 text-center">
          <Lock className="w-8 h-8 text-slate-400 mx-auto mb-2"/>
          <div className="font-semibold mb-1">Report unavailable</div>
          <div className="text-sm text-slate-600">{state.error || "Please contact Titan Restoration for a new link."}</div>
          <div className="mt-4 text-xs text-slate-500">Titan Restoration LLC · (803) 555-0100</div>
        </div>
      </div>
    );
  }

  const d = state.data;
  const templateLabel = d.template === "adjuster" ? "Loss Documentation Report"
                      : d.template === "customer" ? "Project Photo Report"
                      : "Photo Dossier";

  const downloadPdf = async () => {
    if (!d) return;
    await generateAndDownloadPhotoReport({
      jobNumber: d.jobNumber,
      jobAddress: d.jobAddress ?? undefined,
      customerName: d.customerName ?? undefined,
      template: d.template,
      photos: d.photos,
      burnAnnotations: true,
    });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-teal-700 font-semibold">Titan Restoration LLC</div>
            <div className="font-semibold text-lg">{templateLabel}</div>
            <div className="text-sm text-slate-600">Job {d.jobNumber}{d.jobAddress ? ` · ${d.jobAddress}` : ""}</div>
          </div>
          <button
            onClick={downloadPdf}
            className="inline-flex items-center gap-1 px-3 py-2 rounded bg-teal-600 hover:bg-teal-700 text-white text-sm"
          >
            <Download className="w-4 h-4"/> Download PDF
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
        {/* Cover facts */}
        <div className="bg-white rounded-lg border p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Fact label="Customer" value={d.customerName ?? ""}/>
            <Fact label="Property" value={d.jobAddress ?? ""}/>
            <Fact label="Photos" value={String(d.photos.length)}/>
            <Fact label="Rooms" value={String(groups.length)}/>
          </div>
        </div>

        {groups.map(g => (
          <section key={g.room}>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-teal-700"/> {g.room}
              <span className="text-xs text-slate-500 font-normal">({g.photos.length} photo{g.photos.length === 1 ? "" : "s"})</span>
            </h2>
            <div className={`grid gap-4 ${d.template === "adjuster" ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"}`}>
              {g.photos.map(p => <PhotoCard key={p.id} photo={p} template={d.template}/>)}
            </div>
          </section>
        ))}

        <div className="text-xs text-slate-500 text-center pt-8 pb-16">
          Titan Restoration LLC · This report was shared via a secure link and will expire on
          {d.expiresAt ? ` ${new Date(d.expiresAt).toLocaleDateString()}` : " request"}. Contact us for updated documentation.
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-medium text-slate-900 truncate">{value || "—"}</div>
    </div>
  );
}

function PhotoCard({ photo, template }: { photo: Photo; template: ReportTemplate }) {
  const src = (photo as any).dataUrl as string | undefined;
  const room = (photo as any).room as string | null;
  const damage = (photo as any).damageType as string | null;
  const severity = (photo as any).severity as string | null;
  const taken = (photo as any).originalTakenAt as string | null;
  const device = [(photo as any).deviceMake, (photo as any).deviceModel].filter(Boolean).join(" ");
  const lat = (photo as any).latitude, lng = (photo as any).longitude;
  const showTechnical = template !== "customer";
  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <div className="bg-slate-100 aspect-video flex items-center justify-center">
        {src
          ? <img src={src} alt={(photo as any).caption || ""} className="w-full h-full object-contain"/>
          : <Camera className="w-8 h-8 text-slate-400"/>}
      </div>
      <div className="p-3 space-y-1">
        <div className="font-semibold text-sm">{(photo as any).caption || `Photo #${photo.id}`}</div>
        <div className="flex flex-wrap gap-1 text-[11px] text-slate-600">
          {room && <span className="px-1.5 py-0.5 rounded bg-slate-100">{room}</span>}
          {damage && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{damage}</span>}
          {severity && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800">{severity}</span>}
        </div>
        {showTechnical && (
          <div className="text-[11px] text-slate-500 space-y-0.5 pt-1">
            {taken && <div>Captured: {new Date(taken).toLocaleString()}</div>}
            {device && <div>Device: {device}</div>}
            {lat && lng && (
              <div className="flex items-center gap-1">
                <Droplets className="w-3 h-3"/> GPS {String(lat).slice(0, 8)}, {String(lng).slice(0, 8)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
