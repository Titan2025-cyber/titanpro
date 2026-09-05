// Send-for-Signature panel for the EstimateDetail page.
//
// Reuses the site-wide signature_requests table + /api/public/sign/:token
// flow (routes_quickadd_esign.ts). The signed PDF lands in the job file
// automatically as a job_documents row (that side is already generic).
//
// This panel:
//   1. Shows existing pending/signed signature requests scoped to THIS estimate
//   2. Renders "Send for signature" button that POSTs /api/signature-requests
//      with docType="estimate" and a formData payload the public sign page
//      can regenerate the PDF from.
//
// The estimate is associated with the request via formData.estimateId — the
// sign-request row itself only knows the job id.

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PenLine, Send, ExternalLink, Copy as CopyIcon, CheckCircle2, Clock, XCircle } from "lucide-react";

type SignatureRequest = {
  id: number;
  token: string;
  docType: string;
  title: string;
  recipientEmail: string;
  recipientName: string | null;
  status: string;
  viewedAt: string | null;
  signedAt: string | null;
  completedDocumentId: number | null;
  expiresAt: string;
  createdAt: string;
};

interface EstimateSignatureFormData {
  estimateId: number;
  estimateNumber: string;
  createdAt?: string;
  billToName?: string;
  billToPhone?: string;
  billToEmail?: string;
  propertyAddress?: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    unit?: string;
    category?: string;
    notes?: string;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  notes?: string;
  scopeOfWork?: string;
}

interface Props {
  estimateId: number;
  jobId: number;
  jobNumber?: string;
  title: string;                   // e.g. "Estimate — EST-2026-001"
  defaultRecipientEmail: string;
  defaultRecipientName: string;
  buildFormData: () => EstimateSignatureFormData;
}

export function EstimateSignaturePanel({
  estimateId, jobId, jobNumber, title,
  defaultRecipientEmail, defaultRecipientName, buildFormData,
}: Props) {
  const { toast } = useToast();
  const [email, setEmail] = useState(defaultRecipientEmail);
  const [name, setName] = useState(defaultRecipientName);

  // Pull all signature requests for the job, then filter to just this
  // estimate. The request row itself doesn't carry estimateId, so we peek
  // the formData server-side via completed_document? That's expensive — we
  // instead include estimateId directly in the title so we can match on it.
  // (See below: title prefix "Estimate — <n> · #<id>".)
  const titleTag = `#estimate:${estimateId}`;

  const { data: allRequests = [] } = useQuery<SignatureRequest[]>({
    queryKey: [`/api/jobs/${jobId}/signature-requests`],
    enabled: !!jobId,
  });
  const requests = allRequests.filter(r => r.docType === "estimate" && r.title.includes(titleTag));

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!email.trim()) throw new Error("Recipient email required");
      const formData = buildFormData();
      const body = {
        jobId,
        docType: "estimate",
        title: `${title} · ${titleTag}`,
        formData,
        recipientEmail: email.trim(),
        recipientName: name.trim() || undefined,
        recipientRole: "homeowner",
      };
      const res = await apiRequest("POST", "/api/signature-requests", body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Signing link sent", description: `Emailed to ${email}` });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}/signature-requests`] });
    },
    onError: (e: any) => toast({
      title: "Send failed",
      description: e?.message || "Could not send signing link.",
      variant: "destructive",
    }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/signature-requests/${id}/cancel`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}/signature-requests`] });
      toast({ title: "Signing link cancelled" });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/signature-requests/${id}/resend`, {}),
    onSuccess: () => toast({ title: "Signing link re-sent" }),
    onError: (e: any) => toast({
      title: "Resend failed",
      description: e?.message || "",
      variant: "destructive",
    }),
  });

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/sign/${token}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Link copied", description: url });
  };

  const statusChip = (s: string) => {
    if (s === "signed") return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300"><CheckCircle2 className="w-3 h-3 mr-1" />Signed</Badge>;
    if (s === "cancelled") return <Badge className="bg-red-100 text-red-800 border-red-300"><XCircle className="w-3 h-3 mr-1" />Cancelled</Badge>;
    if (s === "expired") return <Badge className="bg-slate-200 text-slate-700 border-slate-300">Expired</Badge>;
    if (s === "viewed") return <Badge className="bg-amber-100 text-amber-800 border-amber-300"><Clock className="w-3 h-3 mr-1" />Viewed</Badge>;
    return <Badge className="bg-blue-100 text-blue-800 border-blue-300"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
  };

  return (
    <Card className="border-[hsl(var(--titan-blue)/0.35)]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <PenLine className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
          Send for Signature
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <p className="text-xs text-muted-foreground">
          Emails the customer a public signing link. When they sign, a signed PDF is
          saved to this job's Documents tab automatically.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Recipient email</Label>
            <Input
              className="mt-1 h-9"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="customer@example.com"
              data-testid="input-estimate-sign-email"
            />
          </div>
          <div>
            <Label className="text-xs">Recipient name (optional)</Label>
            <Input
              className="mt-1 h-9"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Property owner name"
              data-testid="input-estimate-sign-name"
            />
          </div>
        </div>
        <Button
          onClick={() => sendMutation.mutate()}
          disabled={sendMutation.isPending || !email.trim()}
          className="w-full sm:w-auto"
          data-testid="button-estimate-send-for-signature"
        >
          <Send className="w-4 h-4 mr-2" />
          {sendMutation.isPending ? "Sending…" : "Send signing link"}
        </Button>

        {requests.length > 0 && (
          <div className="mt-3 border rounded-lg divide-y">
            {requests.map(r => (
              <div key={r.id} className="flex items-center gap-2 p-2 text-sm flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {statusChip(r.status)}
                    <span className="font-medium truncate">{r.recipientEmail}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Sent {new Date(r.createdAt).toLocaleDateString()}
                    {r.signedAt && ` · Signed ${new Date(r.signedAt).toLocaleDateString()}`}
                    {!r.signedAt && r.status !== "cancelled" && ` · Expires ${new Date(r.expiresAt).toLocaleDateString()}`}
                  </div>
                </div>
                {r.status !== "signed" && r.status !== "cancelled" && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => copyLink(r.token)} title="Copy link">
                      <CopyIcon className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => window.open(`/sign/${r.token}`, "_blank")} title="Open">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => resendMutation.mutate(r.id)} disabled={resendMutation.isPending}>
                      Resend
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => cancelMutation.mutate(r.id)} disabled={cancelMutation.isPending} className="text-destructive">
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
