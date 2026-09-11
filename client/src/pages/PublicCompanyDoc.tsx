/**
 * PublicCompanyDoc.tsx — public /company-doc/:token viewer.
 *
 * Anyone with the link can view or download the document until it expires.
 * No auth required — the token itself IS the credential. The server
 * enforces expiration and revocation; view-count is bumped on load.
 */
import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Download, ExternalLink, ShieldCheck } from "lucide-react";

type PublicDoc = {
  title: string;
  description: string | null;
  expires_at: string | null;
  issuer: string | null;
  document_number: string | null;
  file_name: string | null;
  file_mime_type: string | null;
  file_url: string | null;
  share_expires_at: string;
};

export default function PublicCompanyDoc() {
  const [match, params] = useRoute("/company-doc/:token");
  const token = params?.token;
  const [doc, setDoc] = useState<PublicDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/company-doc-public/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || "Link not available");
        }
        return r.json();
      })
      .then((d: PublicDoc) => setDoc(d))
      .catch((e: any) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, [token]);

  if (!match) return null;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <div className="text-sm text-muted-foreground">Loading document…</div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              Link unavailable
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {error || "This share link is no longer available."}
            </p>
            <p className="text-xs text-muted-foreground mt-3">
              If you need this document, please contact Titan Restoration directly.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isPdf = doc.file_mime_type?.startsWith("application/pdf");
  const isImage = doc.file_mime_type?.startsWith("image/");

  return (
    <div className="min-h-screen bg-muted/30 p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Header */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-xl" data-testid="text-title">{doc.title}</CardTitle>
                <div className="text-sm text-muted-foreground mt-1">
                  {doc.issuer && <>{doc.issuer} · </>}
                  {doc.document_number && <>#{doc.document_number} · </>}
                  Shared by Titan Restoration LLC
                </div>
              </div>
              {doc.file_url && (
                <a
                  href={doc.file_url}
                  download={doc.file_name || undefined}
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  data-testid="link-download"
                >
                  <Download className="w-4 h-4" /> Download
                </a>
              )}
            </div>
          </CardHeader>
          {doc.description && (
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground">{doc.description}</p>
            </CardContent>
          )}
        </Card>

        {/* File viewer */}
        {doc.file_url && (
          <Card>
            <CardContent className="p-2">
              {isPdf ? (
                <iframe
                  src={doc.file_url}
                  className="w-full h-[75vh] rounded"
                  title={doc.title}
                  data-testid="iframe-viewer"
                />
              ) : isImage ? (
                <img
                  src={doc.file_url}
                  alt={doc.title}
                  className="w-full rounded"
                  data-testid="img-viewer"
                />
              ) : (
                <div className="p-8 text-center">
                  <p className="text-sm text-muted-foreground mb-3">
                    This file type can't be previewed in the browser.
                  </p>
                  <Button asChild data-testid="button-download-alt">
                    <a href={doc.file_url} download={doc.file_name || undefined}>
                      <Download className="w-4 h-4 mr-2" /> Download {doc.file_name}
                    </a>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Footer meta */}
        <Card>
          <CardContent className="p-4 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-2">
            <div className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              This link expires {new Date(doc.share_expires_at).toLocaleDateString()}
            </div>
            {doc.expires_at && (
              <div>Document expires {doc.expires_at}</div>
            )}
            <div>© Titan Restoration LLC · titanaugusta.pro</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
