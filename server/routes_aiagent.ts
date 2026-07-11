import type { Express, Request, Response } from "express";
import type Database from "better-sqlite3";
import Anthropic from "@anthropic-ai/sdk";
import { makeAuthMiddleware } from "./routes_auth";

// ─────────────────────────────────────────────────────────────────────────────
// Titan Pro — AI Agent Center backend
//
// Seven autonomous agents that read the live job files and produce review-ready
// output for the General Manager. All AI calls run through the Anthropic SDK,
// which reads ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL injected by the sandbox
// (start_server api_credentials=["llm-api:website"]). Every agent DEGRADES
// GRACEFULLY: if the LLM is unavailable, a deterministic rules engine produces a
// useful result so the module never hard-fails.
// ─────────────────────────────────────────────────────────────────────────────

// Real Anthropic model ID. Override without a rebuild by setting ANTHROPIC_MODEL in Railway.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const now = () => new Date().toISOString();
const todayISO = () => new Date().toISOString().slice(0, 10);

function llmAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Single place to call the model. Returns raw text or throws.
async function askLLM(system: string, user: string, maxTokens = 2000): Promise<string> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  return msg.content.map((c: any) => (c.type === "text" ? c.text : "")).join("").trim();
}

// Parse a JSON object/array out of a model response that may be fenced.
function extractJSON<T = any>(text: string): T | null {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.search(/[[{]/);
  if (first === -1) return null;
  // Find matching last bracket
  const lastObj = t.lastIndexOf("}");
  const lastArr = t.lastIndexOf("]");
  const last = Math.max(lastObj, lastArr);
  if (last === -1) return null;
  try {
    return JSON.parse(t.slice(first, last + 1)) as T;
  } catch {
    return null;
  }
}

export function registerAIAgentRoutes(app: Express, sqlite: Database.Database) {
  const { requireRole } = makeAuthMiddleware(sqlite);
  // AI Agent Center is restricted to owner + general_manager.
  const gmOnly = requireRole("owner", "general_manager");

  // ── Persistence: agent run history + generated drafts ──────────────────────
  sqlite.exec(`CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    summary TEXT,
    result_json TEXT,
    used_llm INTEGER DEFAULT 0,
    run_by TEXT,
    created_at TEXT NOT NULL
  )`);

  sqlite.exec(`CREATE TABLE IF NOT EXISTS agent_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    job_id INTEGER,
    kind TEXT,
    recipient TEXT,
    recipient_email TEXT,
    subject TEXT,
    body TEXT,
    status TEXT NOT NULL DEFAULT 'pending_review',
    meta_json TEXT,
    created_at TEXT NOT NULL
  )`);

  function recordRun(agent: string, summary: string, result: any, usedLlm: boolean, runBy: string) {
    const r = sqlite.prepare(
      "INSERT INTO agent_runs (agent, status, summary, result_json, used_llm, run_by, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(agent, "completed", summary, JSON.stringify(result ?? null), usedLlm ? 1 : 0, runBy, now());
    return Number(r.lastInsertRowid);
  }

  const runBy = (req: Request) => ((req as any).employee?.name as string) || "Agent";

  // Convenience data loaders --------------------------------------------------
  const allJobs = () => sqlite.prepare("SELECT * FROM jobs ORDER BY id").all() as any[];
  const jobById = (id: number) => sqlite.prepare("SELECT * FROM jobs WHERE id=?").get(id) as any;
  const contactById = (id: number) => sqlite.prepare("SELECT * FROM contacts WHERE id=?").get(id) as any;
  const notesFor = (jobId: number) =>
    sqlite.prepare("SELECT * FROM job_notes WHERE job_id=? ORDER BY created_at ASC").all(jobId) as any[];
  const docsFor = (jobId: number) =>
    sqlite.prepare("SELECT id, doc_type, title, status, created_at FROM job_documents WHERE job_id=?").all(jobId) as any[];
  const activeStaff = () =>
    sqlite.prepare("SELECT id, name, role, position, gmail_email FROM employees WHERE is_active=1 ORDER BY id").all() as any[];

  // Wire the audit helper's data loaders (avoids threading the db handle around).
  __setAuditLoaders(notesFor, docsFor);

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPANYCAM PHOTOS — expose imported photos for the job document packet.
  // Matches imported CompanyCam photos to a job by project id / job number.
  // Used by client documentPacket.ts to embed photos in the combined PDF.
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/api/jobs/:id/companycam-photos", (req: Request, res: Response) => {
    const jobId = Number(req.params.id);
    const job = jobById(jobId);
    if (!job) return res.status(404).json({ error: "Job not found." });
    // Table only exists once a CompanyCam sync has run.
    const exists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='imported_companycam_photos'").get();
    if (!exists) return res.json({ jobId, photos: [] });
    // Match by project id equal to the job number, or return all if no project mapping.
    const jn = String(job.job_number || "");
    let photos = sqlite.prepare(
      "SELECT id, project_id, uri, captured_at FROM imported_companycam_photos WHERE project_id=? ORDER BY captured_at DESC"
    ).all(jn) as any[];
    if (!photos.length) {
      // Fallback: no project mapping — surface the most recent photos so the GM can include them.
      photos = sqlite.prepare("SELECT id, project_id, uri, captured_at FROM imported_companycam_photos ORDER BY captured_at DESC LIMIT 24").all() as any[];
    }
    res.json({ jobId, photos });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STATUS — health + capability report for the dashboard header
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/api/ai-agent/status", gmOnly, (_req, res) => {
    const lastRuns = sqlite.prepare(
      "SELECT agent, MAX(created_at) as last_run, COUNT(*) as runs FROM agent_runs GROUP BY agent"
    ).all() as any[];
    const pendingDrafts = sqlite.prepare(
      "SELECT COUNT(*) as n FROM agent_drafts WHERE status='pending_review'"
    ).get() as any;
    res.json({
      llmAvailable: llmAvailable(),
      model: MODEL,
      lastRuns,
      pendingDrafts: pendingDrafts?.n || 0,
      jobsTracked: (sqlite.prepare("SELECT COUNT(*) n FROM jobs").get() as any).n,
    });
  });

  app.get("/api/ai-agent/runs", gmOnly, (_req, res) => {
    const rows = sqlite.prepare("SELECT * FROM agent_runs ORDER BY id DESC LIMIT 50").all() as any[];
    res.json(rows.map(r => ({ ...r, result: safeParse(r.result_json) })));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT 1 — DAILY FILE AUDIT
  // Reads every job file; flags missing info, missed/overdue dates, missing
  // required documents, and stale notes based on where the job is in its cycle.
  // ═══════════════════════════════════════════════════════════════════════════
  app.post("/api/ai-agent/audit", gmOnly, async (req: Request, res: Response) => {
    const jobs = allJobs();
    const findings = jobs.map(j => auditJob(j));
    let overview = deterministicAuditOverview(findings);
    let usedLlm = false;

    if (llmAvailable()) {
      try {
        const compact = findings.map(f => ({
          job: f.jobNumber, status: f.status, issues: f.issues.map(i => i.label), score: f.completeness,
        }));
        const txt = await askLLM(
          "You are the operations auditor for Titan Restoration, a water/fire/storm restoration contractor. Given per-job completeness findings, write a concise daily briefing for the General Manager. Prioritize by risk to revenue and compliance. Be specific and actionable. 4-7 sentences max. Plain text, no markdown headers.",
          "Today is " + todayISO() + ". Per-job audit findings:\n" + JSON.stringify(compact, null, 2),
          700
        );
        if (txt) { overview = txt; usedLlm = true; }
      } catch (_) { /* fall back to deterministic overview */ }
    }

    const result = {
      generatedAt: now(),
      overview,
      totalJobs: jobs.length,
      totalIssues: findings.reduce((a, f) => a + f.issues.length, 0),
      findings,
    };
    recordRun("audit", `Audited ${jobs.length} job files — ${result.totalIssues} issues found.`, result, usedLlm, runBy(req));
    res.json(result);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT 2 — NEXT-DAY SCHEDULE BUILDER
  // Reads recent notes + open jobs and proposes tomorrow's shifts, tagging the
  // appropriate technicians. GM reviews, then can commit to the shifts table.
  // ═══════════════════════════════════════════════════════════════════════════
  app.post("/api/ai-agent/schedule/propose", gmOnly, async (req: Request, res: Response) => {
    const targetDate = (req.body?.date as string) || tomorrowISO();
    const jobs = allJobs().filter(j => !["closed", "complete", "invoice_paid"].includes((j.status || "").toLowerCase()));
    const staff = activeStaff();
    const techs = staff.filter(s => ["tech", "general_manager", "admin", "owner"].includes(s.role));

    const jobContext = jobs.map(j => ({
      id: j.id, job: j.job_number, status: j.status, loss: j.loss_type,
      address: j.address, assigned: j.assigned_tech,
      recentNotes: notesFor(j.id).slice(-4).map(n => `${n.tag ? "[" + n.tag + "] " : ""}${n.body}`),
    }));

    let proposals: any[] = [];
    let rationale = "";
    let usedLlm = false;

    if (llmAvailable()) {
      try {
        const txt = await askLLM(
          "You are the dispatch scheduler for Titan Restoration. Build the next working day's field schedule from open jobs and their recent notes. Assign the most appropriate technician(s) to each job based on note content (e.g. active drying = daily monitoring visit, reconstruction = crew day, new = initial inspection). Return ONLY JSON: {\"rationale\":\"1-2 sentences\",\"shifts\":[{\"jobId\":number,\"jobNumber\":\"..\",\"techName\":\"..\",\"title\":\"..\",\"startTime\":\"08:00\",\"endTime\":\"12:00\",\"reason\":\"why this tech / this task\"}]}. Use ONLY technician names from the provided roster. Times in 24h HH:MM.",
          "Target date: " + targetDate + "\nAvailable field staff: " + JSON.stringify(techs.map(t => ({ name: t.name, role: t.role, position: t.position }))) + "\nOpen jobs with recent notes:\n" + JSON.stringify(jobContext, null, 2),
          2500
        );
        const parsed = extractJSON<any>(txt);
        if (parsed && Array.isArray(parsed.shifts)) {
          proposals = parsed.shifts;
          rationale = parsed.rationale || "";
          usedLlm = true;
        }
      } catch (_) { /* fall through */ }
    }

    if (!proposals.length) {
      const det = deterministicSchedule(jobs, techs, targetDate);
      proposals = det.shifts;
      rationale = det.rationale;
    }

    // Normalize + tag: attach staff email for the "tagged people" requirement
    proposals = proposals.map((p, idx) => {
      const tech = staff.find(s => s.name === p.techName) || techs[idx % Math.max(techs.length, 1)];
      return {
        jobId: p.jobId, jobNumber: p.jobNumber, techName: tech?.name || p.techName || "Unassigned",
        techEmail: tech?.gmail_email || null, techPhone: null,
        title: p.title || "Site visit", startTime: p.startTime || "08:00",
        endTime: p.endTime || "16:00", reason: p.reason || "",
      };
    });

    const result = { targetDate, rationale, shifts: proposals, taggedPeople: [...new Set(proposals.map(p => p.techName))] };
    recordRun("schedule", `Proposed ${proposals.length} shifts for ${targetDate}.`, result, usedLlm, runBy(req));
    res.json(result);
  });

  // Commit approved shifts to the real shifts table.
  app.post("/api/ai-agent/schedule/commit", gmOnly, (req: Request, res: Response) => {
    const shifts = (req.body?.shifts as any[]) || [];
    if (!shifts.length) return res.status(400).json({ error: "No shifts to commit." });
    const date = (req.body?.date as string) || tomorrowISO();
    const stmt = sqlite.prepare(
      "INSERT INTO shifts (job_id, tech_name, shift_date, start_time, end_time, title, notes, notification_sent, created_at) VALUES (?,?,?,?,?,?,?,0,?)"
    );
    let created = 0;
    for (const s of shifts) {
      stmt.run(s.jobId || null, s.techName || "", date, s.startTime || "08:00", s.endTime || "16:00", s.title || "Site visit", s.reason || "", now());
      created++;
    }
    res.json({ created, date });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT 3 — SCOPE → CARRIER & CUSTOMER EMAIL DRAFTER
  // Reviews the initial scope-of-work notes for a job and drafts an email to the
  // carrier on file AND the customer, saved for GM review.
  // ═══════════════════════════════════════════════════════════════════════════
  app.post("/api/ai-agent/scope-email", gmOnly, async (req: Request, res: Response) => {
    const jobId = Number(req.body?.jobId);
    const job = jobById(jobId);
    if (!job) return res.status(404).json({ error: "Job not found." });
    const contact = job.contact_id ? contactById(job.contact_id) : null;
    const scopeNotes = notesFor(jobId).filter(n =>
      !n.tag || /scope|inspection|initial|assessment|estimate/i.test((n.tag || "") + " " + (n.body || ""))
    );
    const scopeText = (scopeNotes.length ? scopeNotes : notesFor(jobId)).map(n => n.body).join("\n") || job.description || "";

    const carrierEmail = job.adjuster_email || "";
    const customerEmail = contact?.email || "";

    let drafts = deterministicScopeEmails(job, contact, scopeText);
    let usedLlm = false;

    if (llmAvailable() && scopeText.trim()) {
      try {
        const txt = await askLLM(
          "You are the office manager at Titan Restoration LLC (Chapin, SC / Augusta, GA — 706-922-0154), a licensed water/fire/storm restoration contractor. From the scope-of-work notes, draft TWO professional emails for the General Manager to review before sending: (1) to the insurance carrier/adjuster confirming scope and requesting authorization, referencing claim/policy numbers; (2) to the property owner (customer) in plain, reassuring language explaining what work will happen next. Sign as Titan Restoration LLC. Return ONLY JSON: {\"carrier\":{\"subject\":\"..\",\"body\":\"..\"},\"customer\":{\"subject\":\"..\",\"body\":\"..\"}}.",
          JSON.stringify({
            jobNumber: job.job_number, lossType: job.loss_type, address: job.address,
            carrier: job.insurance_carrier, adjuster: job.adjuster_name, claimNumber: job.claim_number,
            policyNumber: job.policy_number, customerName: contact?.name, scopeNotes: scopeText,
          }, null, 2),
          2200
        );
        const parsed = extractJSON<any>(txt);
        if (parsed?.carrier?.body && parsed?.customer?.body) { drafts = parsed; usedLlm = true; }
      } catch (_) { /* fall through */ }
    }

    // Save both as review-ready drafts
    const saved: any[] = [];
    for (const [kind, email, recipient] of [
      ["carrier", drafts.carrier, job.adjuster_name || job.insurance_carrier || "Carrier"],
      ["customer", drafts.customer, contact?.name || "Customer"],
    ] as const) {
      const to = kind === "carrier" ? carrierEmail : customerEmail;
      const r = sqlite.prepare(
        "INSERT INTO agent_drafts (agent, job_id, kind, recipient, recipient_email, subject, body, status, created_at) VALUES ('scope-email',?,?,?,?,?,?,'pending_review',?)"
      ).run(jobId, kind, recipient, to, email.subject, email.body, now());
      saved.push({ id: Number(r.lastInsertRowid), kind, recipient, recipientEmail: to, subject: email.subject, body: email.body });
    }
    const result = { jobId, jobNumber: job.job_number, drafts: saved };
    recordRun("scope-email", `Drafted carrier + customer emails for ${job.job_number}.`, result, usedLlm, runBy(req));
    res.json(result);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT 4 — INBOX RESPONDER
  // Reads emails in the inbox, matches each to a job file, and drafts a reply
  // grounded in that file's data. Saved for GM review.
  // ═══════════════════════════════════════════════════════════════════════════
  app.post("/api/ai-agent/inbox/draft-replies", gmOnly, async (req: Request, res: Response) => {
    const inbox = sqlite.prepare("SELECT * FROM emails WHERE folder='inbox' ORDER BY id DESC LIMIT 25").all() as any[];
    const jobs = allJobs();
    const saved: any[] = [];
    let usedLlm = false;

    for (const em of inbox) {
      // Match to a job: by claim number in subject/body, carrier, or adjuster email.
      const match = matchEmailToJob(em, jobs);
      const job = match ? match : null;
      const contact = job?.contact_id ? contactById(job.contact_id) : null;

      let reply = deterministicReply(em, job, contact);
      if (llmAvailable()) {
        try {
          const txt = await askLLM(
            "You are Cody Brantley's assistant at Titan Restoration LLC. Draft a professional, concise reply to this email, grounded in the linked job file's data. Do not invent facts not present. If information is missing, note what needs to be confirmed. Return ONLY JSON: {\"subject\":\"RE: ..\",\"body\":\"..\"}.",
            JSON.stringify({
              from: em.from, subject: em.subject, body: em.body,
              linkedJob: job ? { jobNumber: job.job_number, lossType: job.loss_type, status: job.status, carrier: job.insurance_carrier, claimNumber: job.claim_number, address: job.address, customer: contact?.name } : null,
            }, null, 2),
            1400
          );
          const parsed = extractJSON<any>(txt);
          if (parsed?.body) { reply = parsed; usedLlm = true; }
        } catch (_) { /* fall through */ }
      }

      const r = sqlite.prepare(
        "INSERT INTO agent_drafts (agent, job_id, kind, recipient, recipient_email, subject, body, status, meta_json, created_at) VALUES ('inbox-reply',?, 'reply', ?, ?, ?, ?, 'pending_review', ?, ?)"
      ).run(job?.id || null, em.from, em.from, reply.subject, reply.body, JSON.stringify({ sourceEmailId: em.id, originalSubject: em.subject }), now());
      saved.push({
        id: Number(r.lastInsertRowid), sourceEmailId: em.id, from: em.from, originalSubject: em.subject,
        linkedJob: job?.job_number || null, subject: reply.subject, body: reply.body,
      });
    }
    const result = { processed: inbox.length, drafts: saved };
    recordRun("inbox-reply", `Drafted ${saved.length} inbox replies.`, result, usedLlm, runBy(req));
    res.json(result);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT 5 — LEAD & ASBESTOS FLAGGER
  // Flags each job for lead/asbestos potential based on year built + loss type +
  // scope notes. Writes into hazmat_flags (auto_detected=1) for the Hazmat page.
  // ═══════════════════════════════════════════════════════════════════════════
  app.post("/api/ai-agent/hazmat/scan", gmOnly, async (req: Request, res: Response) => {
    const jobs = allJobs();
    const flags: any[] = [];
    let usedLlm = false;

    for (const j of jobs) {
      const noteText = notesFor(j.id).map(n => n.body).join(" ");
      let assessment = deterministicHazmat(j, noteText);

      if (llmAvailable()) {
        try {
          const txt = await askLLM(
            "You are an EPA RRP / AHERA compliance assistant for a restoration contractor. Assess a property's potential for LEAD-based paint and ASBESTOS-containing materials based on year built, loss type, address, and scope notes. Pre-1978 = lead risk; pre-1980 (especially pre-1990) = asbestos risk in flooring, popcorn ceilings, insulation, mastic. Return ONLY JSON: {\"lead\":{\"risk\":\"low|medium|high\",\"reason\":\"..\",\"testingRequired\":bool},\"asbestos\":{\"risk\":\"low|medium|high\",\"reason\":\"..\",\"testingRequired\":bool}}.",
            JSON.stringify({ jobNumber: j.job_number, lossType: j.loss_type, address: j.address, description: j.description, scopeNotes: noteText }),
            900
          );
          const parsed = extractJSON<any>(txt);
          if (parsed?.lead && parsed?.asbestos) { assessment = parsed; usedLlm = true; }
        } catch (_) { /* fall through */ }
      }

      // Persist flags for lead + asbestos when risk is medium/high (auto-detected).
      for (const [type, a] of [["lead", assessment.lead], ["asbestos", assessment.asbestos]] as const) {
        if (!a) continue;
        // Avoid duplicate auto flags for same job+type
        const existing = sqlite.prepare(
          "SELECT id FROM hazmat_flags WHERE job_id=? AND flag_type=? AND auto_detected=1"
        ).get(j.id, type) as any;
        const record = {
          job_id: j.id, flag_type: type, risk_level: a.risk, year_built: j.year_built || null,
          auto_detected: 1, acknowledged: 0, documentation_required: a.testingRequired ? 1 : 0,
          notes: a.reason || "", created_at: now(),
        };
        if (existing) {
          sqlite.prepare("UPDATE hazmat_flags SET risk_level=?, documentation_required=?, notes=? WHERE id=?")
            .run(record.risk_level, record.documentation_required, record.notes, existing.id);
        } else if (a.risk && a.risk !== "low") {
          sqlite.prepare(
            "INSERT INTO hazmat_flags (job_id, flag_type, risk_level, year_built, auto_detected, acknowledged, documentation_required, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
          ).run(record.job_id, record.flag_type, record.risk_level, record.year_built, 1, 0, record.documentation_required, record.notes, record.created_at);
        }
      }
      flags.push({ jobId: j.id, jobNumber: j.job_number, ...assessment });
    }
    const highRisk = flags.filter(f => f.lead?.risk === "high" || f.asbestos?.risk === "high").length;
    const result = { scannedAt: now(), totalJobs: jobs.length, highRiskJobs: highRisk, flags };
    recordRun("hazmat", `Scanned ${jobs.length} jobs — ${highRisk} high-risk for lead/asbestos.`, result, usedLlm, runBy(req));
    res.json(result);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAFTS management — list / approve / dismiss / push to email drafts
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/api/ai-agent/drafts", gmOnly, (req: Request, res: Response) => {
    const agent = req.query.agent as string | undefined;
    const rows = (agent
      ? sqlite.prepare("SELECT * FROM agent_drafts WHERE agent=? ORDER BY id DESC LIMIT 100").all(agent)
      : sqlite.prepare("SELECT * FROM agent_drafts ORDER BY id DESC LIMIT 100").all()) as any[];
    res.json(rows);
  });

  app.patch("/api/ai-agent/drafts/:id", gmOnly, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const { subject, body, status } = req.body || {};
    const existing = sqlite.prepare("SELECT * FROM agent_drafts WHERE id=?").get(id) as any;
    if (!existing) return res.status(404).json({ error: "Draft not found." });
    sqlite.prepare("UPDATE agent_drafts SET subject=COALESCE(?,subject), body=COALESCE(?,body), status=COALESCE(?,status) WHERE id=?")
      .run(subject ?? null, body ?? null, status ?? null, id);
    res.json(sqlite.prepare("SELECT * FROM agent_drafts WHERE id=?").get(id));
  });

  app.delete("/api/ai-agent/drafts/:id", gmOnly, (req: Request, res: Response) => {
    sqlite.prepare("DELETE FROM agent_drafts WHERE id=?").run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT — INSURANCE NARRATIVE GENERATOR
  // Reads a job file (loss details, water category/class, psychrometric drying
  // logs, equipment deployed, affected areas, notes) and drafts the professional
  // scope-of-work / drying narrative adjusters expect to justify the claim.
  // Uses the LLM when available; otherwise a structured deterministic narrative
  // built from the same data. Result is saved as a reviewable draft.
  // ═══════════════════════════════════════════════════════════════════════════
  const dryingFor = (jobId: number) =>
    sqlite.prepare("SELECT * FROM drying_records WHERE job_id=? ORDER BY day_number ASC, reading_date ASC").all(jobId) as any[];
  const equipmentFor = (jobId: number) =>
    sqlite.prepare(
      "SELECT ed.*, e.name AS equipment_name, e.category AS equipment_type, e.model AS equipment_model FROM equipment_deployments ed " +
      "LEFT JOIN equipment e ON e.id = ed.equipment_id WHERE ed.job_id=? ORDER BY ed.deployed_at ASC"
    ).all(jobId) as any[];

  function buildJobDossier(jobId: number) {
    const job = jobById(jobId);
    if (!job) return null;
    const contact = job.contact_id ? contactById(job.contact_id) : null;
    const drying = dryingFor(jobId);
    const equipment = equipmentFor(jobId);
    const notes = notesFor(jobId).slice(-12).map((n: any) => ({ tag: n.tag, body: n.body, at: n.created_at }));
    // affected_areas may be stored as a JSON array string, a comma list, or plain text.
    const areaSet = new Set<string>();
    for (const d of drying) {
      const raw = d.affected_areas;
      if (!raw) continue;
      let parsed: any = null;
      try { parsed = JSON.parse(raw); } catch { /* not JSON */ }
      const items = Array.isArray(parsed) ? parsed : String(raw).split(/[,;]/);
      items.map((s: any) => String(s).trim()).filter(Boolean).forEach((s: string) => areaSet.add(s));
    }
    const affected = Array.from(areaSet);
    return { job, contact, drying, equipment, notes, affected };
  }

  app.post("/api/ai-agent/narrative", gmOnly, async (req: Request, res: Response) => {
    const jobId = Number(req.body?.jobId);
    if (!jobId) return res.status(400).json({ error: "jobId is required." });
    const dossier = buildJobDossier(jobId);
    if (!dossier) return res.status(404).json({ error: "Job not found." });

    let narrative = deterministicNarrative(dossier);
    let usedLlm = false;

    if (llmAvailable()) {
      try {
        const compact = {
          jobNumber: dossier.job.job_number,
          lossType: dossier.job.loss_type,
          address: dossier.job.address,
          description: dossier.job.description,
          carrier: dossier.job.insurance_carrier,
          claimNumber: dossier.job.claim_number,
          policyNumber: dossier.job.policy_number,
          adjuster: dossier.job.adjuster_name,
          insured: dossier.contact?.name,
          mitigationStart: dossier.job.mitigation_start,
          dryOutComplete: dossier.job.dry_out_complete,
          affectedAreas: dossier.affected,
          dryingLog: dossier.drying.map((d: any) => ({
            day: d.day_number, date: d.reading_date, tech: d.tech_name,
            waterCategory: d.water_category, waterClass: d.water_class,
            tempF: d.temp_f, rhPct: d.rh_pct, gpp: d.gpp, dewPointF: d.dew_point_f,
            areas: d.affected_areas, goalMet: !!d.drying_goal_met,
            structuralDryingComplete: !!d.structural_drying_complete,
            observations: d.observations,
          })),
          equipment: dossier.equipment.map((e: any) => ({
            name: e.equipment_name, type: e.equipment_type,
            deployed: e.deployed_at, returned: e.returned_at, daysOut: e.days_out,
          })),
          notes: dossier.notes,
        };
        const txt = await askLLM(
          "You are a restoration documentation specialist for Titan Restoration, an IICRC-standard water/fire/storm restoration contractor. Write a professional insurance narrative an adjuster will use to justify the claim. Structure it with clear sections: LOSS SUMMARY, SCOPE OF WORK PERFORMED, MOISTURE & DRYING DOCUMENTATION (reference the psychrometric readings and whether drying goals / structural drying were met, cite IICRC S500 where appropriate), EQUIPMENT DEPLOYED (list units and duration), and CONCLUSION. Be factual and cite only the data provided — never invent readings, dates, or amounts. Professional, third-person, insurance-appropriate tone. Plain text with UPPERCASE section headers, no markdown.",
          "Job file data:\n" + JSON.stringify(compact, null, 2),
          2200
        );
        if (txt && txt.length > 120) { narrative = txt; usedLlm = true; }
      } catch (_) { /* fall back to deterministic narrative */ }
    }

    const subject = `Insurance Narrative — ${dossier.job.job_number}` +
      (dossier.job.claim_number ? ` (Claim ${dossier.job.claim_number})` : "");
    const draftRow = sqlite.prepare(
      "INSERT INTO agent_drafts (agent, job_id, kind, recipient, recipient_email, subject, body, status, meta_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(
      "narrative", jobId, "insurance_narrative",
      dossier.job.adjuster_name || dossier.job.insurance_carrier || "",
      dossier.job.adjuster_email || "",
      subject, narrative, "pending_review",
      JSON.stringify({ usedLlm, dryingReadings: dossier.drying.length, equipmentUnits: dossier.equipment.length }),
      now()
    );
    recordRun("narrative", `Drafted insurance narrative for ${dossier.job.job_number}.`, { jobId, subject }, usedLlm, runBy(req));
    res.json({
      draftId: Number(draftRow.lastInsertRowid),
      jobNumber: dossier.job.job_number,
      subject, narrative, usedLlm,
      dryingReadings: dossier.drying.length,
      equipmentUnits: dossier.equipment.length,
    });
  });

  // Approve a draft → write it into the app's own emails table (Sent/Drafts folder)
  app.post("/api/ai-agent/drafts/:id/approve", gmOnly, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const d = sqlite.prepare("SELECT * FROM agent_drafts WHERE id=?").get(id) as any;
    if (!d) return res.status(404).json({ error: "Draft not found." });
    sqlite.prepare(
      "INSERT INTO emails (folder, \"from\", \"to\", subject, body, read, created_at) VALUES ('drafts', 'cody@titanrestorationllc.com', ?, ?, ?, 1, ?)"
    ).run(d.recipient_email || "", d.subject || "", d.body || "", now());
    sqlite.prepare("UPDATE agent_drafts SET status='approved' WHERE id=?").run(id);
    res.json({ ok: true, movedTo: "Email · Drafts" });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — deterministic fallbacks & rules engines
// ─────────────────────────────────────────────────────────────────────────────
function safeParse(s: string) { try { return JSON.parse(s); } catch { return null; } }

// Structured insurance narrative built purely from job-file data (no LLM).
// Used as the fallback whenever the AI key is absent or a call fails.
function deterministicNarrative(d: any): string {
  const j = d.job || {};
  const c = d.contact || {};
  const drying: any[] = d.drying || [];
  const equip: any[] = d.equipment || [];
  const areas: string[] = d.affected || [];
  const L = (v: any, fallback = "not recorded") => (v === null || v === undefined || v === "" ? fallback : String(v));
  const lossType = L(j.loss_type, "property").toUpperCase();
  // Normalize date-ish values to YYYY-MM-DD (job dates are sometimes stored as ISO timestamps).
  const D = (v: any) => {
    if (!v) return null;
    const s = String(v);
    const m = s.match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : s;
  };

  const lt = L(j.loss_type, "").toLowerCase();
  const standard =
    lt.includes("fire") || lt.includes("smoke") ? "IICRC S700 fire and smoke damage restoration standards" :
    lt.includes("mold") ? "IICRC S520 mold remediation standards" :
    lt.includes("water") || lt.includes("storm") || lt.includes("flood") ? "IICRC S500 water damage restoration standards" :
    "applicable IICRC restoration standards";

  const lines: string[] = [];
  lines.push("LOSS SUMMARY");
  lines.push(
    `Titan Restoration LLC responded to a reported ${L(j.loss_type, "property")} loss at ${L(j.address)}` +
    (c.name ? ` on behalf of the insured, ${c.name}.` : ".")
  );
  const claimBits = [
    j.insurance_carrier ? `Carrier: ${j.insurance_carrier}` : null,
    j.claim_number ? `Claim #: ${j.claim_number}` : null,
    j.policy_number ? `Policy #: ${j.policy_number}` : null,
    j.adjuster_name ? `Adjuster: ${j.adjuster_name}` : null,
  ].filter(Boolean);
  if (claimBits.length) lines.push(claimBits.join("  |  "));
  if (j.description) lines.push(`Reported conditions: ${j.description}`);
  lines.push("");

  lines.push("SCOPE OF WORK PERFORMED");
  const scope: string[] = [];
  if (j.mitigation_start) scope.push(`Emergency mitigation commenced ${D(j.mitigation_start)}.`);
  if (areas.length) scope.push(`Affected areas addressed: ${areas.join("; ")}.`);
  scope.push(`Work was performed in accordance with ${standard}, including inspection, affected-material assessment, containment where required, and appropriate mitigation of the affected areas.`);
  if (j.dry_out_complete) scope.push(`Structural dry-out completed ${D(j.dry_out_complete)}.`);
  lines.push(scope.join(" "));
  lines.push("");

  lines.push("MOISTURE & DRYING DOCUMENTATION");
  if (drying.length) {
    const first = drying[0];
    if (first.water_category || first.water_class) {
      lines.push(`Loss classified as Water Category ${L(first.water_category, "?")}, Class ${L(first.water_class, "?")} per IICRC S500.`);
    }
    lines.push(`Psychrometric monitoring was documented across ${drying.length} logged reading(s):`);
    for (const r of drying) {
      const parts = [
        `Day ${L(r.day_number, "?")} (${L(r.reading_date, "date n/r")})`,
        r.temp_f != null ? `${r.temp_f}\u00B0F` : null,
        r.rh_pct != null ? `${r.rh_pct}% RH` : null,
        r.gpp != null ? `${r.gpp} GPP` : null,
        r.dew_point_f != null ? `${r.dew_point_f}\u00B0F dew point` : null,
        r.tech_name ? `tech ${r.tech_name}` : null,
      ].filter(Boolean);
      let line = "  \u2022 " + parts.join(", ") + ".";
      if (r.observations) line += ` Observations: ${r.observations}`;
      if (r.structural_drying_complete) line += " Structural drying confirmed complete.";
      else if (r.drying_goal_met) line += " Daily drying goal met.";
      lines.push(line);
    }
    const done = drying.some((r) => r.structural_drying_complete);
    lines.push(done
      ? "Structural drying goals were achieved and verified before equipment removal."
      : "Monitoring continued toward documented dry standard; readings support the drying duration billed.");
  } else {
    lines.push("No psychrometric drying readings are recorded on this job file at the time of this narrative.");
  }
  lines.push("");

  lines.push("EQUIPMENT DEPLOYED");
  if (equip.length) {
    lines.push(`${equip.length} unit(s) were deployed to achieve and maintain drying conditions:`);
    for (const e of equip) {
      const prettyType = e.equipment_type ? String(e.equipment_type).replace(/_/g, " ") : "";
      const label = [e.equipment_name, prettyType].filter(Boolean).join(" ") || "Equipment unit";
      const dur = e.days_out != null ? `${e.days_out} day(s)` : (e.deployed_at ? `deployed ${e.deployed_at}` : "duration n/r");
      lines.push(`  \u2022 ${label} \u2014 ${dur}.`);
    }
  } else {
    lines.push("No equipment deployments are recorded on this job file.");
  }
  lines.push("");

  lines.push("CONCLUSION");
  lines.push(
    `The documented scope, moisture readings, and equipment usage support the ${lossType} loss mitigation performed by Titan Restoration LLC and substantiate the associated claim. Supporting photos, drying logs, and daily notes are available in the job file upon request.`
  );
  lines.push("");
  lines.push("Prepared by Titan Restoration LLC \u2014 706-922-0154");
  return lines.join("\n");
}
function tomorrowISO() { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }
function daysBetween(a: string, b: Date) { return Math.floor((b.getTime() - new Date(a).getTime()) / 86400000); }

// Required documents by phase — used by the audit agent.
const REQUIRED_DOCS: Record<string, string[]> = {
  mitigation: ["work_authorization"],
  reconstruction: ["work_authorization"],
  complete: ["work_authorization", "certificate_of_completion"],
};

function auditJob(j: any) {
  const issues: { severity: string; label: string }[] = [];
  const push = (severity: string, label: string) => issues.push({ severity, label });

  if (!j.contact_id) push("high", "No customer/contact linked");
  if (!j.address) push("medium", "Missing property address");
  if (!j.loss_type) push("medium", "Loss type not set");
  if (!j.insurance_carrier) push("high", "No insurance carrier on file");
  if (!j.claim_number) push("medium", "Claim number missing");
  if (!j.adjuster_email && !j.adjuster_name) push("medium", "No adjuster contact on file");

  const status = (j.status || "").toLowerCase();
  const nb = new Date();

  // Date sequencing / overdue checks
  if (status === "mitigation" && j.mitigation_start && !j.dry_out_complete) {
    const d = daysBetween(j.mitigation_start, nb);
    if (d >= 4) push("high", `Drying running ${d} days with no dry-out complete date`);
  }
  if (status === "mitigation" && !j.mitigation_start) push("medium", "Mitigation started but no start date recorded");
  if (status === "reconstruction" && !j.reconstruction_start) push("medium", "In reconstruction with no reconstruction start date");
  if (["complete", "invoice_paid", "closed"].includes(status) && !j.job_complete) push("low", "Marked complete but no completion date");

  // Notes recency
  const notes = (globalNotesLoader ? globalNotesLoader(j.id) : []) as any[];
  const lastNote = notes[notes.length - 1];
  if (!notes.length) push("medium", "No notes on file");
  else if (lastNote && daysBetween(lastNote.created_at, nb) >= 3 && !["complete", "closed", "invoice_paid"].includes(status)) {
    push("low", `No note activity in ${daysBetween(lastNote.created_at, nb)} days`);
  }

  // Required documents
  const req = REQUIRED_DOCS[status] || [];
  const haveDocs = (globalDocsLoader ? globalDocsLoader(j.id) : []) as any[];
  const haveTypes = new Set(haveDocs.map(d => d.doc_type));
  for (const rd of req) if (!haveTypes.has(rd)) push("high", `Missing required document: ${rd.replace(/_/g, " ")}`);

  const completeness = Math.max(0, Math.round(100 - issues.reduce((a, i) => a + (i.severity === "high" ? 20 : i.severity === "medium" ? 10 : 4), 0)));
  return { jobId: j.id, jobNumber: j.job_number, status: j.status, address: j.address, completeness, issues };
}

// These loaders are wired at request time so auditJob can pull notes/docs without
// threading the db handle through. Set inside registerAIAgentRoutes scope.
let globalNotesLoader: ((id: number) => any[]) | null = null;
let globalDocsLoader: ((id: number) => any[]) | null = null;

function deterministicAuditOverview(findings: any[]) {
  const highs = findings.flatMap(f => f.issues.filter((i: any) => i.severity === "high").map((i: any) => `${f.jobNumber}: ${i.label}`));
  const worst = [...findings].sort((a, b) => a.completeness - b.completeness).slice(0, 3);
  return `Daily file audit complete across ${findings.length} jobs. ${highs.length} high-priority gaps found${highs.length ? ": " + highs.slice(0, 4).join("; ") + "." : "."} Lowest completeness: ${worst.map(w => `${w.jobNumber} (${w.completeness}%)`).join(", ")}. Prioritize carrier/claim gaps and overdue drying files first.`;
}

function deterministicSchedule(jobs: any[], techs: any[], date: string) {
  const shifts: any[] = [];
  let ti = 0;
  for (const j of jobs) {
    const status = (j.status || "").toLowerCase();
    let title = "Site visit", start = "08:00", end = "16:00";
    if (status === "mitigation") { title = "Daily drying check & moisture readings"; start = "08:00"; end = "10:00"; }
    else if (status === "reconstruction") { title = "Reconstruction crew day"; start = "07:30"; end = "16:00"; }
    else if (status === "new") { title = "Initial inspection & scope"; start = "09:00"; end = "11:00"; }
    const tech = techs[ti % Math.max(techs.length, 1)];
    ti++;
    shifts.push({ jobId: j.id, jobNumber: j.job_number, techName: tech?.name, title, startTime: start, endTime: end, reason: `${status} phase — assigned by rotation` });
  }
  return { shifts, rationale: `Rules-based schedule for ${date}: drying files get morning monitoring visits, reconstruction gets full crew days, new jobs get inspections.` };
}

function deterministicScopeEmails(job: any, contact: any, scope: string) {
  const co = "Titan Restoration LLC";
  const claim = job.claim_number ? ` (Claim #${job.claim_number})` : "";
  return {
    carrier: {
      subject: `Scope Confirmation & Authorization Request — ${job.job_number}${claim}`,
      body: `Dear ${job.adjuster_name || "Adjuster"},\n\nWe have completed our initial inspection for the ${job.loss_type || ""} loss at ${job.address || "the insured property"}${claim}. Based on our assessment, the scope of work includes:\n\n${scope || "See attached inspection notes."}\n\nWe respectfully request authorization to proceed. Please confirm coverage and advise of any documentation you require.\n\nThank you,\n${co}\n706-922-0154 · cody@titanrestorationllc.com`,
    },
    customer: {
      subject: `Your Restoration Project — Next Steps (${job.job_number})`,
      body: `Dear ${contact?.name || "Homeowner"},\n\nThank you for trusting ${co} with the restoration of your property. Following our initial inspection, here is what we'll be doing next:\n\n${scope || "Our team will walk you through each step."}\n\nWe are coordinating with your insurance carrier and will keep you updated throughout. Please don't hesitate to reach out with any questions.\n\nWarm regards,\nThe ${co} Team\n706-922-0154`,
    },
  };
}

function matchEmailToJob(em: any, jobs: any[]) {
  const hay = `${em.subject || ""} ${em.body || ""}`.toLowerCase();
  // by claim number
  for (const j of jobs) if (j.claim_number && hay.includes(String(j.claim_number).toLowerCase())) return j;
  // by adjuster email (from)
  for (const j of jobs) if (j.adjuster_email && (em.from || "").toLowerCase() === String(j.adjuster_email).toLowerCase()) return j;
  // by carrier name
  for (const j of jobs) if (j.insurance_carrier && hay.includes(String(j.insurance_carrier).toLowerCase())) return j;
  return null;
}

function deterministicReply(em: any, job: any, contact: any) {
  const ref = job ? ` regarding ${job.job_number} (${job.loss_type} loss at ${job.address || "the property"})` : "";
  return {
    subject: `RE: ${em.subject || "Your message"}`,
    body: `Hi,\n\nThank you for your email${ref}. ${job ? `We have this file active and are moving it forward. ` : ""}I'll review the details and follow up with the specifics shortly.\n\nPlease let me know if you need anything in the meantime.\n\nBest regards,\nCody Brantley\nTitan Restoration LLC · 706-922-0154`,
  };
}

function deterministicHazmat(j: any, noteText: string) {
  const yr = Number(j.year_built) || 0;
  const text = `${j.description || ""} ${noteText}`.toLowerCase();
  const lossDemo = /(demo|tear|remov|cut|floor|ceiling|drywall|insulation)/.test(text) || ["fire", "storm", "water"].includes((j.loss_type || "").toLowerCase());

  const leadRisk = yr && yr < 1978 ? (lossDemo ? "high" : "medium") : yr ? "low" : "medium";
  const asbRisk = yr && yr < 1990 ? (lossDemo ? "high" : "medium") : yr ? "low" : "medium";
  return {
    lead: {
      risk: leadRisk,
      reason: yr ? `Built ${yr}; ${yr < 1978 ? "pre-1978 — lead-based paint likely present" : "post-1978 — lead unlikely"}.${lossDemo ? " Disturbance/demo work raises exposure." : ""}` : "Year built unknown — assume pre-1978 until confirmed (EPA RRP).",
      testingRequired: leadRisk !== "low",
    },
    asbestos: {
      risk: asbRisk,
      reason: yr ? `Built ${yr}; ${yr < 1990 ? "pre-1990 — asbestos likely in flooring, mastic, popcorn ceilings, insulation" : "post-1990 — asbestos unlikely"}.${lossDemo ? " Demo/removal triggers AHERA testing." : ""}` : "Year built unknown — presume asbestos-containing materials until survey completed.",
      testingRequired: asbRisk !== "low",
    },
  };
}

export function __setAuditLoaders(notesLoader: (id: number) => any[], docsLoader: (id: number) => any[]) {
  globalNotesLoader = notesLoader;
  globalDocsLoader = docsLoader;
}
