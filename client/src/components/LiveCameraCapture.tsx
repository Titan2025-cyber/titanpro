/**
 * LiveCameraCapture.tsx
 *
 * A true in-app viewfinder built on getUserMedia. The tech opens it once
 * and can rip through many photos without ever leaving the app.
 *
 * Flow:
 *   1. Parent opens the component (open=true).
 *   2. We request the rear camera via getUserMedia({ video: { facingMode: "environment" } }).
 *   3. Each tap of the big shutter button draws the current <video> frame
 *      into a hidden <canvas>, converts it to a File, and adds it to a
 *      client-side queue with a thumbnail preview.
 *   4. On close, we call onCapture(files) with the entire batch and stop
 *      the media stream. Parent decides what to do with the files
 *      (upload, attach to a job, run through handleFiles, etc.).
 *
 * Notes on browser behavior:
 *   - Requires HTTPS (or localhost). Railway serves HTTPS so we're fine.
 *   - Rear vs front camera: we pass facingMode as an ideal constraint,
 *     with a "flip" button to toggle. Some laptops only have one camera —
 *     the flip button is disabled in that case.
 *   - iOS Safari 14.5+ supports this fully. Older iPad/iPhone will fall
 *     back to a permission error — we surface a clear message so the
 *     user can switch to the native camera picker.
 *   - Photos are captured at the video track's native resolution (usually
 *     1280x720 or 1920x1080 depending on device). We use JPEG at 0.85
 *     quality — good balance for job documentation.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, X, RefreshCcw, ZapOff, Zap, CloudUpload, Trash2, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

// ── Aspect-ratio modes ──────────────────────────────────────────────────────
// Native phone rear cameras usually deliver a 4:3 sensor frame. We keep that
// as the default (best vertical field of view — good for a wall, ceiling, or
// a close-up damage shot) and offer 16:9 (widest horizontal FOV for a whole
// room from across it) and 1:1 (square, for before/after comparability and
// consistent thumbnails). 16:9 and 1:1 are cropped from the sensor frame at
// capture time — the viewfinder shows exactly what will be saved.
type AspectMode = "4:3" | "16:9" | "1:1";
const ASPECT_RATIOS: Record<AspectMode, number> = {
  "4:3": 4 / 3,
  "16:9": 16 / 9,
  "1:1": 1,
};
const ASPECT_HINTS: Record<AspectMode, string> = {
  "4:3": "Close-up · full sensor",
  "16:9": "Wide · whole room",
  "1:1": "Square · documentation",
};

export interface LiveCameraCaptureProps {
  open: boolean;
  onClose: () => void;
  /** Called with all captured files when the user taps "Save all". */
  onCapture: (files: File[]) => void;
  /** Optional label shown in the header — e.g. job number, category. */
  contextLabel?: string;
  /** Optional filename prefix — defaults to "photo". */
  filenamePrefix?: string;
}

interface QueuedPhoto {
  file: File;
  previewUrl: string;
  ts: number;
}

