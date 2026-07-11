/**
 * JobPhotos.tsx — Per-job photo module
 * Embedded directly in JobDetail tabs and Technician view.
 * Supports camera capture, file upload, categorized viewing, and deletion.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Camera, Upload, Trash2, FolderOpen, X, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Photo } from "@shared/schema";

const CATEGORIES = ["general", "before", "during", "after", "damage", "moisture", "equipment"];

const CATEGORY_COLORS: Record<string, string> = {
  general: "bg-gray-100 text-gray-700",
  before: "bg-blue-100 text-blue-700",
  during: "bg-yellow-100 text-yellow-700",
  after: "bg-green-100 text-green-700",
  damage: "bg-red-100 text-red-700",
  moisture: "bg-cyan-100 text-cyan-700",
  equipment: "bg-purple-100 text-purple-700",
};

interface Props {
  jobId: number;
  readOnly?: boolean;
  /** When set to 'mitigation' or 'reconstruction', only photos for that phase
   * are shown and new uploads are tagged with it. 'both'/undefined = show all. */
  phase?: string;
}

export default function JobPhotos({ jobId, readOnly = false, phase }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState("general");
  const [uploading, setUploading] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");
  const [lightbox, setLightbox] = useState<Photo | null>(null);

  const { data: photos = [], isLoading } = useQuery<Photo[]>({
    queryKey: ["/api/jobs", String(jobId), "photos"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/photos`).then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/photos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "photos"] });
      setLightbox(null);
    },
  });

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      await new Promise<void>(resolve => {
        reader.onload = async () => {
          try {
            await apiRequest("POST", "/api/photos", {
              jobId,
              filename: file.name,
              dataUrl: reader.result as string,
              caption: caption || file.name,
              category,
              phase: phase && phase !== "both" ? phase : "mitigation",
            });
            queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "photos"] });
          } catch (e) {
            toast({ title: "Upload failed", variant: "destructive" });
          }
          resolve();
        };
        reader.readAsDataURL(file);
      });
    }
    setUploading(false);
    setCaption("");
    toast({ title: `${files.length} photo(s) uploaded` });
  };

  // Phase scope: 'both'/undefined shows everything; otherwise only photos
  // tagged with the active phase (null phase treated as 'mitigation').
  const phaseScoped = !phase || phase === "both"
    ? photos
    : photos.filter(p => ((p as any).phase || "mitigation") === phase);

  const categoryCounts = CATEGORIES.reduce<Record<string, number>>((acc, c) => {
    acc[c] = phaseScoped.filter(p => p.category === c).length;
    return acc;
  }, {});

  const filtered = activeFilter === "all" ? phaseScoped : phaseScoped.filter(p => p.category === activeFilter);

  return (
    <div className="space-y-4">
      {/* Upload bar */}
      {!readOnly && (
        <div className="border rounded-lg p-3 bg-muted/20 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Caption (optional)</Label>
              <Input
                className="h-8 text-xs mt-1"
                value={caption}
                onChange={e => setCaption(e.target.value)}
                placeholder="Photo description…"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => handleFiles(e.target.files)} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={e => handleFiles(e.target.files)} />
            <Button
              size="sm"
              variant="outline"
              className="flex-1 border-[hsl(var(--titan-blue))] text-[hsl(var(--titan-blue))]"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              data-testid="button-upload-photos"
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />{uploading ? "Uploading…" : "Choose Files"}
            </Button>
            <Button
              size="sm"
              className="flex-1 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
              disabled={uploading}
              onClick={() => cameraRef.current?.click()}
              data-testid="button-take-photo"
            >
              <Camera className="w-3.5 h-3.5 mr-1.5" />Take Photo
            </Button>
          </div>
        </div>
      )}

      {/* Category filter pills */}
      {phaseScoped.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveFilter("all")}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${activeFilter === "all" ? "bg-[hsl(var(--titan-blue))] text-white border-transparent" : "border-border hover:bg-muted"}`}
          >
            All ({phaseScoped.length})
          </button>
          {CATEGORIES.filter(c => categoryCounts[c] > 0).map(c => (
            <button
              key={c}
              onClick={() => setActiveFilter(c)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${activeFilter === c ? "bg-[hsl(var(--titan-blue))] text-white border-transparent" : "border-border hover:bg-muted"}`}
            >
              {c.charAt(0).toUpperCase() + c.slice(1)} ({categoryCounts[c]})
            </button>
          ))}
        </div>
      )}

      {/* Photo grid */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="aspect-square bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <FolderOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">{activeFilter === "all" ? "No photos yet — upload the first one above." : `No ${activeFilter} photos yet.`}</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {filtered.map(photo => (
            <div
              key={photo.id}
              className="relative group rounded-lg overflow-hidden border bg-muted aspect-square cursor-pointer"
              data-testid={`photo-${photo.id}`}
              onClick={() => setLightbox(photo)}
            >
              <img
                src={photo.dataUrl}
                alt={photo.caption || photo.filename}
                className="w-full h-full object-cover transition-transform group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <ZoomIn className="w-6 h-6 text-white" />
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLORS[photo.category ?? ""] || "bg-gray-100 text-gray-700"}`}>
                  {photo.category}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <button
              className="absolute -top-10 right-0 text-white hover:text-gray-300 transition-colors"
              onClick={() => setLightbox(null)}
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={lightbox.dataUrl}
              alt={lightbox.caption || lightbox.filename}
              className="w-full rounded-lg max-h-[75vh] object-contain"
            />
            <div className="mt-3 flex items-center justify-between">
              <div>
                <p className="text-white font-medium text-sm">{lightbox.caption || lightbox.filename}</p>
                <div className="flex gap-2 mt-1">
                  <Badge className={CATEGORY_COLORS[lightbox.category ?? ""]}>{lightbox.category}</Badge>
                  {lightbox.takenAt && (
                    <span className="text-gray-400 text-xs">{new Date(lightbox.takenAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
              {!readOnly && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => { if (confirm("Delete this photo?")) deleteMutation.mutate(lightbox.id); }}
                  data-testid={`button-delete-photo-${lightbox.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />Delete
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
