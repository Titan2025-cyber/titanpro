/**
 * AssistantDrawer.tsx — Global slide-out chat drawer.
 *
 * Opens with ⌘J / Ctrl-J from anywhere in the app. Uses the same backend as
 * /assistant but is stateless (starts a fresh conversation each open unless
 * one already exists in memory). For deep conversations the user clicks
 * "Open full page" to jump to /assistant.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { buildAuthHeaders } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Send, X, Maximize2, Loader2, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Msg = {
  role: "user" | "assistant";
  text: string;
  tools?: Array<{ id: string; name: string; input: any; result?: any }>;
};

export default function AssistantDrawer() {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [convId, setConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [, setLocation] = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Keyboard shortcut: ⌘J / Ctrl-J (⌘K is taken by CommandPalette) ────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // ── Check availability on first open ───────────────────────────────────────
  useEffect(() => {
    if (open && available === null) {
      fetch("/api/assistant/status", { headers: buildAuthHeaders("/api/assistant/status") })
        .then(r => r.json()).then(j => setAvailable(!!j.available))
        .catch(() => setAvailable(false));
    }
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open, available]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamText]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    let cid = convId;
    if (!cid) {
      const r = await fetch("/api/assistant/conversations", {
        method: "POST",
        headers: { ...buildAuthHeaders("/api/assistant/conversations"), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      cid = j.id;
      setConvId(cid);
    }
    setMessages(m => [...m, { role: "user", text }]);
    setInput("");
    setStreaming(true);
    setStreamText("");

    try {
      const res = await fetch(`/api/assistant/conversations/${cid}/messages`, {
        method: "POST",
        headers: { ...buildAuthHeaders(`/api/assistant/conversations/${cid}/messages`), "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      let tools: Array<{ id: string; name: string; input: any; result?: any }> = [];
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
          const data = JSON.parse(dataLine);
          if (eventLine === "delta") {
            acc += data.text || "";
            setStreamText(acc);
          } else if (eventLine === "tool_start") {
            tools = [...tools, { id: data.id, name: data.name, input: data.input }];
          } else if (eventLine === "tool_result") {
            tools = tools.map(t => t.id === data.id ? { ...t, result: data.result } : t);
          } else if (eventLine === "done") {
            try { reader.cancel(); } catch {}
            break;
          } else if (eventLine === "error") {
            throw new Error(data.message || "Assistant error");
          }
        }
      }
      setMessages(m => [...m, { role: "assistant", text: acc, tools }]);
    } catch (e: any) {
      toast({ title: "Assistant error", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setStreaming(false);
      setStreamText("");
    }
  }

  function openFullPage() {
    setOpen(false);
    setLocation("/assistant");
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 h-11 w-11 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition flex items-center justify-center"
        title="Titan Assistant (⌘J)"
        aria-label="Open Titan Assistant"
        data-testid="button-open-assistant-drawer"
      >
        <Sparkles className="w-5 h-5" />
      </button>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={() => setOpen(false)}
      />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[440px] bg-background border-l shadow-2xl flex flex-col">
        {/* Header */}
        <div className="border-b px-4 py-3 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <div className="flex-1">
            <div className="font-semibold text-sm">Titan Assistant</div>
            <div className="text-[11px] text-muted-foreground">
              {available === false ? "not configured" : "Claude Sonnet 4.5 · ⌘J to toggle"}
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={openFullPage} title="Open full page">
            <Maximize2 className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setOpen(false)}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Body */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {available === false && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-xs flex gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <div>
                <div className="font-semibold text-amber-900 dark:text-amber-200">Not configured</div>
                <div className="text-amber-800 dark:text-amber-300">Add <code>ANTHROPIC_API_KEY</code> to Railway env vars.</div>
              </div>
            </div>
          )}
          {messages.length === 0 && available && (
            <div className="text-xs text-muted-foreground text-center py-8">
              Ask about IICRC standards, look up a job, draft a note, or anything restoration-related.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`text-sm ${m.role === "user" ? "text-right" : ""}`}>
              <div className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 whitespace-pre-wrap break-words ${
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}>
                {m.text}
              </div>
              {m.tools && m.tools.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {m.tools.map(t => (
                    <div key={t.id} className="text-[10px] text-muted-foreground text-left pl-1">
                      🛠 {t.name} — {t.result?.count !== undefined ? `${t.result.count} results` : t.result?.error ? "error" : "ok"}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {streaming && (
            <div className="text-sm">
              <div className="inline-block max-w-[85%] rounded-2xl px-3 py-2 bg-muted whitespace-pre-wrap break-words">
                {streamText || <span className="text-muted-foreground">Thinking…</span>}
                {streamText && <span className="inline-block w-1 h-3 bg-current opacity-40 ml-0.5 animate-pulse" />}
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t p-3">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={available ? "Ask anything…" : "Not configured"}
              disabled={!available || streaming}
              className="flex-1"
              data-testid="input-assistant-drawer"
            />
            <Button onClick={send} disabled={!available || streaming || !input.trim()}>
              {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <div className="text-[10px] text-muted-foreground mt-2 flex items-center justify-between">
            <span>Reads jobs, notes, drying. Drafts require confirm.</span>
            <button onClick={openFullPage} className="hover:underline">Full page →</button>
          </div>
        </div>
      </div>
    </>
  );
}
