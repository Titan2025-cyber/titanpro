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
  Thermometer, Droplets, Wind, Clipboard, Save, AlertTriangle
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
import { CloudUpload, AlertTriangle, RefreshCw } from "lucide-react";
import { formatAge } from "@/lib/offlineQueue";

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
interface AreaRow { id: number; room: string; material: string; sqft: number; wetPct: number; }

function MoistureTable({ rows, onChange, readOnly }: { rows: MoistureRow[]; onChange: (r: MoistureRow[]) => void; readOnly?: boolean }) {
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
          return (
            <div key={row.id} className="grid grid-cols-12 gap-1 items-center">
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
  const totalSF = rows.reduce((s, r) => s + (r.sqft || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Affected Areas</p>
        {!readOnly && <Button size="sm" variant="outline" onClick={add} className="h-7 text-xs"><Plus className="w-3 h-3 mr-1" />Add</Button>}
      </div>
      <div className="space-y-1.5">
        {rows.map(row => (
          <div key={row.id} className="grid grid-cols-12 gap-1 items-center">
            <Input className="col-span-3 h-7 text-xs" placeholder="Room/Area" value={row.room}
              disabled={readOnly} onChange={e => upd(row.id, "room", e.target.value)} />
            <Select value={row.material} onValueChange={v => upd(row.id, "material", v)} disabled={readOnly}>
              <SelectTrigger className="col-span-3 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{MATERIAL_TYPES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
            <Input className="col-span-2 h-7 text-xs" type="number" placeholder="SF" value={row.sqft || ""}
              disabled={readOnly} onChange={e => upd(row.id, "sqft", Number(e.target.value))} />
            <div className="col-span-3 flex items-center gap-1">
              <Input className="h-7 text-xs" type="number" min="0" max="100" placeholder="Wet%" value={row.wetPct || ""}
                disabled={readOnly} onChange={e => upd(row.id, "wetPct", Number(e.target.value))} />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
            {!readOnly && <Button size="sm" variant="ghost" className="col-span-1 h-7 px-1 text-destructive" onClick={() => del(row.id)}><Trash2 className="w-3 h-3" /></Button>}
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-muted-foreground italic py-2">No affected areas documented.</p>}
      </div>
      {totalSF > 0 && <p className="mt-1 text-xs text-muted-foreground">Total affected: <strong>{totalSF} SF</strong></p>}
    </div>
  );
}

// ── Single Record Card ────────────────────────────────────────────────────────
function RecordCard({ record, jobId, readOnly }: { record: DryingRecord; jobId: number; readOnly?: boolean }) {
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

  const gpp = form.tempF && form.rhPct ? calcGPP(Number(form.tempF), Number(form.rhPct)) : null;
  const dp = form.tempF && form.rhPct ? calcDewPoint(Number(form.tempF), Number(form.rhPct)) : null;

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/drying-records/${record.id}`, {
        ...form,
        tempF: form.tempF !== "" ? Number(form.tempF) : null,
        rhPct: form.rhPct !== "" ? Number(form.rhPct) : null,
        gpp,
        dewPointF: dp,
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

            {/* Psychrometrics */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Thermometer className="w-3.5 h-3.5" />Psychrometric Data (S500 §11)
              </p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div>
                  <Label className="text-xs">Temp (°F)</Label>
                  <Input type="number" className="h-8 text-xs mt-1" placeholder="72" value={form.tempF} disabled={!editing}
                    onChange={e => setForm(f => ({ ...f, tempF: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">RH (%)</Label>
                  <Input type="number" className="h-8 text-xs mt-1" placeholder="55" value={form.rhPct} disabled={!editing}
                    onChange={e => setForm(f => ({ ...f, rhPct: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">GPP (calc)</Label>
                  <div className={`h-8 mt-1 px-3 flex items-center rounded border text-xs font-mono ${gpp && gpp > 900 ? "bg-red-50 border-red-300 text-red-700 dark:bg-red-950" : gpp && gpp > 500 ? "bg-yellow-50 border-yellow-300 dark:bg-yellow-950" : "bg-muted"}`}>
                    {gpp !== null ? `${gpp} GPP` : "—"}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Dew Point (°F)</Label>
                  <div className="h-8 mt-1 px-3 flex items-center rounded border text-xs font-mono bg-muted">
                    {dp !== null ? `${dp}°F` : "—"}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Stored GPP</Label>
                  <div className="h-8 mt-1 px-3 flex items-center rounded border text-xs font-mono bg-muted">
                    {record.gpp ? `${record.gpp} GPP` : "—"}
                  </div>
                </div>
              </div>
              {gpp !== null && (
                <p className={`mt-1 text-xs ${gpp > 900 ? "text-red-600" : gpp > 500 ? "text-yellow-600" : "text-green-600"}`}>
                  {gpp > 900 ? "⚠ Class 3 drying conditions — maximum equipment required" :
                   gpp > 500 ? "Class 2 drying conditions — standard equipment protocol" :
                   "✓ Class 1 conditions — low evaporation rate"}
                </p>
              )}
            </div>

            {/* Moisture readings */}
            <MoistureTable rows={moistureRows} onChange={setMoistureRows} readOnly={!editing} />

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

// ── New Record Form ───────────────────────────────────────────────────────────
function NewRecordForm({ jobId, onClose }: { jobId: number; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    readingDate: new Date().toISOString().slice(0, 10),
    readingTime: new Date().toTimeString().slice(0, 5),
    techName: "",
    dayNumber: 1,
    waterCategory: "category2",
    waterClass: "class2",
    tempF: "",
    rhPct: "",
    observations: "",
  });
  const [moistureRows, setMoistureRows] = useState<MoistureRow[]>([]);
  const [equipRows, setEquipRows] = useState<EquipRow[]>([]);
  const [areaRows, setAreaRows] = useState<AreaRow[]>([]);

  const gpp = form.tempF && form.rhPct ? calcGPP(Number(form.tempF), Number(form.rhPct)) : null;
  const dp = form.tempF && form.rhPct ? calcDewPoint(Number(form.tempF), Number(form.rhPct)) : null;

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/jobs/${jobId}/drying-records`, {
        ...form,
        tempF: form.tempF !== "" ? Number(form.tempF) : null,
        rhPct: form.rhPct !== "" ? Number(form.rhPct) : null,
        gpp,
        dewPointF: dp,
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

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Temp (°F)</Label>
            <Input type="number" className="h-8 text-xs mt-1" placeholder="72" value={form.tempF}
              onChange={e => setForm(f => ({ ...f, tempF: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">RH (%)</Label>
            <Input type="number" className="h-8 text-xs mt-1" placeholder="55" value={form.rhPct}
              onChange={e => setForm(f => ({ ...f, rhPct: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">GPP (calc)</Label>
            <div className="h-8 mt-1 px-3 flex items-center rounded border text-xs font-mono bg-muted">
              {gpp !== null ? `${gpp} GPP` : "—"}
            </div>
          </div>
        </div>

        <MoistureTable rows={moistureRows} onChange={setMoistureRows} />
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

  const { data: records = [], isLoading } = useQuery<DryingRecord[]>({
    queryKey: ["/api/jobs", String(jobId), "drying-records"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/drying-records`).then(r => r.json()),
  });

  const dryCount = records.filter(r => r.structuralDryingComplete === 1).length;
  const wetCount = records.filter(r => {
    const readings: MoistureRow[] = JSON.parse(r.moistureReadings || "[]");
    return readings.some(m => m.reading > m.target);
  }).length;

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

      {showNew && <NewRecordForm jobId={jobId} onClose={() => setShowNew(false)} />}

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
          {records.map(r => <RecordCard key={r.id} record={r} jobId={jobId} readOnly={readOnly} />)}
        </div>
      )}
    </div>
  );
}
