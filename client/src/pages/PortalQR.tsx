import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrCode, Download, Printer, Copy, Check, Home, ExternalLink, Info } from "lucide-react";

type Portal = {
  key: string;
  title: string;
  subtitle: string;
  hash: string;
  accent: string; // css var name
  icon: typeof Home;
  blurb: string;
};

const PORTALS: Portal[] = [
  {
    key: "customer",
    title: "Customer Portal",
    subtitle: "For homeowners",
    hash: "#/customer-portal",
    accent: "--titan-red",
    icon: Home,
    blurb: "Homeowners scan to track their job status, view documents, and pay invoices. They sign in with the phone number on file and their 4-digit PIN.",
  },
  {
    key: "partner",
    title: "Partner Portal",
    subtitle: "For subs & referral partners",
    hash: "#/partner-access",
    accent: "--titan-blue",
    icon: ExternalLink,
    blurb: "Subcontractors and referral partners scan to view assigned jobs, track earnings, and manage payout methods. They sign in by selecting their name and entering their access PIN.",
  },
];

function QRCard({ portal, baseUrl }: { portal: Portal; baseUrl: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const fullUrl = baseUrl ? `${baseUrl}/${portal.hash}` : portal.hash;

  useEffect(() => {
    if (!canvasRef.current || !baseUrl) return;
    QRCode.toCanvas(canvasRef.current, fullUrl, {
      width: 240,
      margin: 1,
      color: { dark: "#111827", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }, () => {});
    QRCode.toDataURL(fullUrl, {
      width: 720,
      margin: 2,
      color: { dark: "#111827", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }).then(setDataUrl).catch(() => {});
  }, [fullUrl, baseUrl]);

  const download = () => {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `titan-${portal.key}-portal-qr.png`;
    a.click();
  };

  const printQR = () => {
    if (!dataUrl) return;
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    w.document.write(`
      <html><head><title>${portal.title} — QR Code</title>
      <style>
        body{font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:48px;color:#111827}
        h1{font-size:24px;margin:0 0 4px}
        h2{font-size:15px;color:#6b7280;font-weight:500;margin:0 0 28px}
        img{width:340px;height:340px}
        .url{margin-top:20px;font-size:13px;color:#374151;word-break:break-all}
        .brand{margin-top:40px;font-size:13px;color:#9ca3af}
        .co{font-weight:700;color:#CC0000}
      </style></head>
      <body>
        <h1>${portal.title}</h1>
        <h2>${portal.subtitle} — Titan Restoration LLC</h2>
        <img src="${dataUrl}" />
        <p class="url">${fullUrl}</p>
        <p class="brand"><span class="co">Titan Restoration LLC</span> · 706-922-0154 · Recover · Restore · Rebuild</p>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  const copyLink = () => {
    // navigator.clipboard is blocked in the sandbox iframe; fall back gracefully.
    try {
      const ta = document.createElement("textarea");
      ta.value = fullUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* noop */ }
  };

  const Icon = portal.icon;

  return (
    <Card data-testid={`card-qr-${portal.key}`} className="overflow-hidden">
      <CardHeader className="pb-3" style={{ borderBottom: `3px solid hsl(var(${portal.accent}))` }}>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
            style={{ background: `hsl(var(${portal.accent}))` }}>
            <Icon className="w-4 h-4" />
          </span>
          <div>
            <div>{portal.title}</div>
            <div className="text-xs font-normal text-muted-foreground">{portal.subtitle}</div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">{portal.blurb}</p>

        <div className="flex justify-center">
          <div className="p-3 bg-white rounded-xl border shadow-sm">
            <canvas ref={canvasRef} data-testid={`canvas-qr-${portal.key}`} />
          </div>
        </div>

        <div className="rounded-lg bg-muted/50 border p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Portal link</p>
          <p className="text-xs font-mono break-all text-foreground" data-testid={`text-url-${portal.key}`}>{fullUrl}</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" className="text-xs" onClick={download} data-testid={`button-download-${portal.key}`}>
            <Download className="w-3.5 h-3.5 mr-1" />Download
          </Button>
          <Button variant="outline" size="sm" className="text-xs" onClick={printQR} data-testid={`button-print-${portal.key}`}>
            <Printer className="w-3.5 h-3.5 mr-1" />Print
          </Button>
          <Button variant="outline" size="sm" className="text-xs" onClick={copyLink} data-testid={`button-copy-${portal.key}`}>
            {copied ? <><Check className="w-3.5 h-3.5 mr-1 text-green-600" />Copied</> : <><Copy className="w-3.5 h-3.5 mr-1" />Copy</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PortalQR() {
  // Detect the base URL from the current browser origin (works both in preview
  // and once the app is published to a real domain).
  const [baseUrl, setBaseUrl] = useState("");

  useEffect(() => {
    const origin = window.location.origin;
    const path = window.location.pathname.replace(/\/$/, "");
    setBaseUrl(`${origin}${path}`);
  }, []);

  const isPreview = baseUrl.includes("perplexity.ai") || baseUrl.includes("localhost");

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <QrCode className="w-5 h-5 text-[hsl(var(--titan-blue))]" />Portal QR Codes
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Print or share these codes so customers and partners can reach their portal by scanning with a phone camera.
        </p>
      </div>

      {isPreview && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3">
          <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            These QR codes point to the current preview address. Once the app is published to its own web
            address, revisit this page and the codes will automatically update to the live links — then print them for the field.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {PORTALS.map(p => <QRCard key={p.key} portal={p} baseUrl={baseUrl} />)}
      </div>

      <Card>
        <CardContent className="pt-5">
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
            <Info className="w-4 h-4 text-[hsl(var(--titan-blue))]" />How it works
          </h3>
          <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
            <li>Anyone who scans a code opens the portal directly — no staff login required.</li>
            <li>Each portal has its own secure sign-in: customers use phone + PIN, partners select their name + PIN.</li>
            <li><span className="font-medium text-foreground">Download</span> saves a high-resolution PNG you can add to emails, invoices, or yard signs.</li>
            <li><span className="font-medium text-foreground">Print</span> opens a print-ready sheet with the company branding.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
