/**
 * PhotoAnnotator.tsx — Non-destructive annotation canvas for a photo.
 *
 * Design goals:
 *   1. Draw arrows, circles, rectangles, freehand strokes, text labels, and
 *      moisture reading badges directly on top of the photo.
 *   2. The original image bytes are NEVER modified — annotations persist as a
 *      JSON shape array on the photo row. The PDF renderer composites them
 *      onto the image at export time.
 *   3. Room-inspection reality: techs are on-site with wet hands and gloves,
 *      so tools must be big, obvious, and hard to mis-tap. No hidden gestures.
 *
 * Data model:
 *   annotationsJson = { shapes: Shape[] }
 *   Shape = { id, type: "arrow"|"circle"|"rect"|"freehand"|"text"|"moisture",
 *             color, strokeWidth, points?, x?, y?, w?, h?, text?, value? }
 *
 * Coordinates live in a normalized 0..1 space against the image's natural
 * size, so the same JSON renders correctly on any canvas dimension (mobile
 * preview, PDF page, or blown-up desktop).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Save, Undo2, ArrowRight, Circle as CircleIcon, Square, PenLine, Type, Droplets, Trash2, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Photo } from "@shared/schema";

type ShapeKind = "arrow" | "circle" | "rect" | "freehand" | "text" | "moisture";

interface Shape {
  id: string;
  type: ShapeKind;
  color: string;
  strokeWidth: number;
  // Normalized coordinates (0..1). Endpoint shapes use x/y + x2/y2.
  // Rect / circle use x/y + w/h. Freehand uses points[]. Text/moisture use x/y + text/value.
  x?: number; y?: number;
  x2?: number; y2?: number;
  w?: number; h?: number;
  points?: { x: number; y: number }[];
  text?: string;
  value?: string;
}

const TOOL_COLORS = ["#ef4444", "#f59e0b", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ffffff", "#000000"];

interface Props {
  photo: Photo;
  onClose: () => void;
  /** Called with the JSON string to persist on the photo row. */
  onSave: (annotationsJson: string) => Promise<void> | void;
}

function uid() { return "s_" + Math.random().toString(36).slice(2, 9); }

