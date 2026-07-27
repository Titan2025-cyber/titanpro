/**
 * MitigationSketch.tsx — Floor Plan Sketch Tool
 * Canvas-based sketching for mitigation jobs:
 *   - Draw rooms (rectangles) with drag
 *   - Add moisture reading labels (pin a reading anywhere)
 *   - Add text annotations
 *   - Freehand drawing mode
 *   - Erase objects
 *   - Save / load per job from backend
 *   - Export sketch as PNG
 */
import { useRef, useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Square, Pen, Type, Droplets, Eraser, Download,
  Save, Trash2, RotateCcw, ZoomIn, ZoomOut, MousePointer,
  Ruler, PenLine, Circle
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
type ToolMode = "select" | "room" | "freehand" | "text" | "moisture" | "eraser" | "circle" | "arrow";

interface RoomShape {
  type: "room";
  id: string;
  x: number; y: number; w: number; h: number;
  label: string;
  color: string;
  sqft?: number;
}
interface FreehandShape {
  type: "freehand";
  id: string;
  points: { x: number; y: number }[];
  color: string;
  lineWidth: number;
}
interface TextShape {
  type: "text";
  id: string;
  x: number; y: number;
  text: string;
  color: string;
  fontSize: number;
}
interface MoisturePin {
  type: "moisture";
  id: string;
  x: number; y: number;
  label: string;       // e.g. "14.2% WME"
  material: string;
  alert: boolean;       // true if above threshold
}
interface CircleShape {
  type: "circle";
  id: string;
  cx: number; cy: number; r: number;
  color: string;
  label: string;
}
interface ArrowShape {
  type: "arrow";
  id: string;
  x1: number; y1: number;
  x2: number; y2: number;
  color: string;
  label: string;
}

type Shape = RoomShape | FreehandShape | TextShape | MoisturePin | CircleShape | ArrowShape;

interface SketchData {
  shapes: Shape[];
  scale: number; // ft per 100px
  notes: string;
}

const ROOM_COLORS = [
  "#3B82F6", "#EF4444", "#22C55E", "#F59E0B",
  "#8B5CF6", "#EC4899", "#14B8A6", "#F97316",
];

const DEFAULT_SKETCH: SketchData = { shapes: [], scale: 10, notes: "" };

// Grid: 50px = 10 ft  →  5px per foot. Keep in sync with gridSize/scale math.
const PX_PER_FT = 5;
const pxToFt = (px: number) => Math.abs(px) / PX_PER_FT;
const ftToPx = (ft: number) => ft * PX_PER_FT;

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// ── Canvas renderer ───────────────────────────────────────────────────────────
function renderCanvas(
  canvas: HTMLCanvasElement,
  sketch: SketchData,
  selectedId: string | null,
  draft: Partial<Shape> | null,
  offset: { x: number; y: number },
  zoom: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  // Grid
  ctx.save();
  ctx.translate(offset.x, offset.y);
  ctx.scale(zoom, zoom);

  const gridSize = 50; // 50px = scale feet
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 0.5 / zoom;
  const startX = Math.floor(-offset.x / zoom / gridSize) * gridSize;
  const startY = Math.floor(-offset.y / zoom / gridSize) * gridSize;
  for (let gx = startX; gx < (width - offset.x) / zoom + gridSize; gx += gridSize) {
    ctx.beginPath(); ctx.moveTo(gx, startY); ctx.lineTo(gx, (height - offset.y) / zoom + gridSize); ctx.stroke();
  }
  for (let gy = startY; gy < (height - offset.y) / zoom + gridSize; gy += gridSize) {
    ctx.beginPath(); ctx.moveTo(startX, gy); ctx.lineTo((width - offset.x) / zoom + gridSize, gy); ctx.stroke();
  }

  // Draw all shapes
  for (const shape of sketch.shapes) {
    drawShape(ctx, shape, shape.id === selectedId, zoom);
  }

  // Draw draft
  if (draft) drawShape(ctx, draft as Shape, false, zoom, true);

  ctx.restore();
}

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, selected: boolean, zoom: number, isDraft = false) {
  ctx.save();
  if (selected) {
    ctx.shadowColor = "#3B82F6";
    ctx.shadowBlur = 8 / zoom;
  }
  if (isDraft) ctx.globalAlpha = 0.5;

  switch (shape.type) {
    case "room": {
      const s = shape as RoomShape;
      ctx.fillStyle = s.color + "22";
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      ctx.rect(s.x, s.y, s.w, s.h);
      ctx.fill();
      ctx.stroke();
      // Label
      ctx.fillStyle = s.color;
      ctx.font = `bold ${13 / zoom}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(s.label, s.x + s.w / 2, s.y + s.h / 2);
      if (s.sqft) {
        ctx.font = `${10 / zoom}px Inter, sans-serif`;
        ctx.fillText(`${s.sqft} sq ft`, s.x + s.w / 2, s.y + s.h / 2 + 14 / zoom);
      }
      // Dimension lines
      ctx.strokeStyle = s.color + "88";
      ctx.lineWidth = 0.5 / zoom;
      ctx.font = `${9 / zoom}px Inter, sans-serif`;
      ctx.fillStyle = "#64748b";
      ctx.textAlign = "center";
      // Width label
      ctx.fillText(`${Math.abs(s.w / 50 * 10).toFixed(0)} ft`, s.x + s.w / 2, s.y - 4 / zoom);
      // Height label
      ctx.save();
      ctx.translate(s.x - 6 / zoom, s.y + s.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`${Math.abs(s.h / 50 * 10).toFixed(0)} ft`, 0, 0);
      ctx.restore();
      // Selection handles
      if (selected) {
        const handles = [
          [s.x, s.y], [s.x + s.w, s.y], [s.x, s.y + s.h], [s.x + s.w, s.y + s.h],
          [s.x + s.w / 2, s.y], [s.x + s.w / 2, s.y + s.h],
          [s.x, s.y + s.h / 2], [s.x + s.w, s.y + s.h / 2],
        ];
        ctx.fillStyle = "#3B82F6";
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1 / zoom;
        for (const [hx, hy] of handles) {
          ctx.beginPath();
          ctx.arc(hx, hy, 4 / zoom, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      break;
    }
    case "freehand": {
      const s = shape as FreehandShape;
      if (s.points.length < 2) break;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.lineWidth / zoom;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke();
      break;
    }
    case "text": {
      const s = shape as TextShape;
      ctx.font = `${s.fontSize / zoom}px Inter, sans-serif`;
      ctx.fillStyle = s.color;
      ctx.textAlign = "left";
      ctx.fillText(s.text, s.x, s.y);
      if (selected) {
        const m = ctx.measureText(s.text);
        ctx.strokeStyle = "#3B82F6";
        ctx.lineWidth = 1 / zoom;
        ctx.strokeRect(s.x - 2 / zoom, s.y - s.fontSize / zoom, m.width + 4 / zoom, s.fontSize / zoom + 4 / zoom);
      }
      break;
    }
    case "moisture": {
      const s = shape as MoisturePin;
      const pinColor = s.alert ? "#EF4444" : "#22C55E";
      ctx.fillStyle = pinColor;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 8 / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Droplet icon as text
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${8 / zoom}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("~", s.x, s.y + 3 / zoom);
      // Label bubble
      const lblW = (s.label.length * 6 + 16) / zoom;
      const lblH = 16 / zoom;
      const lblX = s.x - lblW / 2;
      const lblY = s.y - 22 / zoom - lblH;
      ctx.fillStyle = pinColor;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(lblX, lblY, lblW, lblH, 3 / zoom) : ctx.rect(lblX, lblY, lblW, lblH);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${9 / zoom}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(s.label, s.x, lblY + 11 / zoom);
      if (s.material) {
        ctx.fillStyle = "#475569";
        ctx.font = `${8 / zoom}px Inter, sans-serif`;
        ctx.fillText(s.material, s.x, s.y + 18 / zoom);
      }
      break;
    }
    case "circle": {
      const s = shape as CircleShape;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2 / zoom;
      ctx.fillStyle = s.color + "18";
      ctx.beginPath();
      ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (s.label) {
        ctx.fillStyle = s.color;
        ctx.font = `${11 / zoom}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(s.label, s.cx, s.cy + 3 / zoom);
      }
      break;
    }
    case "arrow": {
      const s = shape as ArrowShape;
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) break;
      const angle = Math.atan2(dy, dx);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      // Arrowhead
      const hw = 8 / zoom;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.moveTo(s.x2, s.y2);
      ctx.lineTo(s.x2 - hw * Math.cos(angle - 0.4), s.y2 - hw * Math.sin(angle - 0.4));
      ctx.lineTo(s.x2 - hw * Math.cos(angle + 0.4), s.y2 - hw * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fill();
      if (s.label) {
        ctx.fillStyle = s.color;
        ctx.font = `${10 / zoom}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(s.label, (s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2 - 6 / zoom);
      }
      break;
    }
  }
  ctx.restore();
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function MitigationSketch({ jobId, readOnly = false }: { jobId: number; readOnly?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { toast } = useToast();

  const [tool, setTool] = useState<ToolMode>("select");
  const [sketch, setSketch] = useState<SketchData>(DEFAULT_SKETCH);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [color, setColor] = useState("#3B82F6");
  const [lineWidth, setLineWidth] = useState(2);
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState("");
  const [pendingMoisture, setPendingMoisture] = useState<{ x: number; y: number } | null>(null);
  const [moistureLabel, setMoistureLabel] = useState("");
  const [moistureMaterial, setMoistureMaterial] = useState("");
  const [moistureAlert, setMoistureAlert] = useState(false);
  const [roomLabel, setRoomLabel] = useState("Living Room");
  const [roomW, setRoomW] = useState(12); // ft — used when clicking to drop a fixed-size room
  const [roomH, setRoomH] = useState(10); // ft
  const [dirty, setDirty] = useState(false);
  const [historyStack, setHistoryStack] = useState<SketchData[]>([DEFAULT_SKETCH]);
  const [histIdx, setHistIdx] = useState(0);

  // Drag state
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragShapeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const freehandPoints = useRef<{ x: number; y: number }[]>([]);
  const currentFreehandId = useRef<string | null>(null);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const isPanning = useRef(false);

  // ── Load from backend ─────────────────────────────────────────────────────
  const { data: saved } = useQuery({
    queryKey: ["/api/jobs", String(jobId), "sketch"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/sketch`).then(r => r.json()),
    retry: false,
  });

  useEffect(() => {
    if (saved?.sketchData) {
      try {
        const parsed: SketchData = JSON.parse(saved.sketchData);
        setSketch(parsed);
        setHistoryStack([parsed]);
        setHistIdx(0);
      } catch {}
    }
  }, [saved]);

  // ── Save to backend ───────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (data: SketchData) =>
      apiRequest("POST", `/api/jobs/${jobId}/sketch`, { sketchData: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "sketch"] });
      toast({ title: "Sketch saved" });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  // ── History ───────────────────────────────────────────────────────────────
  const pushHistory = useCallback((s: SketchData) => {
    setHistoryStack(prev => {
      const trimmed = prev.slice(0, histIdx + 1);
      return [...trimmed, s];
    });
    setHistIdx(prev => prev + 1);
    setDirty(true);
  }, [histIdx]);

  const undo = useCallback(() => {
    if (histIdx <= 0) return;
    const prev = historyStack[histIdx - 1];
    setSketch(prev);
    setHistIdx(h => h - 1);
    setDirty(true);
  }, [histIdx, historyStack]);

  // ── Convert canvas px → world coords ─────────────────────────────────────
  const toWorld = useCallback((ex: number, ey: number, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (ex - rect.left - offset.x) / zoom,
      y: (ey - rect.top - offset.y) / zoom,
    };
  }, [offset, zoom]);

  // ── Draw loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderCanvas(canvas, sketch, selectedId, null, offset, zoom);
  }, [sketch, selectedId, offset, zoom]);

  // ── Resize canvas ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const resize = () => {
      canvas.width = parent.clientWidth;
      canvas.height = Math.max(420, parent.clientHeight);
      renderCanvas(canvas, sketch, selectedId, null, offset, zoom);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [sketch, selectedId, offset, zoom]);

  // ── Hit test ──────────────────────────────────────────────────────────────
  const hitTest = useCallback((wx: number, wy: number): string | null => {
    const shapes = [...sketch.shapes].reverse();
    for (const s of shapes) {
      if (s.type === "room") {
        const r = s as RoomShape;
        const [x1, x2] = [Math.min(r.x, r.x + r.w), Math.max(r.x, r.x + r.w)];
        const [y1, y2] = [Math.min(r.y, r.y + r.h), Math.max(r.y, r.y + r.h)];
        if (wx >= x1 && wx <= x2 && wy >= y1 && wy <= y2) return s.id;
      } else if (s.type === "text") {
        const t = s as TextShape;
        if (Math.abs(wx - t.x) < 80 && Math.abs(wy - t.y) < 20) return s.id;
      } else if (s.type === "moisture") {
        const m = s as MoisturePin;
        const d = Math.sqrt((wx - m.x) ** 2 + (wy - m.y) ** 2);
        if (d < 14) return s.id;
      } else if (s.type === "circle") {
        const c = s as CircleShape;
        const d = Math.sqrt((wx - c.cx) ** 2 + (wy - c.cy) ** 2);
        if (Math.abs(d - c.r) < 10 || d < c.r) return s.id;
      }
    }
    return null;
  }, [sketch.shapes]);

  // ── Mouse events ──────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = toWorld(e.clientX, e.clientY, canvas);

    // Middle mouse or space+drag = pan
    if (e.button === 1) {
      isPanning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
      return;
    }

    dragging.current = true;
    dragStart.current = { x: w.x, y: w.y };

    if (tool === "select") {
      const hit = hitTest(w.x, w.y);
      setSelectedId(hit);
      if (hit) {
        const shape = sketch.shapes.find(s => s.id === hit);
        if (shape?.type === "room") {
          const r = shape as RoomShape;
          dragShapeStart.current = { x: r.x, y: r.y, w: r.w, h: r.h };
        }
      }
    } else if (tool === "text") {
      setPendingText({ x: w.x, y: w.y });
      dragging.current = false;
    } else if (tool === "moisture") {
      setPendingMoisture({ x: w.x, y: w.y });
      dragging.current = false;
    } else if (tool === "freehand") {
      const id = uid();
      currentFreehandId.current = id;
      freehandPoints.current = [w];
      const newShape: FreehandShape = { type: "freehand", id, points: [w], color, lineWidth };
      const next = { ...sketch, shapes: [...sketch.shapes, newShape] };
      setSketch(next);
    } else if (tool === "eraser") {
      const hit = hitTest(w.x, w.y);
      if (hit) {
        const next = { ...sketch, shapes: sketch.shapes.filter(s => s.id !== hit) };
        setSketch(next);
        pushHistory(next);
        setSelectedId(null);
      }
      dragging.current = false;
    }
  }, [tool, toWorld, hitTest, sketch, offset, color, lineWidth, pushHistory]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isPanning.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setOffset({ x: panStart.current.ox + dx, y: panStart.current.oy + dy });
      return;
    }

    if (!dragging.current) return;
    const w = toWorld(e.clientX, e.clientY, canvas);
    const ds = dragStart.current;

    if (tool === "room" || tool === "circle" || tool === "arrow") {
      // Preview draft on canvas directly
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderCanvas(canvas, sketch, selectedId, null, offset, zoom);
      ctx.save();
      ctx.translate(offset.x, offset.y);
      ctx.scale(zoom, zoom);
      if (tool === "room") {
        const draft: RoomShape = { type: "room", id: "draft", x: ds.x, y: ds.y, w: w.x - ds.x, h: w.y - ds.y, label: roomLabel, color, sqft: Math.round(Math.abs((w.x - ds.x) / 50 * 10) * Math.abs((w.y - ds.y) / 50 * 10)) };
        drawShape(ctx, draft, false, zoom, true);
      } else if (tool === "circle") {
        const r = Math.sqrt((w.x - ds.x) ** 2 + (w.y - ds.y) ** 2);
        const draft: CircleShape = { type: "circle", id: "draft", cx: ds.x, cy: ds.y, r, color, label: "" };
        drawShape(ctx, draft, false, zoom, true);
      } else if (tool === "arrow") {
        const draft: ArrowShape = { type: "arrow", id: "draft", x1: ds.x, y1: ds.y, x2: w.x, y2: w.y, color, label: "" };
        drawShape(ctx, draft, false, zoom, true);
      }
      ctx.restore();
    } else if (tool === "freehand" && currentFreehandId.current) {
      freehandPoints.current.push(w);
      setSketch(prev => ({
        ...prev,
        shapes: prev.shapes.map(s =>
          s.id === currentFreehandId.current
            ? { ...s, points: [...freehandPoints.current] } as FreehandShape
            : s
        ),
      }));
    } else if (tool === "select" && selectedId) {
      const shape = sketch.shapes.find(s => s.id === selectedId);
      if (shape?.type === "room") {
        const dx = w.x - ds.x;
        const dy = w.y - ds.y;
        setSketch(prev => ({
          ...prev,
          shapes: prev.shapes.map(s =>
            s.id === selectedId
              ? { ...s, x: dragShapeStart.current.x + dx, y: dragShapeStart.current.y + dy } as RoomShape
              : s
          ),
        }));
      }
    }
  }, [tool, toWorld, sketch, selectedId, offset, zoom, color, roomLabel]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isPanning.current) { isPanning.current = false; return; }
    if (!dragging.current) return;
    dragging.current = false;

    const w = toWorld(e.clientX, e.clientY, canvas);
    const ds = dragStart.current;
    const moved = Math.abs(w.x - ds.x) > 3 || Math.abs(w.y - ds.y) > 3;

    if (tool === "room" && moved) {
      const newRoom: RoomShape = {
        type: "room", id: uid(),
        x: Math.min(ds.x, w.x), y: Math.min(ds.y, w.y),
        w: Math.abs(w.x - ds.x), h: Math.abs(w.y - ds.y),
        label: roomLabel, color,
        sqft: Math.round(Math.abs((w.x - ds.x) / 50 * 10) * Math.abs((w.y - ds.y) / 50 * 10)),
      };
      const next = { ...sketch, shapes: [...sketch.shapes, newRoom] };
      setSketch(next);
      pushHistory(next);
    } else if (tool === "room" && !moved) {
      // Click (no drag) with Room tool → drop a room at the exact typed W×H (ft)
      const wPx = ftToPx(Math.max(1, roomW));
      const hPx = ftToPx(Math.max(1, roomH));
      const newRoom: RoomShape = {
        type: "room", id: uid(),
        x: ds.x, y: ds.y, w: wPx, h: hPx,
        label: roomLabel, color,
        sqft: Math.round(roomW * roomH),
      };
      const next = { ...sketch, shapes: [...sketch.shapes, newRoom] };
      setSketch(next);
      pushHistory(next);
      setSelectedId(newRoom.id);
    } else if (tool === "circle" && moved) {
      const r = Math.sqrt((w.x - ds.x) ** 2 + (w.y - ds.y) ** 2);
      const newCircle: CircleShape = { type: "circle", id: uid(), cx: ds.x, cy: ds.y, r, color, label: "" };
      const next = { ...sketch, shapes: [...sketch.shapes, newCircle] };
      setSketch(next);
      pushHistory(next);
    } else if (tool === "arrow" && moved) {
      const newArrow: ArrowShape = { type: "arrow", id: uid(), x1: ds.x, y1: ds.y, x2: w.x, y2: w.y, color, label: "" };
      const next = { ...sketch, shapes: [...sketch.shapes, newArrow] };
      setSketch(next);
      pushHistory(next);
    } else if (tool === "freehand") {
      currentFreehandId.current = null;
      pushHistory(sketch);
    } else if (tool === "select" && selectedId && moved) {
      pushHistory(sketch);
    }
  }, [tool, toWorld, sketch, selectedId, color, roomLabel, pushHistory]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(z => Math.max(0.3, Math.min(4, z * factor)));
  }, []);

  // ── Commit text ───────────────────────────────────────────────────────────
  const commitText = () => {
    if (!pendingText || !textInput.trim()) { setPendingText(null); setTextInput(""); return; }
    const newText: TextShape = { type: "text", id: uid(), x: pendingText.x, y: pendingText.y, text: textInput.trim(), color, fontSize: 14 };
    const next = { ...sketch, shapes: [...sketch.shapes, newText] };
    setSketch(next);
    pushHistory(next);
    setPendingText(null);
    setTextInput("");
  };

  // ── Commit moisture pin ───────────────────────────────────────────────────
  const commitMoisture = () => {
    if (!pendingMoisture || !moistureLabel.trim()) { setPendingMoisture(null); return; }
    const pin: MoisturePin = { type: "moisture", id: uid(), x: pendingMoisture.x, y: pendingMoisture.y, label: moistureLabel.trim(), material: moistureMaterial, alert: moistureAlert };
    const next = { ...sketch, shapes: [...sketch.shapes, pin] };
    setSketch(next);
    pushHistory(next);
    setPendingMoisture(null);
    setMoistureLabel("");
    setMoistureMaterial("");
    setMoistureAlert(false);
  };

  // ── Export PNG ────────────────────────────────────────────────────────────
  const exportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `job-${jobId}-sketch.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  // ── Clear ─────────────────────────────────────────────────────────────────
  const clearAll = () => {
    const next: SketchData = { ...sketch, shapes: [] };
    setSketch(next);
    pushHistory(next);
    setSelectedId(null);
  };

  // ── Update a room's dimensions / label from the manual editor ──────────────
  const updateRoom = (id: string, patch: Partial<{ wFt: number; hFt: number; label: string }>) => {
    setSketch(prev => {
      const next = {
        ...prev,
        shapes: prev.shapes.map(s => {
          if (s.id !== id || s.type !== "room") return s;
          const r = s as RoomShape;
          const newW = patch.wFt != null ? ftToPx(Math.max(1, patch.wFt)) : r.w;
          const newH = patch.hFt != null ? ftToPx(Math.max(1, patch.hFt)) : r.h;
          const newLabel = patch.label != null ? patch.label : r.label;
          return {
            ...r,
            w: newW,
            h: newH,
            label: newLabel,
            sqft: Math.round(pxToFt(newW) * pxToFt(newH)),
          } as RoomShape;
        }),
      };
      return next;
    });
    setDirty(true);
  };

  // Snapshot to history after the user finishes editing a field (on blur)
  const commitRoomEdit = () => { setSketch(prev => { pushHistory(prev); return prev; }); };

  const selectedShape = sketch.shapes.find(s => s.id === selectedId);

  // Total floor area across all rooms on the sketch
  const roomShapes = sketch.shapes.filter(s => s.type === "room");
  const totalSqft = roomShapes.reduce((sum, s) => sum + (s.sqft ?? Math.abs((s.w / 50 * 10) * (s.h / 50 * 10))), 0);

  const TOOLS: { id: ToolMode; icon: any; label: string; tip: string }[] = [
    { id: "select", icon: MousePointer, label: "Select", tip: "Select & move shapes" },
    { id: "room", icon: Square, label: "Room", tip: "Draw a room (drag)" },
    { id: "circle", icon: Circle, label: "Circle", tip: "Draw circle area (drag)" },
    { id: "arrow", icon: PenLine, label: "Arrow", tip: "Draw arrow (drag)" },
    { id: "freehand", icon: Pen, label: "Draw", tip: "Freehand drawing" },
    { id: "text", icon: Type, label: "Text", tip: "Add text label (click)" },
    { id: "moisture", icon: Droplets, label: "Moisture", tip: "Pin a moisture reading (click)" },
    { id: "eraser", icon: Eraser, label: "Erase", tip: "Erase shape (click)" },
  ];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ruler className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
          <span className="text-sm font-semibold">Floor Plan Sketch</span>
          {roomShapes.length > 0 && (
            <Badge variant="outline" className="text-xs font-medium" data-testid="text-sketch-total-sqft">
              {roomShapes.length} {roomShapes.length === 1 ? "room" : "rooms"} · {Math.round(totalSqft).toLocaleString()} sq ft total
            </Badge>
          )}
          {dirty && <Badge variant="outline" className="text-xs text-orange-500 border-orange-300">Unsaved</Badge>}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={undo} disabled={histIdx <= 0} title="Undo" data-testid="button-sketch-undo">
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="outline" onClick={exportPNG} title="Export PNG" data-testid="button-sketch-export">
              <Download className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="outline" onClick={clearAll} className="text-red-500" title="Clear all" data-testid="button-sketch-clear">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
              onClick={() => saveMutation.mutate(sketch)}
              disabled={saveMutation.isPending || !dirty}
              data-testid="button-sketch-save"
            >
              <Save className="w-3.5 h-3.5 mr-1" />
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>

      {/* Toolbar */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1.5 p-2 bg-muted/40 rounded-lg border">
          {/* Tool buttons */}
          <div className="flex gap-1">
            {TOOLS.map(t => (
              <button
                key={t.id}
                title={t.tip}
                data-testid={`button-sketch-tool-${t.id}`}
                onClick={() => { setTool(t.id); setSelectedId(null); }}
                className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                  tool === t.id
                    ? "bg-[hsl(var(--titan-blue))] text-white"
                    : "bg-background hover:bg-accent text-muted-foreground hover:text-foreground border"
                }`}
              >
                <t.icon className="w-3.5 h-3.5" />
                <span className="leading-none">{t.label}</span>
              </button>
            ))}
          </div>

          <div className="w-px h-8 bg-border mx-1" />

          {/* Color picker */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Color</span>
            <div className="flex gap-0.5">
              {ROOM_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-5 h-5 rounded-full border-2 transition-transform ${color === c ? "border-foreground scale-110" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent" title="Custom color" />
            </div>
          </div>

          {tool === "room" && (
            <>
              <div className="w-px h-8 bg-border mx-1" />
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Room</span>
                <Input
                  className="h-7 w-28 text-xs"
                  value={roomLabel}
                  onChange={e => setRoomLabel(e.target.value)}
                  placeholder="Room name"
                  data-testid="input-sketch-room-label"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">W</span>
                <Input
                  type="number" min={1}
                  className="h-7 w-14 text-xs"
                  value={roomW}
                  onChange={e => setRoomW(Math.max(1, Number(e.target.value) || 1))}
                  data-testid="input-sketch-room-w"
                />
                <span className="text-xs text-muted-foreground">×</span>
                <Input
                  type="number" min={1}
                  className="h-7 w-14 text-xs"
                  value={roomH}
                  onChange={e => setRoomH(Math.max(1, Number(e.target.value) || 1))}
                  data-testid="input-sketch-room-h"
                />
                <span className="text-xs text-muted-foreground">ft</span>
              </div>
            </>
          )}

          {tool === "freehand" && (
            <>
              <div className="w-px h-8 bg-border mx-1" />
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Width</span>
                <input type="range" min={1} max={10} value={lineWidth} onChange={e => setLineWidth(Number(e.target.value))} className="w-16 h-1.5" />
                <span className="text-xs w-4">{lineWidth}</span>
              </div>
            </>
          )}

          <div className="w-px h-8 bg-border mx-1" />

          {/* Zoom */}
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setZoom(z => Math.min(4, z * 1.2))}><ZoomIn className="w-3.5 h-3.5" /></Button>
            <span className="text-xs w-10 text-center">{Math.round(zoom * 100)}%</span>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setZoom(z => Math.max(0.3, z * 0.8))}><ZoomOut className="w-3.5 h-3.5" /></Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>Reset</Button>
          </div>
        </div>
      )}

      {/* Canvas area */}
      <div className="relative border rounded-lg overflow-hidden bg-white" style={{ height: 460 }}>
        <canvas
          ref={canvasRef}
          className="block w-full h-full"
          style={{ cursor: tool === "eraser" ? "crosshair" : tool === "select" ? "default" : "crosshair" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          data-testid="canvas-sketch"
        />

        {/* Hints */}
        {sketch.shapes.length === 0 && !readOnly && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-muted-foreground">
              <Ruler className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium opacity-50">Select "Room" and drag to draw — or set W×H (ft) and click to drop an exact-size room</p>
              <p className="text-xs opacity-40 mt-1">Select a room to edit its dimensions · Grid = 10 ft per square · Scroll to zoom · Middle-click drag to pan</p>
            </div>
          </div>
        )}

        {/* Selected shape info */}
        {selectedShape && !readOnly && (
          <div className="absolute bottom-3 left-3 right-3 bg-background/90 backdrop-blur-sm border rounded-lg p-2 flex items-center gap-3 text-xs shadow flex-wrap">
            <Badge variant="outline" className="capitalize">{selectedShape.type}</Badge>
            {selectedShape.type === "room" && (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Name</span>
                  <Input
                    className="h-7 w-32 text-xs"
                    value={(selectedShape as RoomShape).label}
                    onChange={e => updateRoom(selectedShape.id, { label: e.target.value })}
                    onBlur={commitRoomEdit}
                    data-testid="input-sketch-selected-room-label"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">W</span>
                  <Input
                    type="number" min={1}
                    className="h-7 w-14 text-xs"
                    value={Math.round(pxToFt((selectedShape as RoomShape).w))}
                    onChange={e => updateRoom(selectedShape.id, { wFt: Math.max(1, Number(e.target.value) || 1) })}
                    onBlur={commitRoomEdit}
                    data-testid="input-sketch-selected-room-w"
                  />
                  <span className="text-muted-foreground">×</span>
                  <Input
                    type="number" min={1}
                    className="h-7 w-14 text-xs"
                    value={Math.round(pxToFt((selectedShape as RoomShape).h))}
                    onChange={e => updateRoom(selectedShape.id, { hFt: Math.max(1, Number(e.target.value) || 1) })}
                    onBlur={commitRoomEdit}
                    data-testid="input-sketch-selected-room-h"
                  />
                  <span className="text-muted-foreground">ft</span>
                </div>
                <span className="text-muted-foreground font-medium">{(selectedShape as RoomShape).sqft} sq ft</span>
              </div>
            )}
            {selectedShape.type === "moisture" && (
              <span className={`font-mono font-semibold ${(selectedShape as MoisturePin).alert ? "text-red-600" : "text-green-600"}`}>
                {(selectedShape as MoisturePin).label} — {(selectedShape as MoisturePin).material}
              </span>
            )}
            <Button
              size="sm" variant="ghost"
              className="h-6 px-2 ml-auto text-red-500 hover:text-red-600"
              onClick={() => {
                const next = { ...sketch, shapes: sketch.shapes.filter(s => s.id !== selectedId) };
                setSketch(next);
                pushHistory(next);
                setSelectedId(null);
              }}
              data-testid="button-sketch-delete-selected"
            >
              <Trash2 className="w-3 h-3 mr-1" />Delete
            </Button>
          </div>
        )}
      </div>

      {/* Text input dialog */}
      {pendingText && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-background border rounded-xl shadow-xl p-5 w-80">
            <h3 className="font-semibold mb-3 text-sm">Add Text Label</h3>
            <Input
              autoFocus
              placeholder="Enter label text…"
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") commitText(); if (e.key === "Escape") { setPendingText(null); setTextInput(""); } }}
              data-testid="input-sketch-text"
            />
            <div className="flex gap-2 mt-3">
              <Button size="sm" className="flex-1 bg-[hsl(var(--titan-blue))] text-white" onClick={commitText}>Add</Button>
              <Button size="sm" variant="outline" onClick={() => { setPendingText(null); setTextInput(""); }}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Moisture pin dialog */}
      {pendingMoisture && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-background border rounded-xl shadow-xl p-5 w-80 space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Droplets className="w-4 h-4 text-blue-500" />Pin Moisture Reading
            </h3>
            <div>
              <Label className="text-xs">Reading (e.g. 14.2% WME)</Label>
              <Input
                autoFocus
                placeholder="14.2% WME"
                value={moistureLabel}
                onChange={e => setMoistureLabel(e.target.value)}
                className="mt-1 text-xs"
                data-testid="input-sketch-moisture-label"
              />
            </div>
            <div>
              <Label className="text-xs">Material</Label>
              <Input
                placeholder="Drywall, Subfloor, Framing…"
                value={moistureMaterial}
                onChange={e => setMoistureMaterial(e.target.value)}
                className="mt-1 text-xs"
                data-testid="input-sketch-moisture-material"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="moisture-alert"
                checked={moistureAlert}
                onChange={e => setMoistureAlert(e.target.checked)}
                data-testid="checkbox-sketch-moisture-alert"
              />
              <label htmlFor="moisture-alert" className="text-xs text-red-500 font-medium">Flag as above threshold (red pin)</label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 bg-[hsl(var(--titan-blue))] text-white" onClick={commitMoisture}>Pin It</Button>
              <Button size="sm" variant="outline" onClick={() => { setPendingMoisture(null); setMoistureLabel(""); }}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground border rounded-lg p-2.5 bg-muted/20">
        <span className="font-medium text-foreground">Legend:</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" />Green pin = within threshold</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" />Red pin = above threshold (flag)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-1 bg-blue-400 inline-block rounded" />Grid = 10 ft per square</span>
        <span>Scroll = Zoom · Middle-click drag = Pan</span>
      </div>
    </div>
  );
}
