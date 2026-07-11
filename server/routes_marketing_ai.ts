import type { Express, Request, Response } from "express";
import type Database from "better-sqlite3";
import Anthropic from "@anthropic-ai/sdk";
import { makeAuthMiddleware } from "./routes_auth";

// ─────────────────────────────────────────────────────────────────────────────
// Titan Pro — Marketing AI backend (ADDITIVE)
//
// Adds three capabilities on top of the existing static POST_LIBRARY, without
// changing any existing marketing routes, pages, designs, or features:
//   1. Custom on-demand post generation (24/7, any topic)
//   2. Seasonal / holiday calendar-aware post generation (restoration-tuned)
//   3. A learning loop: saved posts become few-shot examples so the AI learns
//      Titan's voice over time.
//
// Follows the exact same pattern as routes_aiagent.ts:
//   - Uses the Anthropic SDK (ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL from env).
//   - llmAvailable() gate; if the LLM is unavailable, a deterministic template
//     engine produces a useful, on-brand post so the module NEVER hard-fails.
//   - Staff-authenticated (Marketing is a staff-accessible page).
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const now = () => new Date().toISOString();

// Titan brand constants — baked into every generated post.
const TITAN = {
  name: "Titan Restoration LLC",
  phone: "706-922-0154",
  web: "titanrestorationllc.com",
  area: "Augusta, GA, Columbia, SC, and the CSRA",
  tagline: "Recover · Restore · Rebuild",
};

function llmAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

async function askLLM(system: string, user: string, maxTokens = 1200): Promise<string> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  return msg.content.map((c: any) => (c.type === "text" ? c.text : "")).join("").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Seasonal / holiday calendar — restoration-industry tuned.
// Each entry maps a window of the year to a post theme. `match(d)` returns true
// when date d (a JS Date) falls in the entry's window.
// ─────────────────────────────────────────────────────────────────────────────
type CalendarEntry = {
  key: string;
  label: string;
  emoji: string;
  season: string;
  lossType: "water" | "fire" | "mold" | "storm" | "general";
  theme: string;         // what the post should be about
  angle: string;         // industry-standard angle for restoration marketing
  match: (d: Date) => boolean;
};

// month is 0-indexed in JS Dates
const inMonth = (d: Date, ...months: number[]) => months.includes(d.getMonth());
const isDate = (d: Date, month: number, day: number) => d.getMonth() === month && d.getDate() === day;
// window across a month range (inclusive)
const inMonthDayRange = (d: Date, m1: number, d1: number, m2: number, d2: number) => {
  const cur = (d.getMonth() + 1) * 100 + d.getDate();
  const start = (m1 + 1) * 100 + d1;
  const end = (m2 + 1) * 100 + d2;
  return cur >= start && cur <= end;
};

