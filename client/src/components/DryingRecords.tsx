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
interface MoistureRow { id: number; location: string; material: string; reading: number; target: number; }
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
  tearOut?: boolean;         // true when this material is being torn out
  replacedWith?: string;     // replacement material to install (only meaningful when tearOut is true)
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

function MoistureTable({ rows, onChange, readOnly, history }: { rows: MoistureRow[]; onChange: (r: MoistureRow[]) => void; readOnly?: boolean; history?: MoistureHistory }) {
  const add = () => onChange([...rows, { id: Date.now(), location: "", material: "Drywall", reading: 0, target: 17 }]);
  const del = (id: number) => onChange(rows.filter(r => r.id !== id));
  const upd = (id: number, field: keyof MoistureRow, val: any) =>
    onChange(rows.map(r => r.id === id ? { ...r, [field]: val } : r));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Moisture Readings (WME %)</p>
        {!readOnly && <Button size="sm" variant="outline" onClick={add} className="h-7 text-xs"><Plus className="w-3 h-3 mr-1" />Add</Button>}
      </div>
      <div className="space-y-1.5">
        {rows.map(row => {
          const over = row.reading > row.target;
          const trend = history?.[moistureKey(row.location, row.material)] || [];
          // Trend line: show day-1 (initial) plus up to the last 3 readings so
          // the tech can see "started at 32%, now trending 24 -> 21 -> 19".
          const day1 = trend[0];
          const recent = trend.slice(-3);
          const showDay1Separately = day1 && !recent.includes(day1);
          const target = row.target || 0;
          return (
            <div key={row.id} className="space-y-0.5">
              <div className="grid grid-cols-12 gap-1 items-center">
                <Input className="col-span-3 h-7 text-xs" placeholder="Location" value={row.location} disabled={readOnly}
                  onChange={e => upd(row.id, "location", e.target.value)} />
                <Select value={row.material} onValueChange={v => upd(row.id, "material", v)} disabled={readOnly}>
                  <SelectTrigger className="col-span-3 h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{MATERIAL_TYPES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
                <div className="col-span-2 relative">
                  <Input className={`h-7 text-xs pr-6 ${over ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : ""}`}
                    type="number" placeholder="Reading" value={row.reading || ""} disabled={readOnly}
                    onChange={e => upd(row.id, "reading", Number(e.target.value))} />
                  {over && <AlertTriangle className="absolute right-1 top-1.5 w-3.5 h-3.5 text-red-500" />}
                </div>
                <Input className="col-span-2 h-7 text-xs" type="number" placeholder="Target" value={row.target || ""}
                  disabled={readOnly} onChange={e => upd(row.id, "target", Number(e.target.value))} />
                <div className="col-span-1 flex justify-center">
                  {over
                    ? <Badge className="text-xs h-5 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200 border-0">WET</Badge>
                    : <Badge className="text-xs h-5 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200 border-0">DRY</Badge>
                  }
                </div>
                {!readOnly && <Button size="sm" variant="ghost" className="col-span-1 h-7 px-1 text-destructive" onClick={() => del(row.id)}><Trash2 className="w-3 h-3" /></Button>}
              </div>
              {trend.length > 0 && (
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

function EquipmentTable({ rows, onChange, readOnly }: { rows: EquipRow[]; onChange: (r: EquipRow[]) => void; readOnly?: boolean }) {
  const add = () => onChange([...rows, { id: Date.now(), type: "LGR Dehumidifier", qty: 1, placement: "", serialNumber: "", dailyReadings: [] }]);
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
      <div className="space-y-1.5">
        {rows.map(row => {
          const isDehu = row.type.toLowerCase().includes("dehumid");
          const dr = row.dailyReadings || [];
          return (
            <div key={row.id} className="grid grid-cols-12 gap-1 items-center">
              <Select value={row.type} onValueChange={v => upd(row.id, "type", v)} disabled={readOnly}>
                <SelectTrigger className="col-span-4 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{EQUIPMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
              <Input className="col-span-1 h-7 text-xs" type="number" min="1" placeholder="Qty" value={row.qty || ""}
                disabled={readOnly} onChange={e => upd(row.id, "qty", Number(e.target.value))} />
              <Input className="col-span-3 h-7 text-xs" placeholder="Placement/Room" value={row.placement}
                disabled={readOnly} onChange={e => upd(row.id, "placement", e.target.value)} />
              <Input className={`${isDehu ? "col-span-2" : "col-span-3"} h-7 text-xs`} placeholder="Serial / Asset #" value={row.serialNumber}
                disabled={readOnly} onChange={e => upd(row.id, "serialNumber", e.target.value)} />
              {isDehu && (
                <Button size="sm" variant="outline" className="col-span-1 h-7 px-1 text-[10px]"
                  onClick={() => upd(row.id, "dailyReadings", dr.length ? dr : [{ id: Date.now(), date: new Date().toISOString().split("T")[0], intakeTemp: 0, intakeRh: 0, outTemp: 0, outRh: 0 }])}
                  title="Show daily readings">
                  <Droplets className="w-3 h-3" />{dr.length > 0 ? dr.length : ""}
                </Button>
              )}
              {!readOnly && <Button size="sm" variant="ghost" className="col-span-1 h-7 px-1 text-destructive" onClick={() => del(row.id)}><Trash2 className="w-3 h-3" /></Button>}
              {isDehu && dr.length > 0 && (
                <DehuReadingsPanel readings={dr} onChange={v => upd(row.id, "dailyReadings", v)} readOnly={readOnly} />
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
              <div className="grid grid-cols-12 gap-1 items-center pl-3 border-l-2 border-red-400" data-testid={`tearout-row-${row.id}`}>
                <div className="col-span-3 flex items-center gap-1 text-[11px] text-red-700 dark:text-red-400 font-semibold uppercase tracking-wide">
                  <Scissors className="w-3 h-3" /><span>Tear-out</span>
                </div>
                <div className="col-span-3 text-[11px] text-muted-foreground truncate" title={row.material}>
                  Removing: <span className="font-medium text-foreground">{row.material}</span>
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
        affectedAreas: JSON.stringify(areaRows),
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
            <MoistureTable rows={moistureRows} onChange={setMoistureRows} readOnly={!editing} history={buildMoistureHistory(priorRecords)} />

            {/* Equipment */}
            <EquipmentTable rows={equipRows} onChange={setEquipRows} readOnly={!editing} />

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
    if (!lastVisit) return [];
    let rows: MoistureRow[] = [];
    try { rows = JSON.parse(lastVisit.moistureReadings || "[]"); } catch { rows = []; }
    // Preserve location, material, and target; blank the reading so the tech
    // has to actively enter today's value (no accidental duplicate readings).
    return rows.filter(r => r && (r.location || r.material)).map(r => ({
      id: Date.now() + Math.random(),
      location: r.location || "",
      material: r.material || "Drywall",
      reading: 0,
      target: Number(r.target) || 17,
    })) as MoistureRow[];
  })();

  const seededEquip: EquipRow[] = (() => {
    // Equipment stays installed across visits, so carry forward the most
    // recent record's equipment list wholesale (including serial numbers and
    // placement). Techs can then delete anything that was pulled that day.
    if (!lastVisit) return [];
    let rows: EquipRow[] = [];
    try { rows = JSON.parse(lastVisit.equipment || "[]"); } catch { rows = []; }
    return rows.filter(Boolean).map(r => ({
      ...r,
      id: Date.now() + Math.random(),
      // Drop yesterday's daily readings — those are per-visit.
      dailyReadings: [],
    })) as EquipRow[];
  })();

  const seededAreas: AreaRow[] = (() => {
    if (!lastVisit) return [];
    let rows: AreaRow[] = [];
    try { rows = JSON.parse(lastVisit.affectedAreas || "[]"); } catch { rows = []; }
    return rows.filter(Boolean).map(r => ({ ...r, id: Date.now() + Math.random() })) as AreaRow[];
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
        affectedAreas: JSON.stringify(areaRows),
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

        <MoistureTable rows={moistureRows} onChange={setMoistureRows} history={moistureHistory} />
        <EquipmentTable rows={equipRows} onChange={setEquipRows} />
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
