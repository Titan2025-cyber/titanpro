/**
 * routes_assistant.ts — Titan Pro conversational AI assistant.
 *
 * A ChatGPT-style chat sitting inside the app, powered by Claude Sonnet 4.5
 * via the Anthropic SDK. Uses tool calling so the model can look up jobs,
 * search notes, and propose draft writes (which the user confirms in the UI).
 *
 * Endpoints:
 *   GET  /api/assistant/status                — has ANTHROPIC_API_KEY?
 *   GET  /api/assistant/conversations         — list current user's threads
 *   POST /api/assistant/conversations         — create a new thread
 *   GET  /api/assistant/conversations/:id     — full thread + messages
 *   PATCH /api/assistant/conversations/:id    — rename
 *   DELETE /api/assistant/conversations/:id   — soft delete
 *   POST /api/assistant/conversations/:id/messages — send + stream response (SSE)
 *
 * Auth: all endpoints require a logged-in staff session. Each conversation
 * is scoped to its owner (user_id) — no cross-user reads.
 */
import type { Express, Request, Response } from "express";
import type Database from "better-sqlite3";
import Anthropic from "@anthropic-ai/sdk";
import { makeAuthMiddleware } from "./routes_auth";

// ─────────────────────────────────────────────────────────────────────────────
// Model + system prompt
// ─────────────────────────────────────────────────────────────────────────────
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

function llmAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const SYSTEM_PROMPT = `You are Titan Assistant, an AI helper inside Titan Pro — the operations platform for Titan Restoration LLC, a property restoration and mitigation contractor based in Red Bank, South Carolina.

# Who you help
You help Titan's staff — technicians, project managers, office managers, the general manager, and the owner (Cody Brantley). Each user has a role that determines what data they can see and what they can do.

# Domain knowledge you bring
You have working knowledge of:
- IICRC S500 (Water Damage Restoration) — categories 1/2/3, drying classes 1-4, psychrometrics, dehumidifier sizing, AFD placement.
- IICRC S520 (Mold Remediation) — containment, PPE, remediation levels, clearance testing.
- IICRC S540 (Trauma & Crime Scene Cleanup) basics.
- Xactimate line items and pricing logic (RCV/ACV, O&P, depreciation, supplements).
- Insurance claim workflow — FNOL, adjuster interaction, scope disputes, umpire process.
- Fire/smoke restoration basics — soot chemistry, thermal fogging, ozone vs hydroxyl.
- OSHA safety basics for restoration work (respiratory protection, confined spaces, lead RRP, asbestos AHERA).

Always cite the standard when you reference one (e.g. "per IICRC S500 §12.2.4"). If asked about something outside restoration/construction/insurance, help but note it's outside your specialty.

# How you use tools
When asked about a specific job, drying record, estimate, invoice, or piece of Titan data, use the read tools. Never guess a job number, address, or dollar amount — look it up.

When asked to write something (a note, an estimate line, an email, a stage change), use the draft tools. Drafts appear as review cards for the user to approve. NEVER assume something was saved just because you drafted it.

# How you write
- Concise. This is a work tool, not a chat toy. Bullet points and short paragraphs.
- Cite your sources — IICRC section, job number, note date. If you don't have a source, say so.
- Never fabricate data. If a lookup fails, tell the user honestly rather than inventing.
- Match Cody's directness: senior-level, technical when needed, no fluff.

# Titan-specific context
- Two divisions: mitigation (water/fire/mold) and reconstruction (rebuild). Some jobs are "both".
- Pipeline stages: pending_sale → pre_production → wip → invoice_pending → accounts_receivable → complete.
- Titan uses DocuSketch for estimates. Xactimate is the industry standard they price against.
- Titan Pro (this app) is Cody's own operations software, also being commercialized separately.

Today's date: ${new Date().toISOString().slice(0, 10)}.`;

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions — read tools return data, draft tools return a preview
// that renders as a review card in the UI. Nothing writes without the user
// clicking Confirm on that card (handled on the client side; server never
// commits a draft tool's output automatically).
// ─────────────────────────────────────────────────────────────────────────────
const TOOLS: Anthropic.Tool[] = [
  {
    name: "lookup_job",
    description: "Look up one job by its job number (e.g. 'TP-2026-Augusta-0421') or numeric id. Returns core fields: address, status, phase, dates, assigned tech, insurance carrier, and totals.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Job number or numeric job id." },
      },
      required: ["query"],
    },
  },
  {
    name: "list_active_jobs",
    description: "List active (non-complete) jobs, optionally filtered by phase or assigned tech. Returns up to 25 rows.",
    input_schema: {
      type: "object",
      properties: {
        phase: { type: "string", description: "Optional pipeline phase filter: pending_sale, pre_production, wip, invoice_pending, accounts_receivable." },
        assigned_tech: { type: "string", description: "Optional tech name substring." },
      },
    },
  },
  {
    name: "search_notes",
    description: "Full-text search across all job notes. Use this when the user asks 'what did we say about X' or 'find the job where Y happened'.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text search." },
        limit: { type: "number", description: "Max results (default 10, max 25)." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_job_notes",
    description: "Get all notes for a specific job, most recent first.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "number", description: "Numeric job id." },
      },
      required: ["job_id"],
    },
  },
  {
    name: "get_drying_records",
    description: "Get drying records (daily equipment/moisture readings) for a specific job.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "number" },
      },
      required: ["job_id"],
    },
  },
  {
    name: "draft_note",
    description: "Draft a note to add to a job. Renders as a review card. The user clicks Confirm to actually save it. Do NOT tell the user the note has been saved — only that it's been drafted for their review.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "number" },
        body: { type: "string", description: "The note text." },
      },
      required: ["job_id", "body"],
    },
  },
  {
    name: "propose_stage_change",
    description: "Propose moving a job to a different pipeline stage. Renders as a review card. User confirms before it saves.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "number" },
        new_stage: { type: "string", description: "One of: pending_sale, pre_production, wip, invoice_pending, accounts_receivable, complete." },
        reason: { type: "string", description: "Short reason to display on the review card." },
      },
      required: ["job_id", "new_stage"],
    },
  },
  {
    name: "draft_email",
    description: "Draft an email (subject + body) for the user to review, edit, and send. Renders as a review card with a Copy button and, if a recipient is provided, an Open in Gmail button.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Optional recipient email address." },
        subject: { type: "string" },
        body: { type: "string", description: "Plain text or lightweight markdown. No HTML." },
      },
      required: ["subject", "body"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool execution — READ tools query SQLite and return JSON; DRAFT tools
// return a preview payload that the client renders as a review card.
// ─────────────────────────────────────────────────────────────────────────────
type ToolContext = { sqlite: Database.Database; userId: number; userRole: string };

async function runTool(name: string, input: any, ctx: ToolContext): Promise<any> {
  const { sqlite } = ctx;
  switch (name) {
    case "lookup_job": {
      const q = String(input.query || "").trim();
      if (!q) return { error: "Empty query" };
      const isNumeric = /^\d+$/.test(q);
      const job = isNumeric
        ? sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(Number(q))
        : sqlite.prepare("SELECT * FROM jobs WHERE job_number = ? LIMIT 1").get(q);
      if (!job) return { error: `No job matching '${q}'` };
      return sanitizeJob(job);
    }
    case "list_active_jobs": {
      const phase = String(input.phase || "").trim();
      const tech = String(input.assigned_tech || "").trim();
      let sql = "SELECT id, job_number, address, status, progress_stage, assigned_tech, insurance_carrier, loss_type, created_at FROM jobs WHERE (progress_stage IS NULL OR progress_stage != 'complete')";
      const params: any[] = [];
      if (phase) { sql += " AND progress_stage = ?"; params.push(phase); }
      if (tech) { sql += " AND assigned_tech LIKE ?"; params.push(`%${tech}%`); }
      sql += " ORDER BY id DESC LIMIT 25";
      const rows = sqlite.prepare(sql).all(...params);
      return { count: rows.length, jobs: rows };
    }
    case "search_notes": {
      const q = String(input.query || "").trim();
      if (!q) return { error: "Empty query" };
      const limit = Math.min(Number(input.limit) || 10, 25);
      const rows = sqlite.prepare(`
        SELECT n.id, n.job_id, n.body, n.author, n.created_at, j.job_number
        FROM job_notes n LEFT JOIN jobs j ON j.id = n.job_id
        WHERE n.body LIKE ? AND (n.is_public = 1 OR n.is_public IS NULL)
        ORDER BY n.created_at DESC LIMIT ?
      `).all(`%${q}%`, limit);
      return { count: rows.length, notes: rows };
    }
    case "get_job_notes": {
      const jobId = Number(input.job_id);
      const rows = sqlite.prepare(`
        SELECT id, body, author, created_at
        FROM job_notes WHERE job_id = ? AND (is_public = 1 OR is_public IS NULL)
        ORDER BY created_at DESC LIMIT 50
      `).all(jobId);
      return { job_id: jobId, count: rows.length, notes: rows };
    }
    case "get_drying_records": {
      const jobId = Number(input.job_id);
      const rows = sqlite.prepare(`
        SELECT id, reading_date, reading_time, tech_name, day_number,
               water_category, water_class, temp_f, rh_pct, gpp, dew_point_f,
               moisture_readings, equipment, affected_areas, observations,
               drying_goal_met, structural_drying_complete
        FROM drying_records WHERE job_id = ? ORDER BY reading_date DESC, id DESC LIMIT 100
      `).all(jobId);
      return { job_id: jobId, count: rows.length, records: rows };
    }
    case "draft_note":
    case "propose_stage_change":
    case "draft_email":
      // Draft tools return a preview payload. The UI renders it as a review
      // card. The user confirms → the client makes a separate write API call.
      // The SERVER NEVER writes anything as a side-effect of a tool call.
      return {
        __draft: true,
        kind: name,
        input,
      };
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function sanitizeJob(job: any) {
  // Strip large / sensitive fields, keep useful ones for the model.
  const {
    id, job_number, address, status, progress_stage, assigned_tech,
    insurance_carrier, claim_number, loss_type, division,
    sales_date, pre_production_date, wip_date, invoice_pending_date,
    invoice_sent_date, invoice_paid_date, created_at, contact_id,
  } = job;
  return {
    id, job_number, address, status, progress_stage, assigned_tech,
    insurance_carrier, claim_number, loss_type, division,
    sales_date, pre_production_date, wip_date, invoice_pending_date,
    invoice_sent_date, invoice_paid_date, created_at, contact_id,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB migration — conversations + messages tables
// ─────────────────────────────────────────────────────────────────────────────
function ensureSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS assistant_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT 'New conversation',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_conv_user ON assistant_conversations(user_id, deleted_at);
    CREATE TABLE IF NOT EXISTS assistant_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,                -- 'user' | 'assistant' | 'tool'
      content TEXT NOT NULL,             -- JSON: [{type:'text',text:...}, {type:'tool_use',...}]
      tool_use_id TEXT,                  -- when role='tool', the tool_use_id this responds to
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_msg_conv ON assistant_messages(conversation_id, id);
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
export function registerAssistantRoutes(app: Express, sqlite: Database.Database) {
  ensureSchema(sqlite);
  const { requireStaffAuth } = makeAuthMiddleware(sqlite);

  // Every route requires a logged-in staff session.
  const auth = requireStaffAuth;

  function getUser(req: Request): { id: number; role: string; name: string } | null {
    const e = (req as any).employee;
    if (!e) return null;
    return { id: e.id, role: e.role || "tech", name: e.name || "" };
  }

  // ── Status ────────────────────────────────────────────────────────────────
  app.get("/api/assistant/status", auth, (_req, res) => {
    res.json({ available: llmAvailable(), model: MODEL });
  });

  // ── List conversations ────────────────────────────────────────────────────
  app.get("/api/assistant/conversations", auth, (req, res) => {
    const u = getUser(req); if (!u) return res.status(401).json({ error: "auth" });
    const rows = sqlite.prepare(`
      SELECT id, title, created_at, updated_at
      FROM assistant_conversations
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT 100
    `).all(u.id);
    res.json({ conversations: rows });
  });

  // ── Create conversation ───────────────────────────────────────────────────
  app.post("/api/assistant/conversations", auth, (req, res) => {
    const u = getUser(req); if (!u) return res.status(401).json({ error: "auth" });
    const now = new Date().toISOString();
    const title = String(req.body?.title || "New conversation").slice(0, 200);
    const info = sqlite.prepare(`
      INSERT INTO assistant_conversations(user_id, title, created_at, updated_at)
      VALUES(?, ?, ?, ?)
    `).run(u.id, title, now, now);
    res.json({ id: Number(info.lastInsertRowid), title, created_at: now, updated_at: now });
  });

  // ── Get conversation with messages ────────────────────────────────────────
  app.get("/api/assistant/conversations/:id", auth, (req, res) => {
    const u = getUser(req); if (!u) return res.status(401).json({ error: "auth" });
    const id = Number(req.params.id);
    const conv: any = sqlite.prepare(`
      SELECT id, title, created_at, updated_at FROM assistant_conversations
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `).get(id, u.id);
    if (!conv) return res.status(404).json({ error: "Not found" });
    const messages = sqlite.prepare(`
      SELECT id, role, content, tool_use_id, created_at
      FROM assistant_messages WHERE conversation_id = ? ORDER BY id ASC
    `).all(id);
    // Parse content JSON for the client
    const parsed = messages.map((m: any) => ({
      ...m,
      content: safeParse(m.content),
    }));
    res.json({ ...conv, messages: parsed });
  });

  // ── Rename ────────────────────────────────────────────────────────────────
  app.patch("/api/assistant/conversations/:id", auth, (req, res) => {
    const u = getUser(req); if (!u) return res.status(401).json({ error: "auth" });
    const id = Number(req.params.id);
    const title = String(req.body?.title || "").slice(0, 200).trim();
    if (!title) return res.status(400).json({ error: "title required" });
    const info = sqlite.prepare(`
      UPDATE assistant_conversations SET title = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `).run(title, new Date().toISOString(), id, u.id);
    if (info.changes === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  });

  // ── Delete (soft) ─────────────────────────────────────────────────────────
  app.delete("/api/assistant/conversations/:id", auth, (req, res) => {
    const u = getUser(req); if (!u) return res.status(401).json({ error: "auth" });
    const id = Number(req.params.id);
    sqlite.prepare(`
      UPDATE assistant_conversations SET deleted_at = ?
      WHERE id = ? AND user_id = ?
    `).run(new Date().toISOString(), id, u.id);
    res.json({ ok: true });
  });

  // ── Send message + stream response (SSE) ──────────────────────────────────
  app.post("/api/assistant/conversations/:id/messages", auth, async (req, res) => {
    const u = getUser(req); if (!u) return res.status(401).json({ error: "auth" });
    if (!llmAvailable()) {
      return res.status(503).json({ error: "AI is not configured. An owner needs to set ANTHROPIC_API_KEY in Railway." });
    }
    const convId = Number(req.params.id);
    const conv: any = sqlite.prepare(`
      SELECT id FROM assistant_conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `).get(convId, u.id);
    if (!conv) return res.status(404).json({ error: "Not found" });

    const userText = String(req.body?.content || "").trim();
    if (!userText) return res.status(400).json({ error: "empty message" });

    // Persist user message
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO assistant_messages(conversation_id, role, content, created_at)
      VALUES(?, 'user', ?, ?)
    `).run(convId, JSON.stringify([{ type: "text", text: userText }]), now);

    // Load full history for the model
    const history = sqlite.prepare(`
      SELECT role, content FROM assistant_messages
      WHERE conversation_id = ? ORDER BY id ASC
    `).all(convId) as { role: string; content: string }[];

    // Set up SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const write = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    // Heartbeat so Railway's edge doesn't close the SSE connection during long turns.
    // Any bytes on the socket reset its idle timer; a comment line is ignored by EventSource.
    const heartbeat = setInterval(() => {
      try { res.write(": keep-alive\n\n"); } catch { /* connection closed */ }
    }, 15000);
    // Client abort cleanup
    let aborted = false;
    req.on("close", () => { aborted = true; clearInterval(heartbeat); });

    try {
      const client = new Anthropic();
      // Convert stored history into the API's message shape
      const messages = history.map(h => ({
        role: h.role === "tool" ? ("user" as const) : (h.role as "user" | "assistant"),
        content: safeParse(h.content) || h.content,
      })) as Anthropic.MessageParam[];

      // Agentic loop: keep calling until we get a stop_reason of end_turn
      // (i.e. the model is done, no more tool calls).
      const MAX_TURNS = 8;
      let assembledText = "";
      const toolUses: any[] = [];

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        if (aborted) break;
        // Stream every turn: text deltas are pushed to the client immediately
        // so long tool loops don't look like a hang. The final message object
        // (with tool_use blocks) is available after the stream ends.
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages,
        });
        // Forward text deltas as they arrive.
        stream.on("text", (delta: string) => {
          if (delta) {
            assembledText += delta;
            try { write("delta", { text: delta }); } catch { /* closed */ }
          }
        });
        const response = await stream.finalMessage();
        if (aborted) break;

        const contentBlocks = response.content;
        const toolBlocks = contentBlocks.filter((b: any) => b.type === "tool_use");

        // If no tool calls, we're done (text already streamed above)
        if (toolBlocks.length === 0) {
          break;
        }

        // Record the assistant turn (with tool_use blocks) into history
        messages.push({ role: "assistant", content: contentBlocks as any });

        // Execute each tool and stream tool cards to the client
        const toolResults: any[] = [];
        for (const tb of toolBlocks as any[]) {
          write("tool_start", { id: tb.id, name: tb.name, input: tb.input });
          try {
            const result = await runTool(tb.name, tb.input, { sqlite, userId: u.id, userRole: u.role });
            toolUses.push({ id: tb.id, name: tb.name, input: tb.input, result });
            write("tool_result", { id: tb.id, name: tb.name, result });
            toolResults.push({
              type: "tool_result",
              tool_use_id: tb.id,
              content: JSON.stringify(result).slice(0, 20000),
            });
          } catch (e: any) {
            const err = { error: e?.message || String(e) };
            toolUses.push({ id: tb.id, name: tb.name, input: tb.input, result: err });
            write("tool_result", { id: tb.id, name: tb.name, result: err });
            toolResults.push({
              type: "tool_result",
              tool_use_id: tb.id,
              content: JSON.stringify(err),
              is_error: true,
            });
          }
        }
        // Add the tool results as a user turn so the model can respond to them
        messages.push({ role: "user", content: toolResults as any });

        if (response.stop_reason !== "tool_use") break;
      }

      // Persist assistant message (final text + all tool uses inline)
      const finalContent: any[] = [];
      if (assembledText) finalContent.push({ type: "text", text: assembledText });
      for (const tu of toolUses) {
        finalContent.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
        finalContent.push({ type: "tool_result", tool_use_id: tu.id, result: tu.result });
      }
      sqlite.prepare(`
        INSERT INTO assistant_messages(conversation_id, role, content, created_at)
        VALUES(?, 'assistant', ?, ?)
      `).run(convId, JSON.stringify(finalContent), new Date().toISOString());

      // Bump conversation updated_at + auto-title from first user message
      const currentTitle: any = sqlite.prepare(`SELECT title FROM assistant_conversations WHERE id = ?`).get(convId);
      const shouldTitle = currentTitle?.title === "New conversation";
      if (shouldTitle) {
        const auto = userText.slice(0, 60) + (userText.length > 60 ? "…" : "");
        sqlite.prepare(`UPDATE assistant_conversations SET title = ?, updated_at = ? WHERE id = ?`)
          .run(auto, new Date().toISOString(), convId);
      } else {
        sqlite.prepare(`UPDATE assistant_conversations SET updated_at = ? WHERE id = ?`)
          .run(new Date().toISOString(), convId);
      }

      write("done", { ok: true });
      clearInterval(heartbeat);
      res.end();
    } catch (e: any) {
      console.error("[assistant] stream error:", e?.message || e);
      clearInterval(heartbeat);
      try { write("error", { message: e?.message || "Assistant failed. Try again." }); } catch {}
      try { res.end(); } catch {}
    }
  });

  // ── Confirm a draft — the client sends the tool kind + input, we execute
  //    the actual write. Kept separate from the chat stream so a tool call in
  //    the transcript is a PROPOSAL, and this endpoint is the COMMIT.
  app.post("/api/assistant/confirm-draft", auth, (req, res) => {
    const u = getUser(req); if (!u) return res.status(401).json({ error: "auth" });
    const kind = String(req.body?.kind || "");
    const input = req.body?.input || {};
    const now = new Date().toISOString();
    try {
      if (kind === "draft_note") {
        const jobId = Number(input.job_id);
        const body = String(input.body || "").trim();
        if (!jobId || !body) return res.status(400).json({ error: "missing job_id or body" });
        const info = sqlite.prepare(`
          INSERT INTO job_notes(job_id, body, author, is_public, created_at)
          VALUES(?, ?, ?, 1, ?)
        `).run(jobId, body, u.name || "Titan Assistant", now);
        return res.json({ ok: true, id: Number(info.lastInsertRowid) });
      }
      if (kind === "propose_stage_change") {
        const jobId = Number(input.job_id);
        const stage = String(input.new_stage || "");
        const valid = ["pending_sale", "pre_production", "wip", "invoice_pending", "accounts_receivable", "complete"];
        if (!jobId || !valid.includes(stage)) return res.status(400).json({ error: "invalid stage" });
        sqlite.prepare(`UPDATE jobs SET progress_stage = ? WHERE id = ?`).run(stage, jobId);
        return res.json({ ok: true });
      }
      if (kind === "draft_email") {
        // Email drafts are just displayed on the client — nothing to commit here.
        // We echo back so the client has a uniform response shape.
        return res.json({ ok: true, note: "Email drafts are copied client-side; nothing to commit." });
      }
      return res.status(400).json({ error: `Unknown draft kind: ${kind}` });
    } catch (e: any) {
      console.error("[assistant] confirm-draft error:", e?.message || e);
      return res.status(500).json({ error: e?.message || "Confirm failed" });
    }
  });
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
