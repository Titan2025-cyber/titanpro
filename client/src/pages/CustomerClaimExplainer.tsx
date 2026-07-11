import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, CheckCircle2, Clock, HelpCircle, Send, ChevronRight } from "lucide-react";

const STAGE_EXPLAINERS: Record<string, { title: string; plain: string; nextSteps: string[]; doNot: string[] }> = {
  new: { title: "We've received your claim", plain: "Your job has been created and a crew coordinator is reviewing the details. We'll call you within 2 hours to schedule your first visit.", nextSteps: ["Answer our call to confirm the inspection time", "Clear a path to the affected area if possible", "Keep a list of damaged items you notice"], doNot: ["Don't throw away damaged materials — they're part of your claim", "Don't sign anything with your insurance company until we've documented the damage"] },
  mitigation: { title: "Crews are on-site mitigating", plain: "Our technicians are actively removing water, drying materials, and preventing further damage. This is the most critical phase — acting fast protects your home and your claim.", nextSteps: ["Allow crew access during scheduled hours", "Contact us if you smell anything unusual", "Review and sign the work authorization if you haven't yet"], doNot: ["Don't turn off equipment between visits", "Don't let anyone remove equipment without our approval"] },
  drying: { title: "Your home is being dried", plain: "Equipment is running to bring moisture levels back to normal. This typically takes 3–5 days. We check readings daily and will remove equipment once targets are met.", nextSteps: ["Allow daily tech check-ins (usually 15 min)", "Note your daily reading update texts", "Contact us with any concerns — we check readings every 24 hours"], doNot: ["Don't turn off dehumidifiers or air movers", "Don't close doors to affected rooms"] },
  reconstruction: { title: "Reconstruction is underway", plain: "The affected areas are now dry and your adjuster has approved the repair scope. Our crews are rebuilding — this phase varies by scope but we'll keep you updated at each milestone.", nextSteps: ["Confirm your material selections if any were offered", "Review the reconstruction scope document", "Note the estimated completion date from your coordinator"], doNot: ["Don't make independent repairs to affected areas", "Don't pay any supplement requests directly to subcontractors"] },
  complete: { title: "Your job is complete", plain: "All work has been completed. Your Certificate of Completion is available in your portal. Please review your invoice and contact us with any questions before paying your deductible.", nextSteps: ["Review and sign the Certificate of Completion", "Inspect the completed work with your coordinator", "Contact us if anything is not to your satisfaction"], doNot: ["Don't close the insurance claim until all approved work is paid", "Don't discard any communications from your carrier about this loss"] },
};

export default function CustomerClaimExplainer() {
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("GET", "/api/jobs").then(r => r.json()) });
  const [selectedJob, setSelectedJob] = useState("");

  const job = (jobs as any[]).find(j => String(j.id) === selectedJob);
  const explainer = job ? STAGE_EXPLAINERS[job.status] || STAGE_EXPLAINERS["new"] : null;

  const stages = ["new","mitigation","drying","reconstruction","complete"];
  const currentStageIdx = job ? stages.indexOf(job.status) : -1;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-blue))] flex items-center justify-center">
          <BookOpen className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Customer Claim Explainer</h1>
          <p className="text-sm text-muted-foreground">Plain-English stage guides — send to customers at every milestone</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Select Job</CardTitle></CardHeader>
        <CardContent>
          <Select value={selectedJob} onValueChange={setSelectedJob}>
            <SelectTrigger><SelectValue placeholder="Choose a job…" /></SelectTrigger>
            <SelectContent>
              {(jobs as any[]).map((j: any) => (
                <SelectItem key={j.id} value={String(j.id)}>TP-{String(j.id).padStart(4,"0")} — {j.address} ({j.status})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {job && explainer && (
        <>
          {/* Progress timeline */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between overflow-x-auto gap-1 pb-1">
                {stages.map((s, i) => (
                  <div key={s} className="flex items-center gap-1 shrink-0">
                    <div className={`flex flex-col items-center gap-1`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${i < currentStageIdx ? "bg-green-500 text-white" : i === currentStageIdx ? "bg-[hsl(var(--titan-red))] text-white" : "bg-muted text-muted-foreground"}`}>
                        {i < currentStageIdx ? "✓" : i + 1}
                      </div>
                      <p className={`text-[9px] capitalize text-center max-w-12 leading-tight ${i === currentStageIdx ? "font-bold text-[hsl(var(--titan-red))]" : "text-muted-foreground"}`}>{s}</p>
                    </div>
                    {i < stages.length - 1 && <div className={`w-8 h-0.5 mb-4 ${i < currentStageIdx ? "bg-green-400" : "bg-muted"}`} />}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Explainer card */}
          <Card className="border-[hsl(var(--titan-blue)/0.3)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[hsl(var(--titan-blue))]" />{explainer.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm">{explainer.plain}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200">
                  <p className="text-xs font-semibold text-green-700 mb-2 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />What to do</p>
                  <ul className="space-y-1">{explainer.nextSteps.map((s,i) => <li key={i} className="text-xs flex items-start gap-1.5"><ChevronRight className="w-3 h-3 mt-0.5 shrink-0 text-green-500" />{s}</li>)}</ul>
                </div>
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200">
                  <p className="text-xs font-semibold text-red-600 mb-2 flex items-center gap-1"><HelpCircle className="w-3.5 h-3.5" />What NOT to do</p>
                  <ul className="space-y-1">{explainer.doNot.map((s,i) => <li key={i} className="text-xs flex items-start gap-1.5"><ChevronRight className="w-3 h-3 mt-0.5 shrink-0 text-red-400" />{s}</li>)}</ul>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="bg-[hsl(var(--titan-red))] text-white hover:opacity-90 text-xs"><Send className="w-3 h-3 mr-1" />Text to Customer</Button>
                <Button size="sm" variant="outline" className="text-xs">Send Email</Button>
                <Button size="sm" variant="outline" className="text-xs">Copy Text</Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
