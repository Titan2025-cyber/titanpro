/**
 * Assistant.tsx — Titan Pro's ChatGPT-style AI assistant.
 *
 * Full-page /assistant route. Left rail lists past conversations, right pane
 * is the active thread. Uses SSE to stream Claude's response token-by-token.
 * Tool calls appear inline as cards; DRAFT tool cards have a Confirm button
 * that hits /api/assistant/confirm-draft to actually commit the write.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { buildAuthHeaders } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sparkles, Send, Plus, Trash2, MessageSquare, AlertCircle,
  Wrench, CheckCircle2, Copy, ChevronRight, Loader2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

// ── Types ────────────────────────────────────────────────────────────────────
type Conv = { id: number; title: string; created_at: string; updated_at: string };
type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: any }
  | { type: "tool_result"; tool_use_id: string; result: any };
type Msg = { id: number; role: "user" | "assistant" | "tool"; content: Block[] | string; created_at: string };

// ── Component ────────────────────────────────────────────────────────────────
export default function Assistant() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamTools, setStreamTools] = useState<Array<{ id: string; name: string; input: any; result?: any }>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Load status + conversations on mount ───────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/assistant/status", { headers: buildAuthHeaders("/api/assistant/status") });
        const j = await r.json();
        setAvailable(!!j.available);
      } catch { setAvailable(false); }
      await refreshConversations();
    })();
  }, []);

  async function refreshConversations() {
    try {
      const r = await fetch("/api/assistant/conversations", { headers: buildAuthHeaders("/api/assistant/conversations") });
      const j = await r.json();
      setConversations(j.conversations || []);
      if (!activeId && j.conversations?.[0]) {
        openConversation(j.conversations[0].id);
      }
    } catch (e: any) {
      console.error(e);
    }
  }

  async function openConversation(id: number) {
    setActiveId(id);
    setMessages([]);
    setStreamText("");
    setStreamTools([]);
    try {
      const r = await fetch(`/api/assistant/conversations/${id}`, {
        headers: buildAuthHeaders(`/api/assistant/conversations/${id}`),
      });
      const j = await r.json();
      setMessages(j.messages || []);
    } catch (e: any) {
      toast({ title: "Failed to load conversation", description: e?.message, variant: "destructive" });
    }
  }

  async function newConversation() {
    try {
      const r = await fetch("/api/assistant/conversations", {
        method: "POST",
        headers: { ...buildAuthHeaders("/api/assistant/conversations"), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      await refreshConversations();
      openConversation(j.id);
    } catch (e: any) {
      toast({ title: "Failed to create conversation", description: e?.message, variant: "destructive" });
    }
  }

  async function deleteConversation(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    try {
      await fetch(`/api/assistant/conversations/${id}`, {
        method: "DELETE",
        headers: buildAuthHeaders(`/api/assistant/conversations/${id}`),
      });
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
      await refreshConversations();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  }

  // ── Send + stream ──────────────────────────────────────────────────────────
  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;
    let convId = activeId;
    if (!convId) {
      // Create a fresh conversation on first send
      const r = await fetch("/api/assistant/conversations", {
        method: "POST",
        headers: { ...buildAuthHeaders("/api/assistant/conversations"), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      convId = j.id;
      setActiveId(convId);
      await refreshConversations();
    }

    // Optimistically add the user turn
    const userMsg: Msg = {
      id: Date.now(),
      role: "user",
      content: [{ type: "text", text }],
      created_at: new Date().toISOString(),
    };
    setMessages(m => [...m, userMsg]);
    setInput("");
    setStreaming(true);
    setStreamText("");
    setStreamTools([]);

    try {
      const res = await fetch(`/api/assistant/conversations/${convId}/messages`, {
        method: "POST",
        headers: { ...buildAuthHeaders(`/api/assistant/conversations/${convId}/messages`), "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok || !res.body) {
        const err = await res.text();
        throw new Error(err || "Stream failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accText = "";
      let accTools: Array<{ id: string; name: string; input: any; result?: any }> = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() || "";
        for (const evt of events) {
          const lines = evt.split("\n");
          const eventLine = lines.find(l => l.startsWith("event:"))?.slice(6).trim();
          const dataLine = lines.find(l => l.startsWith("data:"))?.slice(5).trim();
          if (!eventLine || !dataLine) continue;
          try {
            const data = JSON.parse(dataLine);
            if (eventLine === "delta") {
              accText += data.text || "";
              setStreamText(accText);
            } else if (eventLine === "tool_start") {
              accTools = [...accTools, { id: data.id, name: data.name, input: data.input }];
              setStreamTools(accTools);
            } else if (eventLine === "tool_result") {
              accTools = accTools.map(t => t.id === data.id ? { ...t, result: data.result } : t);
              setStreamTools(accTools);
            } else if (eventLine === "done") {
              // Server has finished — persist happened, stop reading.
              // Break out of the outer while loop by cancelling the reader.
              try { reader.cancel(); } catch {}
              break;
            } else if (eventLine === "error") {
              throw new Error(data.message || "Assistant error");
            }
          } catch (e) {
            console.warn("SSE parse", e);
          }
        }
      }
      // Reload the conversation to get the persisted assistant message.
      // Wrapped in try so a failed reload never leaves the input stuck.
      try {
        await openConversation(convId);
        await refreshConversations();
      } catch (reloadErr) {
        console.warn("reload after send failed", reloadErr);
      }
    } catch (e: any) {
      toast({ title: "Assistant error", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setStreaming(false);
      setStreamText("");
      setStreamTools([]);
    }
  }

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamText, streamTools]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-4rem)] bg-background">
      {/* Left rail — conversation list */}
      <div className="w-72 border-r bg-muted/30 flex flex-col">
        <div className="p-3 border-b">
          <Button onClick={newConversation} className="w-full" size="sm" data-testid="button-new-assistant-conv">
            <Plus className="w-4 h-4 mr-2" /> New conversation
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {conversations.length === 0 && (
              <div className="text-xs text-muted-foreground p-3">No conversations yet.</div>
            )}
            {conversations.map(c => (
              // Use a div as the row so we can nest a real button for delete.
              // Nested <button> inside <button> is invalid HTML and breaks the
              // inner click on some browsers — that was silently killing delete.
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => openConversation(c.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openConversation(c.id); } }}
                className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 hover:bg-accent transition cursor-pointer ${
                  activeId === c.id ? "bg-accent" : ""
                }`}
                data-testid={`button-open-conv-${c.id}`}
              >
                <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
                <span className="flex-1 truncate">{c.title}</span>
                <button
                  type="button"
                  onClick={(e) => deleteConversation(c.id, e)}
                  className="p-1 rounded hover:bg-destructive/10 transition shrink-0"
                  aria-label="Delete conversation"
                  title="Delete conversation"
                  data-testid={`button-delete-conv-${c.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Main pane */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <div>
              <div className="font-semibold text-sm">Titan Assistant</div>
              <div className="text-xs text-muted-foreground">
                {available === null ? "checking…" : available ? "Claude Sonnet 4.5 · connected" : "Not configured — see below"}
              </div>
            </div>
          </div>
        </div>

        {/* Not configured banner */}
        {available === false && (
          <div className="m-4 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-semibold text-amber-900 dark:text-amber-200">Assistant not configured</div>
                <div className="text-amber-800 dark:text-amber-300 mt-1">
                  An owner needs to add <code className="bg-amber-100 dark:bg-amber-900/60 px-1 rounded">ANTHROPIC_API_KEY</code> to Railway environment variables and redeploy. Once added, the assistant will light up automatically.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {messages.length === 0 && !streaming && available && (
            <EmptyState onExample={(t) => setInput(t)} />
          )}
          {messages.map(m => <MessageBubble key={m.id} msg={m} />)}
          {streaming && (
            <StreamingBubble text={streamText} tools={streamTools} />
          )}
        </div>

        {/* Composer */}
        <div className="border-t p-4">
          <div className="max-w-4xl mx-auto flex gap-2">
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={available ? "Ask about IICRC standards, jobs, drying, estimates…" : "Assistant is not configured yet"}
              disabled={!available || streaming}
              className="flex-1"
              data-testid="input-assistant"
            />
            <Button
              onClick={sendMessage}
              disabled={!available || streaming || !input.trim()}
              data-testid="button-send-assistant"
            >
              {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <div className="max-w-4xl mx-auto text-[10px] text-muted-foreground mt-2 px-1">
            The assistant can look up jobs, notes, and drying records, and can draft notes/emails/stage changes — you confirm before anything saves.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Empty state with example prompts ─────────────────────────────────────────
function EmptyState({ onExample }: { onExample: (t: string) => void }) {
  const examples = [
    "What does IICRC S500 say about Category 2 drying goals?",
    "List all active jobs in WIP",
    "Find notes mentioning ceiling stain",
    "Draft a note for job 42: 'Homeowner confirmed weekend access'",
    "How do I calculate AHAM dehu capacity for a Class 3 loss?",
  ];
  return (
    <div className="max-w-2xl mx-auto text-center pt-10">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
        <Sparkles className="w-7 h-7 text-primary" />
      </div>
      <h2 className="text-2xl font-semibold mb-2">Titan Assistant</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Restoration-industry knowledge, your job data, and draft-write tools — all in one place.
      </p>
      <div className="grid gap-2 text-left">
        {examples.map(ex => (
          <button
            key={ex}
            onClick={() => onExample(ex)}
            className="border rounded-lg px-4 py-3 text-sm hover:bg-accent transition text-left flex items-center gap-2"
          >
            <ChevronRight className="w-4 h-4 opacity-40" />
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Rendered message ─────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  const blocks = Array.isArray(msg.content) ? msg.content : [];
  const textBlocks = blocks.filter(b => (b as any).type === "text") as Array<{ type: "text"; text: string }>;
  const toolPairs = pairToolUses(blocks);

  return (
    <div className={`max-w-4xl mx-auto flex gap-4 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${
        isUser ? "bg-primary text-primary-foreground" : "bg-muted"
      }`}>
        {isUser ? "You" : <Sparkles className="w-4 h-4" />}
      </div>
      <div className={`flex-1 min-w-0 space-y-3 ${isUser ? "text-right" : ""}`}>
        {textBlocks.map((b, i) => (
          <div
            key={i}
            className={`inline-block max-w-full text-sm whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 ${
              isUser ? "bg-primary text-primary-foreground text-left" : "bg-muted"
            }`}
          >
            {b.text}
          </div>
        ))}
        {toolPairs.map(({ use, result }, i) => (
          <ToolCard key={use.id + i} use={use} result={result} />
        ))}
      </div>
    </div>
  );
}

function StreamingBubble({
  text,
  tools,
}: {
  text: string;
  tools: Array<{ id: string; name: string; input: any; result?: any }>;
}) {
  return (
    <div className="max-w-4xl mx-auto flex gap-4">
      <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-muted">
        <Sparkles className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0 space-y-3">
        {tools.map(t => (
          <ToolCard key={t.id} use={{ id: t.id, name: t.name, input: t.input, type: "tool_use" }} result={t.result} />
        ))}
        {text && (
          <div className="bg-muted rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words">
            {text}<span className="inline-block w-1.5 h-4 bg-current opacity-40 ml-0.5 animate-pulse" />
          </div>
        )}
        {!text && tools.length === 0 && (
          <div className="text-xs text-muted-foreground">Thinking…</div>
        )}
      </div>
    </div>
  );
}

function pairToolUses(blocks: Block[]) {
  const pairs: Array<{ use: any; result: any }> = [];
  for (const b of blocks) {
    if ((b as any).type === "tool_use") {
      const use = b as any;
      const result = blocks.find(x => (x as any).type === "tool_result" && (x as any).tool_use_id === use.id);
      pairs.push({ use, result: (result as any)?.result });
    }
  }
  return pairs;
}

// ── Tool card (read tools show data; draft tools show a confirm button) ─────
function ToolCard({ use, result }: { use: any; result: any }) {
  const isDraft = result && typeof result === "object" && result.__draft;
  const isError = result && typeof result === "object" && (result.error || result.__error);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function confirm() {
    setConfirming(true);
    try {
      const r = await fetch("/api/assistant/confirm-draft", {
        method: "POST",
        headers: { ...buildAuthHeaders("/api/assistant/confirm-draft"), "Content-Type": "application/json" },
        body: JSON.stringify({ kind: result.kind, input: result.input }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Confirm failed");
      setConfirmed(true);
      toast({ title: "Applied", description: labelFor(result.kind) });
    } catch (e: any) {
      toast({ title: "Confirm failed", description: e?.message, variant: "destructive" });
    } finally {
      setConfirming(false);
    }
  }

  function copyEmailBody() {
    const body = result?.input?.body || "";
    const subject = result?.input?.subject || "";
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
    toast({ title: "Copied", description: "Email content copied to clipboard." });
  }

  // ── DRAFT tool cards: user must confirm ────────────────────────────────────
  if (isDraft) {
    const kind = result.kind;
    return (
      <div className="border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 rounded-xl overflow-hidden">
        <div className="px-3 py-2 border-b border-amber-200 dark:border-amber-900 flex items-center gap-2 text-xs">
          <Wrench className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
          <span className="font-medium text-amber-900 dark:text-amber-200">Draft — {labelFor(kind)}</span>
          {confirmed && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 ml-auto" />}
        </div>
        <div className="p-3 text-sm space-y-2">
          {kind === "draft_note" && (
            <>
              <div className="text-xs text-muted-foreground">Job #{result.input.job_id}</div>
              <div className="whitespace-pre-wrap">{result.input.body}</div>
            </>
          )}
          {kind === "propose_stage_change" && (
            <>
              <div>Move job <b>#{result.input.job_id}</b> to <b>{result.input.new_stage}</b></div>
              {result.input.reason && <div className="text-xs text-muted-foreground">Reason: {result.input.reason}</div>}
            </>
          )}
          {kind === "draft_email" && (
            <>
              {result.input.to && <div className="text-xs"><span className="text-muted-foreground">To:</span> {result.input.to}</div>}
              <div className="text-xs"><span className="text-muted-foreground">Subject:</span> <b>{result.input.subject}</b></div>
              <div className="whitespace-pre-wrap border-t pt-2 mt-2">{result.input.body}</div>
            </>
          )}
          <div className="flex gap-2 pt-2">
            {!confirmed && kind !== "draft_email" && (
              <Button size="sm" onClick={confirm} disabled={confirming} data-testid={`button-confirm-${kind}`}>
                {confirming ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                Confirm & Apply
              </Button>
            )}
            {kind === "draft_email" && !confirmed && (
              <>
                <Button size="sm" variant="outline" onClick={copyEmailBody}>
                  <Copy className="w-3 h-3 mr-1" /> Copy
                </Button>
                {result.input.to && (
                  <a
                    href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(result.input.to)}&su=${encodeURIComponent(result.input.subject)}&body=${encodeURIComponent(result.input.body)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Button size="sm">Open in Gmail</Button>
                  </a>
                )}
              </>
            )}
            {confirmed && <span className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Applied</span>}
          </div>
        </div>
      </div>
    );
  }

  // ── READ tool cards: show a small summary ──────────────────────────────────
  return (
    <details className="border rounded-xl overflow-hidden text-xs">
      <summary className="px-3 py-2 cursor-pointer bg-muted/40 flex items-center gap-2">
        <Wrench className="w-3 h-3" />
        <span className="font-medium">{labelFor(use.name)}</span>
        <span className="text-muted-foreground truncate">
          {summarizeInput(use.name, use.input)}
        </span>
        {isError ? (
          <span className="ml-auto text-destructive">error</span>
        ) : (
          <span className="ml-auto text-muted-foreground">{summarizeResult(use.name, result)}</span>
        )}
      </summary>
      <pre className="p-3 bg-muted/30 overflow-x-auto max-h-48 text-[10px]">
        {JSON.stringify(result, null, 2)}
      </pre>
    </details>
  );
}

function labelFor(name: string): string {
  switch (name) {
    case "lookup_job": return "Look up job";
    case "list_active_jobs": return "List active jobs";
    case "search_notes": return "Search notes";
    case "get_job_notes": return "Get job notes";
    case "get_drying_records": return "Get drying records";
    case "draft_note": return "Add note";
    case "propose_stage_change": return "Change stage";
    case "draft_email": return "Draft email";
    default: return name;
  }
}
function summarizeInput(name: string, input: any): string {
  if (!input) return "";
  if (input.query) return `"${input.query}"`;
  if (input.job_id) return `job #${input.job_id}`;
  if (input.phase) return `phase = ${input.phase}`;
  if (input.subject) return `"${input.subject}"`;
  return JSON.stringify(input).slice(0, 60);
}
function summarizeResult(_name: string, result: any): string {
  if (!result) return "";
  if (result.error) return "no result";
  if (result.count !== undefined) return `${result.count} result${result.count === 1 ? "" : "s"}`;
  if (result.job_number) return result.job_number;
  return "ok";
}
