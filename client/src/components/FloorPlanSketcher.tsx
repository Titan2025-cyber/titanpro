/**
 * FloorPlanSketcher.tsx — Interactive floor plan sketch surface.
 *
 * Design goals:
 *   1. A tech on-site should be able to sketch a room layout in under 90 seconds.
 *   2. EVERYTHING is editable AFTER creation: rename, drag, resize, delete, recolor.
 *   3. No proprietary format — one JSON blob per job, versionable & diffable.
 *   4. Photos link to a specific room by id, so the PDF report can pin them
 *      onto the plan and group photos by room automatically.
 *
 * The sketch model:
 *   plan = { rooms: Room[], scale?: { pixelsPerFoot }, background?: { dataUrl } }
 *   Room = { id, name, x, y, w, h, color, notes? }
 *
 * Coordinates are stored in an abstract 1000x700 unit space. The <svg> viewBox
 * scales that to whatever canvas size the parent gives us, so plans render
 * consistently across mobile and desktop and don't need re-computing when the
 * container resizes.
 *
 * Interactions:
 *   - Add: click "Add room" → new 200×150 rectangle drops in the center.
 *   - Draw: hold "Draw mode", click-drag on empty canvas to rubber-band a room.
 *   - Move: click a room and drag anywhere inside it.
 *   - Resize: eight handles (corners + midpoints) on the selected room.
 *   - Rename: dbl-click a room, or edit in the side panel.
 *   - Delete: Delete key when selected, or trash icon in the side panel.
 *   - Undo: Cmd/Ctrl-Z pops the history stack (up to 30 snapshots).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Undo2, Save, Grid3x3, Move, PencilRuler, X, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const CANVAS_W = 1000;
const CANVAS_H = 700;

// A tasteful default palette for room fills. Users can pick any of these from
// the room inspector; the swatches double as accessibility-safe visual codes.
const ROOM_COLORS = [
  "#dbeafe", // blue
  "#dcfce7", // green
  "#fef3c7", // amber
  "#fce7f3", // pink
  "#e9d5ff", // purple
  "#fed7aa", // orange
  "#cffafe", // cyan
  "#fee2e2", // red
];

export interface FloorRoom {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  notes?: string;
}
export interface FloorPlanData {
  rooms: FloorRoom[];
  scale?: { pixelsPerFoot?: number };
  background?: { dataUrl?: string };
}

// Handle IDs for resize dots. `move` is the interior body-drag.
type DragMode =
  | { kind: "move"; id: string; startX: number; startY: number; origX: number; origY: number }
  | { kind: "resize"; id: string; handle: string; startX: number; startY: number; orig: FloorRoom }
  | { kind: "draw"; startX: number; startY: number; currX: number; currY: number }
  | null;

interface Props {
  value: FloorPlanData;
  onChange: (next: FloorPlanData) => void;
  /** Optional: render a numbered pin count per room (photo counts from parent). */
  photoCounts?: Record<string, number>;
  /** Called when Save is clicked — parent persists via API. */
  onSave?: () => void;
  saving?: boolean;
  readOnly?: boolean;
}

function uid() {
  return "r_" + Math.random().toString(36).slice(2, 9);
}

