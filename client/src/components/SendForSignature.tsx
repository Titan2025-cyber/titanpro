// Shared "Send to customer for signature" launcher used at the top of every
// signable form in JobDocuments. Collects the customer's email + name +
// relationship, POSTs a signature_request, and shows the resulting link so
// ops can copy it (in case the email was blocked or the customer wants it
// texted).
//
// The parent form owns the docType and passes the current `formData` state
// snapshot — that way whatever the tech has already filled in gets shipped
// with the sign link and pre-populates the customer's view.

import { useState } from "react";
import { Mail, Copy, Check, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export type SendForSignatureProps = {
  jobId: number;
  docType: string;                                       // "work_authorization" | etc
  title: string;                                         // human-readable, appears in the email subject
  getFormData: () => Record<string, any>;                // called lazily so the latest values are captured
  defaultEmail?: string;
  defaultName?: string;
  defaultRole?: "homeowner" | "insured" | "tenant" | "other";
};

export function SendForSignature(props: SendForSignatureProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(props.defaultEmail || "");
  const [name, setName] = useState(props.defaultName || "");
  const [role, setRole] = useState<string>(props.defaultRole || "homeowner");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const send = async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "Enter a valid email", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/signature-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          jobId: props.jobId,
          docType: props.docType,
          title: props.title,
          formData: props.getFormData(),
          recipientEmail: email,
          recipientName: name || null,
          recipientRole: role,
        }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || `HTTP ${res.status}`);
      const data = await res.json();
      setLink(data.link);
      toast({
        title: data.emailSent ? "✉️ Sign link emailed" : "Sign link created",
        description: data.emailSent
          ? `Sent to ${email}. Link expires in 7 days.`
          : `Email couldn't be sent (${data.emailError || "unknown"}). Copy the link and text it.`,
        variant: data.emailSent ? "default" : "destructive",
      });
    } catch (e: any) {
      toast({ title: "Failed to send", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 text-sm font-medium px-3 py-2.5 rounded-lg border border-dashed border-[hsl(var(--titan-blue)/0.5)] text-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue)/0.06)] transition-colors"
        data-testid={`button-send-for-signature-${props.docType}`}
      >
        <Send className="w-4 h-4" />
        Send to customer for signature (email)
      </button>
    );
  }

  return (
    <Card className="p-4 border-[hsl(var(--titan-blue)/0.4)] bg-[hsl(var(--titan-blue)/0.03)] space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-[hsl(var(--titan-blue))]">
        <Mail className="w-4 h-4" />
        Send this form to the customer to sign remotely
      </div>
      <p className="text-xs text-muted-foreground">
        We'll email a private link that expires in 7 days. When the customer signs on their phone/computer,
        the signed PDF loads back into this job automatically.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Customer email</Label>
          <Input
            type="email"
            className="mt-1 h-9 text-sm"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="name@example.com"
            data-testid={`input-signature-email-${props.docType}`}
          />
        </div>
        <div>
          <Label className="text-xs">Customer name (optional)</Label>
          <Input
            className="mt-1 h-9 text-sm"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Full legal name"
            data-testid={`input-signature-name-${props.docType}`}
          />
        </div>
      </div>
      <div>
        <Label className="text-xs">Role</Label>
        <select
          className="mt-1 h-9 text-sm w-full rounded-md border bg-background px-2"
          value={role}
          onChange={e => setRole(e.target.value)}
          data-testid={`select-signature-role-${props.docType}`}
        >
          <option value="homeowner">Homeowner</option>
          <option value="insured">Insured (named on policy)</option>
          <option value="tenant">Tenant</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
          onClick={send}
          disabled={busy}
          data-testid={`button-send-signature-submit-${props.docType}`}
        >
          <Send className="w-4 h-4 mr-1.5" />
          {busy ? "Sending…" : "Send sign link"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>

      {link && (
        <div className="pt-3 border-t space-y-1.5">
          <p className="text-xs text-muted-foreground">Sign link (also emailed to the customer):</p>
          <div className="flex gap-2">
            <Input className="text-xs font-mono" value={link} readOnly />
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
