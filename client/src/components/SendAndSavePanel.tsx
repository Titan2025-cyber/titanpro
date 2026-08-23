// ─────────────────────────────────────────────────────────────────────────────
// SendAndSavePanel
//
// One reusable component that lets any generated document (estimate PDF,
// invoice PDF, future one-off receipts) be:
//
//   1. Downloaded locally (button always available)
//   2. Saved to the job file library (POST /api/jobs/:jobId/documents)
//   3. Emailed to the customer with the PDF attached (server picks Gmail
//      OR SMTP based on availability; no dedicated per-doc endpoint needed)
//
// Callers pass in:
//   - jobId          : which job the "save to file" record binds to
//   - docType        : job_documents.docType value (e.g. "estimate", "invoice")
//   - title          : human title stored on the row + used as PDF filename
//   - buildPdf()     : lazy PDF generator returning a base64 data URI
//   - defaultTo      : customer email (prefilled)
//   - defaultSubject : email subject seed
//   - defaultBody    : email body seed
//
// The component is intentionally dumb: it does not know about estimates
// vs invoices — every caller wires their own PDF builder.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Download, Mail, FolderPlus, Loader2, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { downloadPDF } from "@/lib/pdfEngine";

type Props = {
  jobId: number | null | undefined;
  docType: string;
  title: string;                    // "Estimate EST-2026-001" — used as filename base
  buildPdf: () => Promise<string> | string;
  defaultTo?: string;
  defaultSubject?: string;
  defaultBody?: string;
  // Called after any successful save/email so the caller can refresh state.
  onSaved?: (kind: "saved-to-job" | "emailed") => void;
};

export function SendAndSavePanel({
  jobId,
  docType,
  title,
  buildPdf,
  defaultTo = "",
  defaultSubject,
  defaultBody,
  onSaved,
}: Props) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<"none" | "email">("none");
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const safeFilename = (title || "document").replace(/[^\w.\-]+/g, "_") + ".pdf";

  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject || title);
  const [body, setBody] = useState(
    defaultBody ??
      "Please find your document attached. Reply here with any questions.\n\n— Titan Restoration",
  );

  async function withPdf<T>(fn: (dataUri: string) => Promise<T> | T): Promise<T> {
    const dataUri = await buildPdf();
    return await fn(dataUri);
  }

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      await withPdf(uri => downloadPDF(uri, safeFilename));
    } catch (e: any) {
      toast({ title: "Download failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  }

  async function handleSaveToJob() {
    if (saving) return;
    if (!jobId) {
      toast({ title: "No job attached", description: "Attach this to a job first.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const dataUri = await Promise.resolve(buildPdf());
      await apiRequest("POST", `/api/jobs/${jobId}/documents`, {
        docType,
        title,
        fileData: dataUri,
        // Empty formData keeps parity with signature request docs.
        formData: JSON.stringify({ source: "send-and-save", createdVia: "manual" }),
        status: "final",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}/documents`] });
      queryClient.invalidateQueries({ queryKey: ["/api/job-documents"] });
      toast({ title: "Saved to job file", description: `${title} is now in the job's Documents tab.` });
      onSaved?.("saved-to-job");
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSendEmail() {
    if (sending) return;
    if (!to.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim())) {
      toast({ title: "Enter a valid email", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const dataUri = await Promise.resolve(buildPdf());
      const resp: any = await apiRequest("POST", "/api/send-document-email", {
        jobId,
        docType,
        title,
        to: to.trim(),
        subject: subject.trim() || title,
        body: body.trim(),
        pdfDataUri: dataUri,
        // Also drop a copy in the job file so there's an audit trail of what was sent.
        saveToJob: !!jobId,
      });
      const data = resp && typeof resp.json === "function" ? await resp.json() : resp;
      const status = data?.email?.[0]?.status || "sent";
      const provider = data?.provider || "email";
      if (status === "sent") {
        toast({
          title: "Email sent",
          description: `${title} sent to ${to.trim()} via ${provider}.` + (data?.savedDocumentId ? " Saved to job file." : ""),
        });
        setExpanded("none");
        onSaved?.("emailed");
      } else if (status === "logged") {
        toast({
          title: "Email simulated",
          description: "No mail provider is configured — connect Gmail in Settings or set SENDGRID_API_KEY.",
        });
      } else {
        toast({ title: "Email failed", description: data?.email?.[0]?.error || "Unknown error", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Email failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-lg border bg-gradient-to-br from-blue-50/40 to-transparent p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleDownload}
          disabled={downloading}
          data-testid="button-download-doc"
        >
          {downloading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}
          Download PDF
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSaveToJob}
          disabled={saving || !jobId}
          data-testid="button-save-to-job"
          title={jobId ? "Save this PDF to the job's Documents tab" : "This document isn't attached to a job"}
        >
          {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <FolderPlus className="w-3 h-3 mr-1" />}
          Save to job file
        </Button>
        <Button
          size="sm"
          variant={expanded === "email" ? "secondary" : "default"}
          onClick={() => setExpanded(e => (e === "email" ? "none" : "email"))}
          data-testid="button-email-doc"
        >
          <Mail className="w-3 h-3 mr-1" />
          Email to customer
        </Button>
      </div>

      {expanded === "email" && (
        <div className="space-y-2 rounded-md border bg-background p-3">
          <div className="grid gap-2">
            <div className="grid gap-1">
              <Label htmlFor="send-to" className="text-xs">To</Label>
              <Input
                id="send-to"
                type="email"
                value={to}
                onChange={e => setTo(e.target.value)}
                placeholder="customer@example.com"
                data-testid="input-email-to"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="send-subject" className="text-xs">Subject</Label>
              <Input
                id="send-subject"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                data-testid="input-email-subject"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="send-body" className="text-xs">Message</Label>
              <Textarea
                id="send-body"
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={4}
                data-testid="textarea-email-body"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={handleSendEmail} disabled={sending} data-testid="button-send-email">
              {sending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Check className="w-3 h-3 mr-1" />}
              Send with PDF attached
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setExpanded("none")} disabled={sending}>
              <X className="w-3 h-3 mr-1" />Cancel
            </Button>
            {jobId && (
              <p className="text-xs text-muted-foreground ml-auto">
                A copy is auto-saved to the job's Documents tab.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