const CALENDAR: CalendarEntry[] = [
  // ── Winter ──────────────────────────────────────────────────────────────
  {
    key: "new-year", label: "New Year", emoji: "🎉", season: "Winter", lossType: "general",
    theme: "New Year message — thank the community, wish them a safe and prosperous year, remind them Titan is here 24/7 if disaster strikes.",
    angle: "Gratitude + brand awareness. Warm, community-focused, not salesy.",
    match: (d) => inMonthDayRange(d, 0, 1, 0, 3),
  },
  {
    key: "winter-freeze", label: "Winter Pipe Freeze", emoji: "🧊", season: "Winter", lossType: "water",
    theme: "Frozen and burst pipe prevention during cold snaps: let faucets drip, insulate exposed pipes, keep heat on, know where your shutoff is. Emergency CTA if a pipe already burst.",
    angle: "Prevention tips + urgency. #1 winter restoration driver in the Southeast.",
    match: (d) => inMonth(d, 11, 0, 1), // Dec, Jan, Feb
  },
  {
    key: "space-heater", label: "Space Heater / Winter Fire Safety", emoji: "🔥", season: "Winter", lossType: "fire",
    theme: "Winter home fire safety: space heaters 3 feet from anything flammable, never leave running unattended, check smoke detectors, fireplace/chimney safety.",
    angle: "Educational safety. Heating equipment is a leading winter fire cause.",
    match: (d) => inMonth(d, 11, 0, 1),
  },
  {
    key: "valentines", label: "Valentine's Day", emoji: "💛", season: "Winter", lossType: "general",
    theme: "Light Valentine's tie-in: 'We love this community.' Thank customers, gentle brand-awareness post.",
    angle: "Community warmth + brand awareness. Keep it brief and genuine.",
    match: (d) => isDate(d, 1, 14),
  },

  // ── Spring ──────────────────────────────────────────────────────────────
  {
    key: "spring-storm", label: "Spring Storm Season", emoji: "⛈️", season: "Spring", lossType: "storm",
    theme: "Spring storm & hail season is here: how to prepare, what to do after wind/hail damage, document before cleanup, call a restoration pro before the adjuster.",
    angle: "Prevention + urgency + insurance guidance. Peak storm season in the CSRA.",
    match: (d) => inMonth(d, 2, 3, 4), // Mar, Apr, May
  },
  {
    key: "spring-rain-mold", label: "Spring Rain & Mold", emoji: "🌧️", season: "Spring", lossType: "mold",
    theme: "Spring rains raise indoor humidity and moisture intrusion risk. Watch for musty smells, check basements/crawlspaces, act fast on any water intrusion to prevent mold.",
    angle: "Educational. Ties spring weather to mold prevention.",
    match: (d) => inMonth(d, 2, 3, 4),
  },
  {
    key: "mold-awareness", label: "Mold Awareness Month", emoji: "🍄", season: "Spring", lossType: "mold",
    theme: "May is a natural time to educate on mold: grows in 24-48 hours after moisture, hides in walls, standard cleaners don't remove spores, IICRC S520 remediation.",
    angle: "Educational series anchor. Establishes Titan as the local mold authority.",
    match: (d) => inMonth(d, 4), // May
  },
  {
    key: "mothers-day", label: "Mother's Day", emoji: "💐", season: "Spring", lossType: "general",
    theme: "Warm Mother's Day message honoring the moms who keep homes safe; Titan is here to protect the home they've built.",
    angle: "Community warmth + brand awareness.",
    match: (d) => d.getMonth() === 4 && d.getDay() === 0 && d.getDate() >= 8 && d.getDate() <= 14,
  },

  // ── Summer ──────────────────────────────────────────────────────────────
  {
    key: "hurricane-prep", label: "Hurricane / Storm Prep", emoji: "🌀", season: "Summer", lossType: "storm",
    theme: "Hurricane season prep for the Southeast: trim trees, clear gutters, secure loose items, know your insurance coverage, save Titan's number before the storm.",
    angle: "Prevention + preparedness. Atlantic hurricane season June-Nov.",
    match: (d) => inMonth(d, 5, 6, 7), // Jun, Jul, Aug
  },
  {
    key: "ac-leak", label: "Summer AC & Humidity", emoji: "💧", season: "Summer", lossType: "water",
    theme: "Summer AC condensation leaks and high humidity cause hidden water damage and mold. Check condensate lines, watch for ceiling stains, act fast on leaks.",
    angle: "Educational. Common but overlooked summer water-damage source.",
    match: (d) => inMonth(d, 5, 6, 7),
  },
  {
    key: "july-4th", label: "Independence Day", emoji: "🎆", season: "Summer", lossType: "general",
    theme: "Happy 4th of July to the community. Celebrate safely — mind grills and fireworks. Titan is here 24/7 if the unexpected happens.",
    angle: "Community + light fire-safety nudge (grill/fireworks). Festive tone.",
    match: (d) => isDate(d, 6, 4),
  },
  {
    key: "hurricane-season", label: "Hurricane Season Peak", emoji: "🌀", season: "Summer", lossType: "storm",
    theme: "Atlantic hurricane season is at its peak. If a named storm is headed inland toward the CSRA: know your evacuation and shutoff plan, photograph your property now, and save Titan's number. After the storm — document damage before cleanup, tarp/board-up fast to stop further loss, and call a restoration pro before the adjuster. Titan responds 24/7.",
    angle: "Active-response + urgency. Peak Atlantic hurricane activity (Aug-Oct), when inland wind/water damage spikes in the Southeast. Distinct from early-season prep.",
    match: (d) => inMonth(d, 7, 8, 9), // Aug, Sep, Oct
  },
  {
    key: "back-to-school", label: "Back to School", emoji: "🎒", season: "Summer", lossType: "general",
    theme: "Back-to-school season: wishing local students, teachers, and families a safe and successful year. Quick reminder for busy households — test smoke/CO detectors, check that dryer vents and outlets aren't overloaded, and know where your water shutoff is. Titan is here 24/7 to protect the home your family comes back to every day.",
    angle: "Community warmth + light home-safety nudge for busy families. Timed to the August return-to-school window.",
    match: (d) => inMonthDayRange(d, 7, 1, 8, 10), // early Aug through early Sep
  },

  // ── Fall ────────────────────────────────────────────────────────────────
  {
    key: "fall-prep", label: "Fall Home Prep", emoji: "🍂", season: "Fall", lossType: "storm",
    theme: "Fall home prep: clean gutters, inspect the roof before winter, check for leaks, service the heating system. Prevent water and fire issues before cold weather.",
    angle: "Prevention checklist. Seasonal maintenance positioning.",
    match: (d) => inMonth(d, 8, 9), // Sep, Oct
  },
  {
    key: "heating-startup", label: "Heating System Startup", emoji: "🔥", season: "Fall", lossType: "fire",
    theme: "Before you turn the heat on: service the furnace, inspect the chimney, replace filters, test smoke/CO detectors. Prevent heating-related fires.",
    angle: "Educational safety. Timed to first cold weather.",
    match: (d) => inMonth(d, 9, 10), // Oct, Nov
  },
  {
    key: "halloween", label: "Halloween", emoji: "🎃", season: "Fall", lossType: "general",
    theme: "Fun Halloween post with a light safety nudge (candles in decorations, keep exits clear). Keep it playful and community-friendly.",
    angle: "Community engagement + light safety. Playful tone.",
    match: (d) => isDate(d, 9, 31),
  },
  {
    key: "thanksgiving", label: "Thanksgiving", emoji: "🦃", season: "Fall", lossType: "fire",
    theme: "Thanksgiving is the #1 day for home cooking fires. Kitchen safety: never leave the stove unattended, keep flammables away, no fryer under a roof, keep an extinguisher handy. Plus gratitude to the community.",
    angle: "Safety education + genuine gratitude. Titan's biggest fire-safety moment.",
    match: (d) => d.getMonth() === 10 && d.getDay() === 4 && d.getDate() >= 22 && d.getDate() <= 28,
  },

  // ── Holiday season ────────────────────────────────────────────────────────
  {
    key: "christmas", label: "Christmas / Holidays", emoji: "🎄", season: "Winter", lossType: "fire",
    theme: "Holiday fire safety: water the tree, inspect light strings, don't overload outlets, keep candles away from decorations. Warm holiday wishes to the community.",
    angle: "Safety education + warm holiday greeting. Christmas-tree & decoration fires.",
    match: (d) => inMonthDayRange(d, 11, 18, 11, 26),
  },
];

