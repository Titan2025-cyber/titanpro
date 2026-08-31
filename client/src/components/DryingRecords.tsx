/**
 * DryingRecords.tsx — IICRC S500 Drying Log
 * Full mitigation tracking: psychrometrics, moisture readings, equipment, affected areas.
 * Used in JobDetail (Mitigation tab) and Technician view.
 * Viewable by techs, admins, and portals (read-only for portals).
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { UserSelect } from "@/components/UserSelect";
import { useState } from "react";
import {
  Plus, Trash2, ChevronDown, ChevronUp, CheckCircle2,
  Thermometer, Droplets, Wind, Clipboard, Save, AlertTriangle,
  Scissors
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { DryingRecord } from "@shared/schema";
import { SyncChip, useJobQueue } from "@/components/SyncChip";
import { CloudUpload, RefreshCw } from "lucide-react";
import { formatAge } from "@/lib/offlineQueue";
import { todayLocalISO } from "@/lib/dates";

// ── IICRC S500 Reference Data ────────────────────────────────────────────────
const WATER_CATEGORIES = [
  { value: "category1", label: "Category 1 — Clean Water", desc: "Sanitary water source (supply line, faucet)", color: "bg-blue-100 text-blue-800" },
  { value: "category2", label: "Category 2 — Gray Water", desc: "Contaminated water (appliance overflow, toilet bowl)", color: "bg-yellow-100 text-yellow-800" },
  { value: "category3", label: "Category 3 — Black Water", desc: "Grossly contaminated (sewage, flooding)", color: "bg-red-100 text-red-800" },
];

const WATER_CLASSES = [
  { value: "class1", label: "Class 1 — Least Amount of Water", desc: "Slow evaporation; low porosity materials only", target: "≤500 GPP" },
  { value: "class2", label: "Class 2 — Significant Amount", desc: "Fast evaporation; carpet/cushion, structural materials wet to < 24 inches", target: "500–900 GPP" },
  { value: "class3", label: "Class 3 — Greatest Amount", desc: "Fastest evaporation; entire room wet, ceilings, walls, insulation", target: ">900 GPP" },
  { value: "class4", label: "Class 4 — Special Situations", desc: "Deeply saturated materials: hardwood, plaster, concrete", target: "Low humidity required" },
];

const EQUIPMENT_TYPES = [
  "LGR Dehumidifier", "Conventional Dehumidifier", "Desiccant Dehumidifier",
  "Axial Air Mover", "Centrifugal Air Mover", "HEPA Air Scrubber",
  "Negative Air Machine", "Injectidry System", "Drying Mat System",
  "Structural Drying Panel", "Hydroxyl Generator", "Ozone Generator",
  "Moisture Meter (Pin)", "Moisture Meter (Pinless)", "Thermal Hygrometer",
  "Thermal Camera", "Submersible Pump", "Truck Mount Extractor",
];

const MATERIAL_TYPES = [
  // ── Flooring — finished surfaces ──
  "Solid Hardwood Floor", "Engineered Hardwood Floor", "Laminate Flooring",
  "Luxury Vinyl Plank (LVP)", "Luxury Vinyl Tile (LVT)", "Sheet Vinyl",
  "Vinyl Composition Tile (VCT)", "Ceramic Tile", "Porcelain Tile",
  "Natural Stone Tile", "Marble Tile", "Travertine Tile", "Slate Tile",
  "Terrazzo", "Polished/Stained Concrete", "Epoxy Floor Coating",
  "Bamboo Flooring", "Cork Flooring", "Parquet Flooring", "Linoleum",
  "Rubber Flooring", "Carpet", "Carpet Tile", "Area Rug",
  // ── Flooring — underlayment / pad / substrate ──
  "Carpet Pad", "Foam Underlayment", "Cork Underlayment", "Felt Underlayment",
  "Cement Board (Tile Backer)", "Self-Leveling Underlayment", "Thinset/Mortar Bed",
  "Gypsum Underlayment", "Rosin Paper",
  // ── Subfloor / structure ──
  "Plywood Subfloor", "OSB Subfloor", "Particle Board Subfloor", "Concrete Slab",
  "Floor Joist", "Sill Plate", "Framing (2x4)", "Framing (2x6)", "LVL Beam",
  // ── Walls / ceiling / other ──
  "Drywall", "Ceiling Drywall", "Plaster", "Baseboards", "Trim/Millwork",
  "Cabinetry (Base)", "Cabinetry (Upper)", "Vanity", "Wood Paneling",
  "Insulation (Batt)", "Insulation (Spray)", "Insulation (Blown)",
  "Tile Backer", "Exterior Sheathing", "Brick/Masonry", "Wall Base (Vinyl/Rubber)",
];


// ── Helper: Calculate GPP from temp + RH ─────────────────────────────────────
// Multi-location psychrometric readings (Inside / Outside / Affected Area).
// Stored as JSON on drying_records.psychrometric_readings. Legacy tempF/rhPct
// columns mirror the Inside slot so existing reports/PDFs keep working.
type PsychroLocation = "inside" | "outside" | "affected";
export interface PsychroReading {
  location: PsychroLocation;
  tempF: number | "";
  rhPct: number | "";
}
const PSYCHRO_LOCATIONS: { key: PsychroLocation; label: string; hint: string }[] = [
  { key: "inside",   label: "Inside",         hint: "Ambient inside the structure (unaffected room)" },
  { key: "outside",  label: "Outside",        hint: "Exterior conditions at time of visit" },
  { key: "affected", label: "Affected Area",  hint: "Inside the drying chamber \u2014 S500 primary reading" },
];
function hydratePsychroReadings(
  raw: string | null | undefined,
  legacyTempF: number | null | undefined,
  legacyRhPct: number | null | undefined
): PsychroReading[] {
  let parsed: PsychroReading[] = [];
  try { parsed = JSON.parse(raw || "[]"); } catch { parsed = []; }
  const byLoc = new Map(parsed.map(p => [p.location, p]));
  if (parsed.length === 0 && (legacyTempF != null || legacyRhPct != null)) {
    byLoc.set("inside", { location: "inside", tempF: legacyTempF ?? "", rhPct: legacyRhPct ?? "" });
  }
  return PSYCHRO_LOCATIONS.map(l => byLoc.get(l.key) ?? { location: l.key, tempF: "", rhPct: "" });
}
function serializePsychroReadings(readings: PsychroReading[]): string {
  return JSON.stringify(readings.filter(r => r.tempF !== "" || r.rhPct !== ""));
}
function insideOf(readings: PsychroReading[]): PsychroReading {
  return readings.find(r => r.location === "inside") ?? { location: "inside", tempF: "", rhPct: "" };
}

function calcGPP(tempF: number, rh: number): number {
  // Simplified psychrometric: GPP = 0.62198 * Pws * (RH/100) / (P - Pws*(RH/100)) * 7000
  const tempC = (tempF - 32) * 5 / 9;
  const pws = 6.1078 * Math.exp(17.27 * tempC / (tempC + 237.3)); // Antoine approx (kPa * 10)
  const p = 101.325;
  const w = 0.62198 * (pws * rh / 100) / (p - pws * rh / 100);
  return Math.round(w * 7000 * 10) / 10; // grains per pound
}

function calcDewPoint(tempF: number, rh: number): number {
  const tempC = (tempF - 32) * 5 / 9;
  const a = 17.27, b = 237.3;
  const alpha = (a * tempC) / (b + tempC) + Math.log(rh / 100);
  const dpC = (b * alpha) / (a - alpha);
  return Math.round(((dpC * 9 / 5) + 32) * 10) / 10;
}

// ── Sub-components ────────────────────────────────────────────────────────────
// Moisture-reading row. One row = one material at one location per visit.
// When a tech tears a wet material out mid-drying (e.g. wet drywall being
// removed for sill plate), we DO NOT delete the row — IICRC S500 auditors
// want to see the final wet reading before removal. Instead:
//   1. The original row is marked tearOut=true and locked (grayscaled).
//   2. A new row appears for the same location tracking the replacement
//      material's readings going forward.
// Both rows persist on the record; historical moisture trending still
// counts the original material's readings from before removal.
interface MoistureRow {
  id: number;
  location: string;
  material: string;
  reading: number;
  target: number;
  tearOut?: boolean;        // true = this material was torn out and is preserved for audit only
  removedOn?: string;       // YYYY-MM-DD when the tear-out was recorded
  removedDay?: number;      // Day # of the drying record when the tear-out happened
  replacedWith?: string;    // The replacement material name (mirrors the new row's material for cross-ref)
}
interface DehuReading {
  id: number;
  date: string;      // YYYY-MM-DD
  intakeTemp: number;  // °F at dehu air intake
  intakeRh: number;    // % RH at intake
  outTemp: number;     // °F of dry air output
  outRh: number;       // % RH of dry air output
  notes?: string;
}
interface EquipRow {
  id: number;
  type: string;
  qty: number;
  placement: string;
  serialNumber: string;
  dailyReadings?: DehuReading[]; // per-day intake/output readings (dehumidifiers)
  // ── Per-room deployment tracking (added 2026-08-27) ──────────────────
  // Links this equipment row to a specific affected area (matches an
  // AreaRow.room label on the same drying record) plus its deployment
  // window. Runtime hours is derived from start→end when both are set,
  // otherwise the row is treated as still deployed.
  room?: string;         // matches an AreaRow.room label on this record
  startDate?: string;    // YYYY-MM-DD when the equipment was placed
  startTime?: string;    // HH:MM (24h, local) when the equipment was placed
  endDate?: string;      // YYYY-MM-DD when the equipment was pulled (blank = still deployed)
  endTime?: string;      // HH:MM (24h, local) when the equipment was pulled
}

// Runtime in hours between (startDate,startTime) and (endDate,endTime). Time
// components are optional and default to 00:00 so records created before the
// time fields existed keep working. Precision is one decimal hour so a 2h15m
// deployment reads as "2.3h" — accurate enough for reimbursement without
// visually noisy minute counts. Returns null on missing/invalid bounds.
function runtimeHoursBetween(
  startDate?: string,
  endDate?: string,
  startTime?: string,
  endTime?: string,
): number | null {
  if (!startDate || !endDate) return null;
  const st = /^\d{2}:\d{2}$/.test(startTime || "") ? startTime : "00:00";
  const et = /^\d{2}:\d{2}$/.test(endTime || "") ? endTime : "00:00";
  const s = new Date(`${startDate}T${st}:00`);
  const e = new Date(`${endDate}T${et}:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const hrs = (e.getTime() - s.getTime()) / 3_600_000;
  if (hrs < 0) return null;
  return Math.round(hrs * 10) / 10;
}
// Affected area — a room/material pairing with wetness state. Optionally
// tagged as a tear-out (material removed) with the replacement material
// the tech intends to install so the reconstruction phase can be
// pre-scoped straight from the drying record.
interface AreaRow {
  id: number;
  room: string;
  material: string;
  sqft: number;
  wetPct: number;
  tearOut?: boolean;         // true when this material is being torn out (row becomes audit-only after removal)
  replacedWith?: string;     // replacement material name (kept for cross-reference with the new AreaRow below)
  removedOn?: string;        // YYYY-MM-DD when the tear-out happened
  removedDay?: number;       // drying-record day # when the tear-out happened
}

// Multi-location psychrometric grid. Renders Inside / Outside / Affected Area
// rows with Temp + RH inputs and auto-computed GPP + Dew Point per row. Also
// shows the Outside→Affected grain-depression Δ — the number techs actually
// watch to confirm the drying chamber is removing moisture.
function PsychrometricGrid({
  readings, onChange, readOnly = false,
}: {
  readings: PsychroReading[];
  onChange: (r: PsychroReading[]) => void;
  readOnly?: boolean;
}) {
  const setField = (loc: PsychroLocation, field: "tempF" | "rhPct", val: string) => {
    onChange(readings.map(r => r.location === loc ? { ...r, [field]: val === "" ? "" : Number(val) } : r));
  };
  const rowFor = (loc: PsychroLocation) => readings.find(r => r.location === loc) ?? { location: loc, tempF: "" as const, rhPct: "" as const };
  const gppFor = (r: PsychroReading) => (r.tempF !== "" && r.rhPct !== "") ? calcGPP(Number(r.tempF), Number(r.rhPct)) : null;
  const dpFor  = (r: PsychroReading) => (r.tempF !== "" && r.rhPct !== "") ? calcDewPoint(Number(r.tempF), Number(r.rhPct)) : null;
  const outsideGpp  = gppFor(rowFor("outside"));
  const affectedGpp = gppFor(rowFor("affected"));
  const delta = (outsideGpp !== null && affectedGpp !== null) ? Math.round((outsideGpp - affectedGpp) * 10) / 10 : null;
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <Thermometer className="w-3.5 h-3.5" />Psychrometric Data (S500 §11)
      </p>
      <div className="space-y-1.5">
        {/* Header row for wide screens */}
        <div className="hidden md:grid grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          <div>Location</div><div>Temp (°F)</div><div>RH (%)</div><div>GPP (calc)</div><div>Dew Point</div>
        </div>
        {PSYCHRO_LOCATIONS.map(loc => {
          const r = rowFor(loc.key);
          const gpp = gppFor(r);
          const dp = dpFor(r);
          return (
            <div key={loc.key} className="grid grid-cols-2 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 items-center">
              <div className="col-span-2 md:col-span-1">
                <Label className="text-xs font-medium" title={loc.hint}>{loc.label}</Label>
              </div>
              <Input
                type="number"
                inputMode="decimal"
                className="h-8 text-xs"
                placeholder={loc.key === "outside" ? "85" : loc.key === "affected" ? "78" : "72"}
                value={r.tempF}
                disabled={readOnly}
                onChange={e => setField(loc.key, "tempF", e.target.value)}
                data-testid={`input-psychro-${loc.key}-temp`}
              />
              <Input
                type="number"
                inputMode="decimal"
                className="h-8 text-xs"
                placeholder={loc.key === "outside" ? "65" : loc.key === "affected" ? "45" : "55"}
                value={r.rhPct}
                disabled={readOnly}
                onChange={e => setField(loc.key, "rhPct", e.target.value)}
                data-testid={`input-psychro-${loc.key}-rh`}
              />
              <div className={`h-8 px-3 flex items-center rounded border text-xs font-mono ${gpp && gpp > 900 ? "bg-red-50 border-red-300 text-red-700 dark:bg-red-950" : gpp && gpp > 500 ? "bg-yellow-50 border-yellow-300 dark:bg-yellow-950" : "bg-muted"}`}>
                {gpp !== null ? `${gpp} GPP` : "\u2014"}
              </div>
              <div className="h-8 px-3 flex items-center rounded border text-xs font-mono bg-muted">
                {dp !== null ? `${dp}\u00b0F` : "\u2014"}
              </div>
            </div>
          );
        })}
        {/* Grain-depression delta: Outside GPP → Affected GPP */}
        {delta !== null && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <Badge className={delta > 0 ? "bg-green-500 text-white" : "bg-yellow-400 text-yellow-900"}>
              Δ {delta > 0 ? "\u2013" : "+"}{Math.abs(delta)} GPP vs Outside
            </Badge>
            <span className="text-muted-foreground">
              {delta > 0
                ? "Chamber is drier than outside \u2014 dehus are working."
                : "Affected area is wetter than outside \u2014 add capacity or check containment."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// History map: "location|material" -> chronological list of prior readings
// (oldest first) plus the day number they were captured on. Used to render an
// inline trend under each moisture row so the tech can see "where this point
// started and where it is trending" without opening older records.
export type MoistureHistory = Record<string, Array<{ day: number; reading: number; date: string }>>;

function moistureKey(location: string, material: string) {
  return `${(location || "").trim().toLowerCase()}|${(material || "").trim().toLowerCase()}`;
}

// Build a MoistureHistory from prior drying records. Missed-day records have
// no moisture readings and are skipped. Records are walked oldest-first so the
// resulting trend array is in chronological order.
function buildMoistureHistory(priorRecords: DryingRecord[]): MoistureHistory {
  const history: MoistureHistory = {};
  const chronological = [...priorRecords]
    .filter(r => (r as any).recordType !== "missed")
    .sort((a, b) => {
      const da = a.readingDate || "";
      const dbb = b.readingDate || "";
      if (da !== dbb) return da.localeCompare(dbb);
      return (a.dayNumber || 0) - (b.dayNumber || 0);
    });
  for (const r of chronological) {
    let rows: MoistureRow[] = [];
    try { rows = JSON.parse(r.moistureReadings || "[]"); } catch { rows = []; }
    for (const row of rows) {
      if (!row || (!row.location && !row.material)) continue;
      const key = moistureKey(row.location, row.material);
      (history[key] ||= []).push({ day: r.dayNumber || 0, reading: Number(row.reading) || 0, date: r.readingDate || "" });
    }
  }
  return history;
}

// Suggested moisture-content target by material (WME %). Used when a
// replacement material is dropped in via tear-out, so the tech doesn't
// have to remember that hardwood dries to 12 but drywall dries to 17.
function defaultTargetForMaterial(m: string): number {
  const s = (m || "").toLowerCase();
  if (s.includes("hardwood") || s.includes("wood floor")) return 12;
  if (s.includes("concrete") || s.includes("masonry") || s.includes("brick")) return 16;
  if (s.includes("plywood") || s.includes("osb") || s.includes("subfloor")) return 19;
  if (s.includes("framing") || s.includes("stud") || s.includes("sill") || s.includes("joist") || s.includes("lumber")) return 15;
  return 17; // drywall + default fallback
}

function MoistureTable({ rows, onChange, readOnly, history, dayNumber, readingDate }: {
  rows: MoistureRow[];
  onChange: (r: MoistureRow[]) => void;
  readOnly?: boolean;
  history?: MoistureHistory;
  // dayNumber + readingDate are used to stamp tear-out events so the audit
  // trail shows exactly WHEN a material was removed during drying. Both are
  // optional — read-only card views don't pass them and don't need them.
  dayNumber?: number;
  readingDate?: string;
}) {
  const add = () => onChange([...rows, { id: Date.now(), location: "", material: "Drywall", reading: 0, target: 17 }]);
  const del = (id: number) => onChange(rows.filter(r => r.id !== id));
  const upd = (id: number, field: keyof MoistureRow, val: any) =>
    onChange(rows.map(r => r.id === id ? { ...r, [field]: val } : r));

  // Tear-out: lock the existing row (mark tearOut + stamp date/day), and
  // insert a fresh row for the replacement material at the SAME location
  // right below. The original row is preserved for S500 audit continuity;
  // the replacement row starts with a zero reading so the tech records
  // the initial moisture of the newly-installed material.
  const tearOut = (row: MoistureRow) => {
    const replacement = row.material === "Drywall" ? "Sill Plate" : row.material;
    const stamp = readingDate || new Date().toISOString().slice(0, 10);
    const nextRows: MoistureRow[] = [];
    for (const r of rows) {
      if (r.id === row.id) {
        nextRows.push({
          ...r,
          tearOut: true,
          removedOn: stamp,
          removedDay: dayNumber,
          replacedWith: replacement,
        });
        nextRows.push({
          id: Date.now() + Math.floor(Math.random() * 1000),
          location: r.location,
          material: replacement,
          reading: 0,
          target: defaultTargetForMaterial(replacement),
        });
      } else {
        nextRows.push(r);
      }
    }
    onChange(nextRows);
  };

  // Undo tear-out (only meaningful for a tear-out marked earlier this same
  // visit — lets techs correct a mistap without editing raw JSON). Also
  // removes the replacement row IF it's still empty (untouched by the tech).
  const undoTearOut = (row: MoistureRow) => {
    const nextRows: MoistureRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.id === row.id) {
        nextRows.push({ ...r, tearOut: false, removedOn: undefined, removedDay: undefined, replacedWith: undefined });
        // Drop the immediately-following replacement row if it's the
        // freshly-added, still-empty one for the same location.
        const nxt = rows[i + 1];
        if (nxt && nxt.location === r.location && nxt.material === r.replacedWith && (nxt.reading === 0 || !nxt.reading)) {
          i += 1; // skip it
        }
      } else {
        nextRows.push(r);
      }
    }
    onChange(nextRows);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Moisture Readings (WME %)</p>
        {!readOnly && <Button size="sm" variant="outline" onClick={add} className="h-7 text-xs"><Plus className="w-3 h-3 mr-1" />Add</Button>}
      </div>
      <div className="space-y-1.5">
        {rows.map(row => {
          // Torn-out rows are locked, grayscaled, and read-only regardless of
          // the parent readOnly flag. This is deliberate — an audit row must
          // never be editable after the fact, since it captures the last-known
          // wet reading before removal.
          const isTorn = !!row.tearOut;
          const over = row.reading > row.target;
          const trend = history?.[moistureKey(row.location, row.material)] || [];
          const day1 = trend[0];
          const recent = trend.slice(-3);
          const showDay1Separately = day1 && !recent.includes(day1);
          const target = row.target || 0;
          const rowInputsDisabled = readOnly || isTorn;
          return (
            <div key={row.id} className="space-y-0.5">
              <div className={`grid grid-cols-12 gap-1 items-center ${isTorn ? "opacity-60" : ""}`}>
                <Input className="col-span-3 h-7 text-xs" placeholder="Location" value={row.location} disabled={rowInputsDisabled}
                  onChange={e => upd(row.id, "location", e.target.value)} />
                <Select value={row.material} onValueChange={v => upd(row.id, "material", v)} disabled={rowInputsDisabled}>
                  <SelectTrigger className={`col-span-3 h-7 text-xs ${isTorn ? "line-through text-red-700 dark:text-red-400" : ""}`}><SelectValue /></SelectTrigger>
                  <SelectContent>{MATERIAL_TYPES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
                <div className="col-span-2 relative">
                  <Input className={`h-7 text-xs pr-6 ${isTorn ? "text-muted-foreground" : over ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : ""}`}
                    type="number" placeholder="Reading" value={row.reading || ""} disabled={rowInputsDisabled}
                    onChange={e => upd(row.id, "reading", Number(e.target.value))} />
                  {over && !isTorn && <AlertTriangle className="absolute right-1 top-1.5 w-3.5 h-3.5 text-red-500" />}
                </div>
                <Input className="col-span-2 h-7 text-xs" type="number" placeholder="Target" value={row.target || ""}
                  disabled={rowInputsDisabled} onChange={e => upd(row.id, "target", Number(e.target.value))} />
                <div className="col-span-1 flex justify-center">
                  {isTorn
                    ? <Badge className="text-xs h-5 bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200 border-0" title="Material removed — preserved for audit">OUT</Badge>
                    : over
                      ? <Badge className="text-xs h-5 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200 border-0">WET</Badge>
                      : <Badge className="text-xs h-5 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200 border-0">DRY</Badge>
                  }
                </div>
                {!readOnly && !isTorn && (
                  <div className="col-span-1 flex items-center gap-0.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-amber-700 hover:text-red-700 hover:bg-red-50 dark:text-amber-300"
                      title="Mark material as torn out and start a new row for the replacement"
                      onClick={() => tearOut(row)}
                      data-testid={`button-moisture-tearout-${row.id}`}
                    >
                      <Scissors className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => del(row.id)} title="Delete this row">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                )}
                {/* Torn-out rows show an undo button in place of the action
                    cluster, so a mistap can be corrected without hand-editing
                    the JSON. Read-only card view shows nothing. */}
                {!readOnly && isTorn && (
                  <div className="col-span-1 flex justify-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      title="Undo tear-out (only removes the auto-added replacement row if it's still empty)"
                      onClick={() => undoTearOut(row)}
                      data-testid={`button-moisture-tearout-undo-${row.id}`}
                    >
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>
              {/* Tear-out audit chip: shows "TORN OUT day 3 → Sill Plate" so
                  the S500 record makes the transition unambiguous even years
                  later. Persists on the record forever. */}
              {isTorn && (
                <div className="pl-1 flex items-center gap-1.5 text-[10px] text-red-700 dark:text-red-400 font-medium">
                  <Scissors className="w-3 h-3" />
                  <span>TORN OUT{row.removedDay ? ` · Day ${row.removedDay}` : ""}{row.removedOn ? ` · ${row.removedOn}` : ""}</span>
                  {row.replacedWith && (
                    <span className="text-muted-foreground">→ replaced with <span className="font-semibold text-foreground">{row.replacedWith}</span></span>
                  )}
                </div>
              )}
              {trend.length > 0 && !isTorn && (
                <div className="col-span-12 pl-1 flex items-center gap-1.5 text-[10px] text-muted-foreground flex-wrap">
                  <span className="uppercase tracking-wide">Prior:</span>
                  {showDay1Separately && day1 && (
                    <>
                      <span className={day1.reading > target ? "text-red-600 dark:text-red-400 font-medium" : "text-green-700 dark:text-green-400"}>
                        D{day1.day}: {day1.reading}%
                      </span>
                      <span className="opacity-40">…</span>
                    </>
                  )}
                  {recent.map((t, i) => (
                    <span key={i} className={t.reading > target ? "text-red-600 dark:text-red-400 font-medium" : "text-green-700 dark:text-green-400"}>
                      D{t.day}: {t.reading}%{i < recent.length - 1 ? " →" : ""}
                    </span>
                  ))}
                  {day1 && recent.length > 0 && recent[recent.length - 1].reading < day1.reading && (
                    <span className="text-green-700 dark:text-green-400 font-medium">(↓ {day1.reading - recent[recent.length - 1].reading}% since D{day1.day})</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-xs text-muted-foreground italic py-2">No readings recorded yet.</p>}
      </div>
      <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
        <span>Standard targets: Drywall ≤17%, Plywood ≤19%, Hardwood ≤12%, Concrete ≤16%</span>
      </div>
    </div>
  );
}

// Per-dehumidifier daily readings sub-table. Captures intake + dry-air output
// temp/RH; grain depression (GPP removed) is auto-calculated to verify the unit
// is actually pulling moisture. Data lives inside the EquipRow JSON — no schema
// change needed.
function DehuReadingsPanel({ readings, onChange, readOnly }: { readings: DehuReading[]; onChange: (r: DehuReading[]) => void; readOnly?: boolean }) {
  const today = new Date().toISOString().split("T")[0];
  const add = () => onChange([...readings, { id: Date.now(), date: today, intakeTemp: 0, intakeRh: 0, outTemp: 0, outRh: 0 }]);
  const del = (id: number) => onChange(readings.filter(r => r.id !== id));
  const upd = (id: number, field: keyof DehuReading, val: any) =>
    onChange(readings.map(r => r.id === id ? { ...r, [field]: val } : r));

  return (
    <div className="col-span-12 ml-3 mt-1 mb-2 pl-3 border-l-2 border-blue-200 dark:border-blue-900">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">Daily Dehu Readings</p>
        {!readOnly && <Button size="sm" variant="outline" onClick={add} className="h-6 text-[11px] px-2"><Plus className="w-3 h-3 mr-1" />Reading</Button>}
      </div>
      {readings.length > 0 && (
        <div className="grid grid-cols-12 gap-1 text-[10px] font-medium text-muted-foreground uppercase mb-0.5">
          <span className="col-span-3">Date</span>
          <span className="col-span-2 text-center">Intake °F</span>
          <span className="col-span-2 text-center">Intake RH%</span>
          <span className="col-span-2 text-center">Dry-Air °F</span>
          <span className="col-span-2 text-center">Dry-Air RH%</span>
          <span className="col-span-1"></span>
        </div>
      )}
      <div className="space-y-1">
        {readings.map(r => {
          const intakeGpp = r.intakeTemp && r.intakeRh ? calcGPP(Number(r.intakeTemp), Number(r.intakeRh)) : null;
          const outGpp = r.outTemp && r.outRh ? calcGPP(Number(r.outTemp), Number(r.outRh)) : null;
          const depression = intakeGpp != null && outGpp != null ? Math.round((intakeGpp - outGpp) * 10) / 10 : null;
          return (
            <div key={r.id}>
              <div className="grid grid-cols-12 gap-1 items-center">
                <Input className="col-span-3 h-7 text-xs" type="date" value={r.date} disabled={readOnly}
                  onChange={e => upd(r.id, "date", e.target.value)} />
                <Input className="col-span-2 h-7 text-xs text-center" type="number" placeholder="°F" value={r.intakeTemp || ""}
                  disabled={readOnly} onChange={e => upd(r.id, "intakeTemp", Number(e.target.value))} />
                <Input className="col-span-2 h-7 text-xs text-center" type="number" placeholder="%" value={r.intakeRh || ""}
                  disabled={readOnly} onChange={e => upd(r.id, "intakeRh", Number(e.target.value))} />
                <Input className="col-span-2 h-7 text-xs text-center" type="number" placeholder="°F" value={r.outTemp || ""}
                  disabled={readOnly} onChange={e => upd(r.id, "outTemp", Number(e.target.value))} />
                <Input className="col-span-2 h-7 text-xs text-center" type="number" placeholder="%" value={r.outRh || ""}
                  disabled={readOnly} onChange={e => upd(r.id, "outRh", Number(e.target.value))} />
                {!readOnly && <Button size="sm" variant="ghost" className="col-span-1 h-7 px-1 text-destructive" onClick={() => del(r.id)}><Trash2 className="w-3 h-3" /></Button>}
              </div>
              {depression != null && (
                <div className="grid grid-cols-12 gap-1 mt-0.5 mb-0.5">
                  <div className="col-span-11 flex gap-3 text-[10px] text-muted-foreground pl-1">
                    <span>Intake: <strong>{intakeGpp} GPP</strong></span>
                    <span>Dry-air: <strong>{outGpp} GPP</strong></span>
                    <span className={depression > 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}>
                      Grain depression: <strong>{depression} GPP {depression > 0 ? "✓ removing moisture" : "— check unit"}</strong>
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {readings.length === 0 && <p className="text-[11px] text-muted-foreground italic py-1">No daily readings yet. Log intake and dry-air temp/RH each visit.</p>}
      </div>
    </div>
  );
}

function EquipmentTable({
  rows, onChange, readOnly, areaRows, readingDate,
}: {
  rows: EquipRow[];
  onChange: (r: EquipRow[]) => void;
  readOnly?: boolean;
  // Affected-area rows on the same drying record. Their `room` labels populate
  // the equipment Room dropdown so field techs pick from a known list instead
  // of retyping (and possibly misspelling) room names.
  areaRows?: AreaRow[];
  // Reading date of the parent drying record. Used as the default startDate
  // when a new equipment row is added.
  readingDate?: string;
}) {
  // Room options derived from the affected-areas table plus any orphaned
  // rooms already recorded on existing equipment rows (so an equipment row
  // whose room was later removed from the areas table doesn't lose its
  // assignment on next edit).
  const roomOptions = Array.from(new Set([
    ...((areaRows || []).map(a => a.room).filter(Boolean) as string[]),
    ...(rows.map(r => r.room).filter(Boolean) as string[]),
  ])).sort();

  const today = () => new Date().toISOString().slice(0, 10);
  // HH:MM in the local timezone — matches what the <input type="time">
  // control emits so pre-filled values round-trip cleanly.
  const nowHHMM = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  };
  const add = () => onChange([...rows, {
    id: Date.now(),
    type: "LGR Dehumidifier",
    qty: 1,
    placement: "",
    serialNumber: "",
    dailyReadings: [],
    room: roomOptions[0] || "",
    // Default startDate/startTime to the drying record's reading date and the
    // current wall-clock time so techs don't have to re-enter them every time
    // they add a piece of equipment.
    startDate: readingDate || today(),
    startTime: nowHHMM(),
    endDate: "",
    endTime: "",
  }]);
  const del = (id: number) => onChange(rows.filter(r => r.id !== id));
  const upd = (id: number, field: keyof EquipRow, val: any) =>
    onChange(rows.map(r => r.id === id ? { ...r, [field]: val } : r));

  const dehumCount = rows.filter(r => r.type.toLowerCase().includes("dehumid")).reduce((s, r) => s + r.qty, 0);
  const moverCount = rows.filter(r => r.type.toLowerCase().includes("mover")).reduce((s, r) => s + r.qty, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Equipment Log</p>
        {!readOnly && <Button size="sm" variant="outline" onClick={add} className="h-7 text-xs"><Plus className="w-3 h-3 mr-1" />Add</Button>}
      </div>
      <div className="space-y-2">
        {rows.map(row => {
          const isDehu = row.type.toLowerCase().includes("dehumid");
          const dr = row.dailyReadings || [];
          const runtimeHrs = runtimeHoursBetween(row.startDate, row.endDate, row.startTime, row.endTime);
          return (
            <div key={row.id} className={`border rounded-md p-1.5 space-y-1 ${row.endDate ? "bg-muted/40 opacity-80" : ""}`}>
              {row.endDate && (
                <div className="text-[10px] font-medium text-amber-700 dark:text-amber-400 -mb-0.5">
                  Pulled {row.endDate}{row.endTime ? ` · ${row.endTime}` : ""} — won't carry to next day
                </div>
              )}
              {/* Primary line: what it is + serial + actions. */}
              <div className="grid grid-cols-12 gap-1 items-center">
                <Select value={row.type} onValueChange={v => upd(row.id, "type", v)} disabled={readOnly}>
                  <SelectTrigger className="col-span-4 h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{EQUIPMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="col-span-1 h-7 text-xs" type="number" min="1" placeholder="Qty" value={row.qty || ""}
                  disabled={readOnly} onChange={e => upd(row.id, "qty", Number(e.target.value))} />
                {/* Serial width shrinks by one column per action button that's
                    visible on the right side so the row still adds to 12.
                    Static class strings so Tailwind JIT can pick them up. */}
                {(() => {
                  const actionCols = (isDehu ? 1 : 0) + (!readOnly && !row.endDate ? 1 : 0) + (!readOnly ? 1 : 0);
                  const serialCol = 12 - 4 - 1 - actionCols; // type(4) + qty(1)
                  const serialClass =
                    serialCol === 3 ? "col-span-3" :
                    serialCol === 4 ? "col-span-4" :
                    serialCol === 5 ? "col-span-5" :
                    serialCol === 6 ? "col-span-6" :
                                       "col-span-7";
                  return (
                    <Input className={`${serialClass} h-7 text-xs`} placeholder="Serial / Asset #" value={row.serialNumber}
                      disabled={readOnly} onChange={e => upd(row.id, "serialNumber", e.target.value)} />
                  );
                })()}
                {isDehu && (
                  <Button size="sm" variant="outline" className="col-span-1 h-7 px-1 text-[10px]"
                    onClick={() => upd(row.id, "dailyReadings", dr.length ? dr : [{ id: Date.now(), date: new Date().toISOString().split("T")[0], intakeTemp: 0, intakeRh: 0, outTemp: 0, outRh: 0 }])}
                    title="Show daily readings">
                    <Droplets className="w-3 h-3" />{dr.length > 0 ? dr.length : ""}
                  </Button>
                )}
                {/* Pull button — the primary way to remove equipment. Stamps
                    endDate + endTime with "now" so the row is preserved as
                    audit history (report can still show total runtime) but
                    stops seeding to future days. Trash next to it is for
                    accidental adds and deletes the row entirely. */}
                {!readOnly && !row.endDate && (
                  <Button size="sm" variant="outline" className={`${isDehu ? "col-span-1" : "col-span-1"} h-7 px-1 text-[10px]`}
                    onClick={() => onChange(rows.map(r => r.id === row.id ? {
                      ...r,
                      endDate: new Date().toLocaleDateString("en-CA"),   // YYYY-MM-DD local
                      endTime: new Date().toTimeString().slice(0, 5),   // HH:MM local
                    } : r))}
                    title="Pull this equipment (stamps pulled date+time; keeps it in the report but won't carry to next day)">
                    Pull
                  </Button>
                )}
                {!readOnly && <Button size="sm" variant="ghost" className="col-span-1 h-7 px-1 text-destructive" onClick={() => del(row.id)} title="Delete this row entirely (use Pull instead if it was actually deployed)"><Trash2 className="w-3 h-3" /></Button>}
              </div>
              {/* Secondary line: WHERE the equipment sits. Placement is free-text
                  spot-inside-the-room (e.g. "NE corner"); Room is a dropdown
                  pulled from the affected-areas table so the drying report can
                  roll up runtime per room. */}
              <div className="grid grid-cols-12 gap-1 items-center">
                <Select
                  value={row.room || "__unset__"}
                  onValueChange={v => upd(row.id, "room", v === "__unset__" ? "" : v)}
                  disabled={readOnly}
                >
                  <SelectTrigger className="col-span-5 h-7 text-xs">
                    <SelectValue placeholder="Room" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unset__">— unassigned —</SelectItem>
                    {roomOptions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input className="col-span-7 h-7 text-xs" placeholder="Placement in room" value={row.placement}
                  disabled={readOnly} onChange={e => upd(row.id, "placement", e.target.value)} title="Specific spot within the room (e.g. NE corner, closet)" />
              </div>
              {/* Tertiary line: WHEN it was placed / pulled. Date and time
                  are separate inputs — native <input type="time"> gives us
                  a mobile-friendly wheel on iOS/Android without needing a
                  custom picker. Runtime column shows the derived hours
                  (one decimal) with an "on" pill when still deployed. */}
              <div className="grid grid-cols-12 gap-1 items-center">
                <Input className="col-span-3 h-7 text-xs" type="date" value={row.startDate || ""}
                  disabled={readOnly} onChange={e => upd(row.id, "startDate", e.target.value)} title="Placed date" />
                <Input className="col-span-2 h-7 text-xs" type="time" value={row.startTime || ""}
                  disabled={readOnly} onChange={e => upd(row.id, "startTime", e.target.value)} title="Placed time" />
                <Input className="col-span-3 h-7 text-xs" type="date" value={row.endDate || ""}
                  disabled={readOnly} onChange={e => upd(row.id, "endDate", e.target.value)} title="Pulled date (blank = still deployed)" />
                <Input className="col-span-2 h-7 text-xs" type="time" value={row.endTime || ""}
                  disabled={readOnly} onChange={e => upd(row.id, "endTime", e.target.value)} title="Pulled time" />
                <div className="col-span-2 text-[10px] text-muted-foreground text-right pr-1" title="Total runtime">
                  {runtimeHrs !== null
                    ? <span className="font-medium text-foreground">{runtimeHrs}h</span>
                    : (row.startDate ? <span className="text-amber-600 dark:text-amber-400">on</span> : <span className="opacity-50">—</span>)
                  }
                </div>
              </div>
              {isDehu && dr.length > 0 && (
                <div className="grid grid-cols-12 gap-1">
                  <DehuReadingsPanel readings={dr} onChange={v => upd(row.id, "dailyReadings", v)} readOnly={readOnly} />
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-xs text-muted-foreground italic py-2">No equipment logged yet.</p>}
      </div>
      {rows.length > 0 && (
        <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
          <span>Dehumidifiers: <strong>{dehumCount}</strong></span>
          <span>Air Movers: <strong>{moverCount}</strong></span>
          <span className="opacity-60">S500 §11.4: 1 air mover per 50 SF minimum</span>
        </div>
      )}
    </div>
  );
}

// Stamp date/day fields on any AreaRow whose tearOut flag just went on but
// hasn't been persisted yet. Idempotent — rows already stamped are left alone.
function stampAreaTearOuts(rows: AreaRow[], dayNumber: number | undefined, readingDate: string | undefined): AreaRow[] {
  const stamp = readingDate || new Date().toISOString().slice(0, 10);
  return rows.map(r => {
    if (!r.tearOut) return r;
    if (r.removedOn && r.removedDay) return r;
    return { ...r, removedOn: r.removedOn || stamp, removedDay: r.removedDay ?? dayNumber };
  });
}

function AffectedAreasTable({ rows, onChange, readOnly }: { rows: AreaRow[]; onChange: (r: AreaRow[]) => void; readOnly?: boolean }) {
  const add = () => onChange([...rows, { id: Date.now(), room: "", material: "Drywall", sqft: 0, wetPct: 0 }]);
  const del = (id: number) => onChange(rows.filter(r => r.id !== id));
  const upd = (id: number, field: keyof AreaRow, val: any) =>
    onChange(rows.map(r => r.id === id ? { ...r, [field]: val } : r));
  // Toggle tear-out on a row. When switching ON, pre-fill replacedWith with
  // the same material as a sensible default (like-for-like replacement) so
  // the tech only has to change it when the replacement differs.
  const toggleTearOut = (row: AreaRow) => {
    if (row.tearOut) {
      onChange(rows.map(r => r.id === row.id ? { ...r, tearOut: false, replacedWith: undefined } : r));
    } else {
      onChange(rows.map(r => r.id === row.id ? { ...r, tearOut: true, replacedWith: r.replacedWith || r.material } : r));
    }
  };
  const totalSF = rows.reduce((s, r) => s + (r.sqft || 0), 0);
  const tearOutSF = rows.filter(r => r.tearOut).reduce((s, r) => s + (r.sqft || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Affected Areas</p>
        {!readOnly && <Button size="sm" variant="outline" onClick={add} className="h-7 text-xs"><Plus className="w-3 h-3 mr-1" />Add</Button>}
      </div>
      <div className="space-y-1.5">
        {rows.map(row => (
          <div key={row.id} className="space-y-1">
            <div className="grid grid-cols-12 gap-1 items-center">
              <Input className="col-span-3 h-7 text-xs" placeholder="Room/Area" value={row.room}
                disabled={readOnly} onChange={e => upd(row.id, "room", e.target.value)} />
              <Select value={row.material} onValueChange={v => upd(row.id, "material", v)} disabled={readOnly}>
                <SelectTrigger className="col-span-3 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{MATERIAL_TYPES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
              <Input className="col-span-2 h-7 text-xs" type="number" placeholder="SF" value={row.sqft || ""}
                disabled={readOnly} onChange={e => upd(row.id, "sqft", Number(e.target.value))} />
              <div className="col-span-2 flex items-center gap-1">
                <Input className="h-7 text-xs" type="number" min="0" max="100" placeholder="Wet%" value={row.wetPct || ""}
                  disabled={readOnly} onChange={e => upd(row.id, "wetPct", Number(e.target.value))} />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
              {/* Tear-out toggle. When ON, a second row appears below with
                  the replacement material Select. Amber = mark as tear-out,
                  red highlight = active tear-out. */}
              {!readOnly && (
                <Button
                  size="sm"
                  variant={row.tearOut ? "default" : "outline"}
                  className={"col-span-1 h-7 px-1 text-xs " + (row.tearOut
                    ? "bg-red-600 hover:bg-red-700 text-white border-red-600"
                    : "text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-300 dark:border-amber-700")}
                  title={row.tearOut ? "Tear-out marked \u2014 click to remove" : "Mark this material for tear-out and replacement"}
                  onClick={() => toggleTearOut(row)}
                  data-testid={`button-tearout-${row.id}`}
                >
                  <Scissors className="w-3 h-3" />
                </Button>
              )}
              {!readOnly && <Button size="sm" variant="ghost" className="col-span-1 h-7 px-1 text-destructive" onClick={() => del(row.id)}><Trash2 className="w-3 h-3" /></Button>}
            </div>
            {/* Tear-out replacement row. Only rendered when this area is
                flagged as a tear-out. Reads as: "Drywall \u2192 Sill Plate"
                so the office can pre-scope reconstruction line items
                straight from the drying record. */}
            {row.tearOut && (
              <div className="space-y-0.5" data-testid={`tearout-row-${row.id}`}>
                <div className="grid grid-cols-12 gap-1 items-center pl-3 border-l-2 border-red-400">
                  <div className="col-span-3 flex items-center gap-1 text-[11px] text-red-700 dark:text-red-400 font-semibold uppercase tracking-wide">
                    <Scissors className="w-3 h-3" /><span>Tear-out</span>
                  </div>
                  <div className="col-span-3 text-[11px] text-muted-foreground truncate" title={row.material}>
                    Removing: <span className="font-medium text-foreground line-through">{row.material}</span>
                  </div>
                  <div className="col-span-1 text-center text-muted-foreground">→</div>
                  <Select value={row.replacedWith || row.material} onValueChange={v => upd(row.id, "replacedWith", v)} disabled={readOnly}>
                    <SelectTrigger className="col-span-4 h-7 text-xs" data-testid={`select-replacedwith-${row.id}`}>
                      <SelectValue placeholder="Replace with" />
                    </SelectTrigger>
                    <SelectContent>{MATERIAL_TYPES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                  <div className="col-span-1" />
                </div>
                {(row.removedOn || row.removedDay) && (
                  <div className="pl-4 text-[10px] text-muted-foreground">
                    Removed{row.removedDay ? ` · Day ${row.removedDay}` : ""}{row.removedOn ? ` · ${row.removedOn}` : ""}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-muted-foreground italic py-2">No affected areas documented.</p>}
      </div>
      {(totalSF > 0 || tearOutSF > 0) && (
        <p className="mt-1 text-xs text-muted-foreground">
          Total affected: <strong>{totalSF} SF</strong>
          {tearOutSF > 0 && <span className="ml-2 text-red-700 dark:text-red-400">· Tear-out: <strong>{tearOutSF} SF</strong></span>}
        </p>
      )}
    </div>
  );
}

// ── Single Record Card ────────────────────────────────────────────────────────
function RecordCard({ record, jobId, readOnly, priorRecords = [] }: { record: DryingRecord; jobId: number; readOnly?: boolean; priorRecords?: DryingRecord[] }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const { toast } = useToast();

  const [form, setForm] = useState({
    readingDate: record.readingDate,
    readingTime: record.readingTime || "",
    techName: record.techName,
    dayNumber: record.dayNumber || 1,
    waterCategory: record.waterCategory,
    waterClass: record.waterClass,
    tempF: record.tempF ?? "",
    rhPct: record.rhPct ?? "",
    observations: record.observations || "",
    techSignature: record.techSignature || "",
    dryingGoalMet: record.dryingGoalMet === 1,
    structuralDryingComplete: record.structuralDryingComplete === 1,
  });

  const [moistureRows, setMoistureRows] = useState<MoistureRow[]>(
    JSON.parse(record.moistureReadings || "[]")
  );
  const [equipRows, setEquipRows] = useState<EquipRow[]>(
    JSON.parse(record.equipment || "[]")
  );
  const [areaRows, setAreaRows] = useState<AreaRow[]>(
    JSON.parse(record.affectedAreas || "[]")
  );
  // Multi-location psychrometrics: seed from stored JSON, falling back to the
  // legacy tempF/rhPct columns for records saved before this feature landed.
  const [psychroReadings, setPsychroReadings] = useState<PsychroReading[]>(
    hydratePsychroReadings((record as any).psychrometricReadings, record.tempF ?? null, record.rhPct ?? null)
  );

  // Inside slot doubles as the legacy tempF/rhPct + drives GPP badges on the
  // collapsed row and the moisture-alert check.
  const inside = insideOf(psychroReadings);
  const gpp = inside.tempF !== "" && inside.rhPct !== "" ? calcGPP(Number(inside.tempF), Number(inside.rhPct)) : null;
  const dp  = inside.tempF !== "" && inside.rhPct !== "" ? calcDewPoint(Number(inside.tempF), Number(inside.rhPct)) : null;

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/drying-records/${record.id}`, {
        ...form,
        // Legacy columns mirror the Inside reading for back-compat.
        tempF: inside.tempF !== "" ? Number(inside.tempF) : null,
        rhPct: inside.rhPct !== "" ? Number(inside.rhPct) : null,
        gpp,
        dewPointF: dp,
        psychrometricReadings: serializePsychroReadings(psychroReadings),
        dryingGoalMet: form.dryingGoalMet ? 1 : 0,
        structuralDryingComplete: form.structuralDryingComplete ? 1 : 0,
        moistureReadings: JSON.stringify(moistureRows),
        equipment: JSON.stringify(equipRows),
        affectedAreas: JSON.stringify(stampAreaTearOuts(areaRows, record.dayNumber ?? undefined, form.readingDate)),
      });
      // Run moisture alert check after every save
      return apiRequest("POST", `/api/jobs/${jobId}/moisture-alert-check`, {});
    },
    onSuccess: (alertResult: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "drying-records"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId)] });
      setEditing(false);
      if (alertResult?.alerted && alertResult?.consecutive) {
        toast({
          title: "🚨 Critical Moisture Alert Sent",
          description: `${alertResult.wetCount} reading(s) above WME threshold for 2+ consecutive days. Team has been notified via Messaging.`,
          variant: "destructive",
        });
      } else if (alertResult?.alerted) {
        toast({
          title: "⚠️ Moisture Alert Logged",
          description: "WME threshold exceeded — flagged in job activity log.",
        });
      } else {
        toast({ title: "Record saved" });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/drying-records/${record.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "drying-records"] }),
  });

  const catInfo = WATER_CATEGORIES.find(c => c.value === record.waterCategory);
  const classInfo = WATER_CLASSES.find(c => c.value === record.waterClass);
  const wetCount = JSON.parse(record.moistureReadings || "[]").filter((r: MoistureRow) => r.reading > r.target).length;
  const totalReadings = JSON.parse(record.moistureReadings || "[]").length;

  return (
    <Card className="overflow-hidden" data-testid={`drying-record-${record.id}`}>
      <CardContent className="p-0">
        {/* Header row */}
        <div
          className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors ${record.structuralDryingComplete ? "border-l-4 border-green-500" : record.dryingGoalMet ? "border-l-4 border-yellow-400" : "border-l-4 border-[hsl(var(--titan-blue))]"}`}
          onClick={() => setExpanded(e => !e)}
        >
          <div className="shrink-0">
            <p className="text-xs font-bold text-[hsl(var(--titan-blue))]">Day {record.dayNumber}</p>
            <p className="text-xs text-muted-foreground">{record.readingDate}</p>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${catInfo?.color}`}>{catInfo?.label.split("—")[0].trim()}</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-800">{classInfo?.label.split("—")[0].trim()}</span>
              {record.structuralDryingComplete === 1 && <Badge className="bg-green-500 text-white text-xs">✓ Dry</Badge>}
              {totalReadings > 0 && wetCount === 0 && record.structuralDryingComplete !== 1 && <Badge className="bg-yellow-400 text-yellow-900 text-xs">All readings at target</Badge>}
              {wetCount > 0 && <Badge variant="destructive" className="text-xs">{wetCount}/{totalReadings} WET</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{record.techName} {record.readingTime ? `· ${record.readingTime}` : ""}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {record.tempF && <span className="text-xs text-muted-foreground">{record.tempF}°F</span>}
            {record.rhPct && <span className="text-xs text-muted-foreground">{record.rhPct}% RH</span>}
            {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div className="border-t p-4 space-y-5">
            {/* Edit / Delete bar */}
            {!readOnly && (
              <div className="flex gap-2 justify-end">
                {editing ? (
                  <>
                    <Button size="sm" className="bg-[hsl(var(--titan-blue))] text-white h-7 text-xs" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                      <Save className="w-3 h-3 mr-1" />{saveMutation.isPending ? "Saving…" : "Save Record"}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(true)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => { if (confirm("Delete this record?")) deleteMutation.mutate(); }}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Header fields */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Date</Label>
                <Input type="date" className="h-8 text-xs mt-1" value={form.readingDate} disabled={!editing}
                  onChange={e => setForm(f => ({ ...f, readingDate: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Time</Label>
                <Input type="time" className="h-8 text-xs mt-1" value={form.readingTime} disabled={!editing}
                  onChange={e => setForm(f => ({ ...f, readingTime: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Technician</Label>
                <UserSelect value={form.techName} onChange={v => setForm(f => ({ ...f, techName: v }))} roles={["tech"]} disabled={!editing} placeholder="Select tech" className="h-8 text-xs mt-1" testId="select-drying-tech" />
              </div>
              <div>
                <Label className="text-xs">Day #</Label>
                <Input type="number" min="1" className="h-8 text-xs mt-1" value={form.dayNumber} disabled={!editing}
                  onChange={e => setForm(f => ({ ...f, dayNumber: Number(e.target.value) }))} />
              </div>
            </div>

            {/* IICRC Classification */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Water Category (S500 §4)</Label>
                <Select value={form.waterCategory} onValueChange={v => setForm(f => ({ ...f, waterCategory: v }))} disabled={!editing}>
                  <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WATER_CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>
                        <span className="font-medium">{c.label.split("—")[0].trim()}</span>
                        <span className="text-xs text-muted-foreground ml-1">— {c.label.split("—")[1]?.trim()}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {editing && <p className="text-xs text-muted-foreground mt-0.5">{WATER_CATEGORIES.find(c => c.value === form.waterCategory)?.desc}</p>}
              </div>
              <div>
                <Label className="text-xs">Water Class (S500 §5)</Label>
                <Select value={form.waterClass} onValueChange={v => setForm(f => ({ ...f, waterClass: v }))} disabled={!editing}>
                  <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WATER_CLASSES.map(c => (
                      <SelectItem key={c.value} value={c.value}>
                        <span className="font-medium">{c.label.split("—")[0].trim()}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {editing && <p className="text-xs text-muted-foreground mt-0.5">{WATER_CLASSES.find(c => c.value === form.waterClass)?.desc}</p>}
              </div>
            </div>

            {/* Psychrometrics — Inside / Outside / Affected Area */}
            <PsychrometricGrid
              readings={psychroReadings}
              onChange={setPsychroReadings}
              readOnly={!editing}
            />
            {gpp !== null && (
              <p className={`mt-1 text-xs ${gpp > 900 ? "text-red-600" : gpp > 500 ? "text-yellow-600" : "text-green-600"}`}>
                Inside GPP: {gpp > 900 ? "⚠ Class 3 drying conditions — maximum equipment required" :
                 gpp > 500 ? "Class 2 drying conditions — standard equipment protocol" :
                 "✓ Class 1 conditions — low evaporation rate"}
              </p>
            )}

            {/* Moisture readings */}
            <MoistureTable rows={moistureRows} onChange={setMoistureRows} readOnly={!editing} history={buildMoistureHistory(priorRecords)} dayNumber={record.dayNumber} readingDate={form.readingDate} />

            {/* Equipment — pass affected-area rows so the room dropdown
                offers exactly the rooms recorded on this record. */}
            <EquipmentTable
              rows={equipRows}
              onChange={setEquipRows}
              readOnly={!editing}
              areaRows={areaRows}
              readingDate={form.readingDate}
            />

            {/* Affected areas */}
            <AffectedAreasTable rows={areaRows} onChange={setAreaRows} readOnly={!editing} />

            {/* Observations */}
            <div>
              <Label className="text-xs">Observations / Field Notes</Label>
              <Textarea
                className="mt-1 text-xs min-h-[80px]"
                placeholder="Document conditions, anomalies, or next steps per IICRC S500 requirements…"
                value={form.observations}
                disabled={!editing}
                onChange={e => setForm(f => ({ ...f, observations: e.target.value }))}
              />
            </div>

            {/* Completion status */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <input type="checkbox" id={`goal-${record.id}`} checked={form.dryingGoalMet} disabled={!editing}
                  onChange={e => setForm(f => ({ ...f, dryingGoalMet: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300 text-[hsl(var(--titan-blue))]" />
                <label htmlFor={`goal-${record.id}`} className="text-xs font-medium">
                  Drying Goal Met (S500 §12.3)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id={`complete-${record.id}`} checked={form.structuralDryingComplete} disabled={!editing}
                  onChange={e => setForm(f => ({ ...f, structuralDryingComplete: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300 text-green-600" />
                <label htmlFor={`complete-${record.id}`} className="text-xs font-medium">
                  Structural Drying Complete
                </label>
              </div>
            </div>

            {/* Tech signature */}
            <div>
              <Label className="text-xs">Tech Attestation / Signature</Label>
              <Input
                className="mt-1 h-8 text-xs"
                placeholder="Type full name to attest accuracy per IICRC S500"
                value={form.techSignature}
                disabled={!editing}
                onChange={e => setForm(f => ({ ...f, techSignature: e.target.value }))}
              />
              {record.techSignature && <p className="text-xs text-green-600 mt-0.5">✓ Attested by {record.techSignature}</p>}
            </div>

            {/* IICRC reference footer */}
            <div className="border rounded p-3 bg-muted/30 text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground">IICRC S500 Reference</p>
              <p>§4 — Water categories determine PPE and antimicrobial requirements</p>
              <p>§5 — Water class drives equipment placement ratios and drying targets</p>
              <p>§11 — Psychrometric data must be recorded each visit until drying complete</p>
              <p>§11.4 — Minimum 1 air mover per 50 SF (Class 2); 1 per 10–16 SF (Class 3)</p>
              <p>§12.3 — Drying complete when all readings at or below standard (WME ≤17% drywall, ≤19% wood)</p>
              <p>§14 — Drying documentation must be retained and available to all parties</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Legacy Missed-Day support ───────────────────────────────────────────────
// The "Log Missed Day" flow was removed 2026-08-25 — techs asked for a
// simpler timeline that just tracks days they actually visited. Historical
// missed-day rows already in the DB are still rendered by MissedDayCard
// below so the audit trail stays intact, but there is no longer a UI
// path to create new missed-day rows.
// Compact row rendered for LEGACY records with recordType === 'missed'.
// No longer created via the UI (the Log Missed Day button was removed
// 2026-08-25), but historical rows are still displayed so the S500
// audit trail remains complete and previously-logged reasons stay
// visible / deletable.
function MissedDayCard({ record, jobId, readOnly }: { record: DryingRecord; jobId: number; readOnly?: boolean }) {
  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/drying-records/${record.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "drying-records"] }),
  });
  const missedReason = (record as any).missedReason || "Missed day";
  return (
    <Card className="overflow-hidden border-dashed" data-testid={`missed-day-${record.id}`}>
      <CardContent className="p-3 border-l-4 border-amber-400 bg-amber-50/40 dark:bg-amber-950/20 flex items-center gap-3">
        <div className="shrink-0 text-center">
          <p className="text-xs font-bold text-amber-700 dark:text-amber-300">Day {record.dayNumber || "—"}</p>
          <p className="text-xs text-muted-foreground">{record.readingDate}</p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-amber-900 dark:text-amber-200">— no visit —</span>
            <Badge className="bg-amber-200 text-amber-900 border-0 text-[10px] dark:bg-amber-900 dark:text-amber-100">{missedReason}</Badge>
          </div>
          {record.observations && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{record.observations}</p>
          )}
          {record.techName && record.techName !== "— no visit —" && (
            <p className="text-[11px] text-muted-foreground mt-0.5">Attempted by {record.techName}</p>
          )}
        </div>
        {!readOnly && (
          <Button size="sm" variant="ghost" className="h-7 px-1 text-destructive shrink-0"
            onClick={() => { if (confirm("Delete this missed-day entry?")) deleteMutation.mutate(); }}
            data-testid={`delete-missed-${record.id}`}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── New Record Form ─────────────────────────────────────────────────────
function NewRecordForm({ jobId, onClose, priorRecords = [] }: { jobId: number; onClose: () => void; priorRecords?: DryingRecord[] }) {
  const { toast } = useToast();

  // Prior-record carry-forward. When the tech opens a new drying record we
  // don't want them to have to remember which moisture points they took
  // yesterday, what materials they were on, or which dehus/air movers are
  // installed at what serial numbers. So we pre-seed the form from the most
  // recent visit record (readings blanked out so they type today's number)
  // and default the day number to the next-in-sequence value.
  //
  // Non-missed prior records only — missed-day placeholders have no data.
  const visitPrior = priorRecords.filter(r => (r as any).recordType !== "missed");
  const chronoAsc = [...visitPrior].sort((a, b) => (a.dayNumber || 0) - (b.dayNumber || 0));
  const chronoDesc = [...visitPrior].sort((a, b) => (b.dayNumber || 0) - (a.dayNumber || 0));
  const lastVisit = chronoDesc[0];
  const day1Visit = chronoAsc[0];
  const nextDay = (priorRecords.reduce((max, r) => Math.max(max, r.dayNumber || 0), 0)) + 1;

  const seededMoisture: MoistureRow[] = (() => {
    if (chronoAsc.length === 0) return [];
    // Walk oldest → newest and keep two things per (location, material):
    //  (a) the most recent non-teardown snapshot (blank reading on seed) so
    //      the row carries forward with its material and target intact
    //  (b) whether that pair was ever torn out, and if so what replacement
    //      material the tech scoped — so the seeded row keeps the tearOut
    //      audit flag on the new day AND we synthesize the replacement row
    //      if a later day didn't already track it as its own pair.
    // This mirrors the affectedAreas seed so "remember old + new material"
    // works identically across both tables.
    type Snap = {
      location: string; material: string; target: number;
      sawTeardown: boolean; replacedWith?: string;
      removedOn?: string; removedDay?: number;
    };
    const snapByKey = new Map<string, Snap>();
    chronoAsc.forEach(rec => {
      let rows: MoistureRow[] = [];
      try { rows = JSON.parse(rec.moistureReadings || "[]"); } catch { rows = []; }
      rows.forEach(r => {
        if (!r || (!r.location && !r.material)) return;
        const key = `${(r.location || "").toLowerCase()}␟${(r.material || "").toLowerCase()}`;
        const prev = snapByKey.get(key);
        if (r.tearOut) {
          snapByKey.set(key, {
            location: prev?.location || r.location || "",
            material: prev?.material || r.material || "Drywall",
            target: prev?.target ?? (Number(r.target) || 17),
            sawTeardown: true,
            replacedWith: (r as any).replacedWith || prev?.replacedWith,
            removedOn: (r as any).removedOn || prev?.removedOn,
            removedDay: (r as any).removedDay ?? prev?.removedDay,
          });
        } else {
          snapByKey.set(key, {
            location: r.location || "",
            material: r.material || "Drywall",
            target: Number(r.target) || 17,
            sawTeardown: prev?.sawTeardown || false,
            replacedWith: prev?.replacedWith,
            removedOn: prev?.removedOn,
            removedDay: prev?.removedDay,
          });
        }
      });
    });

    const seeds: MoistureRow[] = [];
    const seenKeys = new Set<string>();
    snapByKey.forEach((snap, key) => {
      // Carry the tracked row forward. Preserve tearOut audit flags if the
      // pair was ever torn so the report still shows it as removed.
      seeds.push({
        id: Date.now() + Math.random(),
        location: snap.location,
        material: snap.material,
        reading: 0,
        target: snap.target,
        ...(snap.sawTeardown ? {
          tearOut: true,
          replacedWith: snap.replacedWith,
          removedOn: snap.removedOn,
          removedDay: snap.removedDay,
        } : {}),
      } as MoistureRow);
      seenKeys.add(key);

      // Replacement row — only when torn AND a replacement material was
      // scoped AND no later day already tracks that replacement as its own
      // (location, material) pair.
      if (snap.sawTeardown && snap.replacedWith) {
        const replKey = `${(snap.location || "").toLowerCase()}␟${(snap.replacedWith || "").toLowerCase()}`;
        if (!snapByKey.has(replKey) && !seenKeys.has(replKey)) {
          seeds.push({
            id: Date.now() + Math.random(),
            location: snap.location,
            material: snap.replacedWith,
            reading: 0,
            target: defaultTargetForMaterial(snap.replacedWith),
          } as MoistureRow);
          seenKeys.add(replKey);
        }
      }
    });
    return seeds;
  })();

  const seededEquip: EquipRow[] = (() => {
    // Equipment stays installed across visits until a tech explicitly pulls
    // it, so we carry forward everything that's STILL deployed as of the
    // most recent record. Rows with an endDate set were already pulled on
    // some prior day — those must NOT seed forward or they'd re-appear as
    // active equipment the next day (the user reported exactly this).
    //
    // Dedupe across the whole history by (type, serial, room) so if the
    // same asset was pulled and later re-deployed we keep only the current
    // active instance. Serial-less rows collapse per (type, room).
    if (chronoAsc.length === 0) return [];
    const activeByKey = new Map<string, EquipRow>();
    chronoAsc.forEach(rec => {
      let rows: EquipRow[] = [];
      try { rows = JSON.parse(rec.equipment || "[]"); } catch { rows = []; }
      rows.filter(Boolean).forEach(r => {
        const serial = (r.serialNumber || "").trim();
        const key = `${(r.type || "").toLowerCase()}␟${serial || "∅"}␟${(r.room || "").toLowerCase()}`;
        if (r.endDate) {
          // Pulled — drop it from the active map. If it comes back later
          // (same key, no endDate) the later record overwrites this.
          activeByKey.delete(key);
        } else {
          activeByKey.set(key, r);
        }
      });
    });
    return Array.from(activeByKey.values()).map(r => ({
      ...r,
      id: Date.now() + Math.random(),
      // Drop yesterday's daily readings — those are per-visit.
      dailyReadings: [],
    })) as EquipRow[];
  })();

  const seededAreas: AreaRow[] = (() => {
    if (chronoAsc.length === 0) return [];
    // Walk oldest → newest and, per (room, material), keep the most recent
    // NON-teardown snapshot. Teardown rows are dropped from the seed but
    // they don't overwrite the pre-teardown snapshot, so a room torn out on
    // Day 3 still shows Day 2's state on Day 4.
    //
    // AffectedAreas tear-out flow (unlike moisture) does NOT insert a
    // separate replacement row — it just flips tearOut=true on the original
    // row and stashes the new material name in replacedWith. That means the
    // replacement material never appears as its own AreaRow and the naive
    // seed loses it entirely. So: for every torn row we ALSO synthesize a
    // replacement seed row using replacedWith (starting wet% at 100 by
    // default so the tech remembers to record it). Both rows land on Day N.
    type Snap = { row: AreaRow; sawTeardown: boolean; replacedWith?: string };
    const snapByKey = new Map<string, Snap>();
    chronoAsc.forEach(rec => {
      let rows: AreaRow[] = [];
      try { rows = JSON.parse(rec.affectedAreas || "[]"); } catch { rows = []; }
      rows.forEach(r => {
        if (!r) return;
        const key = `${(r.room || "").toLowerCase()}␟${(r.material || "").toLowerCase()}`;
        const prev = snapByKey.get(key);
        if (r.tearOut) {
          // Remember that this pair was torn out and which replacement was
          // scoped. Don't overwrite the pre-teardown snapshot itself.
          snapByKey.set(key, {
            row: prev?.row || r,
            sawTeardown: true,
            replacedWith: r.replacedWith || prev?.replacedWith,
          });
        } else {
          snapByKey.set(key, { row: r, sawTeardown: prev?.sawTeardown || false, replacedWith: prev?.replacedWith });
        }
      });
    });

    const out: AreaRow[] = [];
    const seenKeys = new Set<string>();
    snapByKey.forEach((snap, key) => {
      // Carry the original row forward. If it was torn out, preserve the
      // tearOut audit flags so the tech (and PDF report) still see "this
      // material was removed on Day X" — the wall really is gone. If it
      // was never torn, carry it as an active tracked area.
      out.push({
        ...snap.row,
        id: Date.now() + Math.random(),
        tearOut: snap.sawTeardown ? true : (snap.row.tearOut || false),
        replacedWith: snap.sawTeardown ? (snap.replacedWith || snap.row.replacedWith) : undefined,
        removedOn: snap.sawTeardown ? snap.row.removedOn : undefined,
        removedDay: snap.sawTeardown ? snap.row.removedDay : undefined,
      });
      seenKeys.add(key);

      // Replacement row — if the pair was torn out and the tech scoped a
      // new material, synthesize an active row for it (starts at 100 wet%
      // so the tech has to enter today's reading; footprint mirrors the
      // original). Skip if a later day already added its own row for that
      // (room, replacement material) pair.
      if (snap.sawTeardown && snap.replacedWith) {
        const replKey = `${(snap.row.room || "").toLowerCase()}␟${(snap.replacedWith || "").toLowerCase()}`;
        if (!snapByKey.has(replKey) && !seenKeys.has(replKey)) {
          out.push({
            id: Date.now() + Math.random(),
            room: snap.row.room,
            material: snap.replacedWith,
            sqft: snap.row.sqft,
            wetPct: 100,
          } as AreaRow);
          seenKeys.add(replKey);
        }
      }
    });
    return out;
  })();

  const moistureHistory = buildMoistureHistory(priorRecords);

  const [form, setForm] = useState({
    readingDate: todayLocalISO(),
    readingTime: new Date().toTimeString().slice(0, 5),
    techName: "",
    dayNumber: nextDay,
    waterCategory: lastVisit?.waterCategory || "category2",
    waterClass: lastVisit?.waterClass || "class2",
    observations: "",
  });
  const [moistureRows, setMoistureRows] = useState<MoistureRow[]>(seededMoisture);
  const [equipRows, setEquipRows] = useState<EquipRow[]>(seededEquip);
  const [areaRows, setAreaRows] = useState<AreaRow[]>(seededAreas);
  const [psychroReadings, setPsychroReadings] = useState<PsychroReading[]>(
    hydratePsychroReadings(null, null, null)
  );

  // Inside slot doubles as the legacy tempF/rhPct so existing reports keep working.
  const inside = insideOf(psychroReadings);
  const gpp = inside.tempF !== "" && inside.rhPct !== "" ? calcGPP(Number(inside.tempF), Number(inside.rhPct)) : null;
  const dp  = inside.tempF !== "" && inside.rhPct !== "" ? calcDewPoint(Number(inside.tempF), Number(inside.rhPct)) : null;

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/jobs/${jobId}/drying-records`, {
        ...form,
        // Legacy columns mirror the Inside reading for back-compat.
        tempF: inside.tempF !== "" ? Number(inside.tempF) : null,
        rhPct: inside.rhPct !== "" ? Number(inside.rhPct) : null,
        gpp,
        dewPointF: dp,
        psychrometricReadings: serializePsychroReadings(psychroReadings),
        moistureReadings: JSON.stringify(moistureRows),
        equipment: JSON.stringify(equipRows),
        affectedAreas: JSON.stringify(stampAreaTearOuts(areaRows, form.dayNumber, form.readingDate)),
      });
      // Run moisture alert check immediately after creating
      return apiRequest("POST", `/api/jobs/${jobId}/moisture-alert-check`, {});
    },
    onSuccess: (alertResult: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "drying-records"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId)] });
      if (alertResult?.alerted && alertResult?.consecutive) {
        toast({
          title: "🚨 Critical Moisture Alert Sent",
          description: `${alertResult.wetCount} reading(s) above WME threshold for 2+ consecutive days. Team notified via Messaging.`,
          variant: "destructive",
        });
      } else if (alertResult?.alerted) {
        toast({
          title: "⚠️ Moisture Alert Logged",
          description: "WME threshold exceeded — flagged in job activity log.",
        });
      } else {
        toast({ title: "Drying record created" });
      }
      onClose();
    },
  });

  return (
    <Card className="border-[hsl(var(--titan-blue)/0.4)] bg-[hsl(var(--titan-blue)/0.03)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Droplets className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
          New Drying Record
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Header */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" className="h-8 text-xs mt-1" value={form.readingDate}
              onChange={e => setForm(f => ({ ...f, readingDate: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Time</Label>
            <Input type="time" className="h-8 text-xs mt-1" value={form.readingTime}
              onChange={e => setForm(f => ({ ...f, readingTime: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Technician</Label>
            <UserSelect value={form.techName} onChange={v => setForm(f => ({ ...f, techName: v }))} roles={["tech"]} placeholder="Select tech" className="h-8 text-xs mt-1" testId="select-drying-tech-2" />
          </div>
          <div>
            <Label className="text-xs">Day #</Label>
            <Input type="number" min="1" className="h-8 text-xs mt-1" value={form.dayNumber}
              onChange={e => setForm(f => ({ ...f, dayNumber: Number(e.target.value) }))} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Water Category</Label>
            <Select value={form.waterCategory} onValueChange={v => setForm(f => ({ ...f, waterCategory: v }))}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{WATER_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Water Class</Label>
            <Select value={form.waterClass} onValueChange={v => setForm(f => ({ ...f, waterClass: v }))}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{WATER_CLASSES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <PsychrometricGrid readings={psychroReadings} onChange={setPsychroReadings} />

        {lastVisit && (moistureRows.length + equipRows.length + areaRows.length) > 0 && (
          <div className="rounded-md border border-[hsl(var(--titan-blue)/0.35)] bg-[hsl(var(--titan-blue)/0.05)] px-3 py-2 text-[11px] text-[hsl(var(--titan-blue))] flex items-start gap-2">
            <Droplets className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium">Carried forward from Day {lastVisit.dayNumber}</span>
              {day1Visit && day1Visit !== lastVisit && (
                <span className="opacity-80"> (installed Day {day1Visit.dayNumber})</span>
              )}
              <span className="opacity-80"> — moisture points, targets, materials, and equipment. Readings are blank so you enter today's numbers. Remove any equipment that was pulled today.</span>
            </div>
          </div>
        )}

        <MoistureTable rows={moistureRows} onChange={setMoistureRows} history={moistureHistory} dayNumber={form.dayNumber} readingDate={form.readingDate} />
        <EquipmentTable
          rows={equipRows}
          onChange={setEquipRows}
          areaRows={areaRows}
          readingDate={form.readingDate}
        />
        <AffectedAreasTable rows={areaRows} onChange={setAreaRows} />

        <div>
          <Label className="text-xs">Observations</Label>
          <Textarea className="mt-1 text-xs min-h-[60px]" placeholder="Field conditions, observations, next steps…"
            value={form.observations} onChange={e => setForm(f => ({ ...f, observations: e.target.value }))} />
        </div>

        <div className="flex gap-2">
          <Button
            className="flex-1 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !form.readingDate || !form.techName}
            data-testid="button-save-drying-record"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            {createMutation.isPending ? "Saving…" : "Save Drying Record"}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function DryingRecords({ jobId, readOnly = false }: { jobId: number; readOnly?: boolean }) {
  const [showNew, setShowNew] = useState(false);
  // showMissed / setShowMissed removed 2026-08-25 with the Log Missed Day
  // feature. Historical missed-day rows still render via MissedDayCard.


  const { data: records = [], isLoading } = useQuery<DryingRecord[]>({
    queryKey: ["/api/jobs", String(jobId), "drying-records"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/drying-records`).then(r => r.json()),
  });

  // Newest-first ordering, with dayNumber as a tiebreaker for same-day entries.
  // A stable client-side sort keeps missed days weaving into the visit stream
  // by date regardless of the order the API returns rows in.
  const sortedRecords = [...records].sort((a, b) => {
    const da = a.readingDate || "";
    const dbb = b.readingDate || "";
    if (da !== dbb) return dbb.localeCompare(da);
    return (b.dayNumber || 0) - (a.dayNumber || 0);
  });

  // Missed days don't have moisture data — exclude them from dry/wet KPIs.
  const visitRecords = records.filter(r => (r as any).recordType !== "missed");
  const missedCount = records.length - visitRecords.length;
  const dryCount = visitRecords.filter(r => r.structuralDryingComplete === 1).length;
  const wetCount = visitRecords.filter(r => {
    const readings: MoistureRow[] = JSON.parse(r.moistureReadings || "[]");
    return readings.some(m => m.reading > m.target);
  }).length;

  // Next default day number for a new missed-day entry: max seen + 1.
  const nextDay = records.reduce((max, r) => Math.max(max, r.dayNumber || 0), 0) + 1;

  // Offline-queued drying-record POSTs for this job (matched by URL path).
  const {
    pendingCount,
    failedCount,
    oldestPendingAt,
    online,
    retryFailed,
  } = useJobQueue(jobId, "/drying-records");
  const pendingAge = oldestPendingAt != null ? formatAge(oldestPendingAt) : null;
  const showPendingAge = pendingAge && pendingAge !== "just now";

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Wind className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
            <span className="text-sm font-semibold">{records.length} Drying {records.length === 1 ? "Record" : "Records"}</span>
          </div>
          {records.length > 0 && (
            <div className="flex gap-2 text-xs">
              {dryCount > 0 && <Badge className="bg-green-500 text-white">{dryCount} Dry</Badge>}
              {wetCount > 0 && <Badge variant="destructive">{wetCount} Active</Badge>}
              {missedCount > 0 && <Badge className="bg-amber-500 text-white">{missedCount} Missed</Badge>}
            </div>
          )}
          {failedCount > 0 && (
            <SyncChip
              count={0}
              failedCount={failedCount}
              online={online}
              onRetry={retryFailed}
              data-testid="sync-chip-drying"
            />
          )}
          {pendingCount > 0 && (
            <SyncChip
              count={pendingCount}
              online={online}
              oldestPendingAt={oldestPendingAt}
              data-testid={failedCount > 0 ? "sync-chip-drying-pending" : "sync-chip-drying"}
            />
          )}
        </div>
        {!readOnly && !showNew && (
          <Button
            size="sm"
            className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
            onClick={() => setShowNew(true)}
            data-testid="button-new-drying-record"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />New Record
          </Button>
        )}
      </div>

      {/* IICRC hint */}
      {records.length === 0 && !showNew && (
        <div className="border rounded-lg p-4 bg-muted/30 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground mb-1 flex items-center gap-1.5"><Clipboard className="w-3.5 h-3.5" />IICRC S500 Drying Documentation Required</p>
          <p>Per IICRC S500 §14, drying records must be completed on every visit and retained for at least 3 years. Records must include psychrometric data, moisture readings, equipment placed, and affected areas for each day of drying.</p>
          {!readOnly && <Button size="sm" className="mt-3 bg-[hsl(var(--titan-blue))] text-white" onClick={() => setShowNew(true)}><Plus className="w-3.5 h-3.5 mr-1" />Start First Record</Button>}
        </div>
      )}

      {showNew && <NewRecordForm jobId={jobId} onClose={() => setShowNew(false)} priorRecords={records} />}

      {isLoading ? (
        <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : (
        <div className="space-y-2">
          {/* Failed (offline-queued) drying records — sync failed, tap to retry */}
          {failedCount > 0 && (
            <div
              className="flex items-center gap-3 p-3 rounded-lg border-2 border-red-400 dark:border-red-600 bg-red-50/60 dark:bg-red-950/30"
              data-testid="drying-record-failed"
              title="Sync failed — tap retry to try again"
            >
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
              <span className="text-sm text-red-800 dark:text-red-300 flex-1">
                {failedCount} drying {failedCount === 1 ? "record" : "records"} failed to sync
              </span>
              <button
                type="button"
                onClick={retryFailed}
                className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white/90 hover:bg-white px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-950/60 dark:hover:bg-red-950 dark:text-red-300 shrink-0"
                data-testid="drying-record-retry"
              >
                <RefreshCw className="w-3 h-3" />Retry
              </button>
            </div>
          )}
          {/* Pending (offline-queued) drying records — saved on-device, awaiting sync */}
          {pendingCount > 0 && (
            <div
              className="flex items-center gap-3 p-3 rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50/60 dark:bg-amber-950/30"
              data-testid="drying-record-pending"
              title="Saved on this device — will sync when back online"
            >
              <CloudUpload className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-sm text-amber-800 dark:text-amber-300">
                {pendingCount} drying {pendingCount === 1 ? "record" : "records"} saved on this device{online ? " — syncing…" : " — will sync when back online"}{showPendingAge ? ` · ${pendingAge}` : ""}
              </span>
            </div>
          )}
          {sortedRecords.map(r => (
            (r as any).recordType === "missed"
              ? <MissedDayCard key={r.id} record={r} jobId={jobId} readOnly={readOnly} />
              : <RecordCard key={r.id} record={r} jobId={jobId} readOnly={readOnly} priorRecords={records.filter(x => (x.dayNumber || 0) < (r.dayNumber || 0))} />
          ))}
        </div>
      )}
    </div>
  );
}
