/**
 * CompanyDocuments.tsx — Titan's internal document vault.
 *
 * Stores COI, licenses, W-9, IICRC certs, safety manuals, capability
 * statements, any doc Titan needs to prove or send to others. Separate
 * from the SUBCONTRACTOR COI Tracker (which is inbound-compliance).
 *
 * Roles: owner / admin / general_manager can upload, edit, share, delete.
 * Everyone else is read/download only.
 *
 * Mounted from Settings (?section=company-documents) and reachable at
 * /company-documents standalone as well.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Upload, Search, Trash2, Pencil, Share2, Copy, Check, X, FileText,
  Calendar, AlertTriangle, Download, Eye, Tag as TagIcon, ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";

type Doc = {
  id: number;
  title: string;
  description: string | null;
  tags: string[];
  issuer: string | null;
  document_number: string | null;
  issued_at: string | null;
  expires_at: string | null;
  file_name: string | null;
  file_mime_type: string | null;
  file_size_bytes: number;
  uploaded_by_name: string | null;
  created_at: string;
  updated_at: string;
  has_file: boolean;
  status: "ok" | "expiring_soon" | "expiring" | "expired" | "no_expiry";
  days_until_expiry: number | null;
};

type Share = {
  id: number;
  token: string;
  recipient_email: string | null;
  recipient_name: string | null;
  note: string | null;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  share_url: string;
  active: boolean;
};

function formatBytes(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadge(doc: Doc) {
  switch (doc.status) {
    case "expired":
      return <Badge variant="destructive" data-testid={`badge-status-${doc.id}`}>Expired</Badge>;
    case "expiring":
      return <Badge className="bg-red-100 text-red-800 hover:bg-red-100" data-testid={`badge-status-${doc.id}`}>{doc.days_until_expiry}d left</Badge>;
    case "expiring_soon":
      return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100" data-testid={`badge-status-${doc.id}`}>{doc.days_until_expiry}d left</Badge>;
    case "ok":
      return <Badge variant="outline" data-testid={`badge-status-${doc.id}`}>OK</Badge>;
    default:
      return null;
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function CompanyDocuments() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canEdit = ["owner", "admin", "general_manager"].includes(user?.role || "");

  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<Doc | null>(null);
  const [form, setForm] = useState({
    title: "", description: "", tags: "", issuer: "", document_number: "",
    issued_at: "", expires_at: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [shareOpen, setShareOpen] = useState(false);
  const [shareDoc, setShareDoc] = useState<Doc | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery<{ documents: Doc[]; tags: string[] }>({
    queryKey: ["/api/company-documents", search, tagFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (tagFilter) params.set("tag", tagFilter);
      const r = await apiRequest(`/api/company-documents?${params.toString()}`);
      return r.json();
    },
  });
  const docs = data?.documents || [];
  const tags = data?.tags || [];

  const counts = useMemo(() => {
    let expired = 0, expiring = 0, expiringSoon = 0;
    for (const d of docs) {
      if (d.status === "expired") expired++;
      else if (d.status === "expiring") expiring++;
      else if (d.status === "expiring_soon") expiringSoon++;
    }
    return { expired, expiring, expiringSoon };
  }, [docs]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        title: form.title,
        description: form.description || null,
        tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
        issuer: form.issuer || null,
        document_number: form.document_number || null,
        issued_at: form.issued_at || null,
        expires_at: form.expires_at || null,
      };
      if (file) {
        payload.file_data = await fileToDataUrl(file);
        payload.file_name = file.name;
        payload.file_mime_type = file.type;
      }
      const url = editing ? `/api/company-documents/${editing.id}` : "/api/company-documents";
      const method = editing ? "PATCH" : "POST";
      const r = await apiRequest(url, { method, body: JSON.stringify(payload) });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents/expiring"] });
      toast({ title: editing ? "Document updated" : "Document uploaded" });
      resetForm();
    },
    onError: (e: any) => toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest(`/api/company-documents/${id}`, { method: "DELETE" });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents/expiring"] });
      toast({ title: "Document deleted" });
    },
  });

  function resetForm() {
    setShowEditor(false);
    setEditing(null);
    setFile(null);
    setForm({ title: "", description: "", tags: "", issuer: "", document_number: "", issued_at: "", expires_at: "" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function openEdit(d: Doc) {
    setEditing(d);
    setForm({
      title: d.title,
      description: d.description || "",
      tags: (d.tags || []).join(", "),
      issuer: d.issuer || "",
      document_number: d.document_number || "",
      issued_at: d.issued_at || "",
      expires_at: d.expires_at || "",
    });
    setFile(null);
    setShowEditor(true);
  }

  function openNew() {
    setEditing(null);
    setForm({ title: "", description: "", tags: "", issuer: "", document_number: "", issued_at: "", expires_at: "" });
    setFile(null);
    setShowEditor(true);
  }

  async function viewDoc(doc: Doc) {
    // Fetch the detail endpoint to get a fresh signed URL, then open
    try {
      const r = await apiRequest(`/api/company-documents/${doc.id}`);
      const detail = await r.json();
      if (detail.file_url) window.open(detail.file_url, "_blank");
      else toast({ title: "No file attached", variant: "destructive" });
    } catch (e: any) {
      toast({ title: "Could not open file", description: String(e?.message || e), variant: "destructive" });
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* ── Header + KPIs ────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-page-title">
            <FileText className="w-6 h-6" /> Company Documents
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Titan's internal vault — COI, licenses, W-9, IICRC certifications, and forms you send to customers and carriers.
          </p>
        </div>
        {canEdit && (
          <Button onClick={openNew} data-testid="button-upload">
            <Upload className="w-4 h-4 mr-2" /> Upload document
          </Button>
        )}
      </div>

      {/* KPI strip */}
      {(counts.expired > 0 || counts.expiring > 0 || counts.expiringSoon > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {counts.expired > 0 && (
            <Card className="border-red-300 bg-red-50 dark:bg-red-950/20">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertTriangle className="w-8 h-8 text-red-600" />
                <div>
                  <div className="text-2xl font-semibold text-red-700 dark:text-red-400" data-testid="text-count-expired">{counts.expired}</div>
                  <div className="text-xs text-red-700 dark:text-red-400 uppercase tracking-wide">Expired</div>
                </div>
              </CardContent>
            </Card>
          )}
          {counts.expiring > 0 && (
            <Card className="border-red-200 bg-red-50/60 dark:bg-red-950/10">
              <CardContent className="p-4 flex items-center gap-3">
                <Calendar className="w-8 h-8 text-red-600" />
                <div>
                  <div className="text-2xl font-semibold text-red-600" data-testid="text-count-expiring">{counts.expiring}</div>
                  <div className="text-xs text-red-600 uppercase tracking-wide">Expiring ≤ 7 days</div>
                </div>
              </CardContent>
            </Card>
          )}
          {counts.expiringSoon > 0 && (
            <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
              <CardContent className="p-4 flex items-center gap-3">
                <Calendar className="w-8 h-8 text-amber-600" />
                <div>
                  <div className="text-2xl font-semibold text-amber-600" data-testid="text-count-expiring-soon">{counts.expiringSoon}</div>
                  <div className="text-xs text-amber-600 uppercase tracking-wide">Expiring ≤ 60 days</div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Search + tag filter ──────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search title, issuer, number, or notes…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search"
          />
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 items-center">
            <TagIcon className="w-4 h-4 text-muted-foreground" />
            {tags.slice(0, 12).map(t => (
              <Badge
                key={t}
                variant={tagFilter === t ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setTagFilter(tagFilter === t ? null : t)}
                data-testid={`badge-tag-${t}`}
              >
                {t}
              </Badge>
            ))}
            {tagFilter && (
              <Button variant="ghost" size="sm" onClick={() => setTagFilter(null)} data-testid="button-clear-tag">
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Documents grid ──────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground text-center py-12">Loading…</div>
      ) : docs.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <div className="text-lg font-medium">No documents yet</div>
            <div className="text-sm text-muted-foreground mt-1">
              {canEdit
                ? "Upload your COI, business license, W-9, IICRC certificates, and any forms you send to customers or carriers."
                : "Your team hasn't uploaded any company documents yet."}
            </div>
            {canEdit && (
              <Button onClick={openNew} className="mt-4" data-testid="button-upload-empty">
                <Upload className="w-4 h-4 mr-2" /> Upload your first document
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {docs.map(d => (
            <Card key={d.id} data-testid={`card-doc-${d.id}`} className="flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base line-clamp-2" data-testid={`text-title-${d.id}`}>{d.title}</CardTitle>
                  {statusBadge(d)}
                </div>
                {d.issuer && <div className="text-xs text-muted-foreground">{d.issuer}</div>}
              </CardHeader>
              <CardContent className="pt-0 flex-1 flex flex-col">
                {d.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{d.description}</p>
                )}
                <div className="text-xs text-muted-foreground space-y-1 mb-3">
                  {d.document_number && <div>#{d.document_number}</div>}
                  {d.expires_at && <div>Expires {d.expires_at}</div>}
                  {d.file_name && <div className="truncate">{d.file_name} {d.file_size_bytes ? `· ${formatBytes(d.file_size_bytes)}` : ""}</div>}
                </div>
                {d.tags && d.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {d.tags.map(t => (
                      <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-1 mt-auto pt-3 border-t">
                  {d.has_file && (
                    <Button variant="outline" size="sm" onClick={() => viewDoc(d)} data-testid={`button-view-${d.id}`}>
                      <Eye className="w-3 h-3 mr-1" /> View
                    </Button>
                  )}
                  {canEdit && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => { setShareDoc(d); setShareOpen(true); }} data-testid={`button-share-${d.id}`}>
                        <Share2 className="w-3 h-3 mr-1" /> Share
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEdit(d)} data-testid={`button-edit-${d.id}`}>
                        <Pencil className="w-3 h-3 mr-1" /> Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (window.confirm(`Delete "${d.title}"? This can be restored from Trash.`)) {
                            deleteMutation.mutate(d.id);
                          }
                        }}
                        data-testid={`button-delete-${d.id}`}
                      >
                        <Trash2 className="w-3 h-3 text-red-600" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Upload / edit dialog ─────────────────────────────────────────── */}
      <Dialog open={showEditor} onOpenChange={(o) => !o && resetForm()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit document" : "Upload document"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the metadata or replace the file."
                : "Store a company-owned document — COI, license, cert, W-9, or any form Titan sends out."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title" value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Certificate of Insurance 2026"
                data-testid="input-title"
              />
            </div>
            <div>
              <Label htmlFor="description">Notes / description</Label>
              <Textarea
                id="description" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What this is, when to use it, who it's for…"
                rows={3}
                data-testid="input-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="issuer">Issuer</Label>
                <Input
                  id="issuer" value={form.issuer}
                  onChange={(e) => setForm({ ...form, issuer: e.target.value })}
                  placeholder="State Farm, SC LLR, IICRC…"
                  data-testid="input-issuer"
                />
              </div>
              <div>
                <Label htmlFor="document_number">Number</Label>
                <Input
                  id="document_number" value={form.document_number}
                  onChange={(e) => setForm({ ...form, document_number: e.target.value })}
                  placeholder="Policy #, license #, cert #"
                  data-testid="input-number"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="issued_at">Issued</Label>
                <Input
                  id="issued_at" type="date" value={form.issued_at}
                  onChange={(e) => setForm({ ...form, issued_at: e.target.value })}
                  data-testid="input-issued"
                />
              </div>
              <div>
                <Label htmlFor="expires_at">Expires</Label>
                <Input
                  id="expires_at" type="date" value={form.expires_at}
                  onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                  data-testid="input-expires"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Input
                id="tags" value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="insurance, coi, general-liability"
                data-testid="input-tags"
              />
            </div>
            <div>
              <Label htmlFor="file">
                {editing ? "Replace file (optional)" : "File"}
              </Label>
              <Input
                id="file" type="file"
                ref={fileInputRef}
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setFile(f);
                  // If Title is empty, auto-fill from the file name (without extension).
                  // Users usually pick a file first and expect the title to be filled in.
                  if (f && !form.title.trim()) {
                    const base = f.name.replace(/\.[^.]+$/, "").replace(/[._-]+/g, " ").trim();
                    if (base) setForm(prev => ({ ...prev, title: base }));
                  }
                }}
                data-testid="input-file"
              />
              {file && (
                <div className="text-xs text-muted-foreground mt-1">
                  {file.name} · {formatBytes(file.size)}
                </div>
              )}
              {editing && !file && editing.file_name && (
                <div className="text-xs text-muted-foreground mt-1">
                  Current: {editing.file_name} · {formatBytes(editing.file_size_bytes)}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm} data-testid="button-cancel">Cancel</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!form.title.trim() || saveMutation.isPending}
              data-testid="button-save"
            >
              {saveMutation.isPending ? "Saving…" : editing ? "Save" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Share dialog ──────────────────────────────────────────────────── */}
      {shareDoc && (
        <ShareDialog
          open={shareOpen}
          onClose={() => { setShareOpen(false); setShareDoc(null); }}
          doc={shareDoc}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ShareDialog — its own component so its state is scoped and cleared per open.
function ShareDialog({ open, onClose, doc }: { open: boolean; onClose: () => void; doc: Doc }) {
  const { toast } = useToast();
  const [recipient, setRecipient] = useState({ email: "", name: "", note: "", days: 30 });
  const [lastResult, setLastResult] = useState<{ share_url: string; email_sent: boolean; expires_at: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: sharesData, refetch } = useQuery<{ shares: Share[] }>({
    queryKey: [`/api/company-documents/${doc.id}/shares`],
    queryFn: async () => (await apiRequest(`/api/company-documents/${doc.id}/shares`)).json(),
    enabled: open,
  });

  const shareMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest(`/api/company-documents/${doc.id}/share`, {
        method: "POST",
        body: JSON.stringify({
          recipient_email: recipient.email || null,
          recipient_name: recipient.name || null,
          note: recipient.note || null,
          expires_in_days: recipient.days,
        }),
      });
      return r.json();
    },
    onSuccess: (data) => {
      setLastResult({ share_url: data.share_url, email_sent: data.email_sent, expires_at: data.expires_at });
      refetch();
      toast({
        title: data.email_sent ? "Shared and emailed" : "Share link created",
        description: data.email_sent ? `Sent to ${recipient.email}` : "Copy the link below.",
      });
      setRecipient({ email: "", name: "", note: "", days: 30 });
    },
    onError: (e: any) => toast({ title: "Share failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest(`/api/company-doc-shares/${id}`, { method: "DELETE" });
      return r.json();
    },
    onSuccess: () => { refetch(); toast({ title: "Link revoked" }); },
  });

  function copyLink(url: string) {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const activeShares = sharesData?.shares?.filter(s => s.active) || [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share "{doc.title}"</DialogTitle>
          <DialogDescription>
            Create a time-limited public link. Optionally email it directly to a recipient. Links expire automatically and can be revoked anytime.
          </DialogDescription>
        </DialogHeader>

        {/* New share form */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="share-email">Recipient email (optional)</Label>
              <Input
                id="share-email" type="email" value={recipient.email}
                onChange={(e) => setRecipient({ ...recipient, email: e.target.value })}
                placeholder="adjuster@carrier.com"
                data-testid="input-share-email"
              />
            </div>
            <div>
              <Label htmlFor="share-name">Recipient name</Label>
              <Input
                id="share-name" value={recipient.name}
                onChange={(e) => setRecipient({ ...recipient, name: e.target.value })}
                placeholder="Jane Adjuster"
                data-testid="input-share-name"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="share-note">Personal note (optional)</Label>
            <Textarea
              id="share-note" value={recipient.note}
              onChange={(e) => setRecipient({ ...recipient, note: e.target.value })}
              placeholder="Attached per your request…"
              rows={2}
              data-testid="input-share-note"
            />
          </div>
          <div>
            <Label htmlFor="share-days">Link expires in (days)</Label>
            <Input
              id="share-days" type="number" min={1} max={365} value={recipient.days}
              onChange={(e) => setRecipient({ ...recipient, days: Number(e.target.value) || 30 })}
              className="w-32"
              data-testid="input-share-days"
            />
          </div>
          <Button
            onClick={() => shareMutation.mutate()}
            disabled={shareMutation.isPending}
            data-testid="button-create-share"
          >
            <Share2 className="w-4 h-4 mr-2" />
            {recipient.email ? "Send & create link" : "Create link"}
          </Button>
        </div>

        {/* Just-created link */}
        {lastResult && (
          <div className="p-3 rounded-md bg-muted flex items-center gap-2">
            <Input readOnly value={lastResult.share_url} className="text-xs" data-testid="input-last-link" />
            <Button variant="outline" size="sm" onClick={() => copyLink(lastResult.share_url)} data-testid="button-copy-last">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        )}

        {/* Active shares */}
        {activeShares.length > 0 && (
          <>
            <Separator />
            <div>
              <div className="text-sm font-medium mb-2">Active links</div>
              <div className="space-y-2">
                {activeShares.map(s => (
                  <div key={s.id} className="p-2 border rounded-md text-xs space-y-1" data-testid={`row-share-${s.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate flex-1">
                        {s.recipient_email || <span className="text-muted-foreground">No recipient</span>}
                        {s.recipient_name && <span className="text-muted-foreground"> · {s.recipient_name}</span>}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => copyLink(s.share_url)} data-testid={`button-copy-${s.id}`}>
                          <Copy className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => window.open(s.share_url, "_blank")} data-testid={`button-open-${s.id}`}>
                          <ExternalLink className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => revokeMutation.mutate(s.id)} data-testid={`button-revoke-${s.id}`}>
                          <X className="w-3 h-3 text-red-600" />
                        </Button>
                      </div>
                    </div>
                    <div className="text-muted-foreground">
                      Expires {new Date(s.expires_at).toLocaleDateString()} · Viewed {s.view_count} time{s.view_count === 1 ? "" : "s"}
                      {s.last_viewed_at && ` · last ${new Date(s.last_viewed_at).toLocaleDateString()}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-close-share">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