// Deterministic template builder — used as the graceful fallback and as the
// seed body when the LLM is unavailable. Always on-brand, always has Titan's
// contact info.
function templatePost(opts: {
  platform: string;
  topic: string;
  tone: string;
  lossType?: string;
}): string {
  const { platform, topic, tone } = opts;
  const tag = "#TitanRestoration #AugustaGA #CSRA";
  const isGoogle = platform === "Google Business";
  const isInsta = platform === "Instagram";
  const cta = isInsta
    ? `📞 ${TITAN.phone} | Link in bio`
    : `📞 ${TITAN.phone} | ${TITAN.web}`;
  const opener =
    tone === "emergency" ? `🚨 ${topic}` :
    tone === "testimonial" ? `⭐⭐⭐⭐⭐ ${topic}` :
    tone === "promotional" ? `✅ ${topic}` :
    topic;
  const body = isGoogle
    ? `${opener}\n\n${TITAN.name} serves ${TITAN.area} with 24/7 IICRC-certified restoration and direct insurance billing.\n\n${cta}`
    : `${opener}\n\n${TITAN.name} — 24/7 emergency response across ${TITAN.area}. IICRC-certified, direct insurance billing, "${TITAN.tagline}".\n\n${cta}\n\n${tag}`;
  return body;
}

