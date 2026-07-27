/**
 * NPSSurveys.tsx — #15 Post-Job NPS Gated Review Funnel
 * Send NPS 48hrs after close; promoters → Google; detractors → private form
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Star, Send, TrendingUp, ThumbsUp, ThumbsDown, Minus, ExternalLink, Plus, Trash2 } from "lucide-react";
import type { Job, Contact } from "@shared/schema";

const GOOGLE_REVIEW = "https://g.page/r/CbTitanRestorationAugusta/review";

const CATEGORY_META: Record<string, { label: string; color: string; icon: any }> = {
  promoter: { label: "Promoter", color: "bg-green-100 text-green-700", icon: ThumbsUp },
  passive: { label: "Passive", color: "bg-yellow-100 text-yellow-700", icon: Minus },
  detractor: { label: "Detractor", color: "bg-red-100 text-red-700", icon: ThumbsDown },
};

function DeleteSurveyBtn({ id, label }: { id: number; label: string }) {
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/nps-surveys/${id}`),
    onSuccess: () => {
      toast({ title: "Survey Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/nps-surveys"] });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" data-testid={`button-delete-nps-surveys-${id}`}>
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this survey?</AlertDialogTitle>
          <AlertDialogDescription>
            {label ? `"${label}" ` : ""}This permanently removes the record and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => m.mutate()} data-testid={`button-confirm-delete-nps-surveys-${id}`}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function NPSSurveys() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ jobId: "", contactId: "", contactName: "" });
  const [scoreMap, setScoreMap] = useState<Record<number, number | null>>({});
  const [feedbackMap, setFeedbackMap] = useState<Record<number, string>>({});

  const { data: surveys = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/nps-surveys"],
    queryFn: () => apiRequest("GET", "/api/nps-surveys").then(r => r.json()),
  });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });

  const sendMutation = useMutation({
    mutationFn: (d: any) => apiRequest("POST", "/api/nps-surveys", d).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/nps-surveys"] }); setOpen(false); toast({ title: "NPS survey created" }); },
  });

  const respondMutation = useMutation({
    mutationFn: ({ id, score, feedback }: { id: number; score: number; feedback: string }) =>
      apiRequest("PATCH", `/api/nps-surveys/${id}/respond`, { score, feedback }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/nps-surveys"] }); toast({ title: "Response recorded" }); },
  });

  // NPS score calculation
  const responded = surveys.filter((s: any) => s.score !== null);
  const promoters = responded.filter((s: any) => s.score >= 9).length;
  const detractors = responded.filter((s: any) => s.score <= 6).length;
  const npsScore = responded.length ? Math.round(((promoters - detractors) / responded.length) * 100) : null;

  const getCategory = (score: number) => score >= 9 ? "promoter" : score >= 7 ? "passive" : "detractor";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Star className="w-6 h-6 text-[hsl(var(--titan-blue))]" />
          <h1 className="text-xl font-bold">NPS & Review Funnel</h1>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white">
              <Plus className="w-4 h-4 mr-2" />Send Survey
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Send NPS Survey</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Job</Label>
                <Select value={form.jobId} onValueChange={v => {
                  const job = jobs.find(j => j.id === Number(v));
                  const contact = job ? contacts.find(c => c.id === job.contactId) : undefined;
                  setForm(f => ({ ...f, jobId: v, contactId: contact ? String(contact.id) : "", contactName: contact?.name || "" }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Select completed job" /></SelectTrigger>
                  <SelectContent>{jobs.filter(j => j.status === "complete").map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber} — {j.address}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {form.contactName && <p className="text-sm text-muted-foreground">Survey will be sent to: <strong>{form.contactName}</strong></p>}
              <Button
                className="w-full bg-[hsl(var(--titan-blue))] text-white"
                disabled={sendMutation.isPending || !form.jobId}
                onClick={() => sendMutation.mutate({ jobId: Number(form.jobId), contactId: Number(form.contactId) || null, contactName: form.contactName, sentAt: new Date().toISOString(), status: "sent" })}
              >
                {sendMutation.isPending ? "Sending…" : "Create Survey"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* NPS Score */}
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className={`text-3xl font-bold ${npsScore === null ? "text-muted-foreground" : npsScore >= 50 ? "text-green-600" : npsScore >= 0 ? "text-yellow-600" : "text-[hsl(var(--titan-red))]"}`}>
              {npsScore === null ? "—" : npsScore}
            </p>
            <p className="text-xs text-muted-foreground mt-1">NPS Score</p>
          </CardContent>
        </Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{promoters}</p><p className="text-xs text-muted-foreground">Promoters (9-10)</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-yellow-600">{responded.filter((s: any) => s.score >= 7 && s.score <= 8).length}</p><p className="text-xs text-muted-foreground">Passives (7-8)</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-[hsl(var(--titan-red))]">{detractors}</p><p className="text-xs text-muted-foreground">Detractors (0-6)</p></CardContent></Card>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded" />)}</div>
      ) : surveys.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground"><Star className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No surveys sent yet.</p></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {surveys.map((survey: any) => {
            const job = jobs.find(j => j.id === survey.jobId);
            const cat = survey.score !== null ? getCategory(survey.score) : null;
            const catMeta = cat ? CATEGORY_META[cat] : null;
            const CatIcon = catMeta?.icon;
            const localScore = scoreMap[survey.id];
            const localFeedback = feedbackMap[survey.id] || "";
            return (
              <Card key={survey.id} className={`border-l-4 ${cat === "promoter" ? "border-green-500" : cat === "detractor" ? "border-[hsl(var(--titan-red))]" : cat === "passive" ? "border-yellow-400" : "border-muted"}`}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{job?.jobNumber || `Job #${survey.jobId}`}</span>
                        {survey.contactName && <span className="text-xs text-muted-foreground">{survey.contactName}</span>}
                        {catMeta && <Badge className={`text-xs ${catMeta.color} gap-1`}>{CatIcon && <CatIcon className="w-2.5 h-2.5" />}{catMeta.label}</Badge>}
                        {survey.score !== null && <span className="text-sm font-bold">{survey.score}/10</span>}
                        {survey.score === null && <Badge className="text-xs bg-gray-100 text-gray-600">Awaiting response</Badge>}
                        <DeleteSurveyBtn id={survey.id} label={survey.contactName || job?.jobNumber || `Survey #${survey.id}`} />
                      </div>
                      {survey.feedback && <p className="text-xs text-muted-foreground mt-1 italic">"{survey.feedback}"</p>}
                      {cat === "promoter" && (
                        <Button variant="link" size="sm" className="text-xs text-[hsl(var(--titan-blue))] p-0 h-auto mt-1 gap-1" onClick={() => window.open(GOOGLE_REVIEW, "_blank")}>
                          <ExternalLink className="w-3 h-3" />Send to Google Review
                        </Button>
                      )}
                    </div>
                    {survey.score === null && (
                      <div className="shrink-0 space-y-2">
                        <div className="flex gap-1 flex-wrap justify-end">
                          {[...Array(11)].map((_, n) => (
                            <button key={n} className={`w-7 h-7 rounded text-xs font-medium border transition-colors ${localScore === n ? (n >= 9 ? "bg-green-500 text-white border-green-500" : n >= 7 ? "bg-yellow-400 text-white border-yellow-400" : "bg-red-500 text-white border-red-500") : "border-border hover:bg-muted"}`}
                              onClick={() => setScoreMap(m => ({ ...m, [survey.id]: n }))}>{n}</button>
                          ))}
                        </div>
                        {localScore !== undefined && localScore !== null && (
                          <>
                            {(localScore <= 6) && <Textarea placeholder="What could we improve?" className="text-xs h-16" value={localFeedback} onChange={e => setFeedbackMap(m => ({ ...m, [survey.id]: e.target.value }))} />}
                            <Button size="sm" className="w-full h-7 text-xs bg-[hsl(var(--titan-blue))] text-white" onClick={() => respondMutation.mutate({ id: survey.id, score: localScore!, feedback: localFeedback })}>Submit Score</Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
