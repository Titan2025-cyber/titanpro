/**
 * PhotoSearch.tsx — Cross-job photo library + search.
 *
 * Route: /photos
 *
 * Lets techs and office staff query every photo ever taken across every
 * job — filter by free-text (filename/caption), room label, damage type,
 * severity, category, phase, capture-date range, or a specific job.
 * Facet counts (from /api/photos/search) drive one-click chip filters so
 * a user can drill from "all photos" to "everything tagged 'kitchen' with
 * 'water damage'" in two clicks.
 *
 * Design notes:
 *   • Debounced text input (350ms) — avoids hammering the endpoint while
 *     the user is still typing.
 *   • Facet chips light up when active and act as toggles.
 *   • Clicking a tile opens a lightbox with the full-size image + a jump-
 *     to-job button so you can pivot from search into the source job's
 *     photo tab.
 *   • Paginator at the bottom (limit=100 by default).
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Search, X, Filter, ImageIcon, MapPin, Calendar, ArrowRight, Loader2, Camera } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";

interface SearchPhoto {
  id: number;
  jobId: number;
  jobNumber?: string;
  jobAddress?: string;
  customerName?: string;
  filename: string;
  caption?: string;
  dataUrl?: string;
  room?: string;
  damageType?: string;
  severity?: string;
  category?: string;
  phase?: string;
  aiClassified?: boolean;
  takenAt?: string;
  originalTakenAt?: string;
  uploadedAt?: string;
  latitude?: number;
  longitude?: number;
}

interface Facet { v: string | null; n: number; }
interface SearchResponse {
  total: number;
  limit: number;
  offset: number;
  photos: SearchPhoto[];
  facets: { room: Facet[]; damageType: Facet[]; severity: Facet[]; category: Facet[]; };
}

export default function PhotoSearch() {
  const [, navigate] = useLocation();

  // Search inputs
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [room, setRoom] = useState("");
  const [damageType, setDamageType] = useState("");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [phase, setPhase] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 100;

  // Results
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [lightbox, setLightbox] = useState<SearchPhoto | null>(null);

  // Debounce the free-text box so we're not firing on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setOffset(0); }, 350);
    return () => clearTimeout(t);
  }, [q]);

  // Reset pagination whenever a filter changes.
  useEffect(() => { setOffset(0); }, [room, damageType, severity, category, phase, from, to]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (debouncedQ) params.set("q", debouncedQ);
      if (room) params.set("room", room);
      if (damageType) params.set("damageType", damageType);
      if (severity) params.set("severity", severity);
      if (category) params.set("category", category);
      if (phase) params.set("phase", phase);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      try {
        const res = await apiRequest("GET", `/api/photos/search?${params.toString()}`);
        const json = await res.json();
        if (!cancelled) setResult(json);
      } catch {
        if (!cancelled) setResult({ total: 0, limit, offset, photos: [], facets: { room: [], damageType: [], severity: [], category: [] } });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [debouncedQ, room, damageType, severity, category, phase, from, to, offset]);

  const anyFilter = !!(debouncedQ || room || damageType || severity || category || phase || from || to);
  const clearAll = () => {
    setQ(""); setDebouncedQ("");
    setRoom(""); setDamageType(""); setSeverity(""); setCategory(""); setPhase("");
    setFrom(""); setTo(""); setOffset(0);
  };

  const pageStart = offset + 1;
  const pageEnd = Math.min(offset + (result?.photos.length ?? 0), result?.total ?? 0);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2"><ImageIcon className="w-8 h-8 text-teal-600"/> Photo Library</h1>
        <p className="text-sm text-slate-600 mt-1">Search every photo across every job — filter by room, damage type, date, or free-text.</p>
      </div>

      {/* Filter bar */}
      <div className="border rounded-lg bg-white p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/>
            <Input
              placeholder="Search filename or caption…"
              value={q}
              onChange={e => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">From</label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40"/>
            <label className="text-xs text-slate-500">To</label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40"/>
          </div>
          {anyFilter && (
            <Button variant="ghost" size="sm" onClick={clearAll} className="text-slate-600">
              <X className="w-4 h-4 mr-1"/> Clear
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Select value={room || "any"} onValueChange={v => setRoom(v === "any" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Any room"/></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any room</SelectItem>
              {result?.facets.room.filter(f => f.v).map(f => (
                <SelectItem key={f.v!} value={f.v!}>{f.v} ({f.n})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={damageType || "any"} onValueChange={v => setDamageType(v === "any" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Any damage type"/></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any damage type</SelectItem>
              {result?.facets.damageType.filter(f => f.v).map(f => (
                <SelectItem key={f.v!} value={f.v!}>{f.v} ({f.n})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={severity || "any"} onValueChange={v => setSeverity(v === "any" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Any severity"/></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any severity</SelectItem>
              {result?.facets.severity.filter(f => f.v).map(f => (
                <SelectItem key={f.v!} value={f.v!}>{f.v} ({f.n})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category || "any"} onValueChange={v => setCategory(v === "any" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Any category"/></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any category</SelectItem>
              {result?.facets.category.filter(f => f.v).map(f => (
                <SelectItem key={f.v!} value={f.v!}>{f.v} ({f.n})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={phase || "any"} onValueChange={v => setPhase(v === "any" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Any phase"/></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any phase</SelectItem>
              <SelectItem value="mitigation">Mitigation</SelectItem>
              <SelectItem value="reconstruction">Reconstruction</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Result summary */}
      <div className="flex items-center justify-between text-sm text-slate-600">
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="w-4 h-4 animate-spin"/>}
          {result && !loading && (
            <span>
              <span className="font-semibold text-slate-900">{result.total.toLocaleString()}</span> photos
              {result.total > 0 && (
                <span className="ml-2 text-slate-400">· showing {pageStart}–{pageEnd}</span>
              )}
            </span>
          )}
        </div>
        {result && result.total > limit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Prev</Button>
            <Button variant="outline" size="sm" disabled={offset + limit >= result.total} onClick={() => setOffset(offset + limit)}>Next</Button>
          </div>
        )}
      </div>

      {/* Photo grid */}
      {result && result.photos.length === 0 && !loading && (
        <div className="border rounded-lg p-12 text-center text-slate-500 bg-slate-50">
          <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-40"/>
          <div className="font-medium">No photos match those filters</div>
          <div className="text-xs mt-1">Try broadening the date range or clearing the room/damage tags.</div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {result?.photos.map(p => (
          <button
            key={p.id}
            className="group text-left bg-white rounded-lg overflow-hidden border hover:border-teal-600 hover:shadow transition"
            onClick={() => setLightbox(p)}
          >
            <div className="aspect-square bg-slate-100 relative overflow-hidden">
              {p.dataUrl ? (
                <img src={p.dataUrl} alt={p.caption || p.filename} className="w-full h-full object-cover group-hover:scale-105 transition-transform"/>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-300"><Camera className="w-8 h-8"/></div>
              )}
              {p.damageType && (
                <span className="absolute top-1 left-1 bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide">
                  {p.damageType}
                </span>
              )}
              {p.aiClassified && (
                <span className="absolute top-1 right-1 bg-teal-600 text-white text-[10px] px-1.5 py-0.5 rounded">AI</span>
              )}
            </div>
            <div className="p-2 space-y-1">
              <div className="text-xs font-semibold truncate">{p.room || "—"}</div>
              <div className="text-[10px] text-slate-500 truncate">Job #{p.jobNumber || p.jobId} · {p.customerName || "—"}</div>
              <div className="text-[10px] text-slate-400">
                {(p.originalTakenAt || p.takenAt || "").slice(0, 10) || "no date"}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Bottom paginator */}
      {result && result.total > limit && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Prev</Button>
          <span className="text-sm text-slate-600 px-3">
            Page {Math.floor(offset / limit) + 1} of {Math.max(1, Math.ceil(result.total / limit))}
          </span>
          <Button variant="outline" disabled={offset + limit >= result.total} onClick={() => setOffset(offset + limit)}>Next</Button>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <div className="max-w-5xl w-full bg-white rounded-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-900 text-white px-4 py-2 flex items-center justify-between">
              <div className="text-sm font-semibold truncate">{lightbox.caption || lightbox.filename}</div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => { navigate(`/jobs/${lightbox.jobId}`); setLightbox(null); }}>
                  <ArrowRight className="w-3 h-3 mr-1"/> Open job
                </Button>
                <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={() => setLightbox(null)}>
                  <X className="w-4 h-4"/>
                </Button>
              </div>
            </div>
            <div className="bg-black flex items-center justify-center max-h-[70vh]">
              {lightbox.dataUrl && <img src={lightbox.dataUrl} alt={lightbox.caption || lightbox.filename} className="max-h-[70vh] object-contain"/>}
            </div>
            <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div><div className="text-slate-500 uppercase text-[10px]">Job</div><div className="font-medium">#{lightbox.jobNumber || lightbox.jobId}</div></div>
              <div><div className="text-slate-500 uppercase text-[10px]">Customer</div><div className="font-medium truncate">{lightbox.customerName || "—"}</div></div>
              <div><div className="text-slate-500 uppercase text-[10px]">Room</div><div className="font-medium">{lightbox.room || "—"}</div></div>
              <div><div className="text-slate-500 uppercase text-[10px]">Damage</div><div className="font-medium">{lightbox.damageType || "—"}</div></div>
              <div><div className="text-slate-500 uppercase text-[10px]">Category</div><div className="font-medium">{lightbox.category || "—"}</div></div>
              <div><div className="text-slate-500 uppercase text-[10px]">Phase</div><div className="font-medium">{lightbox.phase || "—"}</div></div>
              <div><div className="text-slate-500 uppercase text-[10px]">Taken</div><div className="font-medium">{(lightbox.originalTakenAt || lightbox.takenAt || "").slice(0, 16).replace("T", " ") || "—"}</div></div>
              <div><div className="text-slate-500 uppercase text-[10px]">Address</div><div className="font-medium truncate">{lightbox.jobAddress || "—"}</div></div>
              {(lightbox.latitude && lightbox.longitude) && (
                <div className="col-span-2 md:col-span-4">
                  <div className="text-slate-500 uppercase text-[10px]">GPS</div>
                  <a href={`https://maps.google.com/?q=${lightbox.latitude},${lightbox.longitude}`} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline flex items-center gap-1">
                    <MapPin className="w-3 h-3"/> {lightbox.latitude.toFixed(5)}, {lightbox.longitude.toFixed(5)}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