export function LiveCameraCapture({
  open,
  onClose,
  onCapture,
  contextLabel,
  filenamePrefix = "photo",
}: LiveCameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { toast } = useToast();

  const [queue, setQueue] = useState<QueuedPhoto[]>([]);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [aspect, setAspect] = useState<AspectMode>("4:3");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [ready, setReady] = useState(false);
  const [flashPulse, setFlashPulse] = useState(false);

  // ── Stream lifecycle ────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function start() {
      setStarting(true);
      setError(null);
      setReady(false);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Your browser does not support live camera capture. Use the standard Take Photo button instead.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const caps: any = track?.getCapabilities?.() || {};
        setTorchSupported(!!caps.torch);
        setTorchOn(false);

        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.playsInline = true;
          v.muted = true;
          await v.play().catch(() => {/* user gesture required on some browsers */});
        }
        setReady(true);
      } catch (e: any) {
        console.error("[LiveCameraCapture] start failed", e);
        const msg = e?.name === "NotAllowedError"
          ? "Camera permission denied. Enable camera access for this site in your browser settings."
          : e?.name === "NotFoundError"
          ? "No camera found on this device."
          : e?.message || "Could not start camera.";
        setError(msg);
      } finally {
        setStarting(false);
      }
    }
    start();

    return () => {
      cancelled = true;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facing]);

  // Revoke object URLs on unmount so previews don't leak memory.
  useEffect(() => {
    return () => {
      queue.forEach(q => URL.revokeObjectURL(q.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopStream() {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    const v = videoRef.current;
    if (v) v.srcObject = null;
    setReady(false);
    setTorchOn(false);
  }

  // ── Torch (flash) toggle ────────────────────────────────────────────
  async function toggleTorch() {
    const s = streamRef.current;
    const track = s?.getVideoTracks()[0];
    if (!track) return;
    try {
      // Torch is a non-standard constraint — cast to any so TS is happy.
      await (track.applyConstraints as any)({ advanced: [{ torch: !torchOn }] });
      setTorchOn(v => !v);
    } catch (e) {
      console.warn("[LiveCameraCapture] torch toggle failed", e);
      toast({ title: "Flash unavailable on this camera", variant: "destructive" });
    }
  }

  // ── Snapshot ────────────────────────────────────────────────────────
  // We center-crop the sensor frame to the selected aspect ratio so what the
  // tech sees under the mask overlay is what actually gets saved.
  function snap() {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !ready) return;
    const sw = v.videoWidth;
    const sh = v.videoHeight;
    if (!sw || !sh) return;

    const target = ASPECT_RATIOS[aspect];
    const sensor = sw / sh;
    // Compute the largest centered rectangle inside the sensor that matches
    // `target`. If the sensor is wider than target → shrink width. If taller
    // → shrink height.
    let cropW = sw;
    let cropH = sh;
    if (sensor > target) {
      cropW = Math.round(sh * target);
    } else if (sensor < target) {
      cropH = Math.round(sw / target);
    }
    const cropX = Math.round((sw - cropW) / 2);
    const cropY = Math.round((sh - cropH) / 2);

    c.width = cropW;
    c.height = cropH;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    c.toBlob(
      blob => {
        if (!blob) return;
        const stamp = new Date();
        const iso = stamp.toISOString().replace(/[:.]/g, "-");
        const file = new File([blob], `${filenamePrefix}-${iso}.jpg`, {
          type: "image/jpeg",
          lastModified: stamp.getTime(),
        });
        const previewUrl = URL.createObjectURL(blob);
        setQueue(prev => [...prev, { file, previewUrl, ts: stamp.getTime() }]);
        // Brief screen flash so the tech knows the tap registered.
        setFlashPulse(true);
        window.setTimeout(() => setFlashPulse(false), 120);
      },
      "image/jpeg",
      0.85,
    );
  }

  function removeAt(idx: number) {
    setQueue(prev => {
      const t = prev[idx];
      if (t) URL.revokeObjectURL(t.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }

  function clearAll() {
    queue.forEach(q => URL.revokeObjectURL(q.previewUrl));
    setQueue([]);
  }

  function handleClose() {
    // Warn if we'd throw away captures.
    if (queue.length > 0) {
      const ok = window.confirm(`Discard ${queue.length} photo${queue.length === 1 ? "" : "s"}?`);
      if (!ok) return;
    }
    clearAll();
    stopStream();
    onClose();
  }

  function handleSaveAll() {
    if (queue.length === 0) return;
    const files = queue.map(q => q.file);
    // Detach so the parent owns the previews' lifetime via its own URLs.
    setQueue([]);
    stopStream();
    onCapture(files);
    onClose();
  }

  const countLabel = useMemo(
    () => `${queue.length} photo${queue.length === 1 ? "" : "s"} staged`,
    [queue.length],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col" role="dialog" aria-label="Live camera capture">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 bg-black/70 text-white">
        <button
          onClick={handleClose}
          className="p-2 rounded-full hover:bg-white/10"
          aria-label="Close"
          data-testid="button-live-close"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="text-center">
          <div className="text-xs font-semibold flex items-center gap-1.5 justify-center">
            <Camera className="w-3.5 h-3.5" />Live capture
          </div>
          <div className="text-[10px] text-white/70">
            {countLabel}
            {contextLabel ? <> · {contextLabel}</> : null}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {torchSupported && (
            <button
              onClick={toggleTorch}
              className={`p-2 rounded-full hover:bg-white/10 ${torchOn ? "text-yellow-300" : ""}`}
              aria-label={torchOn ? "Turn flash off" : "Turn flash on"}
              data-testid="button-live-torch"
            >
              {torchOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
            </button>
          )}
          <button
            onClick={() => setFacing(f => (f === "environment" ? "user" : "environment"))}
            className="p-2 rounded-full hover:bg-white/10"
            aria-label="Flip camera"
            data-testid="button-live-flip"
          >
            <RefreshCcw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── Aspect ratio selector ──────────────────────────────────── */}
      <div className="bg-black/70 border-t border-white/5 px-3 py-1.5 flex items-center justify-center gap-1.5 text-[11px]">
        <Maximize2 className="w-3.5 h-3.5 text-white/50" />
        {(Object.keys(ASPECT_RATIOS) as AspectMode[]).map(mode => (
          <button
            key={mode}
            onClick={() => setAspect(mode)}
            className={`px-2.5 py-1 rounded font-semibold tabular-nums transition-colors ${
              aspect === mode
                ? "bg-white text-black"
                : "text-white/70 hover:text-white hover:bg-white/10"
            }`}
            aria-label={`Aspect ratio ${mode}`}
            aria-pressed={aspect === mode}
            data-testid={`button-aspect-${mode.replace(":", "x")}`}
          >
            {mode}
          </button>
        ))}
        <span className="text-white/40 ml-2 hidden sm:inline">{ASPECT_HINTS[aspect]}</span>
      </div>

      {/* ── Viewfinder ──────────────────────────────────────────── */}
      <div className="relative flex-1 bg-black overflow-hidden">
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          playsInline
          muted
          autoPlay
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Crop mask overlay — shows the tech exactly what will be captured
            for the selected aspect ratio. Areas outside the crop go dim so
            it feels like a real camera app viewfinder. */}
        <AspectMask aspect={aspect} videoEl={videoRef.current} ready={ready} />

        {/* Shutter flash overlay */}
        {flashPulse && <div className="absolute inset-0 bg-white/80 pointer-events-none" />}

        {/* Loading / error overlays */}
        {(starting || !ready) && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">
            <div className="text-center">
              <Camera className="w-10 h-10 mx-auto mb-2 opacity-60 animate-pulse" />
              <p>Starting camera…</p>
              <p className="text-[11px] text-white/60 mt-1">Grant camera permission if your browser asks.</p>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <div className="max-w-xs bg-red-900/40 border border-red-600/50 text-red-100 rounded-lg p-4">
              <p className="text-sm font-semibold mb-1">Camera unavailable</p>
              <p className="text-xs leading-snug">{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 border-red-300 text-red-100 hover:bg-red-800"
                onClick={handleClose}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Thumbnail strip ────────────────────────────────────────── */}
      {queue.length > 0 && (
        <div className="bg-black/80 px-2 py-2 overflow-x-auto flex gap-2 border-t border-white/10">
          {queue.map((q, idx) => (
            <div key={q.ts} className="relative flex-shrink-0 w-16 h-16 rounded overflow-hidden border border-white/20">
              <img src={q.previewUrl} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => removeAt(idx)}
                className="absolute top-0.5 right-0.5 bg-black/70 text-white rounded-full p-0.5 hover:bg-red-600"
                aria-label={`Remove photo ${idx + 1}`}
              >
                <X className="w-3 h-3" />
              </button>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-1 text-[9px] text-white text-center">
                #{idx + 1}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Bottom control bar ─────────────────────────────────────── */}
      <div className="bg-black/85 px-4 py-4 flex items-center justify-between gap-4 border-t border-white/10">
        <button
          onClick={clearAll}
          disabled={queue.length === 0}
          className="text-white/80 hover:text-white text-xs flex flex-col items-center gap-0.5 disabled:opacity-30 min-w-[56px]"
          aria-label="Clear all"
        >
          <Trash2 className="w-5 h-5" />
          <span>Clear</span>
        </button>

        {/* Shutter — the star of the show */}
        <button
          onClick={snap}
          disabled={!ready || !!error}
          className="w-20 h-20 rounded-full border-4 border-white bg-white/10 active:bg-white/40 disabled:opacity-40 flex items-center justify-center relative transition-colors"
          aria-label="Take photo"
          data-testid="button-live-shutter"
        >
          <span className="w-16 h-16 rounded-full bg-white" />
        </button>

        <button
          onClick={handleSaveAll}
          disabled={queue.length === 0}
          className="text-emerald-300 hover:text-emerald-200 text-xs flex flex-col items-center gap-0.5 disabled:opacity-30 min-w-[56px]"
          aria-label={`Save ${queue.length} photos`}
          data-testid="button-live-save-all"
        >
          <CloudUpload className="w-5 h-5" />
          <span>Save {queue.length > 0 ? `(${queue.length})` : ""}</span>
        </button>
      </div>
    </div>
  );
}

// ── AspectMask ──────────────────────────────────────────────────────────────
// Draws two darkened bars over the video so the tech sees exactly which
// portion of the sensor frame will end up in the saved photo. The video uses
// object-contain, so we compute the rendered frame inside the container and
// then compute the crop rectangle inside that frame.
function AspectMask({
  aspect,
  videoEl,
  ready,
}: {
  aspect: AspectMode;
  videoEl: HTMLVideoElement | null;
  ready: boolean;
}) {
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (!ready || !videoEl) { setBox(null); return; }
    const target = ASPECT_RATIOS[aspect];

    function recompute() {
      const v = videoEl;
      if (!v) return;
      const cw = v.clientWidth;
      const ch = v.clientHeight;
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      if (!cw || !ch || !vw || !vh) return;

      // Where object-contain places the actual video frame inside the box.
      const sensor = vw / vh;
      const containerRatio = cw / ch;
      let frameW: number;
      let frameH: number;
      if (sensor > containerRatio) {
        frameW = cw;
        frameH = cw / sensor;
      } else {
        frameH = ch;
        frameW = ch * sensor;
      }
      const frameLeft = (cw - frameW) / 2;
      const frameTop = (ch - frameH) / 2;

      // Center-crop that rendered frame to the target aspect.
      let cropW = frameW;
      let cropH = frameH;
      if (sensor > target) {
        cropW = frameH * target;
      } else if (sensor < target) {
        cropH = frameW / target;
      }
      const cropLeft = frameLeft + (frameW - cropW) / 2;
      const cropTop = frameTop + (frameH - cropH) / 2;

      setBox({ top: cropTop, left: cropLeft, width: cropW, height: cropH });
    }

    recompute();
    // Recompute on resize + when the video actually starts playing.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(recompute) : null;
    if (ro && videoEl) ro.observe(videoEl);
    videoEl.addEventListener("loadedmetadata", recompute);
    videoEl.addEventListener("playing", recompute);
    window.addEventListener("orientationchange", recompute);
    return () => {
      if (ro) ro.disconnect();
      videoEl.removeEventListener("loadedmetadata", recompute);
      videoEl.removeEventListener("playing", recompute);
      window.removeEventListener("orientationchange", recompute);
    };
  }, [aspect, ready, videoEl]);

  if (!box) return null;

  // Four bars around the crop rect. Each is absolutely positioned inside the
  // viewfinder container.
  const barStyle = { background: "rgba(0,0,0,0.55)" } as const;
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {/* top */}
      <div style={{ ...barStyle, position: "absolute", top: 0, left: 0, right: 0, height: box.top }} />
      {/* bottom */}
      <div style={{ ...barStyle, position: "absolute", left: 0, right: 0, bottom: 0, top: box.top + box.height }} />
      {/* left */}
      <div style={{ ...barStyle, position: "absolute", top: box.top, left: 0, width: box.left, height: box.height }} />
      {/* right */}
      <div style={{ ...barStyle, position: "absolute", top: box.top, left: box.left + box.width, right: 0, height: box.height }} />
      {/* crop outline */}
      <div
        style={{
          position: "absolute",
          top: box.top,
          left: box.left,
          width: box.width,
          height: box.height,
          border: "1px solid rgba(255,255,255,0.35)",
        }}
      />
    </div>
  );
}

export default LiveCameraCapture;
