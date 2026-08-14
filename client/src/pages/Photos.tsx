import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { Camera, Upload, Trash2, FolderOpen, Tag, Check, X, CloudUpload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Photo, Job } from "@shared/schema";

const CATEGORIES = [
  "general", "before", "during", "after",
  "damage", "moisture", "equipment",
  "thermal-imaging", "containment", "demo", "reconstruction",
  "safety", "final-walkthrough",
];

export default function Photos() {
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState("general");
  const [relabelingId, setRelabelingId] = useState<number | null>(null);
  const [relabelCat, setRelabelCat] = useState<string>("");
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // ── Capture Session ─────────────────────────────────────────────────────
  // Shoot many photos back-to-back, batch-save at the end.
  const [captureSessionOpen, setCaptureSessionOpen] = useState(false);
  const [sessionQueue, setSessionQueue] = useState<{ file: File; previewUrl: string }[]>([]);
  const sessionCameraRef = useRef<HTMLInputElement>(null);
  const sessionPickerRef = useRef<HTMLInputElement>(null);

  // Revoke object URLs on unmount so previews don't leak memory.
  useEffect(() => {
    return () => {
      sessionQueue.forEach(item => URL.revokeObjectURL(item.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addToSession = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files as any) as File[];
    if (list.length === 0) return;
    const additions = list.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setSessionQueue(prev => [...prev, ...additions]);
  };

  const removeFromSession = (idx: number) => {
    setSessionQueue(prev => {
      const target = prev[idx];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const clearSession = () => {
    sessionQueue.forEach(item => URL.revokeObjectURL(item.previewUrl));
    setSessionQueue([]);
  };

  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: allPhotos = [] } = useQuery<Photo[]>({ queryKey: ["/api/photos"] });

  const uploadMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/photos", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/photos"] }),
  });

  const relabelMutation = useMutation({
    mutationFn: ({ id, category }: { id: number; category: string }) =>
      apiRequest("PATCH", `/api/photos/${id}`, { category }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/photos"] });
      setRelabelingId(null);
      setRelabelCat("");
      toast({ title: "Photo label updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/photos/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/photos"] }),
  });

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files || !selectedJobId) return;
    const list = Array.from(files as any) as File[];
    if (list.length === 0) return;
    setUploading(true);
    setUploadProgress({ done: 0, total: list.length });
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      try {
        const reader = new FileReader();
        await new Promise<void>((resolve, reject) => {
          reader.onload = async () => {
            try {
              await uploadMutation.mutateAsync({
                jobId: Number(selectedJobId),
                filename: file.name,
                dataUrl: reader.result as string,
                caption: caption || file.name,
                category,
              });
              ok++;
              resolve();
            } catch (err) {
              reject(err);
            }
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
      } catch {
        failed++;
      }
      setUploadProgress({ done: i + 1, total: list.length });
    }
    setUploading(false);
    setUploadProgress(null);
    setCaption("");
    if (list.length > 1 || failed > 0) {
      toast({
        title: failed === 0
          ? `Uploaded ${ok} photo${ok === 1 ? "" : "s"}`
          : `Uploaded ${ok}, ${failed} failed`,
        variant: failed === 0 ? undefined : "destructive",
      });
    }
  };

  // Group photos by job
  const photosByJob: Record<number, Photo[]> = {};
  allPhotos.forEach(p => {
    if (!photosByJob[p.jobId]) photosByJob[p.jobId] = [];
    photosByJob[p.jobId].push(p);
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Photos</h1>

      {/* Upload section */}
      <Card className="border-[hsl(var(--titan-blue)/0.3)]">
        <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Camera className="w-4 h-4 text-[hsl(var(--titan-blue))]" />Upload Photos to Job File</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div>
            <Label>Job File</Label>
            <Select value={selectedJobId} onValueChange={setSelectedJobId}>
              <SelectTrigger><SelectValue placeholder="Select a job to attach photos" /></SelectTrigger>
              <SelectContent>
                {jobs.map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber} — {j.address || j.lossType}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Caption (optional)</Label>
              <Input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Photo description" />
            </div>
          </div>

          <div className="flex gap-3">
            {/* Hidden file inputs */}
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleFiles(e.target.files)} />

            <Button
              variant="outline"
              className="flex-1 border-[hsl(var(--titan-blue))] text-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue)/0.1)]"
              disabled={!selectedJobId || uploading}
              onClick={() => fileRef.current?.click()}
              data-testid="button-choose-photos"
            >
              <Upload className="w-4 h-4 mr-2" />{uploading ? "Uploading…" : "Choose Photos"}
            </Button>
            <Button
              className="flex-1 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
              disabled={!selectedJobId || uploading}
              onClick={() => cameraRef.current?.click()}
              data-testid="button-take-photo"
            >
              <Camera className="w-4 h-4 mr-2" />Take Photo
            </Button>
          </div>

          {/* Capture Session — shoot many, upload once as a batch */}
          <Button
            size="sm"
            variant="outline"
            className="w-full border-teal-600 text-teal-700 hover:bg-teal-50 dark:hover:bg-teal-950/30"
            disabled={!selectedJobId || uploading}
            onClick={() => setCaptureSessionOpen(true)}
            data-testid="button-capture-session"
          >
            <Camera className="w-4 h-4 mr-2" />Start Capture Session
            <span className="ml-2 text-[10px] text-teal-600/70">shoot many → save once</span>
          </Button>

          {uploadProgress && (
            <div className="text-xs text-muted-foreground">
              Uploading {uploadProgress.done} of {uploadProgress.total}…
              <div className="mt-1 h-1.5 rounded bg-muted overflow-hidden">
                <div
                  className="h-full bg-[hsl(var(--titan-blue))] transition-all"
                  style={{ width: `${(uploadProgress.done / Math.max(uploadProgress.total, 1)) * 100}%` }}
                />
              </div>
            </div>
          )}

          {!selectedJobId && <p className="text-xs text-muted-foreground">Select a job file above to enable photo upload.</p>}
        </CardContent>
      </Card>

      {/* ── Capture Session tray ── */}
      {captureSessionOpen && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-lg w-full max-w-2xl max-h-[95vh] flex flex-col shadow-2xl">
            <input ref={sessionCameraRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={e => { addToSession(e.target.files); if (e.target) e.target.value = ""; }} />
            <input ref={sessionPickerRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => { addToSession(e.target.files); if (e.target) e.target.value = ""; }} />

            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <div className="font-semibold text-[hsl(var(--titan-blue))] flex items-center gap-2">
                  <Camera className="w-4 h-4" /> Capture Session
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {sessionQueue.length} photo{sessionQueue.length === 1 ? "" : "s"} staged
                  {category ? <> · category <span className="font-medium text-foreground">{category}</span></> : null}
                </div>
              </div>
              <button
                className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => setCaptureSessionOpen(false)}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {sessionQueue.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center p-8">
                  <div>
                    <Camera className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-200">No photos yet</div>
                    <div className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                      Shoot photos one after another. Nothing uploads until you tap Save all.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {sessionQueue.map((item, idx) => (
                    <div key={idx} className="relative aspect-square rounded overflow-hidden bg-slate-100 border">
                      <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
                      <button
                        onClick={() => removeFromSession(idx)}
                        className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 hover:bg-red-600"
                        aria-label="Remove"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-0.5">
                        <span className="text-[10px] text-white font-medium">#{idx + 1}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
                  onClick={() => sessionCameraRef.current?.click()}
                  data-testid="button-session-shoot"
                >
                  <Camera className="w-3.5 h-3.5 mr-1.5" />
                  {sessionQueue.length === 0 ? "Take first photo" : "Take another"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => sessionPickerRef.current?.click()}
                  data-testid="button-session-pick"
                >
                  <Upload className="w-3.5 h-3.5 mr-1.5" />Pick from library
                </Button>
              </div>
              <div className="flex gap-2">
                {sessionQueue.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-slate-500"
                    onClick={clearSession}
                    data-testid="button-session-clear"
                  >
                    Clear all
                  </Button>
                )}
                <Button
                  size="sm"
                  className="ml-auto bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={sessionQueue.length === 0 || !selectedJobId}
                  onClick={() => {
                    // Snapshot the queue, close the tray, and kick off the
                    // batch upload. handleFiles walks the array sequentially
                    // and updates the progress bar on the page.
                    const files = sessionQueue.map(s => s.file);
                    const count = files.length;
                    clearSession();
                    setCaptureSessionOpen(false);
                    toast({ title: `Uploading ${count} photo${count === 1 ? "" : "s"}…` });
                    void handleFiles(files);
                  }}
                  data-testid="button-session-save-all"
                >
                  <CloudUpload className="w-3.5 h-3.5 mr-1.5" />
                  Save all ({sessionQueue.length})
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground text-center leading-snug">
                Photos are stored on this device until you tap Save all. If you close the app before saving, the queue is lost.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Photos grouped by job */}
      {Object.keys(photosByJob).length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <FolderOpen className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p>No photos yet. Select a job and upload photos above.</p>
        </div>
      )}

      {Object.entries(photosByJob).map(([jobId, photos]) => {
        const job = jobs.find(j => j.id === Number(jobId));
        return (
          <Card key={jobId}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
                {job?.jobNumber || `Job #${jobId}`} — {job?.address || job?.lossType}
                <span className="text-xs text-muted-foreground font-normal ml-auto">{photos.length} photo(s)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {photos.map(photo => (
                  <div key={photo.id} className="relative group rounded-lg overflow-hidden border bg-muted" data-testid={`photo-${photo.id}`}>
                    <div className="aspect-square">
                      <img
                        src={photo.dataUrl}
                        alt={photo.caption || photo.filename}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 p-2">
                      <p className="text-white text-xs text-center leading-snug">{photo.caption || photo.filename}</p>
                      <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">{photo.category}</span>
                      <div className="flex gap-1 mt-1">
                        <button
                          onClick={() => { setRelabelingId(photo.id); setRelabelCat(photo.category || "general"); }}
                          className="text-yellow-300 hover:text-yellow-200"
                          title="Relabel"
                        ><Tag className="w-4 h-4" /></button>
                        <button
                          onClick={() => deleteMutation.mutate(photo.id)}
                          className="text-red-400 hover:text-red-300"
                          title="Delete"
                        ><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-xs px-2 py-1">
                      {relabelingId === photo.id ? (
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <select
                            value={relabelCat}
                            onChange={e => setRelabelCat(e.target.value)}
                            className="flex-1 text-xs bg-black/50 text-white border border-white/30 rounded px-1 py-0.5"
                          >
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <button
                            onClick={() => relabelMutation.mutate({ id: photo.id, category: relabelCat })}
                            className="text-green-300 hover:text-green-200"
                          ><Check className="w-3 h-3" /></button>
                        </div>
                      ) : (
                        <span className="truncate block">{photo.category}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