// System prompt shared by all Titan post generation.
function brandSystem(examples: string[]): string {
  const ex = examples.length
    ? `\n\nHere are examples of posts Titan has written and kept — match this voice, structure, and level of detail:\n\n${examples.map((e, i) => `EXAMPLE ${i + 1}:\n${e}`).join("\n\n---\n\n")}`
    : "";
  return `You are the marketing copywriter for ${TITAN.name}, a property damage restoration company serving ${TITAN.area}.

Voice: professional, trustworthy, locally rooted, action-oriented. You help homeowners in crisis and you make them feel safe. You reference real industry standards where relevant (IICRC S500 for water, S520 for mold).

Hard rules for every post:
- Always include the phone number ${TITAN.phone}.
- For Facebook/Google Business include ${TITAN.web}; for Instagram say "Link in bio".
- Use tasteful emojis (not excessive).
- Match the platform: Facebook = medium length with line breaks; Instagram = punchy + hashtags; Google Business = concise, professional, keyword-rich for local SEO, minimal hashtags.
- Never invent fake reviews or fake statistics. Testimonial-style posts must be clearly generic/illustrative, not attributed to a real named person unless one is provided.
- End with a clear call to action.
- Return ONLY the post text, no preamble, no explanation.${ex}`;
}

export function registerMarketingAIRoutes(app: Express, sqlite: Database.Database) {
  const { requireStaffAuth } = makeAuthMiddleware(sqlite);

  // ── Persistence: saved posts (learning corpus) ─────────────────────────────
  sqlite.exec(`CREATE TABLE IF NOT EXISTS marketing_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    kind TEXT,
    topic TEXT,
    tone TEXT,
    loss_type TEXT,
    body TEXT NOT NULL,
    used_llm INTEGER DEFAULT 0,
    starred INTEGER DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL
  )`);

  const createdBy = (req: Request) => ((req as any).employee?.name as string) || "Staff";

  // Pull recent saved posts for the same platform as few-shot examples.
  function learningExamples(platform: string, limit = 3): string[] {
    try {
      const rows = sqlite.prepare(
        `SELECT body FROM marketing_posts
         WHERE platform = ?
         ORDER BY starred DESC, id DESC
         LIMIT ?`
      ).all(platform, limit) as any[];
      return rows.map(r => r.body).filter(Boolean);
    } catch {
      return [];
    }
  }

  // ── 1. CUSTOM on-demand post ───────────────────────────────────────────────
  app.post("/api/marketing/generate-post", requireStaffAuth, async (req: Request, res: Response) => {
    const platform = String(req.body?.platform || "Facebook");
    const topic = String(req.body?.topic || "").trim();
    const tone = String(req.body?.tone || "educational");
    const lossType = req.body?.lossType ? String(req.body.lossType) : undefined;
    if (!topic) return res.status(400).json({ error: "A topic or description is required." });

    if (!llmAvailable()) {
      const body = templatePost({ platform, topic, tone, lossType });
      return res.json({ post: body, usedLlm: false });
    }
    try {
      const examples = learningExamples(platform);
      const system = brandSystem(examples);
      const user = `Write ONE ${platform} post for ${TITAN.name}.
Tone/style: ${tone}.
${lossType ? `Service focus: ${lossType} damage.\n` : ""}Topic / what to say: ${topic}`;
      const post = await askLLM(system, user, 1000);
      return res.json({ post: post || templatePost({ platform, topic, tone, lossType }), usedLlm: !!post });
    } catch (e: any) {
      // Graceful fallback — never hard-fail.
      const body = templatePost({ platform, topic, tone, lossType });
      return res.json({ post: body, usedLlm: false, note: "Generated from template (AI temporarily unavailable)." });
    }
  });

  // ── 2. SEASONAL / HOLIDAY calendar ─────────────────────────────────────────
  // Return the calendar with which entries are "active" for a given date.
  app.get("/api/marketing/calendar", requireStaffAuth, (req: Request, res: Response) => {
    const dateStr = String(req.query.date || "").trim();
    const d = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
    const list = CALENDAR.map(c => ({
      key: c.key,
      label: c.label,
      emoji: c.emoji,
      season: c.season,
      lossType: c.lossType,
      theme: c.theme,
      angle: c.angle,
      active: c.match(d),
    }));
    res.json({ date: d.toISOString().slice(0, 10), entries: list });
  });

  // Generate a post for a specific calendar entry (or the current date's top match).
  app.post("/api/marketing/generate-seasonal", requireStaffAuth, async (req: Request, res: Response) => {
    const platform = String(req.body?.platform || "Facebook");
    const key = req.body?.key ? String(req.body.key) : "";
    const dateStr = String(req.body?.date || "").trim();
    const d = dateStr ? new Date(dateStr + "T12:00:00") : new Date();

    let entry = key ? CALENDAR.find(c => c.key === key) : CALENDAR.find(c => c.match(d));
    if (!entry) {
      // Fall back to the current season's storm/prevention theme.
      entry = CALENDAR.find(c => c.match(d)) || CALENDAR[0];
    }

    if (!llmAvailable()) {
      const body = templatePost({
        platform, topic: `${entry.emoji} ${entry.label} — ${entry.theme}`,
        tone: "educational", lossType: entry.lossType,
      });
      return res.json({ post: body, entry: { key: entry.key, label: entry.label }, usedLlm: false });
    }
    try {
      const examples = learningExamples(platform);
      const system = brandSystem(examples);
      const user = `Write ONE ${platform} post for ${TITAN.name} for this seasonal/holiday moment.
Occasion: ${entry.label} (${entry.season})
Service focus: ${entry.lossType} damage.
What the post should cover: ${entry.theme}
Marketing angle: ${entry.angle}`;
      const post = await askLLM(system, user, 1000);
      return res.json({
        post: post || templatePost({ platform, topic: entry.theme, tone: "educational", lossType: entry.lossType }),
        entry: { key: entry.key, label: entry.label },
        usedLlm: !!post,
      });
    } catch {
      const body = templatePost({ platform, topic: entry.theme, tone: "educational", lossType: entry.lossType });
      return res.json({ post: body, entry: { key: entry.key, label: entry.label }, usedLlm: false });
    }
  });

  // ── 3. LEARNING LOOP — save / list / star / delete ─────────────────────────
  app.post("/api/marketing/posts", requireStaffAuth, (req: Request, res: Response) => {
    const b = req.body || {};
    const body = String(b.body || "").trim();
    if (!body) return res.status(400).json({ error: "Post body is required." });
    const r = sqlite.prepare(
      `INSERT INTO marketing_posts (platform, kind, topic, tone, loss_type, body, used_llm, starred, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      String(b.platform || "Facebook"),
      b.kind ? String(b.kind) : "custom",
      b.topic ? String(b.topic) : null,
      b.tone ? String(b.tone) : null,
      b.lossType ? String(b.lossType) : null,
      body,
      b.usedLlm ? 1 : 0,
      b.starred ? 1 : 0,
      createdBy(req),
      now(),
    );
    res.json({ id: Number(r.lastInsertRowid), ok: true });
  });

  app.get("/api/marketing/posts", requireStaffAuth, (req: Request, res: Response) => {
    const rows = sqlite.prepare(
      `SELECT id, platform, kind, topic, tone, loss_type AS lossType, body,
              used_llm AS usedLlm, starred, created_by AS createdBy, created_at AS createdAt
       FROM marketing_posts ORDER BY starred DESC, id DESC LIMIT 100`
    ).all();
    res.json(rows);
  });

  app.patch("/api/marketing/posts/:id", requireStaffAuth, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const starred = req.body?.starred ? 1 : 0;
    sqlite.prepare("UPDATE marketing_posts SET starred = ? WHERE id = ?").run(starred, id);
    res.json({ ok: true });
  });

  app.delete("/api/marketing/posts/:id", requireStaffAuth, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    sqlite.prepare("DELETE FROM marketing_posts WHERE id = ?").run(id);
    res.json({ ok: true });
  });
}
