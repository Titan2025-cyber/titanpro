import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gavel, Copy, Download, FileText, Scale, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Job { id: number; jobNumber: string; address: string; insuranceCarrier?: string; }

export default function OPRebuttal() {
  const { toast } = useToast();
  const [form, setForm] = useState({
    jobId: "", jobAddress: "", carrier: "", claimNumber: "",
    estimateSubtotal: "", state: "GA", supervisorHours: "", supervisorRate: "65",
    disputedItems: "",
  });
  const [letter, setLetter] = useState("");
  const [opAmount, setOpAmount] = useState("");

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then(r => r.json()),
  });

  const generateMutation = useMutation({
    mutationFn: (payload: any) =>
      apiRequest("/api/op-rebuttal/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(r => r.json()),
    onSuccess: (data) => {
      setLetter(data.letter);
      setOpAmount(data.opAmount);
      toast({ title: "Rebuttal Letter Generated", description: `O&P amount: $${data.opAmount}` });
    },
  });

  const handleJobChange = (jobId: string) => {
    const job = jobs.find(j => String(j.id) === jobId);
    setForm(f => ({
      ...f,
      jobId,
      jobAddress: job?.address || "",
      carrier: job?.insuranceCarrier || "",
    }));
  };

  const handleGenerate = () => {
    generateMutation.mutate({
      ...form,
      estimateSubtotal: parseFloat(form.estimateSubtotal) || undefined,
      supervisorHours: parseFloat(form.supervisorHours) || undefined,
      supervisorRate: parseFloat(form.supervisorRate) || 65,
    });
  };

  const copyLetter = () => {
    navigator.clipboard.writeText(letter);
    toast({ title: "Copied to Clipboard" });
  };

  const downloadLetter = () => {
    const blob = new Blob([letter], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `op-rebuttal-${form.claimNumber || "claim"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Scale className="w-7 h-7 text-red-600" />
        <div>
          <h1 className="text-xl font-bold">O&P + Supervision Rebuttal</h1>
          <p className="text-sm text-muted-foreground">Generate a carrier rebuttal letter backed by case law, OSHA, and Xactimate's own documentation</p>
        </div>
      </div>

      {/* Case law reference cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { case: "Mee v. Safeco (PA, 2006)", point: "O&P owed regardless of whether GC has been hired yet" },
          { case: "Tritschler v. Allstate (AZ, 2006)", point: "Replacement cost includes GC fee when one would reasonably be needed" },
          { case: "Ghoman v. NH Insurance (TX Federal)", point: "O&P 'clearly fits' the 'reasonably likely to incur' standard" },
        ].map((c, i) => (
          <Card key={i} className="border-l-4 border-l-blue-600">
            <CardContent className="p-3">
              <p className="text-xs font-bold text-blue-700 dark:text-blue-400">{c.case}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{c.point}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <Card>
          <CardHeader><CardTitle className="text-base">Claim Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Job (optional auto-fill)</Label>
              <Select onValueChange={handleJobChange}>
                <SelectTrigger data-testid="select-op-job"><SelectValue placeholder="Select job..." /></SelectTrigger>
                <SelectContent>
                  {jobs.map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber} — {j.address?.split(",")[0]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Carrier</Label>
                <Input data-testid="input-op-carrier" value={form.carrier} onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))} placeholder="State Farm" />
              </div>
              <div>
                <Label>Claim Number</Label>
                <Input data-testid="input-op-claim" value={form.claimNumber} onChange={e => setForm(f => ({ ...f, claimNumber: e.target.value }))} placeholder="SF-2026-XXXXX" />
              </div>
            </div>
            <div>
              <Label>Property Address</Label>
              <Input value={form.jobAddress} onChange={e => setForm(f => ({ ...f, jobAddress: e.target.value }))} placeholder="123 Main St, Augusta, GA" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>State</Label>
                <Select value={form.state} onValueChange={v => setForm(f => ({ ...f, state: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GA">Georgia</SelectItem>
                    <SelectItem value="SC">South Carolina</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Estimate Subtotal ($)</Label>
                <Input data-testid="input-estimate-total" type="number" value={form.estimateSubtotal} onChange={e => setForm(f => ({ ...f, estimateSubtotal: e.target.value }))} placeholder="45000" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Supervisor Hours</Label>
                <Input type="number" value={form.supervisorHours} onChange={e => setForm(f => ({ ...f, supervisorHours: e.target.value }))} placeholder="8" />
              </div>
              <div>
                <Label>Rate ($/hr)</Label>
                <Input type="number" value={form.supervisorRate} onChange={e => setForm(f => ({ ...f, supervisorRate: e.target.value }))} placeholder="65" />
              </div>
            </div>
            <div>
              <Label>Disputed Items (optional details)</Label>
              <Textarea value={form.disputedItems} onChange={e => setForm(f => ({ ...f, disputedItems: e.target.value }))} placeholder="List specific line items the carrier denied or underpaid..." rows={3} />
            </div>
            {form.estimateSubtotal && (
              <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm">
                <p className="font-medium text-green-700 dark:text-green-400">Calculated O&P</p>
                <p className="text-green-600 dark:text-green-300">
                  ${parseFloat(form.estimateSubtotal).toLocaleString()} × 20.5% = <strong>${(parseFloat(form.estimateSubtotal) * 0.205).toLocaleString("en-US", { maximumFractionDigits: 0 })}</strong>
                </p>
              </div>
            )}
            <Button
              data-testid="button-generate-rebuttal"
              onClick={handleGenerate}
              disabled={!form.carrier || generateMutation.isPending}
              className="w-full bg-red-600 hover:bg-red-700 text-white"
            >
              <Gavel className="w-4 h-4 mr-2" />
              {generateMutation.isPending ? "Generating..." : "Generate Rebuttal Letter"}
            </Button>
          </CardContent>
        </Card>

        {/* Letter Output */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" />Generated Letter</CardTitle>
              {letter && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={copyLetter}><Copy className="w-3.5 h-3.5 mr-1" />Copy</Button>
                  <Button size="sm" variant="outline" onClick={downloadLetter}><Download className="w-3.5 h-3.5 mr-1" />Download</Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!letter ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground text-sm">
                <Scale className="w-10 h-10 mb-3 opacity-30" />
                <p>Fill in the claim details and click Generate.</p>
                <p className="text-xs mt-1 opacity-70">Letter cites Xactimate docs, 3 court cases, OSHA 1926.20, and {form.state === "SC" ? "S.C. Code § 38-59-20" : "O.C.G.A. § 33-24-46"}</p>
              </div>
            ) : (
              <Textarea
                value={letter}
                onChange={e => setLetter(e.target.value)}
                className="font-mono text-xs min-h-[500px] resize-none"
                data-testid="output-rebuttal-letter"
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
