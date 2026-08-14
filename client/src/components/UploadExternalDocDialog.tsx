/**
 * UploadExternalDocDialog.tsx
 *
 * Drop-in dialog for uploading an outside-authored estimate or invoice —
 * a PDF/JPG that was written in Xactimate, Symbility, a subcontractor's
 * template, a carrier's approval letter, etc. — directly into a Titan Pro
 * job. The uploaded doc becomes a first-class estimate/invoice row on the
 * job's tab, with `source = 'external'` and a click-to-open attachment.
 *
 * Used from JobDetail's Estimates and Invoices tabs. Not a route.
 *
 * Props:
 *   kind         'estimate' | 'invoice' — controls copy + fields shown
 *   jobId        target job id
 *   phase        current phase (mitigation/reconstruction/…) — used as default
 *   open / onOpenChange   controlled dialog state
 *   onUploaded   callback fired after a successful POST (parent invalidates query)
 */
import { useState, useRef, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileText, Receipt, X } from "lucide-react";

interface Props {
  kind: "estimate" | "invoice";
  jobId: number;
  phase?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded?: () => void;
}

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export default function UploadExternalDocDialog({ kind, jobId, phase, open, onOpenChange, onUploaded }: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [vendor, setVendor] = useState("");
  const [total, setTotal] = useState("");
  const [status, setStatus] = useState(kind === "invoice" ? "sent" : "sent");
  const [dueDate, setDueDate] = useState("");
  const [phaseSel, setPhaseSel] = useState(phase || "mitigation");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset when the dialog re-opens so a second upload doesn't inherit
  // the previous doc's metadata.
  useEffect(() => {
    if (open) {
      setFile(null);
      setTitle("");
      setInvoiceNumber("");
      setVendor("");
      setTotal("");
      setStatus("sent");
      setDueDate("");
      setPhaseSel(phase || "mitigation");
      setNotes("");
    }
  }, [open, phase]);

  const pick = () => inputRef.current?.click();

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast({ title: "File too large", description: `Max ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`, variant: "destructive" });
      e.target.value = "";
      return;
    }
    setFile(f);
    // Default the title to the filename (without extension) for estimates.
    if (kind === "estimate" && !title) {
      const base = f.name.replace(/\.[^.]+$/, "");
      setTitle(base);
    }
  };

  const submit = async () => {
    if (!file) {
      toast({ title: "Pick a file first", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const url =
        kind === "estimate"
          ? `/api/jobs/${jobId}/estimates/external`
          : `/api/jobs/${jobId}/invoices/external`;
      const payload: any = {
        vendor: vendor || null,
        total: total ? Number(total) : 0,
        notes: notes || null,
        status,
        phase: phaseSel,
        dataUrl,
        fileName: file.name,
        fileMime: file.type || null,
      };
      if (kind === "estimate") payload.title = title || null;
      if (kind === "invoice") {
        payload.invoiceNumber = invoiceNumber || null;
        payload.dueDate = dueDate || null;
      }
      const res = await apiRequest(url, { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Upload failed (${res.status})`);
      }
      toast({ title: `External ${kind} uploaded`, description: file.name });
      onUploaded?.();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message || "Try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const Icon = kind === "invoice" ? Receipt : FileText;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Upload external {kind}
          </DialogTitle>
          <DialogDescription>
            Attach a PDF or image of an {kind} that was written outside Titan Pro (Xactimate, Symbility, a
            subcontractor's template, an insurance approval, etc.). It will land in this job's{" "}
            <span className="font-medium">{phaseSel}</span> {kind} list.
          </DialogDescription>
        </DialogHeader>

        {/* File picker */}
        <div className="space-y-2">
          <Label>File</Label>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={onFilePicked}
          />
          {file ? (
            <div className="flex items-center justify-between rounded-md border p-2 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{file.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  ({(file.size / 1024).toFixed(0)} KB)
                </span>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setFile(null)} title="Remove">
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={pick} className="w-full">
              <Upload className="w-4 h-4 mr-2" /> Choose PDF or image
            </Button>
          )}
        </div>

        {/* Common fields */}
        <div className="grid grid-cols-2 gap-3">
          {kind === "estimate" ? (
            <div className="col-span-2 space-y-1">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Roof replacement — Xactimate" />
            </div>
          ) : (
            <div className="space-y-1">
              <Label>Invoice #</Label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="auto if blank" />
            </div>
          )}

          <div className="space-y-1">
            <Label>Vendor / author</Label>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Xactimate, ACME Roofing" />
          </div>

          <div className="space-y-1">
            <Label>Total ($)</Label>
            <Input type="number" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0.00" />
          </div>

          {kind === "invoice" && (
            <div className="space-y-1">
              <Label>Due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          )}

          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {kind === "estimate" ? (
                  <>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Phase</Label>
            <Select value={phaseSel} onValueChange={setPhaseSel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mitigation">Mitigation</SelectItem>
                <SelectItem value="reconstruction">Reconstruction</SelectItem>
                <SelectItem value="invoice_pending">Invoice pending</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label>Notes (optional)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything relevant — carrier response, sub's terms, etc." />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !file} className="bg-[hsl(var(--titan-blue))] text-white">
            {submitting ? "Uploading…" : `Upload ${kind}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
