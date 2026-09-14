import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import titanLogo from "@/assets/titan-logo.png";

// ── In-App Support ───────────────────────────────────────────────────────────
// Every Titan Pro user can reach Titan support from within the app. This page
// exposes the primary contact channels (email + phone) and lets a user
// submit a support ticket that is emailed straight to Cody. Intuit's app
// review specifically requires that customers have a way to contact support
// from inside the app — this page is that mechanism.
export default function Support() {
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("general");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) {
      toast({ title: "Fill in both fields", description: "Subject and description are required." });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/support/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subject: subject.trim(), body: body.trim(), category }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Couldn't submit your request.");
      setSent(true);
      setSubject("");
      setBody("");
      setCategory("general");
      toast({ title: "Support request sent", description: "We'll respond to your email within one business day." });
    } catch (err: any) {
      toast({ title: "Something went wrong", description: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4" data-testid="page-support">
      <div className="text-center mb-8">
        <img src={titanLogo} alt="Titan Restoration" className="w-16 h-16 object-contain mx-auto mb-3" />
        <h1 className="text-2xl font-bold">Support</h1>
        <p className="text-sm text-muted-foreground">Titan Pro — Titan Restoration LLC</p>
      </div>

      <div className="space-y-6">
        {/* Direct contact channels */}
        <section className="rounded-lg border p-5">
          <h2 className="font-bold text-base mb-3">Contact us directly</h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-baseline gap-2">
              <span className="font-medium w-16 text-muted-foreground">Email:</span>
              <a
                href="mailto:cody@titanaugusta.com"
                className="text-primary hover:underline"
                data-testid="link-support-email"
              >
                cody@titanaugusta.com
              </a>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-medium w-16 text-muted-foreground">Phone:</span>
              <a href="tel:+17068311001" className="text-primary hover:underline" data-testid="link-support-phone">
                (706) 831-1001
              </a>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-medium w-16 text-muted-foreground">Hours:</span>
              <span>Monday–Friday, 8:00 AM – 5:00 PM ET</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            For emergencies outside business hours, please email — urgent tickets are triaged as soon as they arrive.
          </p>
        </section>

        {/* Submit a ticket */}
        <section className="rounded-lg border p-5">
          <h2 className="font-bold text-base mb-3">Submit a support request</h2>
          {sent ? (
            <div className="text-sm bg-green-50 border border-green-200 text-green-900 rounded p-3">
              Your request has been received. We'll respond to the email address on your Titan Pro account within one
              business day.
              <button
                type="button"
                className="ml-3 text-primary hover:underline"
                onClick={() => setSent(false)}
                data-testid="button-support-new"
              >
                Send another
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full text-sm border rounded px-2 py-1.5 bg-background"
                  data-testid="select-support-category"
                >
                  <option value="general">General question</option>
                  <option value="bug">Bug / something is broken</option>
                  <option value="quickbooks">QuickBooks / accounting sync</option>
                  <option value="gmail">Email / Gmail integration</option>
                  <option value="billing">Billing or account</option>
                  <option value="feature">Feature request</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full text-sm border rounded px-2 py-1.5 bg-background"
                  placeholder="Brief summary of your issue"
                  maxLength={200}
                  data-testid="input-support-subject"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full text-sm border rounded px-2 py-1.5 bg-background min-h-[140px]"
                  placeholder="Tell us what happened, what you expected, and any steps to reproduce. If this is about a QuickBooks sync error, include the invoice number or intuit_tid if you have one."
                  maxLength={5000}
                  data-testid="textarea-support-body"
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Your Titan Pro account info is attached automatically so we can find your session.
                </p>
                <button
                  type="submit"
                  disabled={busy}
                  className="text-sm font-medium px-4 py-1.5 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  data-testid="button-support-submit"
                >
                  {busy ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="text-xs text-muted-foreground">
          For information about your data, see our{" "}
          <a href="/privacy" className="text-primary hover:underline">
            Privacy Policy
          </a>{" "}
          and{" "}
          <a href="/terms" className="text-primary hover:underline">
            Terms
          </a>
          .
        </section>
      </div>
    </div>
  );
}