export default function PhotoAnnotator({ photo, onClose, onSave }: Props) {
  // ── Existing annotations load once from the photo row so re-opening picks
  //    up right where the tech left off. Corrupt JSON falls back to empty.
  const initial: Shape[] = useMemo(() => {
    try {
      const raw = (photo as any).annotationsJson;
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.shapes) ? parsed.shapes : [];
    } catch { return []; }
  }, [photo]);

  const [shapes, setShapes] = useState<Shape[]>(initial);
  const [tool, setTool] = useState<ShapeKind>("arrow");
  const [color, setColor] = useState<string>("#ef4444");
  const [strokeWidth, setStrokeWidth] = useState<number>(4);
  const [saving, setSaving] = useState(false);
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null);
  const [pendingMoisture, setPendingMoisture] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState("");
  const [moistureInput, setMoistureInput] = useState("");
  const historyRef = useRef<Shape[][]>([]);
  const drawingRef = useRef<Shape | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [, forceRender] = useState(0);

  const pushHistory = useCallback(() => {
    historyRef.current.push(JSON.parse(JSON.stringify(shapes)));
    if (historyRef.current.length > 30) historyRef.current.shift();
  }, [shapes]);

  const undo = () => {
    const prev = historyRef.current.pop();
    if (prev) setShapes(prev);
  };
  const clearAll = () => {
    if (shapes.length === 0) return;
    if (!confirm("Clear all annotations on this photo?")) return;
    pushHistory();
    setShapes([]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line
  }, [shapes]);

  // ── Pointer → normalized coords ─────────────────────────────────────────
  const toNorm = (e: React.PointerEvent<SVGSVGElement>): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.currentTarget as any).setPointerCapture?.(e.pointerId);
    const p = toNorm(e);
    if (tool === "text") { setPendingText(p); setTextInput(""); return; }
    if (tool === "moisture") { setPendingMoisture(p); setMoistureInput(""); return; }
    pushHistory();
    const base: Shape = { id: uid(), type: tool, color, strokeWidth };
    if (tool === "freehand") {
      drawingRef.current = { ...base, points: [p] };
    } else if (tool === "arrow") {
      drawingRef.current = { ...base, x: p.x, y: p.y, x2: p.x, y2: p.y };
    } else {
      // circle / rect
      drawingRef.current = { ...base, x: p.x, y: p.y, w: 0, h: 0 };
    }
    forceRender(n => n + 1);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawingRef.current) return;
    const p = toNorm(e);
    const s = drawingRef.current;
    if (s.type === "freehand") {
      s.points!.push(p);
    } else if (s.type === "arrow") {
      s.x2 = p.x; s.y2 = p.y;
    } else {
      s.w = p.x - (s.x || 0);
      s.h = p.y - (s.y || 0);
    }
    forceRender(n => n + 1);
  };

  const onPointerUp = () => {
    const s = drawingRef.current;
    if (!s) return;
    drawingRef.current = null;
    // Discard trivially small shapes so an accidental tap doesn't pollute.
    if (s.type === "freehand" && (s.points?.length ?? 0) < 2) return;
    if ((s.type === "circle" || s.type === "rect") && Math.abs(s.w ?? 0) < 0.005 && Math.abs(s.h ?? 0) < 0.005) return;
    if (s.type === "arrow" && Math.hypot((s.x2 ?? 0) - (s.x ?? 0), (s.y2 ?? 0) - (s.y ?? 0)) < 0.005) return;
    setShapes(prev => [...prev, s]);
  };

  const commitText = () => {
    if (!pendingText || !textInput.trim()) { setPendingText(null); return; }
    pushHistory();
    setShapes(prev => [...prev, { id: uid(), type: "text", color, strokeWidth, x: pendingText.x, y: pendingText.y, text: textInput.trim() }]);
    setPendingText(null); setTextInput("");
  };
  const commitMoisture = () => {
    if (!pendingMoisture || !moistureInput.trim()) { setPendingMoisture(null); return; }
    pushHistory();
    setShapes(prev => [...prev, { id: uid(), type: "moisture", color: "#0ea5e9", strokeWidth: 2, x: pendingMoisture.x, y: pendingMoisture.y, value: moistureInput.trim() }]);
    setPendingMoisture(null); setMoistureInput("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(JSON.stringify({ shapes }));
      onClose();
    } finally { setSaving(false); }
  };

  const dataUrl = (photo as any).dataUrl || "";
  // Current in-flight shape rendered live over top of committed shapes.
  const live = drawingRef.current;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-2 md:p-4">
      <div className="bg-white rounded-lg max-w-5xl w-full max-h-[95vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-2 border-b bg-slate-50">
          <div className="font-semibold text-sm">Annotate photo</div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={undo} disabled={historyRef.current.length === 0}>
              <Undo2 className="w-4 h-4"/>
            </Button>
            <Button size="sm" variant="ghost" onClick={clearAll} className="text-red-600">
              <Trash2 className="w-4 h-4"/>
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-1"/>{saving ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4"/></Button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1 p-2 border-b bg-slate-100">
          <ToolButton active={tool==="arrow"} onClick={() => setTool("arrow")} icon={<ArrowRight className="w-4 h-4"/>} label="Arrow"/>
          <ToolButton active={tool==="circle"} onClick={() => setTool("circle")} icon={<CircleIcon className="w-4 h-4"/>} label="Circle"/>
          <ToolButton active={tool==="rect"} onClick={() => setTool("rect")} icon={<Square className="w-4 h-4"/>} label="Rect"/>
          <ToolButton active={tool==="freehand"} onClick={() => setTool("freehand")} icon={<PenLine className="w-4 h-4"/>} label="Draw"/>
          <ToolButton active={tool==="text"} onClick={() => setTool("text")} icon={<Type className="w-4 h-4"/>} label="Text"/>
          <ToolButton active={tool==="moisture"} onClick={() => setTool("moisture")} icon={<Droplets className="w-4 h-4"/>} label="Moisture"/>
          <div className="w-px h-6 bg-slate-300 mx-1"/>
          <Palette className="w-4 h-4 text-slate-500 ml-1"/>
          {TOOL_COLORS.map(c => (
            <button key={c} type="button" onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full border ${color === c ? "ring-2 ring-teal-600" : ""}`}
                    style={{ background: c }} aria-label={`Color ${c}`}/>
          ))}
          <div className="w-px h-6 bg-slate-300 mx-1"/>
          <label className="flex items-center gap-1 text-xs text-slate-600">
            Stroke
            <input type="range" min={2} max={12} step={1} value={strokeWidth}
                   onChange={e => setStrokeWidth(Number(e.target.value))}
                   className="w-24"/>
            <span className="w-4 text-center">{strokeWidth}</span>
          </label>
        </div>

        {/* Canvas */}
        <div className="flex-1 overflow-auto bg-slate-900 relative flex items-center justify-center p-2">
          <div className="relative inline-block max-w-full">
            <img
              ref={imgRef}
              src={dataUrl}
              alt=""
              className="block max-w-full max-h-[70vh] rounded select-none"
              draggable={false}
            />
            {/* SVG overlay matches the img's rendered size exactly. Absolute-positioned. */}
            <svg
              ref={svgRef}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full touch-none"
              style={{ cursor: tool === "text" || tool === "moisture" ? "text" : "crosshair" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {shapes.map(s => renderShape(s))}
              {live && renderShape(live)}
            </svg>
            {/* Inline text prompt overlay */}
            {pendingText && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <div className="bg-white rounded-lg p-3 shadow-lg w-72">
                  <div className="text-xs font-semibold mb-1">Text label</div>
                  <Input autoFocus value={textInput} onChange={e => setTextInput(e.target.value)}
                         onKeyDown={e => { if (e.key === "Enter") commitText(); if (e.key === "Escape") setPendingText(null); }}
                         placeholder="e.g. Water intrusion at baseboard"/>
                  <div className="flex justify-end gap-1 mt-2">
                    <Button size="sm" variant="ghost" onClick={() => setPendingText(null)}>Cancel</Button>
                    <Button size="sm" onClick={commitText}>Add</Button>
                  </div>
                </div>
              </div>
            )}
            {pendingMoisture && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <div className="bg-white rounded-lg p-3 shadow-lg w-72">
                  <div className="text-xs font-semibold mb-1">Moisture reading</div>
                  <Input autoFocus value={moistureInput} onChange={e => setMoistureInput(e.target.value)}
                         onKeyDown={e => { if (e.key === "Enter") commitMoisture(); if (e.key === "Escape") setPendingMoisture(null); }}
                         placeholder="% or reading (e.g. 28% WME)"/>
                  <div className="flex justify-end gap-1 mt-2">
                    <Button size="sm" variant="ghost" onClick={() => setPendingMoisture(null)}>Cancel</Button>
                    <Button size="sm" onClick={commitMoisture}>Add</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="px-3 py-2 text-[11px] text-slate-500 border-t bg-slate-50">
          Original file is never modified. Drawings save as data alongside the photo and render in the report.
        </div>
      </div>
    </div>
  );
}

function ToolButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${active ? "bg-teal-600 text-white" : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"}`}
      aria-pressed={active}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// ── SVG render helpers ──────────────────────────────────────────────────────
// Everything renders in 0..1 space so the same JSON survives any resize.
function renderShape(s: Shape) {
  const stroke = s.color;
  const w = Math.max(0.002, (s.strokeWidth || 4) / 1000);
  switch (s.type) {
    case "arrow":
      return renderArrow(s, stroke, w);
    case "circle": {
      const cx = (s.x || 0) + (s.w || 0) / 2;
      const cy = (s.y || 0) + (s.h || 0) / 2;
      const rx = Math.abs((s.w || 0) / 2);
      const ry = Math.abs((s.h || 0) / 2);
      return <ellipse key={s.id} cx={cx} cy={cy} rx={rx} ry={ry} stroke={stroke} strokeWidth={w} fill="none"/>;
    }
    case "rect": {
      const x = Math.min(s.x || 0, (s.x || 0) + (s.w || 0));
      const y = Math.min(s.y || 0, (s.y || 0) + (s.h || 0));
      const rw = Math.abs(s.w || 0);
      const rh = Math.abs(s.h || 0);
      return <rect key={s.id} x={x} y={y} width={rw} height={rh} stroke={stroke} strokeWidth={w} fill="none"/>;
    }
    case "freehand": {
      const pts = (s.points || []).map(p => `${p.x},${p.y}`).join(" ");
      return <polyline key={s.id} points={pts} stroke={stroke} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round"/>;
    }
    case "text": {
      // font-size is in the same 0..1 unit space, so 0.03 == 3% of canvas height.
      return (
        <g key={s.id}>
          <rect x={(s.x || 0) - 0.005} y={(s.y || 0) - 0.032} width={Math.min(0.4, (s.text?.length || 4) * 0.014 + 0.02)} height={0.038} fill="rgba(0,0,0,0.65)"/>
          <text x={s.x} y={(s.y || 0) - 0.005} fontSize={0.028} fill="#fff" style={{ fontFamily: "Inter, sans-serif" }}>{s.text}</text>
        </g>
      );
    }
    case "moisture": {
      // Sky-blue rounded badge with a droplet cue. Value shown inside.
      return (
        <g key={s.id}>
          <circle cx={s.x} cy={s.y} r={0.028} fill={stroke} stroke="#fff" strokeWidth={0.004}/>
          <text x={s.x} y={(s.y || 0) + 0.01} textAnchor="middle" fontSize={0.022} fill="#fff" fontWeight={700}>{s.value}</text>
        </g>
      );
    }
    default: return null;
  }
}

function renderArrow(s: Shape, stroke: string, w: number) {
  const x1 = s.x || 0, y1 = s.y || 0, x2 = s.x2 || 0, y2 = s.y2 || 0;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const head = Math.max(0.03, w * 6);
  // Two-line arrowhead — simpler than a filled poly and legible at small sizes.
  const hx1 = x2 - ux * head + uy * head * 0.5;
  const hy1 = y2 - uy * head - ux * head * 0.5;
  const hx2 = x2 - ux * head - uy * head * 0.5;
  const hy2 = y2 - uy * head + ux * head * 0.5;
  return (
    <g key={s.id}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={w} strokeLinecap="round"/>
      <line x1={x2} y1={y2} x2={hx1} y2={hy1} stroke={stroke} strokeWidth={w} strokeLinecap="round"/>
      <line x1={x2} y1={y2} x2={hx2} y2={hy2} stroke={stroke} strokeWidth={w} strokeLinecap="round"/>
    </g>
  );
}