export default function FloorPlanSketcher({
  value,
  onChange,
  photoCounts,
  onSave,
  saving,
  readOnly = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [drag, setDrag] = useState<DragMode>(null);
  const [showGrid, setShowGrid] = useState(true);
  const historyRef = useRef<FloorPlanData[]>([]);
  const suppressHistoryRef = useRef(false);

  // Push a snapshot BEFORE mutating so undo restores the previous state.
  const pushHistory = () => {
    if (suppressHistoryRef.current) return;
    historyRef.current.push(JSON.parse(JSON.stringify(value)));
    if (historyRef.current.length > 30) historyRef.current.shift();
  };
  const undo = () => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    suppressHistoryRef.current = true;
    onChange(prev);
    setTimeout(() => { suppressHistoryRef.current = false; }, 0);
  };

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        deleteRoom(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, value, readOnly]);

  const selected = useMemo(() => value.rooms.find(r => r.id === selectedId) || null, [value, selectedId]);

  // Map a pointer event to viewBox coordinates. getScreenCTM handles zoom,
  // scroll, and any CSS transforms on the SVG element in one go.
  const toSvgCoords = (e: React.PointerEvent | PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const addRoom = () => {
    pushHistory();
    const room: FloorRoom = {
      id: uid(),
      name: `Room ${value.rooms.length + 1}`,
      x: CANVAS_W / 2 - 100,
      y: CANVAS_H / 2 - 75,
      w: 200,
      h: 150,
      color: ROOM_COLORS[value.rooms.length % ROOM_COLORS.length],
    };
    onChange({ ...value, rooms: [...value.rooms, room] });
    setSelectedId(room.id);
  };

  const updateRoom = (id: string, patch: Partial<FloorRoom>, skipHistory = false) => {
    if (!skipHistory) pushHistory();
    onChange({
      ...value,
      rooms: value.rooms.map(r => (r.id === id ? { ...r, ...patch } : r)),
    });
  };

  const deleteRoom = (id: string) => {
    pushHistory();
    onChange({ ...value, rooms: value.rooms.filter(r => r.id !== id) });
    if (selectedId === id) setSelectedId(null);
  };

  // ── Pointer flow ────────────────────────────────────────────────────────
  // We commit a single history snapshot at the START of a drag, then update
  // room geometry with skipHistory=true so a long drag doesn't spam undo.
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (readOnly) return;
    (e.currentTarget as any).setPointerCapture?.(e.pointerId);
    const { x, y } = toSvgCoords(e);
    if (drawMode) {
      pushHistory();
      setDrag({ kind: "draw", startX: x, startY: y, currX: x, currY: y });
      setSelectedId(null);
      return;
    }
    // Hit-test resize handles first (they sit on top of the selected room).
    if (selected) {
      const h = hitHandle(selected, x, y);
      if (h) {
        pushHistory();
        setDrag({ kind: "resize", id: selected.id, handle: h, startX: x, startY: y, orig: { ...selected } });
        return;
      }
    }
    // Hit-test room bodies (topmost = last drawn wins).
    for (let i = value.rooms.length - 1; i >= 0; i--) {
      const r = value.rooms[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        setSelectedId(r.id);
        pushHistory();
        setDrag({ kind: "move", id: r.id, startX: x, startY: y, origX: r.x, origY: r.y });
        return;
      }
    }
    // Empty click deselects.
    setSelectedId(null);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const { x, y } = toSvgCoords(e);
    if (drag.kind === "move") {
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      updateRoom(drag.id, { x: clamp(drag.origX + dx, 0, CANVAS_W), y: clamp(drag.origY + dy, 0, CANVAS_H) }, true);
    } else if (drag.kind === "resize") {
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      const next = resizeFromHandle(drag.orig, drag.handle, dx, dy);
      updateRoom(drag.id, next, true);
    } else if (drag.kind === "draw") {
      setDrag({ ...drag, currX: x, currY: y });
    }
  };

  const onPointerUp = () => {
    if (drag?.kind === "draw") {
      const x = Math.min(drag.startX, drag.currX);
      const y = Math.min(drag.startY, drag.currY);
      const w = Math.abs(drag.currX - drag.startX);
      const h = Math.abs(drag.currY - drag.startY);
      // Ignore tiny accidental drags.
      if (w > 20 && h > 20) {
        const room: FloorRoom = {
          id: uid(),
          name: `Room ${value.rooms.length + 1}`,
          x, y, w, h,
          color: ROOM_COLORS[value.rooms.length % ROOM_COLORS.length],
        };
        onChange({ ...value, rooms: [...value.rooms, room] });
        setSelectedId(room.id);
      }
    }
    setDrag(null);
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col md:flex-row gap-4 w-full">
      {/* Canvas */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {!readOnly && (
            <>
              <Button size="sm" variant="outline" onClick={addRoom}><Plus className="w-4 h-4 mr-1"/>Add room</Button>
              <Button size="sm" variant={drawMode ? "default" : "outline"} onClick={() => setDrawMode(v => !v)}>
                <PencilRuler className="w-4 h-4 mr-1"/>{drawMode ? "Drawing…" : "Draw"}
              </Button>
              <Button size="sm" variant="outline" onClick={undo} disabled={historyRef.current.length === 0}>
                <Undo2 className="w-4 h-4 mr-1"/>Undo
              </Button>
            </>
          )}
          <Button size="sm" variant={showGrid ? "default" : "outline"} onClick={() => setShowGrid(v => !v)}>
            <Grid3x3 className="w-4 h-4 mr-1"/>Grid
          </Button>
          {onSave && !readOnly && (
            <Button size="sm" onClick={onSave} disabled={saving} className="ml-auto">
              <Save className="w-4 h-4 mr-1"/>{saving ? "Saving…" : "Save plan"}
            </Button>
          )}
        </div>
        <div className="border rounded-lg overflow-hidden bg-white touch-none">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
            className="w-full h-auto block"
            style={{ maxHeight: "70vh", cursor: drawMode ? "crosshair" : "default" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* Background grid — visual guide only, not persisted. */}
            {showGrid && (
              <g opacity={0.35}>
                {Array.from({ length: Math.ceil(CANVAS_W / 40) + 1 }).map((_, i) => (
                  <line key={"gx"+i} x1={i*40} y1={0} x2={i*40} y2={CANVAS_H} stroke="#e5e7eb" strokeWidth={1}/>
                ))}
                {Array.from({ length: Math.ceil(CANVAS_H / 40) + 1 }).map((_, i) => (
                  <line key={"gy"+i} x1={0} y1={i*40} x2={CANVAS_W} y2={i*40} stroke="#e5e7eb" strokeWidth={1}/>
                ))}
              </g>
            )}
            {value.background?.dataUrl && (
              <image href={value.background.dataUrl} x={0} y={0} width={CANVAS_W} height={CANVAS_H} opacity={0.5}/>
            )}
            {value.rooms.map((r, idx) => {
              const isSel = r.id === selectedId;
              const count = photoCounts?.[r.id] || 0;
              return (
                <g key={r.id}>
                  <rect
                    x={r.x} y={r.y} width={r.w} height={r.h}
                    fill={r.color || "#e0f2fe"} fillOpacity={0.7}
                    stroke={isSel ? "#0f766e" : "#0f172a"}
                    strokeWidth={isSel ? 3 : 1.5}
                    onDoubleClick={() => {
                      if (readOnly) return;
                      const name = prompt("Room name:", r.name);
                      if (name && name.trim()) updateRoom(r.id, { name: name.trim() });
                    }}
                  />
                  {/* Room label — always readable regardless of fill color. */}
                  <text
                    x={r.x + r.w / 2}
                    y={r.y + r.h / 2 - 6}
                    textAnchor="middle"
                    fontSize={Math.max(14, Math.min(22, r.h * 0.15))}
                    fontWeight={600}
                    fill="#0f172a"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {r.name}
                  </text>
                  <text
                    x={r.x + r.w / 2}
                    y={r.y + r.h / 2 + 14}
                    textAnchor="middle"
                    fontSize={12}
                    fill="#475569"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {`${Math.round(r.w)}×${Math.round(r.h)}`}
                    {count > 0 ? ` · ${count} photo${count===1?"":"s"}` : ""}
                  </text>
                  {/* Resize handles — only on the selected room, and only in edit mode. */}
                  {isSel && !readOnly && handlePositions(r).map(([hid, hx, hy]) => (
                    <circle key={hid} cx={hx as number} cy={hy as number} r={7}
                            fill="white" stroke="#0f766e" strokeWidth={2}
                            style={{ cursor: handleCursor(hid as string) }}/>
                  ))}
                </g>
              );
            })}
            {/* Rubber-band preview while drawing. */}
            {drag?.kind === "draw" && (
              <rect
                x={Math.min(drag.startX, drag.currX)}
                y={Math.min(drag.startY, drag.currY)}
                width={Math.abs(drag.currX - drag.startX)}
                height={Math.abs(drag.currY - drag.startY)}
                fill="#0f766e" fillOpacity={0.15} stroke="#0f766e" strokeDasharray="6 4" strokeWidth={2}
              />
            )}
          </svg>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Click a room to select · drag to move · corner handles resize · double-click renames · Delete removes · Cmd/Ctrl-Z undoes.
        </p>
      </div>

      {/* Inspector — visible when a room is selected */}
      <aside className="md:w-72 shrink-0 border rounded-lg p-3 bg-slate-50 min-h-[240px]">
        {!selected ? (
          <div className="text-sm text-gray-500">
            <div className="font-semibold text-gray-700 mb-1">No room selected</div>
            Add a room, or click any existing room on the plan to edit it.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm">Room details</div>
              {!readOnly && (
                <Button size="sm" variant="ghost" onClick={() => deleteRoom(selected.id)} className="text-red-600 h-7 px-2">
                  <Trash2 className="w-4 h-4"/>
                </Button>
              )}
            </div>
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={selected.name} disabled={readOnly}
                     onChange={e => updateRoom(selected.id, { name: e.target.value })}/>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">X</Label>
                <Input type="number" value={Math.round(selected.x)} disabled={readOnly}
                       onChange={e => updateRoom(selected.id, { x: Number(e.target.value) })}/>
              </div>
              <div>
                <Label className="text-xs">Y</Label>
                <Input type="number" value={Math.round(selected.y)} disabled={readOnly}
                       onChange={e => updateRoom(selected.id, { y: Number(e.target.value) })}/>
              </div>
              <div>
                <Label className="text-xs">Width</Label>
                <Input type="number" value={Math.round(selected.w)} disabled={readOnly}
                       onChange={e => updateRoom(selected.id, { w: Math.max(20, Number(e.target.value)) })}/>
              </div>
              <div>
                <Label className="text-xs">Height</Label>
                <Input type="number" value={Math.round(selected.h)} disabled={readOnly}
                       onChange={e => updateRoom(selected.id, { h: Math.max(20, Number(e.target.value)) })}/>
              </div>
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1"><Palette className="w-3 h-3"/>Color</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {ROOM_COLORS.map(c => (
                  <button key={c} type="button" disabled={readOnly}
                          onClick={() => updateRoom(selected.id, { color: c })}
                          className={`w-6 h-6 rounded border ${selected.color === c ? "ring-2 ring-teal-600" : ""}`}
                          style={{ background: c }} aria-label={`Color ${c}`}/>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea rows={3} value={selected.notes || ""} disabled={readOnly}
                        onChange={e => updateRoom(selected.id, { notes: e.target.value })}
                        placeholder="Damage details, moisture readings, etc."/>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

// ── Geometry helpers ────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function handlePositions(r: FloorRoom): Array<[string, number, number]> {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  return [
    ["nw", r.x,       r.y      ],
    ["n",  cx,        r.y      ],
    ["ne", r.x + r.w, r.y      ],
    ["e",  r.x + r.w, cy       ],
    ["se", r.x + r.w, r.y + r.h],
    ["s",  cx,        r.y + r.h],
    ["sw", r.x,       r.y + r.h],
    ["w",  r.x,       cy       ],
  ];
}
function hitHandle(r: FloorRoom, x: number, y: number): string | null {
  for (const [id, hx, hy] of handlePositions(r)) {
    const dx = x - (hx as number), dy = y - (hy as number);
    if (dx * dx + dy * dy <= 10 * 10) return id as string;
  }
  return null;
}
function handleCursor(id: string): string {
  return {
    nw: "nwse-resize", se: "nwse-resize",
    ne: "nesw-resize", sw: "nesw-resize",
    n: "ns-resize", s: "ns-resize",
    e: "ew-resize", w: "ew-resize",
  }[id] || "default";
}
function resizeFromHandle(orig: FloorRoom, handle: string, dx: number, dy: number): Partial<FloorRoom> {
  let { x, y, w, h } = orig;
  const minSize = 20;
  if (handle.includes("e")) w = Math.max(minSize, orig.w + dx);
  if (handle.includes("s")) h = Math.max(minSize, orig.h + dy);
  if (handle.includes("w")) { const nx = orig.x + dx; const nw = orig.w - dx; if (nw >= minSize) { x = nx; w = nw; } }
  if (handle.includes("n")) { const ny = orig.y + dy; const nh = orig.h - dy; if (nh >= minSize) { y = ny; h = nh; } }
  return { x, y, w, h };
}
