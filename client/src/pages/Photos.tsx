import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { Camera, Upload, Trash2, FolderOpen, Tag, Check } from "lucide-react";
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
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

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

  const handleFiles = async (files: FileList | null) => {
    if (!files || !selectedJobId) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      await new Promise<void>(resolve => {
        reader.onload = async () => {
          await uploadMutation.mutateAsync({
            jobId: Number(selectedJobId),
            filename: file.name,
            dataUrl: reader.result as string,
            caption: caption || file.name,
            category,
          });
          resolve();
        };
        reader.readAsDataURL(file);
      });
    }
    setUploading(false);
    setCaption("");
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
          {!selectedJobId && <p className="text-xs text-muted-foreground">Select a job file above to enable photo upload.</p>}
        </CardContent>
      </Card>

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
