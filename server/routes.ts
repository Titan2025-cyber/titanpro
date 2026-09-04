import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, sqlite } from "./storage";
import BetterSqlite3 from "better-sqlite3";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { registerCrudGapRoutes } from "./routes_crud_gaps";
import { registerSuite4Routes } from "./routes_suite4";
import { registerQuickAddAndESignRoutes } from "./routes_quickadd_esign";
import { registerAuthRoutes, makeAuthMiddleware } from "./routes_auth";
import { makeNotifier } from "./notify_bell";
import { sendMentionEmails } from "./notify_email";
import { sendShiftAssignmentEmail } from "./notify_tags";
import { initAuditAndTrash } from "./auditAndTrash";
import { registerAnalyticsRoutes } from "./routes_analytics";
import { registerSubcontractorRoutes } from "./routes_subcontractors";
import { registerContactAdminRoutes } from "./routes_contact_admin";
import { registerExternalDocRoutes } from "./routes_external_docs";
import { registerRoutePlannerRoutes } from "./routes_routeplanner";
import { registerSuite5Routes } from "./routes_suite5";
import { registerSuite6Routes } from "./routes_suite6";
import { registerAIAgentRoutes } from "./routes_aiagent";
import { registerMarketingAIRoutes } from "./routes_marketing_ai";
import { registerHRRoutes } from "./routes_hr";
import { registerGmailRoutes } from "./routes_gmail";
import { registerPresenceRoutes } from "./routes_presence";
import { sendEmail, sendSms, getNotifySettings, saveNotifySettings, providerStatus } from "./notify";
import { ensureNotifPrefsTable, getPrefsMatrix, setPref, NOTIF_CHANNELS, NOTIF_EVENTS } from "./notify_prefs";
import { geocodeJobInBackground, geocoderStatus } from "./geocoder";
import { lookupProperty } from "./property_lookup";
import { startScheduler, runSchedulerNow } from "./scheduler";
import { registerMegaBuildRoutes } from "./routes_megabuild";
import {
  writeImageFieldSafe,
  hydrateImageRows,
} from "./image_pipeline";
import * as objectStorage from "./storage_s3";

// ── Error handler wrapper ────────────────────────────────────────────────────
type Handler = (req: any, res: any, next?: any) => any;
function wrapAsync(fn: Handler): Handler {
  return (req, res, next) => {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') {
        result.catch((err: any) => {
          console.error('[Route Error]', req.method, req.path, err?.message);
          if (!res.headersSent) res.status(500).json({ error: err?.message || 'Server error' });
        });
      }
    } catch (err: any) {
      console.error('[Route Error]', req.method, req.path, err?.message);
      if (!res.headersSent) res.status(500).json({ error: err?.message || 'Server error' });
    }
  };
}


// ── IICRC Category Multipliers ───────────────────────────────────────────────
const IICRC_CATEGORIES: Record<string, number> = {
  "Category 1 (Clean Water)": 1.0,
  "Category 2 (Gray Water)": 1.35,
  "Category 3 (Black Water)": 1.75,
  "Class 1 (Least Amount)": 1.0,
  "Class 2 (Significant)": 1.2,
  "Class 3 (Greatest Amount)": 1.5,
  "Class 4 (Special Situations)": 1.8,
};

// ── Full SC/GA Statute Lookup Table ──────────────────────────────────────────
interface Statute {
  code: string;
  topic: string;
  text: string;
  lossTypes: string[]; // ['all'] for universal, or ['water','fire','mold','storm']
  rebuttalHook: string; // short phrase for inline rebuttal use
}

const STATUTE_TABLE: Record<"SC" | "GA", Statute[]> = {
  SC: [
    // ── Universal (all loss types) ──
    {
      code: "SC Code § 38-59-20",
      topic: "Claim Acceptance / Denial Deadline",
      text: "An insurer must accept or deny a claim within 45 days of receipt of proof of loss. Failure to do so constitutes constructive waiver of defenses.",
      lossTypes: ["all"],
      rebuttalHook: "The carrier's failure to act within 45 days of submitted proof of loss constitutes waiver under SC Code § 38-59-20.",
    },
    {
      code: "SC Code § 38-77-290",
      topic: "Claim Acknowledgment",
      text: "Insurer must acknowledge the claim in writing within 10 days of receiving notice. Failure to acknowledge is a per se unfair claims practice.",
      lossTypes: ["all"],
      rebuttalHook: "Insurer is required to acknowledge this claim within 10 days per SC Code § 38-77-290.",
    },
    {
      code: "SC Code § 38-77-310",
      topic: "Undisputed Amount Payment",
      text: "An insurer may not unreasonably delay payment of any undisputed portion of a claim. Undisputed amounts must be tendered promptly.",
      lossTypes: ["all"],
      rebuttalHook: "Payment of the undisputed line items must be tendered immediately under SC Code § 38-77-310.",
    },
    {
      code: "SC Code § 38-59-40",
      topic: "Attorney's Fees — Bad Faith",
      text: "If an insurer refuses to pay without reasonable cause, the policyholder is entitled to recover attorney's fees and costs in addition to the claim amount.",
      lossTypes: ["all"],
      rebuttalHook: "Continued refusal without reasonable cause exposes the carrier to attorney's fees under SC Code § 38-59-40.",
    },
    {
      code: "SC Reg. 69-64(D)",
      topic: "Extra-Contractual Damages",
      text: "Bad-faith failure to settle a claim where liability is reasonably clear supports extra-contractual damages including punitive damages.",
      lossTypes: ["all"],
      rebuttalHook: "Carrier's conduct may constitute bad faith supporting extra-contractual damages per SC Reg. 69-64(D).",
    },
    {
      code: "SC Code § 38-59-30",
      topic: "Reasonable Investigation Required",
      text: "Insurer must complete a reasonable investigation prior to denying a claim. Denial without adequate investigation is an unfair claims settlement practice.",
      lossTypes: ["all"],
      rebuttalHook: "Any reduction or denial without documented field investigation violates SC Code § 38-59-30.",
    },
    {
      code: "SC Code § 38-57-30",
      topic: "Misrepresentation of Policy Provisions",
      text: "It is an unfair trade practice to misrepresent the provisions of any policy in connection with a claim.",
      lossTypes: ["all"],
      rebuttalHook: "Misrepresenting scope-of-coverage provisions in this adjustment violates SC Code § 38-57-30.",
    },
    // ── Water-Specific ──
    {
      code: "SC Code § 38-75-730",
      topic: "Flood / Water Loss Coverage Duty",
      text: "Insurers must clearly disclose coverage limitations for water intrusion and are prohibited from retroactively narrowing scope after a documented loss event.",
      lossTypes: ["water"],
      rebuttalHook: "Retroactive narrowing of water loss coverage after documentation of the loss event is prohibited under SC Code § 38-75-730.",
    },
    {
      code: "SC Code § 38-77-270",
      topic: "Prompt Payment — Water Damage",
      text: "After receipt of satisfactory proof of water damage loss, the insurer shall pay within 30 days.",
      lossTypes: ["water"],
      rebuttalHook: "Full payment of this documented water loss is required within 30 days of submitted proof per SC Code § 38-77-270.",
    },
    // ── Fire/Smoke-Specific ──
    {
      code: "SC Code § 38-47-10",
      topic: "Fire Policy Mandatory Coverage",
      text: "All fire insurance policies in SC must provide coverage for the actual cash value of damaged property and cost of debris removal. Smoke damage is an insured peril under all standard fire policies.",
      lossTypes: ["fire"],
      rebuttalHook: "Smoke and fire damage including contents and debris removal are mandatory covered perils under SC Code § 38-47-10.",
    },
    // ── Mold-Specific ──
    {
      code: "SC Code § 38-77-140",
      topic: "Mold Remediation — Carrier Duty",
      text: "When mold results from a covered water loss, the carrier has a duty to pay for remediation to pre-loss condition. Denial of remediation costs directly caused by a covered peril is a breach of the policy.",
      lossTypes: ["mold"],
      rebuttalHook: "Mold resulting from the covered water loss requires carrier-funded remediation under SC Code § 38-77-140.",
    },
    // ── Storm-Specific ──
    {
      code: "SC Code § 38-75-1510",
      topic: "Catastrophic Loss — Expedited Handling",
      text: "Following a state-declared catastrophic event, insurers must expedite claims processing and may not apply standard processing timelines as a delay tactic.",
      lossTypes: ["storm"],
      rebuttalHook: "Storm-related claims during a declared catastrophic event are subject to expedited handling under SC Code § 38-75-1510.",
    },
  ],

  GA: [
    // ── Universal (all loss types) ──
    {
      code: "GA Code § 33-6-34",
      topic: "Claim Acknowledgment & Investigation",
      text: "Insurer must acknowledge a claim within 10 days of receipt of notice, conduct a reasonable investigation, and respond to any reasonable inquiry within 10 business days.",
      lossTypes: ["all"],
      rebuttalHook: "Failure to acknowledge and investigate within 10 days violates GA Code § 33-6-34.",
    },
    {
      code: "GA Code § 33-6-34(4)",
      topic: "Undisputed Amount Tender",
      text: "An insurer shall tender any undisputed amount due within 60 days of proof of loss, regardless of any dispute over other portions of the claim.",
      lossTypes: ["all"],
      rebuttalHook: "Undisputed amounts must be tendered within 60 days under GA Code § 33-6-34(4).",
    },
    {
      code: "GA Code § 33-4-6",
      topic: "Bad Faith Penalty",
      text: "If an insurer refuses to pay a loss within 60 days after demand, and the refusal is in bad faith, the insurer is liable for the loss amount plus a 50% penalty plus attorney's fees.",
      lossTypes: ["all"],
      rebuttalHook: "Refusal beyond 60 days after demand exposes carrier to a 50% penalty plus attorney's fees under GA Code § 33-4-6.",
    },
    {
      code: "GA Code § 13-6-11",
      topic: "Attorney's Fees — Bad Faith",
      text: "Attorney's fees are recoverable when the defendant has acted in bad faith, been stubbornly litigious, or caused unnecessary trouble and expense.",
      lossTypes: ["all"],
      rebuttalHook: "Carrier's bad-faith reduction of a well-documented claim exposes it to attorney's fees under GA Code § 13-6-11.",
    },
    {
      code: "GA Code § 33-6-34(3)",
      topic: "No Waiver of Rights",
      text: "Insurer is prohibited from requiring a policyholder to waive rights as a condition of receiving payment of any undisputed amount.",
      lossTypes: ["all"],
      rebuttalHook: "Requesting a waiver of rights in exchange for partial payment violates GA Code § 33-6-34(3).",
    },
    {
      code: "GA Code § 33-6-34(7)",
      topic: "No Delay by Frivolous Demand",
      text: "It is an unfair claims practice to compel a claimant to institute litigation by offering substantially less than the amount ultimately recovered.",
      lossTypes: ["all"],
      rebuttalHook: "Substantially under-paying a documented loss to force litigation is prohibited under GA Code § 33-6-34(7).",
    },
    {
      code: "GA Code § 33-24-45",
      topic: "Reasonable Basis Required for Denial",
      text: "An insurer must have a reasonable basis in law and fact for denying any portion of a covered claim. A reduction must be supported by a written explanation.",
      lossTypes: ["all"],
      rebuttalHook: "Any line-item reduction without a written factual and legal basis violates GA Code § 33-24-45.",
    },
    // ── Water-Specific ──
    {
      code: "GA Code § 33-32-1",
      topic: "Water Damage — Policy Construction",
      text: "Ambiguous policy language regarding water damage coverage must be construed in favor of the insured. Exclusions must be strictly and narrowly applied.",
      lossTypes: ["water"],
      rebuttalHook: "Any ambiguity in water loss coverage must be resolved in the insured's favor per GA Code § 33-32-1.",
    },
    {
      code: "GA Code § 33-6-34(5)",
      topic: "Prompt Payment — Water Damage",
      text: "Insurer must pay documented water damage claims within a reasonable time after proof of loss. Drying and mitigation costs are compensable immediate-response expenses.",
      lossTypes: ["water"],
      rebuttalHook: "Mitigation and drying costs are required immediate-response compensable expenses under GA Code § 33-6-34(5).",
    },
    // ── Fire/Smoke-Specific ──
    {
      code: "GA Code § 33-35-1",
      topic: "Standard Fire Policy — Mandatory Coverage",
      text: "Georgia requires coverage for fire and smoke as defined perils in all standard property policies. Smoke damage caused by a covered fire is an insured peril.",
      lossTypes: ["fire"],
      rebuttalHook: "Smoke and odor remediation resulting from a covered fire event is a mandatory insured peril under GA Code § 33-35-1.",
    },
    // ── Mold-Specific ──
    {
      code: "GA Code § 33-6-34(2)",
      topic: "Mold — Consequential Loss",
      text: "Mold resulting directly from a covered water loss event is a consequential covered loss. The carrier must fund remediation to pre-loss condition.",
      lossTypes: ["mold"],
      rebuttalHook: "Mold caused by the covered water event is a consequential covered loss requiring remediation under GA Code § 33-6-34(2).",
    },
    // ── Storm-Specific ──
    {
      code: "GA Code § 33-6-34(6)",
      topic: "Storm — No Denial Pending Inspection",
      text: "An insurer may not deny a storm loss claim without first conducting a physical inspection of the damaged property.",
      lossTypes: ["storm"],
      rebuttalHook: "Denial or reduction of this storm claim without physical inspection violates GA Code § 33-6-34(6).",
    },
  ],
};

// ── IICRC Standards by Loss Type ─────────────────────────────────────────────
const IICRC_STANDARDS: Record<string, string[]> = {
  water: [
    "IICRC S500 Standard for Professional Water Damage Restoration (current edition) — All drying protocols, equipment placement, and moisture monitoring meet Class/Category requirements.",
    "IICRC S500 §7.4 — Water extraction required for all Category 2/3 losses to prevent secondary damage.",
    "IICRC S500 §11.3 — Low Grain Refrigerant (LGR) dehumidification required per Class 2/3 moisture readings.",
    "IICRC S500 §11.4 — Air movers required at minimum 1 per 50 SF per Class 2 drying protocol.",
    "IICRC S500 §9.7 — Antimicrobial treatment required for all Category 2+ water losses.",
    "IICRC S500 §6.1 — Emergency response within 2 hours required to mitigate secondary damage and limit further loss.",
  ],
  fire: [
    "IICRC S700 Standard for Professional Fire and Smoke Damage Restoration — All cleaning and deodorization procedures comply with S700 requirements.",
    "IICRC S700 §6 — Emergency securing and board-up required to prevent further loss following a fire event.",
    "IICRC S700 §7 — Professional dry/wet chemical soot cleaning protocol required for all surfaces exposed to fire residue.",
    "IICRC S700 §8 — Contents pack-out required when smoke contamination levels preclude in-place cleaning.",
    "IICRC S700 §9 — Hydroxyl generator or ozone treatment required to address embedded smoke odor.",
    "IICRC S700 §11 — Structural deodorization required when odor penetration exceeds surface level.",
  ],
  mold: [
    "IICRC S520 Standard for Professional Mold Remediation — All containment, remediation, and clearance procedures comply with S520.",
    "IICRC S520 §9 — Full negative-air containment required during active mold remediation to prevent cross-contamination.",
    "IICRC S520 §10 — HEPA air filtration required during and following all mold remediation work.",
    "IICRC S520 §11 — Personal Protective Equipment (PPE) at minimum Level C required for all remediation personnel.",
    "IICRC S520 §12 — Post-remediation verification (clearance testing) required prior to reconstruction.",
    "IICRC S520 §13 — Affected porous materials (drywall, insulation, carpet) must be removed and disposed of per EPA/state guidelines.",
  ],
  storm: [
    "IICRC S500 Standard for Professional Water Damage Restoration — Storm-driven water intrusion treated as Category 2/3 loss requiring full drying protocol.",
    "IICRC S700 Standard for Professional Fire and Smoke Damage Restoration — Applicable when storm causes fire or electrical damage.",
    "RIA (Restoration Industry Association) Restoration Consensus Pricing — Unit pricing reflects current Southeast regional market rates for storm loss response.",
    "IICRC S500 §6.1 — Emergency response mobilization required within 2 hours to mitigate further storm damage.",
    "IICRC S500 §7 — Structural drying required when storm infiltration exceeds surface-level moisture levels.",
  ],
  biohazard: [
    "IICRC S540 Standard for Professional Trauma and Crime Scene Cleanup — All biohazard remediation follows S540 protocols.",
    "OSHA 29 CFR 1910.1030 — Bloodborne Pathogens Standard compliance required for all biohazard remediation personnel.",
    "EPA 40 CFR Part 243 — All biohazard waste transported and disposed per EPA solid/hazardous waste guidelines.",
    "IICRC S540 §7 — Containment and decontamination required for all areas with confirmed biohazard contamination.",
    "IICRC S540 §9 — Post-remediation clearance testing required prior to restoration work.",
  ],
  reconstruction: [
    "IICRC S500 §14 — Post-drying structural assessments must confirm moisture levels at or below baseline before reconstruction begins.",
    "IRC (International Residential Code) — All reconstruction work meets current IRC requirements applicable in GA/SC.",
    "OSHA 29 CFR 1926 — Construction Safety Standards compliance maintained throughout reconstruction.",
    "RIA Reconstruction Consensus Pricing — Unit pricing reflects current Southeast regional market rates.",
    "IICRC S500 §15 — Written documentation of drying completion and moisture clearance is required before any reconstruction is performed.",
  ],
};

// ── Smart State Detector ──────────────────────────────────────────────────────
const SC_CITIES = ["chapin", "columbia", "greenville", "spartanburg", "charleston", "myrtle beach", "florence", "rock hill", "sumter", "hilton head", "lexington", "irmo", "west columbia", "cayce", "newberry", "orangeburg", "beaufort", "aiken", "anderson", "gaffney", "conway", "north charleston", "mount pleasant", "bluffton", "greer"];
const GA_CITIES = ["augusta", "martinez", "evans", "grovetown", "hephzibah", "atlanta", "savannah", "macon", "columbus", "athens", "sandy springs", "roswell", "johns creek", "albany", "warner robins", "alpharetta", "marietta", "smyrna", "valdosta", "brookhaven", "peachtree city", "dunwoody", "mcdonough", "kennesaw", "gainesville", "dalton", "north augusta"];

function detectState(address: string | null | undefined): "SC" | "GA" {
  if (!address) return "GA"; // default to GA (Titan's primary market)
  const lower = address.toLowerCase();

  // 1. Explicit state abbreviation (", SC" or ", GA" with word boundary)
  if (/,\s*sc\b/.test(lower)) return "SC";
  if (/,\s*ga\b/.test(lower)) return "GA";

  // 2. Full state name
  if (/south carolina/.test(lower)) return "SC";
  if (/georgia/.test(lower)) return "GA";

  // 3. ZIP code range: 29000–29999 → SC, 30000–31999 → GA
  const zipMatch = lower.match(/\b(\d{5})\b/);
  if (zipMatch) {
    const zip = parseInt(zipMatch[1], 10);
    if (zip >= 29000 && zip <= 29999) return "SC";
    if (zip >= 30000 && zip <= 31999) return "GA";
  }

  // 4. Known city lists
  for (const city of SC_CITIES) {
    if (lower.includes(city)) return "SC";
  }
  for (const city of GA_CITIES) {
    if (lower.includes(city)) return "GA";
  }

  // 5. Default to GA (primary market is Augusta, GA)
  return "GA";
}

// ── Statute Selector ──────────────────────────────────────────────────────────
function selectStatutes(state: "SC" | "GA", lossType: string): Statute[] {
  const all = STATUTE_TABLE[state];
  const normalizedLoss = lossType?.toLowerCase() || "water";
  const universal = all.filter(s => s.lossTypes.includes("all"));
  const specific = all.filter(s => s.lossTypes.includes(normalizedLoss));
  // Deduplicate by code
  const seen = new Set<string>();
  const result: Statute[] = [];
  for (const s of [...universal, ...specific]) {
    if (!seen.has(s.code)) {
      seen.add(s.code);
      result.push(s);
    }
  }
  return result;
}

// ── IICRC Line-Item Justification ─────────────────────────────────────────────
function getIICRCJustification(item: any): string {
  const desc = (item.description || "").toLowerCase();
  if (desc.includes("extract")) return "IICRC S500 §7.4 — Required for all Category 2/3 losses to prevent secondary damage.";
  if (desc.includes("dehumid")) return "IICRC S500 §11.3 — LGR equipment required per Class 2/3 moisture levels.";
  if (desc.includes("air mover")) return "IICRC S500 §11.4 — Air movers required at 1 per 50 SF per Class 2 drying protocol.";
  if (desc.includes("antimicro")) return "IICRC S500 §9.7 — Antimicrobial treatment required for all Category 2+ losses.";
  if (desc.includes("emergency") || desc.includes("mobiliz")) return "IICRC S500 §6.1 — Emergency response within 2 hours required to mitigate secondary damage.";
  if (desc.includes("soot") || desc.includes("smoke") || (desc.includes("clean") && !desc.includes("antimicro"))) return "IICRC S700 §7 — Professional smoke/soot cleaning per fire restoration standard.";
  if (desc.includes("odor") || desc.includes("hydroxyl") || desc.includes("ozone")) return "IICRC S700 §9 — Hydroxyl/ozone treatment required to address embedded smoke odor.";
  if (desc.includes("board") || desc.includes("tarping") || desc.includes("tarp")) return "IICRC S700 §6 — Emergency securing required to prevent further loss.";
  if (desc.includes("content") || desc.includes("pack")) return "IICRC S700 §8 — Contents pack-out required per smoke contamination levels.";
  if (desc.includes("mold") || desc.includes("remediat") || desc.includes("contain")) return "IICRC S520 §12 — Full containment and remediation per mold remediation standard.";
  if (desc.includes("hepa") || desc.includes("air scrub") || desc.includes("negative")) return "IICRC S520 §10 — HEPA air filtration required during all mold remediation.";
  if (desc.includes("clearance") || desc.includes("test")) return "IICRC S520 §12 — Post-remediation clearance testing required before reconstruction.";
  if (desc.includes("dry") && (desc.includes("wall") || desc.includes("board"))) return "IICRC S500 §14 — Structural drying must reach baseline moisture before reconstruction.";
  if (desc.includes("reconstruct") || desc.includes("drywall") || desc.includes("framing") || desc.includes("flooring")) return "IICRC S500 §15 — Reconstruction may proceed only after certified drying completion.";
  return "Per IICRC industry standards and Xactimate regional pricing database.";
}

// ── Rebuttal Generator (auto, no prompt required) ────────────────────────────
function generateRebuttal(estimate: any, job: any): { text: string; state: "SC" | "GA"; statutesUsed: Statute[] } {
  const items = JSON.parse(estimate.lineItems || "[]");
  const total = estimate.total || 0;
  const jobNum = job?.jobNumber || "Unknown";
  const lossType = job?.lossType || "water";
  const carrier = job?.insuranceCarrier || "the carrier";
  const address = job?.address || "";

  const state = detectState(address);
  const statutes = selectStatutes(state, lossType);
  const iicrcRefs = IICRC_STANDARDS[lossType.toLowerCase()] || IICRC_STANDARDS.water;

  const itemList = items.map((i: any) =>
    `  • ${i.description}: $${Number(i.total).toFixed(2)}\n    Basis: ${getIICRCJustification(i)}`
  ).join("\n");

  const statuteList = statutes.map(s =>
    `• ${s.code} — ${s.topic}\n  ${s.text}\n  ↳ ${s.rebuttalHook}`
  ).join("\n\n");

  const iicrcList = iicrcRefs.map(r => `• ${r}`).join("\n");

  const stateLabel = state === "SC" ? "South Carolina" : "Georgia";

  const text = `FORMAL REBUTTAL & SUPPLEMENT DEMAND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Job: ${jobNum} | Loss Type: ${lossType.toUpperCase()} | Estimate Total: $${total.toFixed(2)}
Carrier: ${carrier} | State: ${stateLabel}
Property: ${address || "See job file"}
Date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TO THE ASSIGNED ADJUSTER:

Titan Restoration LLC respectfully submits this formal rebuttal to the carrier's reduction or denial of the documented scope of loss on this claim. All work reflected in our estimate was performed in strict compliance with IICRC ${lossType.toUpperCase()} restoration standards, Xactimate pricing methodology, and applicable ${stateLabel} insurance statutes.

SCOPE JUSTIFICATION BY LINE ITEM:
${itemList || "  • Full scope of documented loss — see attached estimate for line-item detail."}

IICRC STANDARD REFERENCES:
${iicrcList}

APPLICABLE ${stateLabel.toUpperCase()} STATE LAW:
${statuteList}

DEMAND:
Titan Restoration LLC demands payment of the full documented scope of loss within 30 days of this notice. The undisputed amounts must be tendered immediately under ${state === "SC" ? "SC Code § 38-77-310" : "GA Code § 33-6-34(4)"}. Failure to pay the full documented scope within 30 days may constitute bad faith under ${state === "SC" ? "SC Reg. 69-64(D) and SC Code § 38-59-40" : "GA Code § 33-4-6 and GA Code § 13-6-11"}, subjecting the carrier to penalties, attorney's fees, and potential litigation.

All supporting documentation — including moisture logs, drying records, psychrometric data, field photographs, signed authorizations, and equipment placement records — is available upon request and will be submitted to any arbitration or litigation panel.

Respectfully submitted,
Cody Brantley, Owner
Titan Restoration LLC
706-922-0154 | cody@titanrestorationllc.com
License: Licensed Contractor — GA & SC`;

  return { text, state, statutesUsed: statutes };
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ── GLOBAL API AUTH GATE (default-deny) ─────────────────────────────────────
  // Every /api/* request requires a valid staff session EXCEPT an explicit
  // allowlist of public endpoints (staff login, token-based customer/adjuster
  // portals which enforce their own session checks internally, health, and the
  // QuickBooks OAuth callback). This is mounted FIRST so it runs before any
  // route handler regardless of where that route is registered. Default-deny
  // means any route added in the future is protected automatically.
  {
    const { requireStaffAuth: gateStaffAuth } = makeAuthMiddleware(sqlite);
    // Exact paths OR path prefixes (matched against req.path) that stay public.
    const PUBLIC_API = [
      "/api/health",
      // Staff auth endpoints
      "/api/auth/login",
      "/api/auth/logout",
      "/api/auth/me",
      "/api/auth/change-password",
      // Quick PIN kiosk name list — returns ONLY {name, avatarInitials} for
      // active employees so the sign-in page can render the picker before the
      // user is authenticated. Mirrors add/deactivate/delete in User Management.
      "/api/auth/pin-users",
      // Forced-PIN-change flow (uses short-lived pinChangeToken from login response)
      "/api/auth/pin/change-forced",
      // 2FA enrollment + challenge flow — token-authenticated via body, not session
      "/api/auth/2fa/setup/start",
      "/api/auth/2fa/setup/verify",
      "/api/auth/2fa/verify",
      // Token-based portals (self-authenticated via portal session token)
      "/api/customer-portal/",   // prefix: login + all portal data/pay/stripe routes
      "/api/adjuster-portal/",   // prefix: access token + supplement response
      "/api/portal/login",
      // Remote e-signature — customer opens the /sign/:token page from email.
      // The signing token IS the auth (rotates on send, single-use, 7-day
      // expiry, revocable via cancel). GET fetches the pending doc, POST
      // returns the signed PDF + signature image. No staff session required.
      "/api/public/sign/",       // prefix: GET + POST /api/public/sign/:token
      // QuickBooks OAuth redirect callback (no bearer token on the redirect)
      "/api/qb/oauth/callback",
      "/api/qb/oauth/start",
      // Gmail OAuth redirect callback (Google redirects the browser here with no
      // bearer token; the employee is identified via a signed state param).
      "/api/gmail/oauth/callback",
    ];
    const isPublic = (p: string) =>
      PUBLIC_API.some((allow) =>
        allow.endsWith("/") ? p.startsWith(allow) : p === allow
      );
    app.use("/api", (req, res, next) => {
      // req.path here is relative to the "/api" mount, so re-prefix for matching.
      const full = "/api" + (req.path === "/" ? "" : req.path);
      if (isPublic(full)) return next();
      // Allow query-param session token for plain <a> / window.open flows that
      // can't attach an Authorization header (e.g. opening an uploaded PDF from
      // the Estimates tab). We only hoist ?t= into the header when Authorization
      // is missing so callers using headers keep normal behavior. The token is
      // still validated by gateStaffAuth against staff_sessions — no bypass.
      if (!req.headers.authorization && typeof req.query?.t === "string" && req.query.t) {
        req.headers.authorization = `Bearer ${req.query.t}`;
      }
      return gateStaffAuth(req, res, next);
    });
  }

  // ── Contacts ──────────────────────────────────────────────────────────────
  app.get("/api/contacts", (_req, res) => { res.json(storage.getContacts()); });
  app.get("/api/contacts/:id", (req, res) => {
    const c = storage.getContact(Number(req.params.id));
    if (!c) return res.status(404).json({ error: "Not found" });
    res.json(c);
  });
  app.post("/api/contacts", (req, res) => {
    // Require at least a name so blank/empty contacts can't be created.
    if (!req.body?.name || !String(req.body.name).trim()) {
      return res.status(400).json({ error: "Contact name is required." });
    }
    res.json(storage.createContact(req.body));
  });
  app.patch("/api/contacts/:id", (req, res) => {
    const c = storage.updateContact(Number(req.params.id), req.body);
    if (!c) return res.status(404).json({ error: "Not found" });
    res.json(c);
  });
  // DELETE /api/contacts/:id — safe-delete handler is registered later via
  // registerContactAdminRoutes(). The old naive handler was removed because it
  // orphaned jobs, invoices, portal sessions, and payout requests.


  // ── Jobs ──────────────────────────────────────────────────────────────────
  app.get("/api/jobs", (_req, res) => { res.json(storage.getJobs()); });

  // Search-scoped job list: returns EVERY non-deleted job — open, closed,
  // completed, pending — with the customer contact hydrated. Used by the
  // top-nav Global Search so a user can jump to any job by number, address,
  // or customer regardless of its current pipeline stage. Distinct from
  // /api/jobs, which hides closed jobs to keep the primary jobs list clean.
  // Global auth gate above already protects this path; no explicit middleware
  // needed here (and referencing requireStaffAuth before its later
  // destructuring would trip a TDZ ReferenceError at boot).
  app.get("/api/jobs/search-index", (_req, res) => {
    res.json(storage.getJobs(true));
  });

  // Property record lookup by address — called from the New Job form and
  // JobDetail address editor to auto-prefill year_built and square_feet from
  // OpenStreetMap. Always resolves to JSON, never 500s on upstream failure.
  app.get("/api/property-lookup", async (req, res) => {
    const address = String(req.query.address || "").trim();
    if (!address) return res.json({ yearBuilt: null, squareFeet: null, source: null, note: "Address required." });
    try {
      const result = await lookupProperty(address);
      res.json(result);
    } catch (_e: any) {
      res.json({ yearBuilt: null, squareFeet: null, source: null, note: "Lookup temporarily unavailable." });
    }
  });


  // ── Job Financial Summary (all jobs in one call) ──────────────────────────
  app.get("/api/jobs/financials", (_req, res) => {
    // Ensure credit_memo columns exist
    try { sqlite.exec(`ALTER TABLE payments ADD COLUMN credit_memo INTEGER DEFAULT 0`); } catch(_) {}
    try { sqlite.exec(`ALTER TABLE payments ADD COLUMN memo_reason TEXT`); } catch(_) {}

    const jobs = sqlite.prepare("SELECT id FROM jobs WHERE status IS NULL OR status != 'closed'").all() as any[];
    // Estimates and invoices soft-delete via `deleted_at`. Every aggregate
    // below must filter `deleted_at IS NULL`, otherwise the Financial Summary
    // card keeps the deleted row's dollars in the Estimate Amount / Outstanding
    // buckets even though the row is hidden from the list — which is what
    // "the total in the bucket persists after delete" was reporting.
    const invoices = sqlite.prepare("SELECT * FROM invoices WHERE deleted_at IS NULL").all() as any[];
    const payments = sqlite.prepare("SELECT * FROM payments").all() as any[];
    // Per-job, per-phase cost & estimate sums (estimates/invoices/job_costs carry a phase column).
    const costsPhase = sqlite.prepare("SELECT job_id, phase, SUM(total) as total FROM job_costs GROUP BY job_id, phase").all() as any[];
    const estimatesPhase = sqlite.prepare("SELECT job_id, phase, SUM(total) as total FROM estimates WHERE deleted_at IS NULL AND status != 'rejected' GROUP BY job_id, phase").all() as any[];
    // Externally-uploaded estimate/invoice rollup so the Financial Summary
    // card can call out how much of the totals came from outside-authored
    // documents (Xactimate PDFs, sub invoices, carrier approvals, etc.).
    // NULL source is treated as internal.
    const extEstimatesPhase = sqlite.prepare(
      "SELECT job_id, phase, COUNT(*) as cnt, SUM(total) as total FROM estimates WHERE deleted_at IS NULL AND source = 'external' AND status != 'rejected' GROUP BY job_id, phase"
    ).all() as any[];
    const extInvoicesPhase = sqlite.prepare(
      "SELECT job_id, phase, COUNT(*) as cnt, SUM(total) as total FROM invoices WHERE deleted_at IS NULL AND source = 'external' GROUP BY job_id, phase"
    ).all() as any[];
    const supplements = sqlite.prepare("SELECT job_id, SUM(amount_approved) as settled FROM supplements WHERE status IN ('approved','partial') GROUP BY job_id").all() as any[];

    const PHASES = ["mitigation", "reconstruction"] as const;
    const normPhase = (p: any) => (p === "reconstruction" ? "reconstruction" : "mitigation");

    // job_id -> phase -> amount
    const costPhaseMap: Record<number, Record<string, number>> = {};
    costsPhase.forEach((c: any) => {
      (costPhaseMap[c.job_id] ||= {});
      const ph = normPhase(c.phase);
      costPhaseMap[c.job_id][ph] = (costPhaseMap[c.job_id][ph] || 0) + (c.total || 0);
    });
    const estPhaseMap: Record<number, Record<string, number>> = {};
    estimatesPhase.forEach((e: any) => {
      (estPhaseMap[e.job_id] ||= {});
      const ph = normPhase(e.phase);
      estPhaseMap[e.job_id][ph] = (estPhaseMap[e.job_id][ph] || 0) + (e.total || 0);
    });

    // job_id -> phase -> { total, count } for externally-uploaded docs.
    type ExtBucket = { total: number; count: number };
    const extEstMap: Record<number, Record<string, ExtBucket>> = {};
    extEstimatesPhase.forEach((e: any) => {
      (extEstMap[e.job_id] ||= {});
      const ph = normPhase(e.phase);
      const cur = extEstMap[e.job_id][ph] ||= { total: 0, count: 0 };
      cur.total += (e.total || 0);
      cur.count += (e.cnt || 0);
    });
    const extInvMap: Record<number, Record<string, ExtBucket>> = {};
    extInvoicesPhase.forEach((i: any) => {
      (extInvMap[i.job_id] ||= {});
      const ph = normPhase(i.phase);
      const cur = extInvMap[i.job_id][ph] ||= { total: 0, count: 0 };
      cur.total += (i.total || 0);
      cur.count += (i.cnt || 0);
    });

    const suppMap: Record<number, number> = {};
    supplements.forEach((s: any) => { suppMap[s.job_id] = s.settled || 0; });

    const result: Record<number, any> = {};
    for (const job of jobs) {
      const jobInvoices = invoices.filter((i: any) => i.job_id === job.id);
      const invoiceTotal = jobInvoices.reduce((s: number, i: any) => s + (i.total || 0), 0);

      const jobPayments = payments.filter((p: any) => p.job_id === job.id || jobInvoices.some((i: any) => i.id === p.invoice_id));
      const collected = jobPayments.filter((p: any) => p.type === 'received' && !p.credit_memo).reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const creditMemos = jobPayments.filter((p: any) => p.credit_memo).reduce((s: number, p: any) => s + (p.amount || 0), 0);

      const totalCosts = (costPhaseMap[job.id]?.mitigation || 0) + (costPhaseMap[job.id]?.reconstruction || 0);
      const estimateTotal = (estPhaseMap[job.id]?.mitigation || 0) + (estPhaseMap[job.id]?.reconstruction || 0);
      const settledAmount = suppMap[job.id] || 0; // supplement approved (claim-level, no phase)
      const grossProfit = collected - totalCosts;

      // Invoice phase lookup for attributing payments.
      const invPhaseById: Record<number, string> = {};
      jobInvoices.forEach((i: any) => { invPhaseById[i.id] = normPhase(i.phase); });

      // Build per-phase breakdown.
      const byPhase: Record<string, any> = {};
      for (const ph of PHASES) {
        const phEstimate = estPhaseMap[job.id]?.[ph] || 0;
        const phCosts = costPhaseMap[job.id]?.[ph] || 0;
        const phInvoiceTotal = jobInvoices.filter((i: any) => normPhase(i.phase) === ph).reduce((s: number, i: any) => s + (i.total || 0), 0);
        // Payment attributed to the phase of its invoice; job-level payments (no invoice) default to mitigation.
        const phPayments = jobPayments.filter((p: any) => {
          const pph = p.invoice_id && invPhaseById[p.invoice_id] ? invPhaseById[p.invoice_id] : "mitigation";
          return pph === ph;
        });
        const phCollected = phPayments.filter((p: any) => p.type === 'received' && !p.credit_memo).reduce((s: number, p: any) => s + (p.amount || 0), 0);
        const phCreditMemos = phPayments.filter((p: any) => p.credit_memo).reduce((s: number, p: any) => s + (p.amount || 0), 0);
        const phGrossProfit = phCollected - phCosts;
        const phExtEst = extEstMap[job.id]?.[ph] || { total: 0, count: 0 };
        const phExtInv = extInvMap[job.id]?.[ph] || { total: 0, count: 0 };
        byPhase[ph] = {
          estimateTotal: phEstimate,
          invoiceTotal: phInvoiceTotal,
          collected: phCollected,
          creditMemos: phCreditMemos,
          totalCosts: phCosts,
          grossProfit: phGrossProfit,
          settledAmount, // claim-level, shown on both phases
          grossMarginPct: phCollected > 0 ? Math.round((phGrossProfit / phCollected) * 100) : 0,
          outstanding: Math.max(0, phInvoiceTotal - phCollected),
          externalEstimateTotal: phExtEst.total,
          externalEstimateCount: phExtEst.count,
          externalInvoiceTotal: phExtInv.total,
          externalInvoiceCount: phExtInv.count,
        };
      }

      // Job-level external totals (sum across phases).
      const extEstTotalJob = (extEstMap[job.id]?.mitigation?.total || 0) + (extEstMap[job.id]?.reconstruction?.total || 0);
      const extEstCountJob = (extEstMap[job.id]?.mitigation?.count || 0) + (extEstMap[job.id]?.reconstruction?.count || 0);
      const extInvTotalJob = (extInvMap[job.id]?.mitigation?.total || 0) + (extInvMap[job.id]?.reconstruction?.total || 0);
      const extInvCountJob = (extInvMap[job.id]?.mitigation?.count || 0) + (extInvMap[job.id]?.reconstruction?.count || 0);

      result[job.id] = {
        jobId: job.id,
        estimateTotal,
        invoiceTotal,
        collected,
        creditMemos,
        totalCosts,
        grossProfit,
        settledAmount,
        grossMarginPct: collected > 0 ? Math.round(((collected - totalCosts) / collected) * 100) : 0,
        outstanding: Math.max(0, invoiceTotal - collected),
        externalEstimateTotal: extEstTotalJob,
        externalEstimateCount: extEstCountJob,
        externalInvoiceTotal: extInvTotalJob,
        externalInvoiceCount: extInvCountJob,
        byPhase,
      };
    }
    res.json(result);
  });

  // ── Weekly Billing Report (OWNER ONLY) ────────────────────────────────────
  // Billed vs Settled vs Collected, bucketed by ISO week (Mon–Sun).
  const { requireRole, requireStaffAuth } = makeAuthMiddleware(sqlite);
  // In-app notification bell helper. Shared with every event site below
  // (new job, WIP start, note add, estimate & invoice writes…).
  const notifier = makeNotifier(sqlite);

  // Audit log + soft-delete trash. Adds /api/audit-log, /api/trash,
  // /api/trash/:table/:id/restore, DELETE /api/trash/:table/:id, plus a
  // 30-day retention sweep. See server/auditAndTrash.ts.
  const { logAudit, softDelete } = initAuditAndTrash(app, sqlite, requireStaffAuth);

  // Analytics overview — GET /api/analytics/overview?days=90.
  // Cycle time, estimate variance, supplement win rate, tech productivity,
  // aging AR, lead conversion, and margin distribution in one payload.
  registerAnalyticsRoutes(app, sqlite as any, requireStaffAuth);
  registerSubcontractorRoutes(app, sqlite as any, requireStaffAuth);
  registerContactAdminRoutes(app, sqlite as any, requireStaffAuth);
  registerExternalDocRoutes(app, sqlite as any, requireStaffAuth);

  // ── In-app notification bell (per-user) ──────────────────────────────────
  // Every endpoint is scoped to the authenticated employee — no name picker
  // required. Also merges legacy rows targeted at this employee's tech_name.
  app.get("/api/notifications/me", requireStaffAuth, (req: any, res) => {
    const emp = req.employee;
    const rows = sqlite.prepare(
      `SELECT * FROM tech_notifications
         WHERE employee_id = ? OR (employee_id IS NULL AND tech_name = ?)
         ORDER BY created_at DESC
         LIMIT 50`
    ).all(emp.id, emp.name);
    res.json(rows.map((r: any) => ({
      id: r.id, type: r.type, title: r.title, body: r.body,
      jobId: r.job_id, link: r.link, read: !!r.read, createdAt: r.created_at,
    })));
  });
  app.get("/api/notifications/me/unread-count", requireStaffAuth, (req: any, res) => {
    const emp = req.employee;
    const row: any = sqlite.prepare(
      `SELECT COUNT(*) AS count FROM tech_notifications
         WHERE read = 0 AND (employee_id = ? OR (employee_id IS NULL AND tech_name = ?))`
    ).get(emp.id, emp.name);
    res.json({ count: row?.count || 0 });
  });
  app.patch("/api/notifications/:id/read", requireStaffAuth, (req: any, res) => {
    const emp = req.employee;
    // Only allow marking read on notifications targeted at this employee.
    const info = sqlite.prepare(
      `UPDATE tech_notifications SET read = 1
         WHERE id = ? AND (employee_id = ? OR (employee_id IS NULL AND tech_name = ?))`
    ).run(Number(req.params.id), emp.id, emp.name);
    res.json({ ok: true, changed: info.changes });
  });
  app.patch("/api/notifications/me/read-all", requireStaffAuth, (req: any, res) => {
    const emp = req.employee;
    const info = sqlite.prepare(
      `UPDATE tech_notifications SET read = 1
         WHERE read = 0 AND (employee_id = ? OR (employee_id IS NULL AND tech_name = ?))`
    ).run(emp.id, emp.name);
    res.json({ ok: true, changed: info.changes });
  });
  app.delete("/api/notifications/:id", requireStaffAuth, (req: any, res) => {
    const emp = req.employee;
    const info = sqlite.prepare(
      `DELETE FROM tech_notifications
         WHERE id = ? AND (employee_id = ? OR (employee_id IS NULL AND tech_name = ?))`
    ).run(Number(req.params.id), emp.id, emp.name);
    res.json({ ok: true, changed: info.changes });
  });
  // Roster used by @-mention pickers. Same shape the notifier uses to resolve
  // mentions server-side, so the UI can stay in sync.
  app.get("/api/notifications/mentionable", requireStaffAuth, (_req, res) => {
    res.json(notifier.activeEmployeeRoster());
  });

  // Recompute line-item totals + subtotal + total on the server so the client
  // can never dictate a money amount that doesn't match the line items. Accepts
  // the request body, mutates a copy, and returns it. Trusts qty/unitPrice and
  // an explicit numeric `tax`, recomputing everything else. Leaves the body
  // untouched if no lineItems are present (e.g. status-only PATCH).
  function recomputeDocTotals(body: any): any {
    const out: any = { ...(body || {}) };
    if (out.lineItems == null) return out;
    let items: any[];
    try {
      items = typeof out.lineItems === "string" ? JSON.parse(out.lineItems) : out.lineItems;
    } catch { return out; }
    if (!Array.isArray(items)) return out;
    let subtotal = 0;
    for (const it of items) {
      const qty = Number(it.quantity ?? it.qty ?? 1) || 0;
      const unit = Number(it.unitPrice ?? it.unit_price ?? 0) || 0;
      const lineTotal = Math.round(qty * unit * 100) / 100;
      it.total = lineTotal;
      subtotal += lineTotal;
    }
    subtotal = Math.round(subtotal * 100) / 100;
    const tax = Number(out.tax) || 0;
    out.subtotal = subtotal;
    out.tax = tax;
    out.total = Math.round((subtotal + tax) * 100) / 100;
    // Persist the recomputed, per-line-corrected items as a JSON string.
    out.lineItems = JSON.stringify(items);
    return out;
  }

  // ── Notify all employees when a new job is entered ──────────────────────────
  // Posts an announcement to the team messaging channel AND drops a per-employee
  // notification into each active employee's inbox. Never throws (best-effort).
  function notifyNewJob(job: any) {
    try {
      if (!job) return;
      const contact = job.contactId ? storage.getContact(Number(job.contactId)) : undefined;
      const customerName = (contact as any)?.name || "New customer";
      const loss = (job.lossType || "").toString();
      const lossLabel = loss ? loss.charAt(0).toUpperCase() + loss.slice(1) : "General";
      const addr = job.address ? ` at ${job.address}` : "";
      const assigned = job.assignedTech ? ` · Assigned: ${job.assignedTech}` : " · Unassigned";
      const title = `New job ${job.jobNumber} entered`;
      const body = `${lossLabel} loss for ${customerName}${addr}.${assigned}`;
      const nowIso = new Date().toISOString();

      // 1) Post to the team messaging channel (general, id=1)
      const channels = storage.getChannels();
      const generalChannel = channels.find((c) => c.name === "general" || c.id === 1) || channels[0];
      if (generalChannel) {
        const chanMsg = [
          `🆕 New job entered: ${job.jobNumber}`,
          `${lossLabel} loss${addr}`,
          `Customer: ${customerName}${assigned}`,
          `Status: ${job.status || "lead"}`,
        ].join("\n");
        storage.createMessage({ channelId: generalChannel.id, author: "Titan Pro Bot", body: chanMsg });
      }

      // 2) Per-employee notification for every active employee — now also
      // records employee_id + link so the header bell can filter reliably
      // and deep-link to the job on click.
      const insertNote = sqlite.prepare(
        `INSERT INTO tech_notifications
           (tech_name, type, title, body, job_id, employee_id, link, created_at)
         VALUES (?, 'new_job', ?, ?, ?, ?, ?, ?)`
      );
      const employees = storage.getEmployees().filter((e: any) => {
        const active = (e.isActive ?? e.is_active);
        return active === undefined || active === true || active === 1;
      });
      const link = `/jobs/${job.id}`;
      for (const emp of employees) {
        if (!emp?.name || !emp?.id) continue;
        insertNote.run(emp.name, title, body, job.id, emp.id, link, nowIso);
      }
    } catch (e) {
      console.error("[jobs] new-job notification failed:", (e as any)?.message || e);
    }
  }

  // Fires when a job's WIP Date is set (empty → set). Notifies every active
  // sales/BDM employee so they know to pay the referral partner. Idempotent:
  // callers must only invoke this on the empty→set transition. Best-effort;
  // never throws.
  function notifyBDMOfWipStart(job: any) {
    try {
      if (!job) return;
      const contact = job.contactId ? storage.getContact(Number(job.contactId)) : undefined;
      const customerName = (contact as any)?.name || "customer";
      const partnerName = job.referralPartnerId
        ? (storage.getContact(Number(job.referralPartnerId)) as any)?.name
        : undefined;
      const source = job.leadSource ? String(job.leadSource) : "";
      const partnerLine = partnerName
        ? ` Referral partner: ${partnerName}.`
        : (source ? ` Lead source: ${source}${job.leadSourceDetail ? ` (${job.leadSourceDetail})` : ""}.` : "");
      const addr = job.address ? ` at ${job.address}` : "";
      const title = `Job ${job.jobNumber} started — partner payout due`;
      const body = `WIP started for ${customerName}${addr}.${partnerLine} Open the job to confirm and mark partner payout.`;
      const nowIso = new Date().toISOString();

      const insertNote = sqlite.prepare(
        `INSERT INTO tech_notifications (tech_name, type, title, body, job_id, created_at) VALUES (?, 'wip_started', ?, ?, ?, ?)`
      );
      // Route to every active sales/BDM employee (Miranda + any future BDMs).
      const employees = storage.getEmployees().filter((e: any) => {
        const active = (e.isActive ?? e.is_active);
        const isActive = active === undefined || active === true || active === 1;
        const role = String((e as any).role || "").toLowerCase();
        return isActive && (role === "sales" || role === "bdm");
      });
      for (const emp of employees) {
        if (!emp?.name) continue;
        insertNote.run(emp.name, title, body, job.id, nowIso);
      }
    } catch (e) {
      console.error("[jobs] BDM WIP-start notification failed:", (e as any)?.message || e);
    }
  }

  app.get("/api/reports/weekly-billing", requireRole("owner"), (req, res) => {
    try { sqlite.exec(`ALTER TABLE payments ADD COLUMN credit_memo INTEGER DEFAULT 0`); } catch(_) {}

    // Optional query params: groupBy=week|month (default week), from=YYYY-MM-DD, to=YYYY-MM-DD (inclusive)
    const groupBy = (String(req.query.groupBy || "week").toLowerCase() === "month") ? "month" : "week";
    // division=mitigation|reconstruction|both|unassigned|all (default all). Scopes the Brought In / Cost / Net
    // KPIs, chart, and period table to a single division. 'billed'/'settled' are not division-tagged, so
    // when a division filter is active those columns show 0 (money-in/out is what's division-aware).
    const divisionFilterRaw = String(req.query.division || "all").toLowerCase();
    const divisionFilter = ["mitigation", "reconstruction", "both", "unassigned"].includes(divisionFilterRaw) ? divisionFilterRaw : "all";
    const fromStr = typeof req.query.from === "string" && req.query.from ? String(req.query.from) : null;
    const toStr = typeof req.query.to === "string" && req.query.to ? String(req.query.to) : null;
    const fromDate = fromStr ? new Date(fromStr + "T00:00:00") : null;
    const toDate = toStr ? new Date(toStr + "T23:59:59") : null;
    const fromValid = fromDate && !isNaN(fromDate.getTime()) ? fromDate : null;
    const toValid = toDate && !isNaN(toDate.getTime()) ? toDate : null;

    // Keep dates within the [from, to] range (inclusive). No bound = pass through.
    function inRange(dateStr: string): boolean {
      if (!fromValid && !toValid) return true;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;
      if (fromValid && d < fromValid) return false;
      if (toValid && d > toValid) return false;
      return true;
    }

    const invoices = sqlite.prepare("SELECT total, created_at FROM invoices").all() as any[];
    const payments = sqlite.prepare("SELECT amount, type, credit_memo, paid_at, job_id FROM payments").all() as any[];
    const supplements = sqlite.prepare("SELECT amount_approved, status, response_at, submitted_at, created_at FROM supplements").all() as any[];
    const jobCosts = sqlite.prepare("SELECT total, cost_date, created_at, job_id FROM job_costs").all() as any[];

    // Map each job to its division tag (mitigation | reconstruction | both).
    // Missing/unknown tags fall into 'unassigned' so nothing is silently dropped.
    let jobDivRows: any[] = [];
    try { jobDivRows = sqlite.prepare("SELECT id, division FROM jobs WHERE status IS NULL OR status != 'closed'").all() as any[]; } catch (_) { jobDivRows = []; }
    const jobDivision: Record<number, string> = {};
    for (const j of jobDivRows) {
      const d = String(j.division || "").toLowerCase();
      jobDivision[j.id] = (d === "mitigation" || d === "reconstruction" || d === "both") ? d : "unassigned";
    }
    // A 'both' job splits its money 50/50 across the two divisions.
    const divisions = {
      mitigation: { collected: 0, cost: 0 },
      reconstruction: { collected: 0, cost: 0 },
      unassigned: { collected: 0, cost: 0 },
    };
    function addToDivision(jobId: number | null | undefined, field: "collected" | "cost", amount: number) {
      const div = (jobId != null && jobDivision[jobId]) ? jobDivision[jobId] : "unassigned";
      if (div === "both") {
        divisions.mitigation[field] += amount / 2;
        divisions.reconstruction[field] += amount / 2;
      } else {
        (divisions as any)[div][field] += amount;
      }
    }

    // Return the Monday (local) that starts the ISO-style week for a date string.
    function weekStart(dateStr: string): string | null {
      if (!dateStr) return null;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return null;
      const day = d.getDay();               // 0=Sun..6=Sat
      const diff = (day === 0 ? -6 : 1 - day); // shift back to Monday
      const monday = new Date(d);
      monday.setDate(d.getDate() + diff);
      monday.setHours(0, 0, 0, 0);
      const y = monday.getFullYear();
      const m = String(monday.getMonth() + 1).padStart(2, "0");
      const dd = String(monday.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    }

    // Return the first-of-month (YYYY-MM-01) that a date falls in.
    function monthStart(dateStr: string): string | null {
      if (!dateStr) return null;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return null;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      return `${y}-${m}-01`;
    }

    const periodKey = groupBy === "month" ? monthStart : weekStart;

    // Fresh per-period division accumulator: { mitigation:{collected,cost}, reconstruction:{...}, unassigned:{...} }.
    function freshDiv() {
      return {
        mitigation: { collected: 0, cost: 0 },
        reconstruction: { collected: 0, cost: 0 },
        unassigned: { collected: 0, cost: 0 },
      };
    }
    const buckets: Record<string, { periodStart: string; billed: number; settled: number; collected: number; creditMemos: number; cost: number; byDivision: ReturnType<typeof freshDiv> }> = {};
    function bucket(key: string | null) {
      if (!key) return null;
      if (!buckets[key]) buckets[key] = { periodStart: key, billed: 0, settled: 0, collected: 0, creditMemos: 0, cost: 0, byDivision: freshDiv() };
      return buckets[key];
    }

    // Route a per-period division amount, splitting 'both' 50/50 like the totals do.
    function addToPeriodDivision(b: NonNullable<ReturnType<typeof bucket>>, jobId: number | null | undefined, field: "collected" | "cost", amount: number) {
      const div = (jobId != null && jobDivision[jobId]) ? jobDivision[jobId] : "unassigned";
      if (div === "both") {
        b.byDivision.mitigation[field] += amount / 2;
        b.byDivision.reconstruction[field] += amount / 2;
      } else {
        (b.byDivision as any)[div][field] += amount;
      }
    }

    // Billed = invoice totals, by invoice creation date
    for (const inv of invoices) {
      if (!inv.created_at || !inRange(inv.created_at)) continue;
      const b = bucket(periodKey(inv.created_at));
      if (b) b.billed += inv.total || 0;
    }
    // Settled = approved/partial supplement amounts, by response date (fallback submitted/created)
    for (const s of supplements) {
      if (!(s.status === "approved" || s.status === "partial")) continue;
      const sDate = s.response_at || s.submitted_at || s.created_at;
      if (!sDate || !inRange(sDate)) continue;
      const b = bucket(periodKey(sDate));
      if (b) b.settled += s.amount_approved || 0;
    }
    // Collected = received payments (excluding credit memos), by paid date
    for (const p of payments) {
      if (!p.paid_at || !inRange(p.paid_at)) continue;
      const b = bucket(periodKey(p.paid_at));
      if (!b) continue;
      if (p.type === "received" && !p.credit_memo) {
        b.collected += p.amount || 0;
        addToDivision(p.job_id, "collected", p.amount || 0);
        addToPeriodDivision(b, p.job_id, "collected", p.amount || 0);
      }
      if (p.credit_memo) b.creditMemos += p.amount || 0;
    }
    // Cost = job costs, by cost date (fallback to created date)
    for (const jc of jobCosts) {
      const cDate = jc.cost_date || jc.created_at;
      if (!cDate || !inRange(cDate)) continue;
      const b = bucket(periodKey(cDate));
      if (b) { b.cost += jc.total || 0; addToPeriodDivision(b, jc.job_id, "cost", jc.total || 0); }
      addToDivision(jc.job_id, "cost", jc.total || 0);
    }

    const rawPeriods = Object.values(buckets).sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1));

    // Resolve a division bucket's collected/cost for the active filter. 'both' isn't a stored bucket
    // (it's split at write time), so a 'both' filter sums mitigation+reconstruction back together.
    function divCollectedCost(bd: ReturnType<typeof freshDiv>): { collected: number; cost: number } {
      if (divisionFilter === "all") return { collected: bd.mitigation.collected + bd.reconstruction.collected + bd.unassigned.collected, cost: bd.mitigation.cost + bd.reconstruction.cost + bd.unassigned.cost };
      if (divisionFilter === "both") return { collected: bd.mitigation.collected + bd.reconstruction.collected, cost: bd.mitigation.cost + bd.reconstruction.cost };
      const d = (bd as any)[divisionFilter] as { collected: number; cost: number };
      return { collected: d.collected, cost: d.cost };
    }

    // Build the outward-facing periods. When a division filter is active, Brought In / Cost are
    // scoped to that division and Billed/Settled/Credit Memos zero out (not division-attributable).
    // Per-period byDivision (rounded) always ships so the chart can draw division trend lines.
    const periods = rawPeriods.map((r) => {
      const scoped = divisionFilter === "all"
        ? { billed: r.billed, settled: r.settled, collected: r.collected, creditMemos: r.creditMemos, cost: r.cost }
        : (() => { const cc = divCollectedCost(r.byDivision); return { billed: 0, settled: 0, collected: cc.collected, creditMemos: 0, cost: cc.cost }; })();
      return {
        periodStart: r.periodStart,
        billed: Math.round(scoped.billed),
        settled: Math.round(scoped.settled),
        collected: Math.round(scoped.collected),
        creditMemos: Math.round(scoped.creditMemos),
        cost: Math.round(scoped.cost),
        byDivision: {
          mitigation: { collected: Math.round(r.byDivision.mitigation.collected), cost: Math.round(r.byDivision.mitigation.cost), net: Math.round(r.byDivision.mitigation.collected - r.byDivision.mitigation.cost) },
          reconstruction: { collected: Math.round(r.byDivision.reconstruction.collected), cost: Math.round(r.byDivision.reconstruction.cost), net: Math.round(r.byDivision.reconstruction.collected - r.byDivision.reconstruction.cost) },
          unassigned: { collected: Math.round(r.byDivision.unassigned.collected), cost: Math.round(r.byDivision.unassigned.cost), net: Math.round(r.byDivision.unassigned.collected - r.byDivision.unassigned.cost) },
        },
      };
    });

    const totals = periods.reduce((t, r) => ({
      billed: t.billed + r.billed,
      settled: t.settled + r.settled,
      collected: t.collected + r.collected,
      creditMemos: t.creditMemos + r.creditMemos,
      cost: t.cost + r.cost,
    }), { billed: 0, settled: 0, collected: 0, creditMemos: 0, cost: 0 });

    // Division profitability breakdown (respects the same date range filter).
    function divRow(name: string, d: { collected: number; cost: number }) {
      const collected = Math.round(d.collected);
      const cost = Math.round(d.cost);
      const net = collected - cost;
      return {
        division: name,
        collected,
        cost,
        net,
        marginPct: collected > 0 ? Math.round((net / collected) * 100) : 0,
        profitable: net > 0,
      };
    }
    const divisionBreakdown = [
      divRow("mitigation", divisions.mitigation),
      divRow("reconstruction", divisions.reconstruction),
    ];
    // Only surface 'unassigned' if it actually carries money (so the UI can prompt tagging).
    if (divisions.unassigned.collected > 0.5 || divisions.unassigned.cost > 0.5) {
      divisionBreakdown.push(divRow("unassigned", divisions.unassigned));
    }

    // `weeks` kept for backward compatibility; add `periods` + `groupBy` for the new UI.
    const legacyWeeks = periods.map(p => ({ weekStart: p.periodStart, billed: p.billed, settled: p.settled, collected: p.collected, creditMemos: p.creditMemos, cost: p.cost }));
    res.json({ groupBy, from: fromStr, to: toStr, division: divisionFilter, periods, weeks: legacyWeeks, totals, divisions: divisionBreakdown });
  });

  // Line-item detail for a single weekly-billing period (bucket). Returns the actual
  // invoices / payments / costs / supplements that rolled up into one period so the
  // user can review and open each record. Uses the same week/month keying as the report.
  app.get("/api/reports/weekly-billing/detail", requireRole("owner"), (req, res) => {
    const groupBy = (String(req.query.groupBy || "week").toLowerCase() === "month") ? "month" : "week";
    const periodStart = String(req.query.periodStart || "");
    if (!periodStart) return res.status(400).json({ error: "periodStart is required" });

    function weekStartKey(dateStr: string): string | null {
      if (!dateStr) return null;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return null;
      const day = d.getDay();
      const diff = (day === 0 ? -6 : 1 - day);
      const monday = new Date(d);
      monday.setDate(d.getDate() + diff);
      monday.setHours(0, 0, 0, 0);
      return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
    }
    function monthStartKey(dateStr: string): string | null {
      if (!dateStr) return null;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return null;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    }
    const keyOf = groupBy === "month" ? monthStartKey : weekStartKey;

    const invoices = sqlite.prepare("SELECT id, invoice_number, total, created_at, job_id, contact_id, status FROM invoices").all() as any[];
    const payments = sqlite.prepare("SELECT id, amount, type, credit_memo, paid_at, job_id, method FROM payments").all() as any[];
    const supplements = sqlite.prepare("SELECT id, amount_approved, status, response_at, submitted_at, created_at, job_id FROM supplements").all() as any[];
    const jobCosts = sqlite.prepare("SELECT id, total, cost_date, created_at, job_id, category, description FROM job_costs").all() as any[];
    const jobs = storage.getJobs() as any[];
    const contacts = storage.getContacts() as any[];
    const jobNum = (id: any) => jobs.find(j => j.id === id)?.jobNumber || null;
    const contactName = (id: any) => contacts.find(c => c.id === id)?.name || null;

    const billed = invoices
      .filter(inv => inv.created_at && keyOf(inv.created_at) === periodStart)
      .map(inv => ({ id: inv.id, invoiceNumber: inv.invoice_number, total: inv.total || 0, jobId: inv.job_id, jobNumber: jobNum(inv.job_id), contactName: contactName(inv.contact_id), status: inv.status, date: inv.created_at }));

    const collected = payments
      .filter(p => p.paid_at && p.type === "received" && !p.credit_memo && keyOf(p.paid_at) === periodStart)
      .map(p => ({ id: p.id, amount: p.amount || 0, jobId: p.job_id, jobNumber: jobNum(p.job_id), method: p.method, date: p.paid_at }));

    const creditMemos = payments
      .filter(p => p.paid_at && p.credit_memo && keyOf(p.paid_at) === periodStart)
      .map(p => ({ id: p.id, amount: p.amount || 0, jobId: p.job_id, jobNumber: jobNum(p.job_id), date: p.paid_at }));

    const costs = jobCosts
      .filter(jc => { const d = jc.cost_date || jc.created_at; return d && keyOf(d) === periodStart; })
      .map(jc => ({ id: jc.id, total: jc.total || 0, jobId: jc.job_id, jobNumber: jobNum(jc.job_id), category: jc.category, description: jc.description, date: jc.cost_date || jc.created_at }));

    const settled = supplements
      .filter(s => (s.status === "approved" || s.status === "partial") && keyOf(s.response_at || s.submitted_at || s.created_at) === periodStart)
      .map(s => ({ id: s.id, amountApproved: s.amount_approved || 0, jobId: s.job_id, jobNumber: jobNum(s.job_id), status: s.status, date: s.response_at || s.submitted_at || s.created_at }));

    res.json({ periodStart, groupBy, billed, collected, creditMemos, costs, settled });
  });

  // NOTE: /api/jobs/closed must be registered before /api/jobs/:id so Express
  // doesn’t interpret "closed" as a job id. The full closed-job endpoint is
  // defined further below with the close/reopen handlers; here we only reserve
  // the literal prefix in route order.
  app.get("/api/jobs/closed", requireRole("owner", "admin"), (_req, res) => {
    res.json(storage.getClosedJobs());
  });

  app.get("/api/jobs/:id", (req, res) => {
    const j = storage.getJob(Number(req.params.id));
    if (!j) return res.status(404).json({ error: "Not found" });
    res.json(j);
  });
  app.post("/api/jobs", (req, res) => {
    try {
      const job = storage.createJob(req.body);
      notifyNewJob(job);
      // If the job was created with a WIP Date already set, treat that as an
      // empty→set transition and notify BDMs immediately (partner payout due).
      if ((job as any)?.wipDate) notifyBDMOfWipStart(job);
      // Kick off geocoding in the background so the map picks up the pin as
      // soon as Nominatim responds. Never blocks the response.
      if (job?.address) geocodeJobInBackground(sqlite, job.id, job.address);
      res.json(job);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Unable to create job" });
    }
  });
  app.patch("/api/jobs/:id", (req, res, next) => {
    // Referral payout fields (owed amount + paid date) may only be set by
    // owner/admin/sales. Techs can update other job fields freely, so we only
    // enforce a staff session + role when the payout fields are being touched.
    const touchesPayout = req.body && ("partnerPayoutApplied" in req.body || "partnerPayoutDate" in req.body);
    if (!touchesPayout) return next();
    requireRole("owner", "admin", "sales")(req, res, next);
  }, (req, res) => {
    const jobId = Number(req.params.id);
    const before: any = sqlite.prepare("SELECT address, latitude, wip_date FROM jobs WHERE id = ?").get(jobId);
    const j = storage.updateJob(jobId, req.body);
    if (!j) return res.status(404).json({ error: "Not found" });
    // If the address changed OR we still have no coordinates, (re)geocode.
    const addressChanged = before && before.address !== j.address;
    const missingCoords = j.latitude == null;
    if (j.address && (addressChanged || missingCoords)) {
      if (addressChanged) {
        try { sqlite.prepare("UPDATE jobs SET latitude=NULL, longitude=NULL, geocoded_at=NULL WHERE id=?").run(jobId); } catch {}
      }
      geocodeJobInBackground(sqlite, jobId, j.address);
    }
    // BDM notification: fire ONLY on the empty→set transition of wipDate.
    // Idempotent — re-saving the same wipDate does not re-notify.
    const beforeWip = before && before.wip_date ? String(before.wip_date).trim() : "";
    const afterWip = (j as any)?.wipDate ? String((j as any).wipDate).trim() : "";
    if (!beforeWip && afterWip) {
      notifyBDMOfWipStart(j);
    }
    res.json(j);
  });

  // Bulk backfill for jobs that have an address but no coordinates. Any
  // authenticated staff can trigger this from the dashboard "Map N missing"
  // button; there's no write-side risk beyond re-geocoding public addresses.
  // Runs in the background and returns the queued count immediately;
  // callers can poll /api/jobs to watch coordinates fill in.
  app.post("/api/jobs/geocode-missing", (req, res) => {
    // ── Address backfill first ────────────────────────────────────────────────
    // Some legacy jobs were created with the address only on the linked
    // contact record. Copy the contact address onto the job row so the
    // geocoder + map + route planner all agree on a single source of truth.
    // Safe: only touches rows whose job address is blank.
    const backfill: any[] = sqlite.prepare(`
      SELECT j.id AS id, c.address AS c_addr
      FROM jobs j LEFT JOIN contacts c ON c.id = j.contact_id
      WHERE (j.address IS NULL OR TRIM(j.address) = '')
        AND c.address IS NOT NULL AND TRIM(c.address) <> ''
        AND (j.status IS NULL OR j.status <> 'closed')
    `).all();
    let backfilled = 0;
    for (const b of backfill) {
      sqlite.prepare("UPDATE jobs SET address = ? WHERE id = ?").run(b.c_addr, b.id);
      backfilled++;
    }
    const rows: any[] = sqlite.prepare(
      "SELECT id, address FROM jobs WHERE address IS NOT NULL AND TRIM(address) <> '' AND (latitude IS NULL OR longitude IS NULL) AND (status IS NULL OR status <> 'closed')"
    ).all();
    for (const r of rows) geocodeJobInBackground(sqlite, r.id, r.address);
    res.json({ queued: rows.length, backfilled });
  });

  // ── Backup rescue ─────────────────────────────────────────────
  // Owner-only endpoints to list the rotating DB snapshots and restore one.
  // Written specifically for the scenario where a redeploy or migration
  // eats data — the operator can pick the most recent backup taken before
  // the incident and roll the live DB back to that point without shell
  // access. Restore takes a safety copy of the current file first so the
  // operation is itself reversible.
  app.get("/api/admin/backups", requireRole("owner"), async (req, res) => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const dbPath = process.env.DATABASE_PATH || "data.db";
      const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(dbPath), "backups");
      if (!fs.existsSync(backupDir)) return res.json({ backupDir, backups: [], current: null });
      const files = fs.readdirSync(backupDir)
        .filter(f => /^data-.*\.db$/.test(f))
        .map(f => {
          const full = path.join(backupDir, f);
          const stat = fs.statSync(full);
          // Probe the backup to report how many jobs/employees it contains —
          // helps the owner pick the right snapshot without guessing.
          let jobs = 0, employees = 0, jobNumbers: string[] = [];
          try {
            const probe = new BetterSqlite3(full, { readonly: true });
            try {
              const jr: any = probe.prepare("SELECT COUNT(*) AS n FROM jobs").get();
              const er: any = probe.prepare("SELECT COUNT(*) AS n FROM employees WHERE is_active = 1").get();
              const sample: any[] = probe.prepare("SELECT job_number FROM jobs ORDER BY id DESC LIMIT 5").all();
              jobs = Number(jr?.n || 0);
              employees = Number(er?.n || 0);
              jobNumbers = sample.map(r => r.job_number).filter(Boolean);
            } catch { /* schema mismatch */ }
            probe.close();
          } catch { /* unreadable */ }
          return {
            file: f,
            path: full,
            sizeBytes: stat.size,
            mtime: stat.mtime.toISOString(),
            jobs,
            activeEmployees: employees,
            recentJobNumbers: jobNumbers,
          };
        })
        .sort((a, b) => b.mtime.localeCompare(a.mtime));
      // Current live DB summary for comparison.
      let current: any = null;
      try {
        const stat = fs.statSync(dbPath);
        const jr: any = sqlite.prepare("SELECT COUNT(*) AS n FROM jobs").get();
        const er: any = sqlite.prepare("SELECT COUNT(*) AS n FROM employees WHERE is_active = 1").get();
        current = {
          path: dbPath,
          sizeBytes: stat.size,
          mtime: stat.mtime.toISOString(),
          jobs: Number(jr?.n || 0),
          activeEmployees: Number(er?.n || 0),
        };
      } catch { /* db not on disk yet */ }
      res.json({ backupDir, current, backups: files });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  // Restore a specific backup. The current DB is safety-copied to
  // <db>.pre-restore-<timestamp>.bak before the swap so the operation is
  // reversible. Requires ?file=<name> that matches one of the listed
  // backups (name-only, never a full path — defends against traversal).
  app.post("/api/admin/backups/restore", requireRole("owner"), async (req, res) => {
    try {
      const file = String(req.body?.file || "").trim();
      if (!/^data-[A-Za-z0-9._:-]+\.db$/.test(file)) {
        return res.status(400).json({ error: "Invalid backup file name" });
      }
      const fs = await import("fs");
      const path = await import("path");
      const dbPath = process.env.DATABASE_PATH || "data.db";
      const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(dbPath), "backups");
      const src = path.join(backupDir, file);
      if (!fs.existsSync(src)) return res.status(404).json({ error: "Backup not found" });

      // 1) Safety-copy the current DB.
      const safety = dbPath + ".pre-restore-" + Date.now() + ".bak";
      fs.copyFileSync(dbPath, safety);

      // 2) Copy the chosen backup over the current DB. The running process
      //    already has an open handle — this replaces the file underneath
      //    it. SQLite will keep using its in-memory pages until restart. We
      //    return a hint telling the operator to redeploy (which restarts
      //    the process cleanly) so the new file is opened fresh.
      fs.copyFileSync(src, dbPath);

      res.json({
        restored: file,
        safetyCopy: safety,
        note: "Restore complete. Redeploy or restart the server so the new DB file is opened cleanly.",
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  // Force an immediate on-demand backup (in addition to the scheduled ones).
  // Handy before risky operations — an operator can hit this from the
  // browser and know a fresh snapshot exists.
  app.post("/api/admin/backups/snapshot", requireRole("owner"), async (req, res) => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const dbPath = process.env.DATABASE_PATH || "data.db";
      const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(dbPath), "backups");
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dest = path.join(backupDir, `data-${stamp}.db`);
      const anyDb = sqlite as any;
      if (typeof anyDb.backup === "function") {
        await anyDb.backup(dest);
      } else {
        sqlite.pragma("wal_checkpoint(TRUNCATE)");
        fs.copyFileSync(dbPath, dest);
      }
      const stat = fs.statSync(dest);
      res.json({ file: path.basename(dest), path: dest, sizeBytes: stat.size, mtime: stat.mtime.toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  // Diagnostic: report the geocode status of every active job. Useful when
  // pins aren't dropping to see whether the row has an address, has been
  // geocoded, or has a numeric-but-invalid lat/lng from a bad import.
  app.get("/api/jobs/geocode-status", (req, res) => {
    // Include the contact's address as a fallback so the diagnostic reflects
    // the same effective address the map now shows post-hydration.
    const rows: any[] = sqlite.prepare(`
      SELECT j.id AS id, j.job_number AS job_number,
             COALESCE(NULLIF(TRIM(j.address), ''), NULLIF(TRIM(c.address), '')) AS address,
             j.address AS raw_job_address, c.address AS raw_contact_address,
             j.latitude AS latitude, j.longitude AS longitude,
             j.geocoded_at AS geocoded_at, j.status AS status
      FROM jobs j LEFT JOIN contacts c ON c.id = j.contact_id
      WHERE j.status IS NULL OR j.status <> 'closed'
      ORDER BY j.id DESC
    `).all();
    const summary = {
      total: rows.length,
      withAddress: rows.filter(r => (r.address || "").trim().length > 0).length,
      geocoded: rows.filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude)).length,
      missingCoords: rows.filter(r => (r.address || "").trim().length > 0 && !(Number.isFinite(r.latitude) && Number.isFinite(r.longitude))).length,
      noAddress: rows.filter(r => !(r.address || "").trim()).length,
    };
    // Include the live geocoder status so the operator can see WHY pins
    // are missing (network error vs empty result vs bad API key). Also
    // report whether Google Maps is wired — no key = Nominatim only, which
    // is much slower and 1-req/sec limited.
    res.json({
      summary,
      geocoder: {
        ...geocoderStatus,
        googleKeyConfigured: !!(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY),
      },
      jobs: rows,
    });
  });

  // Force-refresh every active job's coordinates: clear the cached lat/lng
  // and re-run the geocoder. Useful when pins have gone stale after an
  // address edit, or when the operator has just added a GOOGLE_MAPS_API_KEY
  // and wants Google-quality coords for jobs that were previously resolved
  // by Nominatim (or not resolved at all).
  app.post("/api/jobs/geocode-refresh-all", requireRole("owner", "admin"), (req, res) => {
    const rows: any[] = sqlite.prepare(
      "SELECT id, address FROM jobs WHERE address IS NOT NULL AND TRIM(address) <> '' AND (status IS NULL OR status <> 'closed')"
    ).all();
    try { sqlite.prepare("UPDATE jobs SET latitude=NULL, longitude=NULL, geocoded_at=NULL WHERE status IS NULL OR status <> 'closed'").run(); } catch {}
    for (const r of rows) geocodeJobInBackground(sqlite, r.id, r.address);
    res.json({ queued: rows.length });
  });
  app.delete("/api/jobs/:id", requireRole("owner", "admin"), (req, res) => {
    const jobId = Number(req.params.id);
    if (!Number.isFinite(jobId)) return res.status(400).json({ error: "Invalid job id" });
    try {
      // Block deletion when financial records exist — deleting a job that has
      // invoices or payments would silently destroy accounting history and
      // orphan money records. Force the user to resolve those first.
      const invCount = (sqlite.prepare("SELECT COUNT(*) c FROM invoices WHERE job_id = ?").get(jobId) as any)?.c || 0;
      const payCount = (sqlite.prepare("SELECT COUNT(*) c FROM payments WHERE job_id = ?").get(jobId) as any)?.c || 0;
      if (!req.query.force && (invCount > 0 || payCount > 0)) {
        return res.status(409).json({
          error: `This job has ${invCount} invoice(s) and ${payCount} payment(s). Delete or reassign those financial records first, or re-send with ?force=1 to remove everything.`,
          invoices: invCount,
          payments: payCount,
        });
      }
      // Cascade-delete children so nothing is orphaned (schema has no FKs).
      const childTables = [
        "estimates", "invoices", "payments", "photos", "drying_records",
        "job_documents", "job_notes", "supplements", "supplement_trackers",
        "time_clock", "claim_payments",
      ];
      const tx = sqlite.transaction(() => {
        for (const t of childTables) {
          try { sqlite.prepare(`DELETE FROM ${t} WHERE job_id = ?`).run(jobId); } catch { /* table may not exist */ }
        }
        storage.deleteJob(jobId);
      });
      tx();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Unable to delete job" });
    }
  });

  // ── Closed jobs (hidden from every other view) ─────────────────────────────
  // Only owner/admin can close or reopen — closing hides the job from KPIs,
  // dashboards, techs, and reports, so we restrict to leadership.
  // (GET /api/jobs/closed is registered earlier, above /api/jobs/:id, so
  // Express matches the literal path before the id parameter route.)
  app.post("/api/jobs/:id/close", requireRole("owner", "admin"), (req, res) => {
    const jobId = Number(req.params.id);
    if (!Number.isFinite(jobId)) return res.status(400).json({ error: "Invalid job id" });
    const emp = (req as any).employee;
    const closedBy = emp?.name || "system";
    const reason = (req.body?.reason ? String(req.body.reason).slice(0, 500) : undefined);
    const updated = storage.closeJob(jobId, closedBy, reason);
    if (!updated) return res.status(404).json({ error: "Job not found" });
    // Audit log — best-effort; do not fail the close if audit insert errors.
    try {
      sqlite.prepare(
        "INSERT INTO job_events (job_id, action, actor_name, details, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(jobId, "closed", closedBy, JSON.stringify({ reason: reason || null, previousStatus: (updated as any).previousStatus }), new Date().toISOString());
    } catch (_) {}
    res.json(updated);
  });

  app.post("/api/jobs/:id/reopen", requireRole("owner", "admin"), (req, res) => {
    const jobId = Number(req.params.id);
    if (!Number.isFinite(jobId)) return res.status(400).json({ error: "Invalid job id" });
    const emp = (req as any).employee;
    const reopenedBy = emp?.name || "system";
    const before = storage.getJob(jobId) as any;
    if (!before) return res.status(404).json({ error: "Job not found" });
    if (before.status !== "closed") return res.status(409).json({ error: "Job is not closed" });
    const updated = storage.reopenJob(jobId, reopenedBy);
    if (!updated) return res.status(500).json({ error: "Unable to reopen job" });
    try {
      sqlite.prepare(
        "INSERT INTO job_events (job_id, action, actor_name, details, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(jobId, "reopened", reopenedBy, JSON.stringify({ restoredStatus: (updated as any).status }), new Date().toISOString());
    } catch (_) {}
    res.json(updated);
  });

  // NOTE: Job notes are handled by the dedicated job_notes table routes further
  // below (GET/POST/PATCH/DELETE /api/jobs/:jobId/notes). The previous route here
  // wrote notes into the jobs.notes JSON column, which the Notes tab never reads —
  // so saved notes were invisible. Removed to let the correct route handle POST.

  // ── Estimates ─────────────────────────────────────────────────────────────
  app.get("/api/estimates", (_req, res) => { res.json(storage.getEstimates()); });
  app.get("/api/estimates/:id", (req, res) => {
    const e = storage.getEstimate(Number(req.params.id));
    if (!e) return res.status(404).json({ error: "Not found" });
    res.json(e);
  });
  app.get("/api/jobs/:id/estimates", (req, res) => { res.json(storage.getEstimatesByJob(Number(req.params.id))); });
  // Editable estimate fields — client can never set arbitrary columns.
  const ESTIMATE_ALLOWED = [
    "jobId", "title", "status", "lineItems", "subtotal", "tax", "total",
    "notes", "rebuttalText", "carrierAdjustment", "phase",
  ];
  function whitelistEstimate(body: any) {
    const clean: any = {};
    for (const k of ESTIMATE_ALLOWED) if (body && k in body) clean[k] = body[k];
    return clean;
  }
  app.post("/api/estimates", requireRole("owner", "admin", "sales", "general_manager"), (req, res) => {
    try {
      const body = recomputeDocTotals(whitelistEstimate(req.body));
      const created = storage.createEstimate(body);
      logAudit(req as any, "create", "estimates", (created as any)?.id ?? null, { after: created });
      res.json(created);
    } catch (err: any) { res.status(400).json({ error: err?.message || "Unable to create estimate" }); }
  });
  app.patch("/api/estimates/:id", requireRole("owner", "admin", "sales", "general_manager"), (req, res) => {
    const body = recomputeDocTotals(whitelistEstimate(req.body));
    const id = Number(req.params.id);
    const before = storage.getEstimate(id);
    const e = storage.updateEstimate(id, body);
    if (!e) return res.status(404).json({ error: "Not found" });
    // Skip audit rows for keystroke-noise fields (lineItems is a big blob
    // that changes on every debounced save). Only log meaningful diffs.
    logAudit(req as any, "update", "estimates", id, { patch: body, before });
    res.json(e);
  });
  // Soft-delete only — the row is hidden from lists but recoverable from
  // /trash for 30 days. Restricted to owner/admin/general_manager: sales
  // can create/edit but shouldn't be able to nuke another rep's estimate.
  app.delete("/api/estimates/:id", requireRole("owner", "admin", "general_manager"), (req, res) => {
    const id = Number(req.params.id);
    const existing = storage.getEstimate(id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    softDelete("estimates", id, req as any);
    res.json({ ok: true, id });
  });

  // Auto-generate rebuttal — now returns state + statutes used
  app.post("/api/estimates/:id/rebuttal", (req, res) => {
    const est = storage.getEstimate(Number(req.params.id));
    if (!est) return res.status(404).json({ error: "Estimate not found" });
    const job = storage.getJob(est.jobId);
    const { text: rebuttalText, state, statutesUsed } = generateRebuttal(est, job);
    const updated = storage.updateEstimate(Number(req.params.id), { rebuttalText });
    res.json({
      rebuttalText,
      state,
      stateName: state === "SC" ? "South Carolina" : "Georgia",
      statutesUsed: statutesUsed.map(s => ({ code: s.code, topic: s.topic, rebuttalHook: s.rebuttalHook })),
      estimate: updated,
    });
  });

  // IICRC calculator
  app.get("/api/iicrc/categories", (_req, res) => { res.json(IICRC_CATEGORIES); });
  app.get("/api/iicrc/statutes/:state", (req, res) => {
    const state = req.params.state.toUpperCase() as "SC" | "GA";
    const lossType = (req.query.lossType as string) || "all";
    if (!STATUTE_TABLE[state]) return res.status(400).json({ error: "State must be SC or GA" });
    res.json(selectStatutes(state, lossType));
  });

  // State detector endpoint
  app.post("/api/iicrc/detect-state", (req, res) => {
    const { address } = req.body;
    const state = detectState(address);
    res.json({ state, stateName: state === "SC" ? "South Carolina" : "Georgia" });
  });

  // ── Invoices ──────────────────────────────────────────────────────────────

  // Auto-advance job stage → accounts_receivable when an invoice with a
  // dueDate is created (or a due date is added to an existing draft invoice).
  // Mirrors the CoC signature auto-advance in routes_quickadd_esign.ts,
  // but for the next step in the pipeline. Keyed on dueDate because the
  // invoice schema has no separate issue-date column. One-way guard: never
  // move a job backward — if it's already in AR or complete, this no-ops.
  const STAGE_RANK: Record<string, number> = {
    pending_sale: 0,
    pre_production: 1,
    wip: 2,
    invoice_pending: 3,
    accounts_receivable: 4,
    complete: 5,
  };
  function advanceJobToAR(jobId: number | null | undefined): { advanced: boolean } {
    if (!jobId) return { advanced: false };
    try {
      const jobRow = sqlite
        .prepare(`SELECT progress_stage, invoice_sent_date FROM jobs WHERE id = ?`)
        .get(jobId) as any;
      if (!jobRow) return { advanced: false };
      const currentRank = STAGE_RANK[jobRow.progress_stage ?? "pending_sale"] ?? 0;
      if (currentRank >= STAGE_RANK.accounts_receivable) return { advanced: false };
      const now = new Date().toISOString();
      // Stamp invoice_sent_date only if it was never set. An invoice with a
      // due date has, by definition, been (or is about to be) sent, so this
      // keeps AR aging honest for jobs that skipped the CoC-signed path.
      const invoiceSentDate = jobRow.invoice_sent_date || now;
      sqlite
        .prepare(
          `UPDATE jobs
             SET progress_stage = 'accounts_receivable',
                 invoice_sent_date = ?
           WHERE id = ?`,
        )
        .run(invoiceSentDate, jobId);
      return { advanced: true };
    } catch (e: any) {
      // Never fail the invoice save because of a stage-advance hiccup —
      // log and move on. The invoice write is the primary action.
      console.error("[invoice→AR] stage-advance failed:", e?.message || e);
      return { advanced: false };
    }
  }

  app.get("/api/invoices", (_req, res) => { res.json(storage.getInvoices()); });
  app.get("/api/invoices/:id", (req, res) => {
    const inv = storage.getInvoice(Number(req.params.id));
    if (!inv) return res.status(404).json({ error: "Not found" });
    res.json(inv);
  });
  app.get("/api/jobs/:id/invoices", (req, res) => { res.json(storage.getInvoicesByJob(Number(req.params.id))); });
  app.post("/api/invoices", requireRole("owner", "admin", "sales", "general_manager"), (req, res) => {
    try {
      const body = recomputeDocTotals(req.body);
      const created = storage.createInvoice(body);
      // If the new invoice already has a due date, promote the parent job
      // to accounts_receivable. Drafts with no dueDate stay in
      // invoice_pending until a date is set.
      if (created && (created as any).dueDate) {
        advanceJobToAR((created as any).jobId);
      }
      res.json(created);
    } catch (err: any) { res.status(400).json({ error: err?.message || "Unable to create invoice" }); }
  });
  app.patch("/api/invoices/:id", requireRole("owner", "admin", "sales", "general_manager"), (req, res) => {
    const id = Number(req.params.id);
    const existing: any = storage.getInvoice(id);
    if (!existing) return res.status(404).json({ error: "Not found" });

    // Whitelist editable fields (never let the client set arbitrary columns).
    const ALLOWED = [
      "contactId", "status", "lineItems", "subtotal", "tax", "total",
      "originalTotal", "adjustment", "adjustmentReason",
      "dueDate", "paidAt", "notes",
    ];
    const rawBody = req.body || {};
    // Server-side total recompute from line items — but ONLY when no settlement
    // adjustment is being applied (the adjustment branch below owns total math).
    const body = (rawBody.lineItems != null && !("adjustment" in rawBody))
      ? recomputeDocTotals(rawBody)
      : rawBody;
    const updates: any = {};
    for (const k of ALLOWED) if (k in body) updates[k] = body[k];

    // Settlement math: if an adjustment (insurance reduction) is being applied,
    // preserve the original invoiced amount and recompute the net total.
    if ("adjustment" in updates) {
      const adj = Number(updates.adjustment) || 0;
      if (adj < 0) return res.status(400).json({ error: "Adjustment must be zero or a positive reduction amount." });
      if (adj === 0) {
        // No reduction. Clear any prior settlement state and honor the total the
        // client provided (e.g. from edited line items). Don't clobber it.
        if (!("originalTotal" in updates)) updates.originalTotal = null;
        // (updates.total, if present, is respected as-is.)
      } else {
        // A reduction is being applied. Prefer an explicit originalTotal from the
        // client (edited gross); otherwise capture the pre-reduction baseline.
        const baseline = updates.originalTotal != null
          ? Number(updates.originalTotal)
          : (existing.originalTotal != null ? Number(existing.originalTotal) : Number(existing.total) || 0);
        updates.originalTotal = baseline;
        if (adj > baseline) return res.status(400).json({ error: "Adjustment cannot exceed the original invoice total." });
        // Net total owed after the reduction.
        updates.total = Math.max(0, baseline - adj);
      }
    }

    const inv = storage.updateInvoice(id, updates);
    if (!inv) return res.status(404).json({ error: "Not found" });
    // AR auto-advance on due-date change: whenever the PATCH sets a dueDate,
    // promote the parent job. advanceJobToAR is idempotent — it only moves
    // the job forward if it isn't already in AR/complete, so this is safe on
    // repeated edits (e.g. correcting a mistyped due date).
    const dueDateChanged = "dueDate" in updates && !!updates.dueDate;
    if (dueDateChanged) {
      advanceJobToAR((inv as any).jobId);
    }
    res.json(inv);
  });
  // Full removal. Owner/admin/general_manager only — sales can create+edit
  // but not delete. Also removes any payments referencing this invoice so we
  // don't leave orphan rows in the payments table.
  app.delete("/api/invoices/:id", requireRole("owner", "admin", "general_manager"), (req, res) => {
    const id = Number(req.params.id);
    const existing = storage.getInvoice(id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    storage.deleteInvoice(id);
    res.json({ ok: true, id });
  });

  // ── Payments ──────────────────────────────────────────────────────────────
  app.get("/api/payments", (_req, res) => { res.json(storage.getPayments()); });
  app.post("/api/payments", (req, res, next) => {
    // Money-out payment types (payouts, refunds, credit memos) are restricted to
    // owner/admin/sales. Recording an ordinary received payment stays open to staff.
    const t = String(req.body?.type || "").toLowerCase();
    const restricted = ["referral_payout", "refund", "credit_memo"];
    if (!restricted.includes(t)) return next();
    requireRole("owner", "admin", "sales")(req, res, next);
  }, (req, res) => {
    res.json(storage.createPayment(req.body));
  });

  // ── Object-storage diagnostic ─────────────────────────────────────────────────
  // Public JSON check: hit /api/storage/status to see whether the running
  // container can see the Railway bucket env vars. Never leaks the secret; only
  // returns booleans + the endpoint / bucket for confirmation.
  app.get("/api/storage/status", wrapAsync(async (_req, res) => {
    // Mirror the same env-var fallback set as storage_s3 so this endpoint
    // reports the truth (not just the S3_* naming).
    const hasEndpoint = !!(process.env.S3_ENDPOINT || process.env.STORAGE_ENDPOINT || process.env.AWS_ENDPOINT_URL);
    const hasBucket = !!(process.env.S3_BUCKET || process.env.STORAGE_BUCKET || process.env.AWS_S3_BUCKET_NAME || process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET);
    const hasKey = !!(process.env.S3_ACCESS_KEY_ID || process.env.STORAGE_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID);
    const hasSecret = !!(process.env.S3_SECRET_ACCESS_KEY || process.env.STORAGE_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY);
    let bucketProbe: any = null;
    if (objectStorage.isConfigured()) {
      try {
        // Try a real write → read → delete round-trip so we surface auth/CORS/
        // endpoint issues right here instead of silently in a POST handler.
        const testKey = objectStorage.makeKey("diagnostic", "txt");
        const body = Buffer.from(`ping ${new Date().toISOString()}`);
        await objectStorage.putObject(testKey, body, "text/plain");
        const url = await objectStorage.getReadUrl(testKey, 60);
        await objectStorage.deleteObject(testKey);
        bucketProbe = { ok: true, testKey, signedUrlLength: url.length };
      } catch (e: any) {
        bucketProbe = { ok: false, error: e?.message || String(e), stack: (e?.stack || "").split("\n").slice(0, 3) };
      }
    }
    res.json({
      isConfigured: objectStorage.isConfigured(),
      env: { hasEndpoint, hasBucket, hasKey, hasSecret,
        endpoint: process.env.S3_ENDPOINT || process.env.STORAGE_ENDPOINT || process.env.AWS_ENDPOINT_URL || "",
        region: process.env.S3_REGION || process.env.STORAGE_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
        bucket: process.env.S3_BUCKET || process.env.STORAGE_BUCKET || process.env.AWS_S3_BUCKET_NAME || process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET || "",
      },
      bucketProbe,
      photoCountsBySource: {
        inline: (sqlite.prepare("SELECT COUNT(*) as n FROM photos WHERE data_url LIKE 'data:%'").get() as any)?.n ?? 0,
        bucket: (sqlite.prepare("SELECT COUNT(*) as n FROM photos WHERE storage_key IS NOT NULL AND storage_key != ''").get() as any)?.n ?? 0,
      },
    });
  }));

  // ── Photos ────────────────────────────────────────────────────────────────
  // Reads hydrate `data_url` from the S3 signed URL when the row has a
  // storage_key set. Legacy rows without a key keep serving inline base64
  // (until the boot migration lifts them into the bucket).
  app.get("/api/photos", wrapAsync(async (_req, res) => {
    const rows = storage.getPhotos() as any[];
    await hydrateImageRows(rows, { urlField: "dataUrl", keyField: "storageKey" });
    res.json(rows);
  }));

  // ── Cross-job photo search ────────────────────────────────────────────────
  // Filters photos across every job on any combination of: free-text (matches
  // filename OR caption), room label, damage type, severity, category, phase,
  // capture-date range (against originalTakenAt OR takenAt), and jobId.
  //
  // Deliberately paginated + capped so a global "show me everything" query
  // can't OOM the box on a big DB. Returns the join of the photo row with
  // job number + customer + address so the search UI can jump straight to
  // the source job without an N+1 fetch.
  app.get("/api/photos/search", wrapAsync(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const room = String(req.query.room ?? "").trim();
    const damageType = String(req.query.damageType ?? "").trim();
    const severity = String(req.query.severity ?? "").trim();
    const category = String(req.query.category ?? "").trim();
    const phase = String(req.query.phase ?? "").trim();
    const jobId = req.query.jobId ? Number(req.query.jobId) : null;
    const from = String(req.query.from ?? "").trim();
    const to = String(req.query.to ?? "").trim();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
    const offset = Math.max(0, Number(req.query.offset ?? 0));

    const clauses: string[] = [];
    const params: any[] = [];
    if (q) {
      clauses.push("(LOWER(p.filename) LIKE ? OR LOWER(p.caption) LIKE ?)");
      const like = `%${q.toLowerCase()}%`;
      params.push(like, like);
    }
    if (room) { clauses.push("LOWER(p.room) = ?"); params.push(room.toLowerCase()); }
    if (damageType) { clauses.push("LOWER(p.damage_type) = ?"); params.push(damageType.toLowerCase()); }
    if (severity) { clauses.push("LOWER(p.severity) = ?"); params.push(severity.toLowerCase()); }
    if (category) { clauses.push("LOWER(p.category) = ?"); params.push(category.toLowerCase()); }
    if (phase) { clauses.push("LOWER(p.phase) = ?"); params.push(phase.toLowerCase()); }
    if (jobId != null && Number.isFinite(jobId)) { clauses.push("p.job_id = ?"); params.push(jobId); }
    if (from) { clauses.push("COALESCE(p.original_taken_at, p.taken_at) >= ?"); params.push(from); }
    if (to) { clauses.push("COALESCE(p.original_taken_at, p.taken_at) <= ?"); params.push(to); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    // Count first so the UI can render a paginator without loading rows.
    const countRow: any = sqlite.prepare(`SELECT COUNT(*) AS n FROM photos p ${where}`).get(...params);
    const total = Number(countRow?.n ?? 0);

    const rows: any[] = sqlite.prepare(`
      SELECT p.*, j.job_number AS jobNumber, j.address AS jobAddress,
             c.name AS customerName
      FROM photos p
      LEFT JOIN jobs j ON j.id = p.job_id
      LEFT JOIN contacts c ON c.id = j.contact_id
      ${where}
      ORDER BY COALESCE(p.original_taken_at, p.taken_at, p.uploaded_at) DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    await hydrateImageRows(rows, { urlField: "dataUrl", keyField: "storageKey" });

    // Also compute lightweight facet counts so the UI can show "12 in Kitchen,
    // 5 with water damage" chips without a second round-trip. Cheap because
    // the WHERE clause is already narrowing.
    const facet = (col: string) => {
      try {
        return sqlite.prepare(`
          SELECT ${col} AS v, COUNT(*) AS n FROM photos p ${where}
          GROUP BY ${col} ORDER BY n DESC LIMIT 20
        `).all(...params) as any[];
      } catch { return []; }
    };

    res.json({
      total,
      limit,
      offset,
      photos: rows,
      facets: {
        room: facet("p.room"),
        damageType: facet("p.damage_type"),
        severity: facet("p.severity"),
        category: facet("p.category"),
      },
    });
  }));
  app.get("/api/jobs/:id/photos", wrapAsync(async (req, res) => {
    const rows = storage.getPhotosByJob(Number(req.params.id)) as any[];
    await hydrateImageRows(rows, { urlField: "dataUrl", keyField: "storageKey" });
    res.json(rows);
  }));
  // On write, hoist any incoming data URL into the bucket before insert so we
  // never persist multi-megabyte base64 blobs into SQLite when storage is
  // configured.
  app.post("/api/photos", wrapAsync(async (req, res) => {
    const body = { ...req.body };
    const incomingUrl = body.dataUrl ?? body.data_url ?? "";
    const stored = await writeImageFieldSafe(incomingUrl, "photos");
    body.dataUrl = stored.dataUrl;
    if (stored.storageKey) body.storageKey = stored.storageKey;
    // Allow-list the enrichment fields so callers can’t stuff arbitrary
    // columns; anything not in this set is dropped.
    const allowed = [
      "jobId", "filename", "dataUrl", "storageKey", "caption", "category", "phase", "takenAt",
      "latitude", "longitude", "originalTakenAt", "deviceMake", "deviceModel",
      "room", "damageType", "severity", "aiClassified",
      "annotationsJson", "voiceNoteUrl", "voiceNoteTranscript", "floorPlanRoomId",
    ];
    const insert: any = {};
    for (const k of allowed) if (body[k] !== undefined && body[k] !== null) insert[k] = body[k];
    res.json(storage.createPhoto(insert));
  }));
  // PATCH — accepts the same enrichment fields for editing after upload.
  app.patch("/api/photos/:id", (req, res) => {
    const id = Number(req.params.id);
    const editable = [
      "category", "caption", "phase", "room", "damageType", "severity",
      "annotationsJson", "floorPlanRoomId", "voiceNoteTranscript", "voiceNoteUrl",
    ];
    const updates: any = {};
    for (const k of editable) if (req.body[k] !== undefined) updates[k] = req.body[k];
    if (Object.keys(updates).length === 0) return res.json({ id });
    const updated = storage.updatePhoto(id, updates);
    res.json(updated || { id });
  });
  app.delete("/api/photos/:id", (req, res) => {
    storage.deletePhoto(Number(req.params.id));
    res.json({ success: true });
  });

  // ── AI classify a photo (room, damage type, severity, caption suggestion) ───
  // Uses Anthropic Vision (Claude Sonnet 4.6) when ANTHROPIC_API_KEY is set.
  // On any error we still return 200 with { skipped: true } so the client's
  // best-effort background classification never turns into a red toast.
  app.post("/api/photos/:id/classify", wrapAsync(async (req, res) => {
    const id = Number(req.params.id);
    const photo: any = storage.getPhoto(id);
    if (!photo) return res.status(404).json({ error: "not_found" });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.json({ skipped: true, reason: "no_anthropic_key" });
    // Hydrate the actual image URL if the row lives in the bucket.
    const rows = [photo];
    try { await hydrateImageRows(rows, { urlField: "dataUrl", keyField: "storageKey" }); } catch {}
    const src: string = rows[0].dataUrl || "";
    if (!src) return res.json({ skipped: true, reason: "no_image_data" });

    const prompt = `You are analyzing a restoration/HVAC job site photo. Return STRICT JSON only with keys: room (short room name like "Kitchen", "Master Bath", "Living Room", or ""), damageType (one of: water, fire, mold, wind, impact, smoke, vandalism, other, or ""), severity (one of: minor, moderate, severe, catastrophic, or ""), caption (one short factual sentence).`;
    let imageBlock: any;
    if (src.startsWith("data:")) {
      const m = src.match(/^data:([^;,]+)(?:;[^;,]+=[^;,]+)*;base64,(.+)$/s);
      if (!m) return res.json({ skipped: true, reason: "bad_data_url" });
      imageBlock = { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
    } else {
      imageBlock = { type: "image", source: { type: "url", url: src } };
    }
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 300,
          messages: [{ role: "user", content: [imageBlock, { type: "text", text: prompt }] }],
        }),
      });
      if (!r.ok) return res.json({ skipped: true, status: r.status });
      const j: any = await r.json();
      const text: string = (j.content?.[0]?.text || "").trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return res.json({ skipped: true, reason: "no_json" });
      const parsed = JSON.parse(match[0]);
      const patch: any = { aiClassified: true };
      if (parsed.room && !photo.room) patch.room = String(parsed.room).slice(0, 60);
      if (parsed.damageType && !photo.damageType) patch.damageType = String(parsed.damageType).slice(0, 30);
      if (parsed.severity && !photo.severity) patch.severity = String(parsed.severity).slice(0, 30);
      if (parsed.caption && (!photo.caption || photo.caption === photo.filename)) patch.caption = String(parsed.caption).slice(0, 240);
      const updated = storage.updatePhoto(id, patch);
      res.json({ updated, ai: parsed });
    } catch (e: any) {
      res.json({ skipped: true, error: e?.message });
    }
  }));

  // ── Floor plan (one JSON blob per job) ────────────────────────────────────────
  app.get("/api/jobs/:id/floor-plan", (req, res) => {
    const row = storage.getFloorPlan(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json(row);
  });
  app.put("/api/jobs/:id/floor-plan", (req, res) => {
    const jobId = Number(req.params.id);
    const planJson: string = typeof req.body?.planJson === "string" ? req.body.planJson : JSON.stringify(req.body || {});
    // Validate it's parseable JSON with a rooms array — refuse garbage so
    // corrupted saves never brick the sketcher.
    try {
      const parsed = JSON.parse(planJson);
      if (!parsed || !Array.isArray(parsed.rooms)) throw new Error("missing_rooms");
    } catch (e: any) {
      return res.status(400).json({ error: "bad_plan_json", detail: e?.message });
    }
    const updatedBy = (req as any).session?.user?.name || (req as any).session?.user?.email || null;
    res.json(storage.upsertFloorPlan(jobId, planJson, updatedBy));
  });

  // ── Public photo report share tokens ──────────────────────────────────────
  // Authenticated create: any authed staff can mint a token for a job.
  // Default 30-day expiry per user preference.
  app.post("/api/jobs/:id/share-tokens", wrapAsync(async (req, res) => {
    const jobId = Number(req.params.id);
    const template = String(req.body?.template || "adjuster");
    const days = Number(req.body?.expiresInDays || 30);
    const photoIds = Array.isArray(req.body?.photoIds) ? JSON.stringify(req.body.photoIds) : null;
    const token = require("crypto").randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
    const createdBy = (req as any).session?.user?.name || (req as any).session?.user?.email || null;
    const row = storage.createShareToken({ token, jobId, template, photoIds, createdBy, expiresAt } as any);
    res.json(row);
  }));
  app.get("/api/jobs/:id/share-tokens", (req, res) => {
    res.json(storage.listShareTokensForJob(Number(req.params.id)));
  });
  app.delete("/api/share-tokens/:token", (req, res) => {
    storage.revokeShareToken(String(req.params.token));
    res.json({ ok: true });
  });
  // Public read — NO auth. Returns job photos + floor plan for the report.
  // Bumps view_count + last_viewed_at so the tech knows when the adjuster opened it.
  app.get("/api/public/reports/:token", wrapAsync(async (req, res) => {
    const token = String(req.params.token);
    const row: any = storage.getShareToken(token);
    if (!row) return res.status(404).json({ error: "not_found" });
    if (row.revoked) return res.status(410).json({ error: "revoked" });
    if (new Date(row.expiresAt).getTime() < Date.now()) return res.status(410).json({ error: "expired" });
    storage.bumpShareTokenView(token);
    const rows = storage.getPhotosByJob(row.jobId) as any[];
    await hydrateImageRows(rows, { urlField: "dataUrl", keyField: "storageKey" });
    // Optional subset by explicit photoIds list.
    let photos = rows;
    if (row.photoIds) {
      try {
        const ids = new Set(JSON.parse(row.photoIds).map((n: any) => Number(n)));
        photos = rows.filter(p => ids.has(p.id));
      } catch {}
    }
    const plan = storage.getFloorPlan(row.jobId) || null;
    const job: any = (storage as any).getJob?.(row.jobId) || null;
    // Flat shape for the public viewer (PublicReport.tsx expects these
    // fields at the top level). We also keep the nested `job` object for
    // compatibility with any other consumers.
    res.json({
      token,
      template: row.template,
      expiresAt: row.expiresAt,
      viewCount: row.viewCount,
      revoked: !!row.revoked,
      createdAt: row.createdAt,
      jobNumber: job?.jobNumber ?? null,
      jobAddress: job?.address ?? null,
      customerName: job?.customer ?? job?.customerName ?? null,
      job: job ? {
        jobNumber: job.jobNumber, customer: job.customer, address: job.address,
        city: job.city, state: job.state, zip: job.zip, causeOfLoss: job.causeOfLoss,
      } : null,
      floorPlan: plan ? JSON.parse(plan.planJson || "{}") : null,
      photos,
    });
  }));

  // ── Channels & Messages ───────────────────────────────────────────────────
  app.get("/api/channels", (_req, res) => { res.json(storage.getChannels()); });
  app.post("/api/channels", (req, res) => { res.json(storage.createChannel(req.body)); });
  app.get("/api/channels/:id/messages", (req, res) => { res.json(storage.getMessages(Number(req.params.id))); });
  app.post("/api/channels/:id/messages", (req, res) => {
    const msg = storage.createMessage({ ...req.body, channelId: Number(req.params.id) });
    res.json(msg);
  });

  // ── Parse a channel message into a Job file (AUG / Cola intake) ────────────
  // Recognizes labeled fields on any line (case-insensitive), e.g.
  //   Customer: Jane Doe
  //   Address: 123 Main St
  //   Loss: water
  //   Carrier: State Farm / Claim: 12345 / Adjuster: Bob Smith
  //   Tech: John / Source: referral
  // The channel (aug/cola) sets the default market + division. Pass
  // { preview: true } to parse WITHOUT creating anything (returns the draft).
  app.post("/api/channels/:id/parse-job", (req, res) => {
    const channelId = Number(req.params.id);
    const channel = storage.getChannels().find(c => c.id === channelId);
    const body: string = String(req.body?.body || "");
    const preview = req.body?.preview === true;

    // ── Market defaults from channel name ──
    const cname = (channel?.name || "").toLowerCase();
    let market = "";
    if (cname.includes("aug")) market = "Augusta, GA";
    else if (cname.includes("cola")) market = "Columbia, SC";

    // ── Field extraction helpers ──
    const grab = (labels: string[]): string => {
      for (const label of labels) {
        // match "Label: value" or "Label - value", value runs to end of line or next " / " separator
        const re = new RegExp(`(?:^|[\\n/])\\s*(?:${label})\\s*[:\\-]\\s*([^\\n/]+)`, "i");
        const m = body.match(re);
        if (m && m[1].trim()) return m[1].trim();
      }
      return "";
    };

    const customer = grab(["name", "customer", "client", "homeowner", "insured"]);
    const address = grab(["address", "addr", "property", "location", "loss location"]);
    // Titan's real-world format uses "Description of Loss" for the narrative;
    // the loss TYPE (water/fire/etc.) is inferred from keywords inside it.
    const description = grab(["description of loss", "description", "notes", "details"]);
    let lossRaw = (grab(["loss type", "loss", "type", "damage"]) || description).toLowerCase();
    const carrier = grab(["insurance", "carrier", "insurance carrier"]);
    const claimNumber = grab(["claim #", "claim number", "claim no", "claim"]);
    const adjusterName = grab(["adjuster", "adjuster name"]);
    const adjusterPhone = grab(["adjuster phone", "adj phone"]);
    const adjusterEmail = grab(["adjuster email", "adj email"]);
    const policyNumber = grab(["policy #", "policy number", "policy"]);
    const assignedTech = grab(["tech", "technician", "assigned", "assigned tech"]);
    let leadSourceRaw = grab(["referral source", "source", "lead source", "lead", "referred by", "referral"]).toLowerCase();

    // ── Customer contact info (Titan dispatch format) ──
    // "Number:" or "Phone:" for the primary line; then any additional bare
    // phone-shaped lines are captured as an alt. phone (e.g. spouse).
    const customerPhone = grab(["number", "phone", "cell", "contact"]);
    const customerEmail = grab(["email", "e-mail"]);
    // Look for a second phone-formatted line that isn't the primary.
    const phoneRe = /\(?\d{3}\)?[\s\-.]*\d{3}[\s\-.]*\d{4}/g;
    const allPhones = (body.match(phoneRe) || []).map(s => s.trim());
    const normalize = (s: string) => s.replace(/\D/g, "");
    const primaryDigits = normalize(customerPhone);
    const altPhone = allPhones.map(p => ({ raw: p, d: normalize(p) }))
      .find(p => p.d && p.d !== primaryDigits)?.raw || "";

    // ── Optional pre-assigned Job # (Titan dispatchers often paste one in) ──
    // Accept anything shaped like TP-YYYY-... or TP-YY-<market>-NNNN; if
    // present and not already used, we honor it instead of auto-numbering.
    const providedJobNumber = grab(["job #", "job number", "job", "file #", "file number"]);

    // Normalize loss type to allowed values
    const LOSS = ["water", "fire", "mold", "storm", "biohazard", "reconstruction"];
    let lossType = LOSS.find(l => lossRaw.includes(l)) || "";

    // Normalize lead source
    const SOURCES: Record<string, string> = {
      referral: "referral", refer: "referral", google: "google", web: "google",
      door: "door_knock", knock: "door_knock", insurance: "insurance_direct",
      direct: "insurance_direct", repeat: "repeat", return: "repeat",
    };
    let leadSource = "";
    for (const key of Object.keys(SOURCES)) if (leadSourceRaw.includes(key)) { leadSource = SOURCES[key]; break; }
    const leadSourceDetail = leadSource && leadSourceRaw ? leadSourceRaw : "";

    // ── Validate: need at minimum a customer OR address, plus a loss type ──
    const hasIdentity = !!(customer || address);
    const missing: string[] = [];
    if (!hasIdentity) missing.push("customer or address");
    if (!lossType) missing.push("loss type (water/fire/mold/storm/biohazard/reconstruction)");
    const ok = missing.length === 0;

    // ── Job number: honor a dispatcher-provided one when unique, else auto ──
    const year = new Date().getFullYear();
    const jobs = storage.getJobs();
    let maxSeq = 0;
    for (const j of jobs) {
      const m = String(j.jobNumber || "").match(/TP-\d{4}-(\d+)/);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    }
    let jobNumber = `TP-${year}-${String(maxSeq + 1).padStart(3, "0")}`;
    if (providedJobNumber) {
      const clean = providedJobNumber.replace(/\s+/g, "");
      // Only accept if it looks like a Titan job number AND isn't already taken.
      const looksReal = /^TP-[\w-]+/i.test(clean);
      const collision = jobs.some(j => String(j.jobNumber || "").toLowerCase() === clean.toLowerCase());
      if (looksReal && !collision) jobNumber = clean;
    }

    const division = lossType === "reconstruction" ? "reconstruction" : "mitigation";

    // Description: prefer the dispatcher's own "Description of Loss" text,
    // fall back to "customer — market" so job cards always show something.
    const finalDescription = description
      || (customer ? `${customer}${market ? ` — ${market}` : ""}` : (market || null));

    const draft: Record<string, any> = {
      jobNumber,
      lossType: lossType || "water",
      status: "new",
      progressStage: "pending_sale",
      address: address || null,
      description: finalDescription,
      assignedTech: assignedTech || null,
      insuranceCarrier: carrier || null,
      claimNumber: claimNumber || null,
      adjusterName: adjusterName || null,
      adjusterPhone: adjusterPhone || null,
      adjusterEmail: adjusterEmail || null,
      policyNumber: policyNumber || null,
      leadSource: leadSource || null,
      leadSourceDetail: leadSourceDetail || null,
      division,
      // Customer phone/email are NOT job columns — they flow onto the
      // linked customer contact record below so both the job and the
      // customer file are complete after one click.
    };

    const parsed = { customer, customerPhone, altPhone, customerEmail, address, description: finalDescription, lossType, carrier, claimNumber, adjusterName, adjusterPhone, adjusterEmail, policyNumber, assignedTech, leadSource, market };

    if (preview || !ok) {
      return res.json({ ok, missing, market, jobNumber, draft, parsed });
    }

    // ── Create: optionally link/create a customer contact ──
    // Also propagate phone/email onto the contact so the customer record is
    // usable immediately (not just the job draft copy).
    let contactId: number | null = null;
    if (customer) {
      const existing = storage.getContacts().find(
        c => (c.type === "customer" || !c.type) && c.name.toLowerCase() === customer.toLowerCase()
      );
      if (existing) contactId = existing.id;
      else {
        const c = storage.createContact({
          name: customer,
          type: "customer",
          address: address || null,
          phone: customerPhone || null,
          email: customerEmail || null,
        } as any);
        contactId = c.id;
      }
    }
    draft.contactId = contactId;
    if (customer && !draft.description) draft.description = customer;

    const job = storage.createJob(draft as any);
    notifyNewJob(job);
    res.json({ ok: true, job, parsed, contactId });
  });

  // ── Emails ────────────────────────────────────────────────────────────────
  app.get("/api/emails", (req, res) => { res.json(storage.getEmails(req.query.folder as string | undefined)); });
  app.get("/api/emails/:id", (req, res) => {
    const e = storage.getEmail(Number(req.params.id));
    if (!e) return res.status(404).json({ error: "Not found" });
    res.json(e);
  });
  app.post("/api/emails", (req, res) => { res.json(storage.createEmail(req.body)); });
  app.patch("/api/emails/:id", (req, res) => {
    const e = storage.updateEmail(Number(req.params.id), req.body);
    res.json(e);
  });
  // Delete an email (frontend Email.tsx delete button).
  app.delete("/api/emails/:id", (req, res) => {
    try {
      sqlite.prepare("DELETE FROM emails WHERE id = ?").run(Number(req.params.id));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Drying Records (IICRC S500) ───────────────────────────────────────────
  app.get("/api/jobs/:id/drying-records", (req, res) => {
    res.json(storage.getDryingRecords(Number(req.params.id)));
  });
  app.post("/api/jobs/:id/drying-records", (req, res) => {
    const record = storage.createDryingRecord({ ...req.body, jobId: Number(req.params.id) });
    res.json(record);
  });
  app.get("/api/drying-records/:id", (req, res) => {
    const r = storage.getDryingRecord(Number(req.params.id));
    if (!r) return res.status(404).json({ error: "Not found" });
    res.json(r);
  });
  app.patch("/api/drying-records/:id", (req, res) => {
    const id = Number(req.params.id);
    const before = storage.getDryingRecord(id);
    const r = storage.updateDryingRecord(id, req.body);
    if (!r) return res.status(404).json({ error: "Not found" });

    // Equipment carry-forward for retro-edits.
    //
    // When a tech goes back and adds equipment to a prior day's record, the
    // days AFTER it were already saved and won't pick up the new deployment
    // on their own. Walk forward from this record's date and merge any
    // still-active equipment (no endDate, key not already tracked) into
    // each later record. Key = (type, serial, room) mirrors the client-side
    // seed logic so "same physical asset" is recognized consistently.
    if (req.body?.equipment !== undefined && before) {
      try {
        const beforeRows = JSON.parse(before.equipment || "[]");
        const afterRows = JSON.parse(r.equipment || "[]");
        const keyOf = (row: any) => {
          const serial = (row?.serialNumber || "").trim();
          return `${(row?.type || "").toLowerCase()}␟${serial || "∅"}␟${(row?.room || "").toLowerCase()}`;
        };
        // Rows that are new on this edit OR flipped from pulled-→-active.
        const beforeByKey = new Map(beforeRows.map((row: any) => [keyOf(row), row]));
        const newlyActive = afterRows.filter((row: any) => {
          if (row.endDate) return false; // still pulled — no need to propagate
          const prev: any = beforeByKey.get(keyOf(row));
          return !prev || prev.endDate; // truly new, or was pulled and is now active again
        });
        if (newlyActive.length > 0) {
          const laterRecords = storage.getDryingRecords(r.jobId)
            .filter((rec: any) => {
              if (rec.id === r.id) return false;
              // Compare by (readingDate, dayNumber) so same-day records with a
              // later dayNumber still count as "after".
              if (rec.readingDate > r.readingDate) return true;
              if (rec.readingDate < r.readingDate) return false;
              return (rec.dayNumber || 0) > (r.dayNumber || 0);
            });
          for (const rec of laterRecords) {
            let recRows: any[] = [];
            try { recRows = JSON.parse(rec.equipment || "[]"); } catch { recRows = []; }
            const existingKeys = new Set(recRows.map(keyOf));
            const toAdd = newlyActive
              .filter((row: any) => !existingKeys.has(keyOf(row)))
              .map((row: any) => ({
                ...row,
                // Fresh id per-record so React keys don't collide.
                id: Date.now() + Math.random(),
                // Per-record daily readings are always visit-specific.
                dailyReadings: [],
              }));
            if (toAdd.length > 0) {
              storage.updateDryingRecord(rec.id, {
                equipment: JSON.stringify([...recRows, ...toAdd]),
              } as any);
            }
          }
        }
      } catch (err) {
        // Non-fatal — the primary save already succeeded. Log so we notice.
        console.warn("[drying-records] retro equipment propagation failed:", err);
      }
    }

    res.json(r);
  });
  app.delete("/api/drying-records/:id", (req, res) => {
    storage.deleteDryingRecord(Number(req.params.id));
    res.json({ success: true });
  });

  // ── Moisture Alert Check: called after saving a drying record ─────────────
  // Scans the last N records for this job, detects WME threshold breaches,
  // writes a note to the job activity log, and pings #general if 2+ consecutive days wet.
  app.post("/api/jobs/:id/moisture-alert-check", (req, res) => {
    const jobId = Number(req.params.id);
    const job = storage.getJob(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    // Missed days carry no moisture data — they must be excluded from the
    // alert stream, otherwise the "last record clean" check would misfire.
    const records = storage.getDryingRecords(jobId).filter(r => (r as any).recordType !== "missed");
    if (records.length === 0) return res.json({ alerted: false, reason: "No records" });

    // Sort by readingDate asc then dayNumber asc
    const sorted = [...records].sort((a, b) => {
      const da = a.readingDate || "";
      const db = b.readingDate || "";
      if (da !== db) return da.localeCompare(db);
      return (a.dayNumber || 0) - (b.dayNumber || 0);
    });

    // Determine which records have ANY moisture reading above threshold
    const flaggedRecords = sorted.map(r => {
      const readings: any[] = JSON.parse(r.moistureReadings || "[]");
      const wetReadings = readings.filter(m => m.reading > m.target);
      return { record: r, wetReadings, hasWet: wetReadings.length > 0 };
    });

    const latestFlagged = flaggedRecords[flaggedRecords.length - 1];
    if (!latestFlagged.hasWet) return res.json({ alerted: false, reason: "Latest record is at target" });

    // Build wet summary for activity note
    const wetSummary = latestFlagged.wetReadings
      .map((m: any) => `${m.location || "Unknown location"} (${m.material}): ${m.reading}% vs target ${m.target}%`)
      .join("; ");

    // Write critical moisture alert to job activity notes
    const noteText = `🚨 MOISTURE ALERT — Day ${latestFlagged.record.dayNumber || "?"} (${latestFlagged.record.readingDate}): ${latestFlagged.wetReadings.length} reading(s) above IICRC S500 WME threshold. ${wetSummary}. Logged by ${latestFlagged.record.techName}. Review drying strategy immediately.`;
    const existingNotes = JSON.parse(job.notes || "[]");
    existingNotes.push({ id: Date.now(), author: "Titan Pro Bot", text: noteText, tag: job.assignedTech || "Cody Brantley", createdAt: new Date().toISOString(), type: "moisture_alert" });
    storage.updateJob(jobId, { notes: JSON.stringify(existingNotes) });

    // Check consecutive days: look at last 3 records — if last 2 are both wet, send channel alert
    const recentFlags = flaggedRecords.slice(-3);
    const consecutiveWetCount = recentFlags.filter(f => f.hasWet).length;
    const isConsecutive = recentFlags.length >= 2 && recentFlags[recentFlags.length - 1].hasWet && recentFlags[recentFlags.length - 2].hasWet;

    if (isConsecutive) {
      const tech = job.assignedTech || "Assigned Technician";
      const alertMsg = [
        `🚨 CRITICAL MOISTURE ALERT — ${job.jobNumber} | ${job.address || job.lossType}`,
        ``,
        `@${tech}: Moisture readings have exceeded IICRC S500 WME thresholds for 2+ consecutive daily logs.`,
        ``,
        `📋 Latest Reading (Day ${latestFlagged.record.dayNumber}, ${latestFlagged.record.readingDate}):`,
        ...latestFlagged.wetReadings.map((m: any) => `   • ${m.location || "Unknown"} (${m.material}): ${m.reading}% — target ≤${m.target}%`),
        ``,
        `⚠️ Per IICRC S500 §12.3, drying strategy must be reassessed when readings stall. Consider:`,
        `   • Repositioning or adding air movers (S500 §11.4)`,
        `   • Increasing dehumidification capacity`,
        `   • Checking for hidden moisture pockets (thermal imaging)`,
        `   • Escalating to Category/Class upgrade if needed`,
        ``,
        `🔗 Job File: https://www.perplexity.ai/computer/a/titan-pro-titan-restoration-ll-w4NT6__oT7.xWA8lbvnc8Q#/jobs/${jobId}`,
        `📞 Cody Brantley: 706-922-0154`,
      ].join("\n");

      // Post to general channel (id=1)
      try {
        const channels = storage.getChannels();
        const generalChannel = channels.find(c => c.name === "general" || c.id === 1);
        if (generalChannel) {
          storage.createMessage({ channelId: generalChannel.id, author: "Titan Pro Bot", body: alertMsg });
        }
      } catch (e) { /* channel may not exist */ }

      return res.json({ alerted: true, consecutive: true, wetCount: latestFlagged.wetReadings.length, message: alertMsg });
    }

    return res.json({ alerted: true, consecutive: false, wetCount: latestFlagged.wetReadings.length, noteAdded: true });
  });

  // ── Employees (Gmail linking) ─────────────────────────────────────────────
  app.get("/api/employees", (_req, res) => { res.json(storage.getEmployees()); });
  app.get("/api/employees/:name", (req, res) => {
    const emp = storage.getEmployeeByName(req.params.name);
    if (!emp) return res.status(404).json({ error: "Not found" });
    res.json(emp);
  });
  // Privileged fields (role/auth) can NEVER be set through this lightweight
  // directory endpoint — staff account/role management goes through the
  // owner/admin-gated /api/staff endpoints. This strips any attempt to escalate
  // privilege or overwrite credentials via /api/employees.
  const EMPLOYEE_FORBIDDEN_FIELDS = ["role", "passwordHash", "password_hash", "pin", "permissions", "isActive", "is_active"];
  function stripEmployeePrivilegedFields(body: any) {
    const clean: any = { ...(body || {}) };
    for (const f of EMPLOYEE_FORBIDDEN_FIELDS) delete clean[f];
    return clean;
  }
  app.post("/api/employees", requireRole("owner", "admin", "general_manager"), (req, res) => {
    const body = stripEmployeePrivilegedFields(req.body);
    if (!body.name || !String(body.name).trim()) return res.status(400).json({ error: "Name is required." });
    res.json(storage.createEmployee(body));
  });
  app.patch("/api/employees/:id", (req: any, res) => {
    // Non-privileged users may ONLY edit their own record. This prevents any
    // signed-in employee from PATCHing another employee's gmailEmail (or any
    // other profile field). Owner / admin / general_manager can still edit
    // anyone. Privileged fields (role, pin, active…) are already stripped for
    // non-owners by stripEmployeePrivilegedFields.
    const targetId = Number(req.params.id);
    const me = req.employee;
    const privileged = me && ["owner", "admin", "general_manager"].includes(String(me.role));
    if (!privileged && (!me || me.id !== targetId)) {
      return res.status(403).json({ error: "You can only update your own profile." });
    }
    const body = stripEmployeePrivilegedFields(req.body);
    const emp = storage.updateEmployee(targetId, body);
    if (!emp) return res.status(404).json({ error: "Not found" });
    res.json(emp);
  });

  // ── Shifts ────────────────────────────────────────────────────────────────
  app.get("/api/shifts", (_req, res) => { res.json(storage.getShifts()); });
  app.get("/api/shifts/:id", (req, res) => {
    const s = storage.getShift(Number(req.params.id));
    if (!s) return res.status(404).json({ error: "Not found" });
    res.json(s);
  });
  app.post("/api/shifts", (req, res) => {
    const shift = storage.createShift(req.body);
    // Notify the assigned tech by email (best-effort, fire-and-forget).
    // Uses the real SMTP/Gmail transport when configured; silent no-op
    // otherwise. Also drops an audit record in the internal mailbox so
    // the sent history remains visible even when live email is off.
    const job = shift.jobId ? storage.getJob(shift.jobId) : null;
    void sendShiftAssignmentEmail(sqlite, {
      techName: shift.techName,
      shiftDate: shift.shiftDate,
      startTime: shift.startTime,
      endTime: shift.endTime,
      title: (shift as any).title,
      notes: (shift as any).notes,
      job: job ? {
        id: job.id,
        jobNumber: job.jobNumber,
        address: job.address,
        lossType: job.lossType,
        customerName: (job as any).customerName,
      } : null,
    });
    if (job) {
      const subject = `[Titan Pro] New Job Assignment: ${job.jobNumber}`;
      const body = `Hi ${shift.techName},\n\nYou have been assigned to a job:\n\nJob #: ${job.jobNumber}\nAddress: ${job.address || "See job file"}\nLoss Type: ${job.lossType.toUpperCase()}\nShift Date: ${shift.shiftDate}\nTime: ${shift.startTime || "TBD"}${shift.endTime ? ` – ${shift.endTime}` : ""}\n\nPlease review the job details in Titan Pro.\n\nTitan Restoration LLC | 706-922-0154`;
      const emp = storage.getEmployeeByName(shift.techName);
      const toEmail = emp?.gmailEmail || `${shift.techName.toLowerCase().replace(/\s/g, "")}@titanrestorationllc.com`;
      storage.createEmail({ folder: "sent", from: "cody@titanrestorationllc.com", to: toEmail, subject, body, read: 1 });
    }
    res.json(shift);
  });
  app.patch("/api/shifts/:id", (req, res) => {
    const prev = storage.getShift(Number(req.params.id));
    const s = storage.updateShift(Number(req.params.id), req.body);
    if (!s) return res.status(404).json({ error: "Not found" });
    // If the tech changed (reassignment) OR a shift-critical field moved,
    // email the (new) assignee so they're not surprised. Same-tech patches
    // like a notes tweak don't re-notify.
    const techChanged = prev && prev.techName !== s.techName;
    const timeChanged = prev && (
      prev.shiftDate !== s.shiftDate ||
      (prev.startTime || "") !== (s.startTime || "") ||
      (prev.endTime || "") !== (s.endTime || "")
    );
    if (techChanged || timeChanged) {
      const job = s.jobId ? storage.getJob(s.jobId) : null;
      void sendShiftAssignmentEmail(sqlite, {
        techName: s.techName,
        shiftDate: s.shiftDate,
        startTime: s.startTime,
        endTime: s.endTime,
        title: (s as any).title,
        notes: (s as any).notes,
        job: job ? {
          id: job.id,
          jobNumber: job.jobNumber,
          address: job.address,
          lossType: job.lossType,
          customerName: (job as any).customerName,
        } : null,
      });
    }
    res.json(s);
  });
  app.delete("/api/shifts/:id", (req, res) => {
    storage.deleteShift(Number(req.params.id));
    res.json({ success: true });
  });

  // ── Payout Methods ────────────────────────────────────────────────────────
  app.get("/api/payout-methods", (req, res) => {
    const contactId = req.query.contactId ? Number(req.query.contactId) : undefined;
    res.json(storage.getPayoutMethods(contactId));
  });
  app.post("/api/payout-methods", (req, res) => { res.json(storage.createPayoutMethod(req.body)); });
  app.patch("/api/payout-methods/:id", (req, res) => {
    const pm = storage.updatePayoutMethod(Number(req.params.id), req.body);
    res.json(pm);
  });
  app.delete("/api/payout-methods/:id", (req, res) => {
    storage.deletePayoutMethod(Number(req.params.id));
    res.json({ success: true });
  });

  // ── Payout Requests ───────────────────────────────────────────────────────
  app.get("/api/payout-requests", (req, res) => {
    const contactId = req.query.contactId ? Number(req.query.contactId) : undefined;
    res.json(storage.getPayoutRequests(contactId));
  });
  app.post("/api/payout-requests", (req, res) => { res.json(storage.createPayoutRequest(req.body)); });
  app.patch("/api/payout-requests/:id", (req, res, next) => {
    // Approving or marking a payout paid is money-out — owner/admin only.
    const newStatus = String(req.body?.status || "").toLowerCase();
    if (newStatus === "paid" || newStatus === "approved") {
      return requireRole("owner", "admin")(req, res, next);
    }
    next();
  }, (req, res) => {
    const id = Number(req.params.id);
    const existing: any = storage.getPayoutRequest ? storage.getPayoutRequest(id) : null;
    const alreadyPaid = existing && String(existing.status || "").toLowerCase() === "paid";
    const pr = storage.updatePayoutRequest(id, req.body);
    if (!pr) return res.status(404).json({ error: "Not found" });

    // Auto-apply payout to job on paid — only on the transition INTO paid, with a
    // positive amount, and never twice (guards against double-applying to job finances).
    if (req.body.status === "paid" && !alreadyPaid && pr && pr.jobId) {
      const amt = Number(pr.amount);
      if (Number.isFinite(amt) && amt > 0) {
        storage.updateJob(pr.jobId, {
          partnerPayoutApplied: amt,
          partnerPayoutDate: new Date().toISOString(),
        });
      }
    }
    res.json(pr);
  });

  // ── Partner Portal ────────────────────────────────────────────────────────
  app.post("/api/portal/login", (req, res) => {
    const { contactId, pin } = req.body;
    const contact = storage.getContact(Number(contactId));
    if (!contact) return res.status(404).json({ error: "Contact not found" });
    // When a partner has a portal PIN set up (via Business Dev → Partner Portal
    // Setup), enforce it. Partners without a PIN retain the legacy open access
    // so existing partners aren't locked out before staff activate them.
    if (contact.portalPin && String(contact.portalPin) !== String(pin ?? "")) {
      return res.status(401).json({ error: "Invalid PIN" });
    }
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    storage.createPortalSession({ contactId: Number(contactId), sessionToken: token, expiresAt });
    res.json({ token, contact });
  });

  // ── Portal access control (IDOR defense) ──────────────────────────────────
  // Portal endpoints receive a contactId/jobId in the URL. Without a check, any
  // customer could read another customer's jobs, invoices, and claim figures by
  // changing the number. These helpers verify the caller's portal token owns the
  // contact (or the job's contact) before returning private data.
  function getPortalContactId(req: any): number | null {
    const token = (req.headers.authorization || "").replace("Bearer ", "").trim()
      || (req.headers["x-portal-token"] as string || "").trim()
      || (req.query.token as string || "").trim();
    if (!token) return null;
    const session: any = sqlite.prepare(
      "SELECT * FROM portal_sessions WHERE session_token = ? AND expires_at > ?"
    ).get(token, new Date().toISOString());
    return session ? Number(session.contact_id) : null;
  }
  // Verify the token owns `contactId`. Returns true/false.
  function portalOwnsContact(req: any, contactId: number): boolean {
    const owned = getPortalContactId(req);
    return owned != null && owned === Number(contactId);
  }
  // Verify the token owns the contact that a given job belongs to.
  function portalOwnsJob(req: any, jobId: number): boolean {
    const owned = getPortalContactId(req);
    if (owned == null) return false;
    const job: any = sqlite.prepare("SELECT contact_id FROM jobs WHERE id = ?").get(Number(jobId));
    return !!job && Number(job.contact_id) === owned;
  }
  // True if the request carries a valid, non-expired staff session token.
  // Staff (admin dashboard) legitimately view any partner's data.
  function hasValidStaffSession(req: any): boolean {
    const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
    if (!token) return false;
    const session: any = sqlite.prepare(
      "SELECT 1 FROM staff_sessions WHERE session_token = ? AND expires_at > ?"
    ).get(token, new Date().toISOString());
    return !!session;
  }
  // Partner endpoints take a contactId in the URL. Allow access only when the
  // caller's portal token owns that contact, OR when a valid staff session is
  // present (the admin dashboard reads every partner). Prevents one partner from
  // reading another partner's leads, balance, jobs, or commission figures.
  function partnerAccessAllowed(req: any, contactId: number): boolean {
    return portalOwnsContact(req, contactId) || hasValidStaffSession(req);
  }

  // ── Customer Portal ───────────────────────────────────────────────────────
  app.post("/api/customer-portal/login", (req, res) => {
    const { phone, pin } = req.body;
    const contacts = storage.getContacts();
    const contact = contacts.find(c =>
      c.type === "customer" &&
      c.portalPin === String(pin) &&
      (c.phone?.replace(/\D/g, "") === String(phone).replace(/\D/g, "") ||
       c.name.toLowerCase().includes(String(phone).toLowerCase()))
    );
    if (!contact) return res.status(401).json({ error: "Invalid credentials" });
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    storage.createPortalSession({ contactId: contact.id, sessionToken: token, expiresAt });
    res.json({ token, contact });
  });

  app.get("/api/customer-portal/jobs/:contactId", (req, res) => {
    if (!portalOwnsContact(req, Number(req.params.contactId)))
      return res.status(403).json({ error: "Not authorized to view this account." });
    const jobs = storage.getJobs().filter(j => j.contactId === Number(req.params.contactId));
    res.json(jobs);
  });

  app.get("/api/customer-portal/invoices/:contactId", (req, res) => {
    if (!portalOwnsContact(req, Number(req.params.contactId)))
      return res.status(403).json({ error: "Not authorized to view this account." });
    const invoices = storage.getInvoices().filter(i => i.contactId === Number(req.params.contactId));
    res.json(invoices);
  });


  // ── Customer Portal — enriched job data (docs, estimates, drying records, notes) ──
  app.get("/api/customer-portal/job-detail/:jobId", (req, res) => {
    const jobId = Number(req.params.jobId);
    if (!portalOwnsJob(req, jobId))
      return res.status(403).json({ error: "Not authorized to view this job." });
    const job: any = sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    if (!job) return res.status(404).json({ error: "Not found" });

    // Public notes only
    const notes = sqlite.prepare(
      "SELECT * FROM job_notes WHERE job_id = ? AND is_public = 1 ORDER BY created_at ASC"
    ).all(jobId);

    // Documents — exclude raw signature/file data to keep payload small; send metadata only
    const docs = sqlite.prepare(
      "SELECT id, job_id, doc_type, title, signer_name, signer_role, signed_at, file_name, file_mime_type, file_size, status, created_by, created_at FROM job_documents WHERE job_id = ? ORDER BY created_at DESC"
    ).all(jobId);

    // Estimates (sent or approved only — not drafts)
    const estimates = sqlite.prepare(
      "SELECT id, job_id, title, status, subtotal, tax, total, notes, created_at FROM estimates WHERE job_id = ? AND status IN ('sent','approved') ORDER BY created_at DESC"
    ).all(jobId);

    // Drying records summary — customer-safe psychrometric fields only.
    // Includes goal/completion flags so the portal can visualize dry-out progress.
    const dryingRecords = sqlite.prepare(
      "SELECT id, job_id, reading_date, reading_time, day_number, water_category, water_class, temp_f, rh_pct, gpp, moisture_readings, equipment, affected_areas, drying_goal_met, structural_drying_complete FROM drying_records WHERE job_id = ? ORDER BY reading_date ASC, day_number ASC"
    ).all(jobId) as any[];

    // Equipment currently on-site for this job (homeowners like to see the gear working)
    const equipmentOnSite = sqlite.prepare(
      "SELECT id, name, category, model, deployed_at FROM equipment WHERE current_job_id = ? AND status = 'deployed' ORDER BY category"
    ).all(jobId) as any[];
    // Fall back to deployment log for count if equipment records are sparse
    const deploymentLog = sqlite.prepare(
      "SELECT ed.id, ed.deployed_at, ed.returned_at, e.name, e.category, e.model FROM equipment_deployments ed LEFT JOIN equipment e ON e.id = ed.equipment_id WHERE ed.job_id = ? AND ed.returned_at IS NULL ORDER BY ed.deployed_at DESC"
    ).all(jobId) as any[];

    // Two-way message thread (homeowner <-> Titan)
    const messages = sqlite.prepare(
      "SELECT id, job_id, sender, author_name, body, created_at FROM customer_messages WHERE job_id = ? ORDER BY created_at ASC"
    ).all(jobId) as any[];

    // ── Next Action panel — plain-English "what happens next" per stage ────────
    const NEXT_ACTION: Record<string, { title: string; detail: string; who: string }> = {
      new:            { title: "We're preparing your job", detail: "Our team is reviewing your loss and scheduling the first crew visit. You'll get a call to confirm arrival time.", who: "Titan Restoration" },
      mitigation:     { title: "Emergency mitigation in progress", detail: "We're extracting water and setting drying equipment to prevent further damage. Please keep the equipment running and pets away from it.", who: "Titan crew" },
      drying:         { title: "Structural drying underway", detail: "We're monitoring moisture daily until your structure is dry to IICRC standards. No action needed — just leave the equipment running.", who: "Titan crew" },
      reconstruction: { title: "Rebuild phase", detail: "Repairs are underway. Review any estimates in the Reports tab and reach out with color/finish selections when prompted.", who: "You & Titan" },
      complete:       { title: "Work complete", detail: "Your job is finished. Please review your final documents and settle any open invoice in the Invoices tab.", who: "You" },
      closed:         { title: "Job closed", detail: "This job is fully closed out. Thank you for trusting Titan Restoration. We'd love a review!", who: "" },
    };
    const nextAction = NEXT_ACTION[job.status] || null;

    // Dry-out progress signal derived from latest reading
    const latestDrying = dryingRecords[dryingRecords.length - 1] || null;
    const dryingComplete = latestDrying ? Boolean(latestDrying.structural_drying_complete) : false;

    // ── Insurance claim picture (customer-safe carrier figures — NO Titan margins) ──
    const claimRow: any = sqlite.prepare("SELECT * FROM job_claims WHERE job_id = ?").get(jobId) || null;
    const claimPayments = sqlite.prepare(
      "SELECT id, label, kind, amount, status, expected_date, received_date, note FROM claim_payments WHERE job_id = ? ORDER BY sort_order ASC, id ASC"
    ).all(jobId) as any[];
    const claim = claimRow ? {
      status: claimRow.claim_status,
      dateOfLoss: claimRow.date_of_loss,
      reportedDate: claimRow.reported_date,
      deductible: claimRow.deductible,
      rcv: claimRow.rcv,
      acv: claimRow.acv,
      recoverableDepreciation: claimRow.recoverable_depreciation,
      supplementTotal: claimRow.supplement_total,
      coverageNotes: claimRow.coverage_notes,
      carrier: job.insurance_carrier,
      claimNumber: job.claim_number,
      policyNumber: job.policy_number,
      adjusterName: job.adjuster_name,
      adjusterPhone: job.adjuster_phone,
      payments: claimPayments,
    } : null;

    // DocuSketch scan (only expose if complete)
    const docusketch = job.docusketch_status === "complete"
      ? {
          projectName: job.docusketch_project_name,
          tourUrl: job.docusketch_url,
          sketchUrl: job.docusketch_sketch_url,
          completedAt: job.docusketch_completed_at,
          status: job.docusketch_status,
        }
      : null;

    res.json({
      notes, docs, estimates, dryingRecords, docusketch,
      equipmentOnSite, deploymentLog, messages, nextAction, dryingComplete, claim,
    });
  });

  // ── Customer Portal — two-way messaging ───────────────────────────────────
  app.get("/api/customer-portal/messages/:jobId", (req, res) => {
    const jobId = Number(req.params.jobId);
    if (!portalOwnsJob(req, jobId))
      return res.status(403).json({ error: "Not authorized to view this job." });
    const messages = sqlite.prepare(
      "SELECT id, job_id, sender, author_name, body, created_at FROM customer_messages WHERE job_id = ? ORDER BY created_at ASC"
    ).all(jobId);
    // Mark Titan messages as read by customer on fetch
    sqlite.prepare("UPDATE customer_messages SET read_by_customer = 1 WHERE job_id = ? AND sender = 'titan'").run(jobId);
    res.json(messages);
  });

  app.post("/api/customer-portal/messages", (req, res) => {
    const { jobId, contactId, body, authorName } = req.body || {};
    if (!jobId || !contactId || !body || !String(body).trim()) {
      return res.status(400).json({ error: "jobId, contactId and body are required" });
    }
    if (!portalOwnsJob(req, Number(jobId)))
      return res.status(403).json({ error: "Not authorized to post to this job." });
    const now = new Date().toISOString();
    const result = sqlite.prepare(
      "INSERT INTO customer_messages (job_id, contact_id, sender, author_name, body, read_by_staff, read_by_customer, created_at) VALUES (?, ?, 'customer', ?, ?, 0, 1, ?)"
    ).run(Number(jobId), Number(contactId), authorName || null, String(body).trim(), now);
    res.json({ id: result.lastInsertRowid, jobId: Number(jobId), sender: "customer", authorName, body: String(body).trim(), created_at: now });
  });

  app.post("/api/customer-portal/pay", (req, res) => {
    const { invoiceId, amount, method, contactId } = req.body;
    if (!portalOwnsContact(req, Number(contactId)))
      return res.status(403).json({ error: "Not authorized to pay on this account." });
    const payment = storage.createPayment({
      invoiceId, amount, method: method || "online", type: "received", contactId,
      reference: "Customer Portal Payment",
    });
    if (invoiceId) storage.updateInvoice(invoiceId, { status: "paid", paidAt: new Date().toISOString() });
    res.json(payment);
  });

  // ── Partner Portal — job submission (refer a job through the app) ─────────
  app.get("/api/partner/:contactId/leads", (req, res) => {
    const partnerId = Number(req.params.contactId);
    if (!partnerAccessAllowed(req, partnerId))
      return res.status(403).json({ error: "Not authorized to view this account." });
    const leads = sqlite.prepare(
      "SELECT * FROM partner_leads WHERE partner_id = ? ORDER BY created_at DESC"
    ).all(partnerId);
    res.json(leads);
  });

  app.post("/api/partner/:contactId/leads", (req, res) => {
    const partnerId = Number(req.params.contactId);
    if (!partnerAccessAllowed(req, partnerId))
      return res.status(403).json({ error: "Not authorized to submit leads for this account." });
    const b = req.body || {};
    if (!b.customerName || !String(b.customerName).trim()) {
      return res.status(400).json({ error: "Customer name is required" });
    }
    if (!b.customerPhone && !b.lossAddress) {
      return res.status(400).json({ error: "A phone number or address is required so we can reach the customer" });
    }
    const partner: any = sqlite.prepare("SELECT id, name FROM contacts WHERE id = ?").get(partnerId);
    const now = new Date().toISOString();
    const result = sqlite.prepare(`
      INSERT INTO partner_leads
        (partner_id, partner_name, customer_name, customer_phone, customer_email, loss_address, loss_type, insurance_carrier, claim_number, urgency, description, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)
    `).run(
      partnerId,
      partner?.name || b.partnerName || null,
      String(b.customerName).trim(),
      b.customerPhone || null,
      b.customerEmail || null,
      b.lossAddress || null,
      b.lossType || null,
      b.insuranceCarrier || null,
      b.claimNumber || null,
      b.urgency || "standard",
      b.description || null,
      now,
    );
    const lead = sqlite.prepare("SELECT * FROM partner_leads WHERE id = ?").get(result.lastInsertRowid);
    res.json(lead);
  });

  // ── Job Documents (e-sign forms + PDF uploads) ─────────────────────────
  // On the list route we now hydrate any bucket-backed fields with signed read
  // URLs so the client's View/Download buttons work for docs whose file_data
  // has been offloaded to S3. Legacy inline data-URIs pass through untouched.
  app.get("/api/jobs/:id/documents", wrapAsync(async (req, res) => {
    const docs = storage.getJobDocuments(Number(req.params.id)) as any[];
    if (objectStorage.isConfigured()) {
      await Promise.all(docs.map(async (doc) => {
        if (doc.storageKey && !doc.fileData) {
          // Force the response MIME + inline disposition so PDFs open in the
          // browser viewer instead of downloading as octet-stream (which
          // renders as a blank/black tab in Chrome & Safari).
          const mime = doc.fileMimeType || "application/pdf";
          const safeName = (doc.fileName || `document-${doc.id}.pdf`).replace(/"/g, "");
          try { doc.fileData = await objectStorage.getReadUrl(doc.storageKey, undefined, {
            responseContentType: mime,
            responseContentDisposition: `inline; filename="${safeName}"`,
          }); } catch {}
        }
        if (doc.signatureStorageKey && !doc.signatureData) {
          try { doc.signatureData = await objectStorage.getReadUrl(doc.signatureStorageKey, undefined, {
            responseContentType: "image/png",
          }); } catch {}
        }
      }));
    }
    res.json(docs);
  }));

  // Hoists file_data (PDF upload) and signature_data (e-sign PNG) into the
  // bucket before insert so signed forms don't bloat SQLite. Legacy rows keep
  // rendering because reads still return whatever's in the DB when no
  // storage_key is set.
  app.post("/api/jobs/:id/documents", wrapAsync(async (req, res) => {
    const body: any = { ...req.body, jobId: Number(req.params.id) };
    if (body.fileData || body.file_data) {
      const rawUri = body.fileData ?? body.file_data;
      // Capture MIME + a reasonable filename BEFORE we hoist to S3 so the
      // read routes can slap them onto the signed URL. Otherwise Chrome
      // gets application/octet-stream and paints a black tab.
      if (!body.fileMimeType && typeof rawUri === "string") {
        const m = /^data:([^;,]+)(?:;[^;,]+=[^;,]+)*;base64,/s.exec(rawUri);
        if (m) body.fileMimeType = m[1];
      }
      if (!body.fileName) {
        const safeTitle = String(body.title || "document").replace(/[^\w.\-]+/g, "_");
        const ext = (body.fileMimeType || "application/pdf").split("/")[1] || "pdf";
        body.fileName = `${safeTitle}.${ext}`;
      }
      const stored = await writeImageFieldSafe(rawUri, "documents");
      body.fileData = stored.dataUrl;
      if (stored.storageKey) body.storageKey = stored.storageKey;
    }
    if (body.signatureData || body.signature_data) {
      const stored = await writeImageFieldSafe(body.signatureData ?? body.signature_data, "signatures");
      body.signatureData = stored.dataUrl;
      if (stored.storageKey) body.signatureStorageKey = stored.storageKey;
    }
    const doc = storage.createJobDocument(body);
    res.json(doc);
  }));

  app.get("/api/documents/:id", wrapAsync(async (req, res) => {
    const doc = storage.getJobDocument(Number(req.params.id)) as any;
    if (!doc) return res.status(404).json({ error: "Not found" });
    // Hydrate any bucket-backed fields on demand. Passing MIME + inline
    // disposition so PDFs open in the browser viewer instead of downloading
    // as octet-stream (which renders as a blank/black tab in Chrome & Safari).
    if (doc.storageKey && objectStorage.isConfigured()) {
      const mime = doc.fileMimeType || "application/pdf";
      const safeName = (doc.fileName || `document-${doc.id}.pdf`).replace(/"/g, "");
      try { doc.fileData = await objectStorage.getReadUrl(doc.storageKey, undefined, {
        responseContentType: mime,
        responseContentDisposition: `inline; filename="${safeName}"`,
      }); } catch {}
    }
    if (doc.signatureStorageKey && objectStorage.isConfigured()) {
      try { doc.signatureData = await objectStorage.getReadUrl(doc.signatureStorageKey, undefined, {
        responseContentType: "image/png",
      }); } catch {}
    }
    res.json(doc);
  }));

  app.patch("/api/documents/:id", wrapAsync(async (req, res) => {
    const body: any = { ...req.body };
    // Same hoist for updates that replace the file or the signature.
    if (body.fileData || body.file_data) {
      const stored = await writeImageFieldSafe(body.fileData ?? body.file_data, "documents");
      body.fileData = stored.dataUrl;
      if (stored.storageKey) body.storageKey = stored.storageKey;
    }
    if (body.signatureData || body.signature_data) {
      const stored = await writeImageFieldSafe(body.signatureData ?? body.signature_data, "signatures");
      body.signatureData = stored.dataUrl;
      if (stored.storageKey) body.signatureStorageKey = stored.storageKey;
    }
    const doc = storage.updateJobDocument(Number(req.params.id), body);
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json(doc);
  }));

  // Email a saved job document to one or more 3rd-party recipients as an
  // attachment. Requires the document to already be persisted so we have a
  // stable filename and content. Body: { to, subject?, message? }.
  app.post("/api/documents/:id/email", wrapAsync(async (req, res) => {
    const doc = storage.getJobDocument(Number(req.params.id)) as any;
    if (!doc) return res.status(404).json({ error: "document not found" });
    let toRaw = req.body?.to;
    if (typeof toRaw === "string") toRaw = toRaw.split(/[,;\s]+/).filter(Boolean);
    const to: string[] = Array.isArray(toRaw) ? toRaw.filter(Boolean) : [];
    if (!to.length) return res.status(400).json({ error: "to required" });
    // Hydrate the file bytes: doc.fileData is either a base64 data-URI or
    // an S3 storage key. sendEmail accepts data URIs directly, so we fetch
    // and re-encode when the doc is bucket-backed.
    let content: string | null = null;
    if (doc.fileData && typeof doc.fileData === "string" && doc.fileData.startsWith("data:")) {
      content = doc.fileData;
    } else if (doc.storageKey && objectStorage.isConfigured()) {
      try {
        const url = await objectStorage.getReadUrl(doc.storageKey);
        const r = await fetch(url);
        const buf = Buffer.from(await r.arrayBuffer());
        const mime = r.headers.get("content-type") || "application/pdf";
        content = `data:${mime};base64,${buf.toString("base64")}`;
      } catch (e: any) {
        return res.status(500).json({ error: "could not read document from storage" });
      }
    }
    if (!content) return res.status(400).json({ error: "document has no attachable content" });
    const filename = String(doc.title || doc.filename || `document-${doc.id}.pdf`);
    const subject = String(req.body?.subject || `${doc.title || "Document"} — Titan Restoration`);
    const html = String(req.body?.message || `<p>Please find the attached document from Titan Restoration.</p>`);
    const result = await sendEmail({
      to,
      subject,
      html,
      attachments: [{ filename, contentType: "application/pdf", content }],
    });
    res.json({ ok: true, result });
  }));

  app.delete("/api/documents/:id", (req, res) => {
    storage.deleteJobDocument(Number(req.params.id));
    res.json({ success: true });
  });
  // ── Equipment ────────────────────────────────────────────────────────────
  app.get("/api/equipment", (_req, res) => {
    const rows = sqlite.prepare("SELECT * FROM equipment ORDER BY category, name").all();
    res.json(rows);
  });
  app.post("/api/equipment", (req, res) => {
    const d = req.body;
    const now = new Date().toISOString();
    const row = sqlite.prepare(`INSERT INTO equipment (name, category, serial_number, model, daily_rate, status, notes, created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING *`)
      .get(d.name, d.category, d.serialNumber||null, d.model||null, d.dailyRate||0, d.status||'available', d.notes||null, now);
    res.json(row);
  });
  app.patch("/api/equipment/:id", (req, res) => {
    const d = req.body;
    const fields = Object.keys(d).map(k => {
      const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
      return `${col} = ?`;
    }).join(', ');
    const vals = [...Object.values(d), req.params.id];
    const row = sqlite.prepare(`UPDATE equipment SET ${fields} WHERE id = ? RETURNING *`).get(...vals);
    res.json(row);
  });
  app.delete("/api/equipment/:id", (req, res) => {
    sqlite.prepare("DELETE FROM equipment WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // Deploy equipment to job
  app.post("/api/equipment/:id/deploy", (req, res) => {
    const { jobId, notes } = req.body;
    const now = new Date().toISOString();
    const deployedAt = req.body.deployedAt || now.slice(0,10);
    sqlite.prepare("UPDATE equipment SET status='deployed', current_job_id=?, deployed_at=? WHERE id=?").run(jobId, deployedAt, req.params.id);
    const dep = sqlite.prepare(`INSERT INTO equipment_deployments (equipment_id, job_id, deployed_at, notes, created_at) VALUES (?,?,?,?,?) RETURNING *`)
      .get(req.params.id, jobId, deployedAt, notes||null, now);
    res.json(dep);
  });
  app.post("/api/equipment/:id/return", (req, res) => {
    const returnedAt = req.body.returnedAt || new Date().toISOString().slice(0,10);
    const equip = sqlite.prepare("SELECT * FROM equipment WHERE id=?").get(req.params.id) as any;
    let daysOut = 0;
    if (equip?.deployed_at) {
      daysOut = Math.ceil((new Date(returnedAt).getTime() - new Date(equip.deployed_at).getTime()) / (1000*60*60*24));
    }
    const billedAmount = daysOut * (equip?.daily_rate || 0);
    sqlite.prepare("UPDATE equipment SET status='available', current_job_id=NULL, deployed_at=NULL WHERE id=?").run(req.params.id);
    // Update the open deployment
    sqlite.prepare(`UPDATE equipment_deployments SET returned_at=?, days_out=?, billed_amount=? WHERE equipment_id=? AND returned_at IS NULL`)
      .run(returnedAt, daysOut, billedAmount, req.params.id);
    res.json({ daysOut, billedAmount });
  });
  app.get("/api/equipment-deployments", (_req, res) => {
    const rows = sqlite.prepare("SELECT * FROM equipment_deployments ORDER BY deployed_at DESC").all();
    res.json(rows);
  });
  app.get("/api/jobs/:jobId/equipment", (req, res) => {
    const rows = sqlite.prepare("SELECT e.*, ed.deployed_at as dep_date FROM equipment e LEFT JOIN equipment_deployments ed ON e.id=ed.equipment_id AND ed.job_id=? WHERE e.current_job_id=?").all(req.params.jobId, req.params.jobId);
    res.json(rows);
  });

  // ── Consumables Inventory ──────────────────────────────────────────────────
  const mapConsumable = (r: any) => r ? ({
    id: r.id, name: r.name, sku: r.sku, category: r.category, unit: r.unit,
    onHand: r.on_hand, reorderPoint: r.reorder_point, unitCost: r.unit_cost,
    vendor: r.vendor, location: r.location, notes: r.notes,
    isActive: r.is_active === 1 || r.is_active === true,
    lowStock: (r.on_hand ?? 0) <= (r.reorder_point ?? 0),
    createdAt: r.created_at,
  }) : r;
  const mapConsTxn = (r: any) => r ? ({
    id: r.id, consumableId: r.consumable_id, type: r.type, quantity: r.quantity,
    unitCost: r.unit_cost, jobId: r.job_id, jobCostId: r.job_cost_id,
    source: r.source, reference: r.reference, enteredBy: r.entered_by,
    balanceAfter: r.balance_after, createdAt: r.created_at,
  }) : r;

  // List all consumables
  app.get("/api/consumables", (req, res) => {
    const includeInactive = req.query.all === "1";
    const rows = sqlite.prepare(
      `SELECT * FROM consumables ${includeInactive ? "" : "WHERE is_active=1"} ORDER BY category, name`
    ).all() as any[];
    res.json(rows.map(mapConsumable));
  });

  // Low-stock / reorder list (grouped-friendly flat list). onHand <= reorderPoint.
  app.get("/api/consumables/low-stock", (_req, res) => {
    const rows = sqlite.prepare(
      "SELECT * FROM consumables WHERE is_active=1 AND on_hand <= reorder_point ORDER BY vendor, category, name"
    ).all() as any[];
    const items = rows.map((r) => {
      const c = mapConsumable(r);
      // Suggested reorder qty: bring back up to 2x reorder point (min 1), rounded up.
      const target = Math.max((r.reorder_point ?? 0) * 2, (r.reorder_point ?? 0) + 1, 1);
      const suggestedQty = Math.max(Math.ceil(target - (r.on_hand ?? 0)), 1);
      return { ...c, suggestedQty, estCost: +(suggestedQty * (r.unit_cost ?? 0)).toFixed(2) };
    });
    // group by vendor for the reorder email/list
    const byVendor: Record<string, any[]> = {};
    for (const it of items) {
      const v = it.vendor || "Unassigned Vendor";
      (byVendor[v] = byVendor[v] || []).push(it);
    }
    const groups = Object.entries(byVendor).map(([vendor, list]) => ({
      vendor,
      items: list,
      estTotal: +list.reduce((s, i) => s + (i.estCost || 0), 0).toFixed(2),
    }));
    const estGrandTotal = +items.reduce((s, i) => s + (i.estCost || 0), 0).toFixed(2);
    res.json({ count: items.length, items, groups, estGrandTotal });
  });
  // ── "Attention Today" owner dashboard ───────────────────────────────
  // Surfaces the things a business owner needs to react to today across
  // the entire company. Each bucket returns a count and the top few
  // offending rows so the UI can render actionable list items directly.
  //
  // Owner/admin/general_manager only — exposes cross-employee
  // information that a tech shouldn't see.
  app.get("/api/dashboard/attention", requireRole("owner", "admin", "general_manager"), (_req, res) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 3600 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
    const tenHoursAgo = new Date(now.getTime() - 10 * 3600 * 1000).toISOString();

    const safe = <T>(fn: () => T, fallback: T): T => {
      try { return fn(); } catch { return fallback; }
    };

    // Overdue invoices — unpaid past due_date, still open.
    const overdueInvoices = safe(() => sqlite.prepare(`
      SELECT id, invoice_number AS invoiceNumber, total, due_date AS dueDate, status, job_id AS jobId
        FROM invoices
       WHERE status NOT IN ('paid','void','cancelled')
         AND due_date IS NOT NULL AND due_date <> '' AND due_date < ?
       ORDER BY due_date ASC
       LIMIT 25
    `).all(nowIso) as any[], []);

    // Signature requests still pending >24h.
    const unsignedRequests = safe(() => sqlite.prepare(`
      SELECT id, title, doc_type AS docType, recipient_name AS recipientName,
             recipient_email AS recipientEmail, job_id AS jobId, created_at AS createdAt
        FROM signature_requests
       WHERE status = 'pending'
         AND created_at < ?
       ORDER BY created_at ASC
       LIMIT 25
    `).all(dayAgo) as any[], []);

    // Drying jobs that have logged 3+ days of readings without a
    // structural_drying_complete = 1 record and are on an open job.
    // IICRC S500 typical benchmark is 3 days; beyond that needs owner
    // eyes.
    const dryingPastBenchmark = safe(() => sqlite.prepare(`
      SELECT j.id AS jobId, j.job_number AS jobNumber, j.address,
             MAX(d.day_number) AS days,
             MAX(d.reading_date) AS lastReading
        FROM drying_records d
        JOIN jobs j ON j.id = d.job_id
       WHERE j.status NOT IN ('closed','cancelled','complete','completed')
       GROUP BY d.job_id
      HAVING MAX(d.day_number) >= 3
         AND SUM(CASE WHEN d.structural_drying_complete = 1 THEN 1 ELSE 0 END) = 0
       ORDER BY days DESC
       LIMIT 25
    `).all() as any[], []);

    // Stalled jobs — no drying record, note, invoice or estimate
    // activity in the past 5 days and still open. Cheap approximation:
    // no drying record and no invoice created in 5 days.
    const stalledJobs = safe(() => sqlite.prepare(`
      SELECT j.id AS jobId, j.job_number AS jobNumber, j.address, j.status,
             MAX(COALESCE(d.reading_date, j.created_at)) AS lastActivity
        FROM jobs j
        LEFT JOIN drying_records d ON d.job_id = j.id
       WHERE j.status NOT IN ('closed','cancelled','complete','completed')
       GROUP BY j.id
      HAVING lastActivity IS NULL OR lastActivity < ?
       ORDER BY lastActivity ASC
       LIMIT 25
    `).all(fiveDaysAgo) as any[], []);

    // Long clock-ins — someone still on the clock >10h means they
    // probably forgot to clock out. Payroll accuracy risk.
    const longClockIns = safe(() => sqlite.prepare(`
      SELECT id, employee_name AS employeeName, job_id AS jobId, clock_in_at AS clockInAt
        FROM time_clock
       WHERE clock_out_at IS NULL
         AND clock_in_at < ?
       ORDER BY clock_in_at ASC
       LIMIT 25
    `).all(tenHoursAgo) as any[], []);

    // Supplements pending >7 days without a response.
    const stalePendingSupplements = safe(() => sqlite.prepare(`
      SELECT id, job_id AS jobId, title, amount_requested AS amountRequested,
             carrier, adjuster_name AS adjusterName, submitted_at AS submittedAt, follow_up_due AS followUpDue, status
        FROM supplements
       WHERE status = 'pending'
         AND COALESCE(submitted_at, created_at) < ?
       ORDER BY COALESCE(submitted_at, created_at) ASC
       LIMIT 25
    `).all(sevenDaysAgo) as any[], []);

    res.json({
      generatedAt: nowIso,
      buckets: {
        overdueInvoices: { count: overdueInvoices.length, items: overdueInvoices.slice(0, 5) },
        unsignedRequests: { count: unsignedRequests.length, items: unsignedRequests.slice(0, 5) },
        dryingPastBenchmark: { count: dryingPastBenchmark.length, items: dryingPastBenchmark.slice(0, 5) },
        stalledJobs: { count: stalledJobs.length, items: stalledJobs.slice(0, 5) },
        longClockIns: { count: longClockIns.length, items: longClockIns.slice(0, 5) },
        stalePendingSupplements: { count: stalePendingSupplements.length, items: stalePendingSupplements.slice(0, 5) },
      },
    });
  });

  // ── First-run setup checklist ─────────────────────────────────────────────
  // Powers the onboarding card on the Dashboard. Each item is either
  // "done", "todo", or "optional". Deliberately owner/admin only so techs
  // don't see setup prompts they can't act on.
  app.get("/api/setup/checklist", requireRole("owner", "admin", "general_manager"), (_req, res) => {
    const jobCount = (sqlite.prepare("SELECT COUNT(*) c FROM jobs").get() as any)?.c || 0;
    const contactCount = (sqlite.prepare("SELECT COUNT(*) c FROM contacts").get() as any)?.c || 0;
    const userCount = (sqlite.prepare("SELECT COUNT(*) c FROM employees WHERE is_active = 1").get() as any)?.c || 0;
    const gmailConnected = (sqlite.prepare("SELECT COUNT(*) c FROM employees WHERE gmail_connected = 1").get() as any)?.c || 0;
    let priceListCount = 0;
    try { priceListCount = (sqlite.prepare("SELECT COUNT(*) c FROM line_item_library").get() as any)?.c || 0; } catch { /* table may not exist yet */ }
    let estimateCount = 0;
    try { estimateCount = (sqlite.prepare("SELECT COUNT(*) c FROM estimates").get() as any)?.c || 0; } catch { /* ignore */ }
    const providers = providerStatus();

    const items = [
      {
        key: "invite_team",
        title: "Invite your team",
        description: "Add each employee, tech, and office user under User Management.",
        cta: { label: "Open User Management", href: "/#/user-management" },
        status: userCount >= 2 ? "done" : "todo",
        detail: userCount >= 2 ? `${userCount} active users` : "Only 1 active user — add your team.",
      },
      {
        key: "connect_gmail",
        title: "Connect a company Gmail",
        description: "Emails to customers and adjusters send from your real Gmail instead of a no-reply address.",
        cta: { label: "Open Integrations", href: "/#/integrations" },
        status: gmailConnected >= 1 ? "done" : "todo",
        detail: gmailConnected >= 1 ? `${gmailConnected} account(s) connected ` : "No Gmail account connected.",
      },
      {
        key: "maps_api",
        title: "Add a Google Maps API key",
        description: "Enables address lookup, geocoding, and the service-area map.",
        cta: { label: "See setup notes", href: "/#/integrations" },
        status: process.env.GOOGLE_MAPS_API_KEY ? "done" : "todo",
        detail: process.env.GOOGLE_MAPS_API_KEY ? "Key present in environment" : "GOOGLE_MAPS_API_KEY missing on server.",
      },
      {
        key: "import_price_list",
        title: "Import your price list",
        description: "Your Xactimate-style lines power estimates and invoices.",
        cta: { label: "Open Line Item Library", href: "/#/line-items" },
        status: priceListCount >= 25 ? "done" : "todo",
        detail: priceListCount >= 25 ? `${priceListCount} items in the library` : `Only ${priceListCount} items — import a CSV.`,
      },
      {
        key: "create_first_job",
        title: "Create your first job",
        description: "Every workflow (estimates, shifts, drying, invoices) starts from a job.",
        cta: { label: "Open Jobs", href: "/#/jobs" },
        status: jobCount >= 1 ? "done" : "todo",
        detail: jobCount >= 1 ? `${jobCount} job(s) in the system` : "No jobs yet.",
      },
      {
        key: "add_contact",
        title: "Add a customer contact",
        description: "Contacts show up in jobs, portals, and marketing touchpoints.",
        cta: { label: "Open Contacts", href: "/#/contacts" },
        status: contactCount >= 1 ? "done" : "todo",
        detail: contactCount >= 1 ? `${contactCount} contact(s)` : "No contacts yet.",
      },
      {
        key: "email_provider",
        title: "Verify email delivery",
        description: "Configure SMTP or SendGrid on Railway if no employee has connected Gmail. Otherwise the Gmail integration is enough.",
        cta: { label: "Open Notify Settings", href: "/#/settings" },
        status: providers.email.live || gmailConnected >= 1 ? "done" : "todo",
        detail: providers.email.live ? `Live via ${providers.email.provider}` : (gmailConnected >= 1 ? "Sends via employee Gmail" : "No email transport configured."),
      },
      {
        key: "sms_provider",
        title: "Enable SMS (optional)",
        description: "Twilio env vars unlock text-message notifications to techs and customers.",
        cta: { label: "Open Notify Settings", href: "/#/settings" },
        status: providers.sms.live ? "done" : "optional",
        detail: providers.sms.live ? "Twilio configured" : "Not configured (optional).",
      },
      {
        key: "create_first_estimate",
        title: "Send your first estimate",
        description: "Try the estimate builder end-to-end so you know the customer‑facing flow works for your business.",
        cta: { label: "Open Estimates", href: "/#/estimates" },
        status: estimateCount >= 1 ? "done" : "optional",
        detail: estimateCount >= 1 ? `${estimateCount} estimate(s) created` : "No estimates yet.",
      },
    ];

    const doneCount = items.filter(i => i.status === "done").length;
    const total = items.filter(i => i.status !== "optional" || i.status === "done").length;
    // Show the checklist until every non-optional item is done.
    const remainingRequired = items.filter(i => i.status === "todo").length;
    res.json({
      items,
      doneCount,
      total,
      complete: remainingRequired === 0,
    });
  });

  // ── Per-user notification preferences ─────────────────────────────────
  // Each employee can decide which notifications they want, per channel
  // (bell / email / sms) and per event type. Backend integrations already
  // check these prefs before sending, so opting out is truly silent.
  ensureNotifPrefsTable(sqlite);

  app.get("/api/notify/preferences", requireStaffAuth, (req: any, res) => {
    const emp = req.employee;
    if (!emp?.id) return res.status(401).json({ error: "Unauthenticated" });
    res.json({
      employeeId: emp.id,
      channels: NOTIF_CHANNELS,
      events: NOTIF_EVENTS,
      matrix: getPrefsMatrix(sqlite, emp.id),
    });
  });

  app.patch("/api/notify/preferences", requireStaffAuth, (req: any, res) => {
    const emp = req.employee;
    if (!emp?.id) return res.status(401).json({ error: "Unauthenticated" });
    // Body: { updates: [{ channel, event, enabled }, ...] }
    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
    let applied = 0;
    for (const u of updates) {
      if (!NOTIF_CHANNELS.includes(u.channel)) continue;
      if (!NOTIF_EVENTS.includes(u.event)) continue;
      setPref(sqlite, emp.id, u.channel, u.event, !!u.enabled);
      applied++;
    }
    res.json({
      applied,
      matrix: getPrefsMatrix(sqlite, emp.id),
    });
  });

  // ── Notification settings + provider status + test send ────────────────────
  app.get("/api/notify/settings", requireStaffAuth, (_req, res) => {
    res.json({ settings: getNotifySettings(sqlite), providers: providerStatus() });
  });
  app.patch("/api/notify/settings", requireRole("owner", "admin"), (req, res) => {
    const next = saveNotifySettings(sqlite, req.body || {});
    res.json({ settings: next, providers: providerStatus() });
  });
  app.post("/api/notify/test", requireRole("owner", "admin"), wrapAsync(async (req, res) => {
    const { channel, to } = req.body || {};
    if (channel === "sms") {
      const r = await sendSms({ to, body: "Titan Pro test SMS — notifications are working." });
      return res.json({ results: r });
    }
    const r = await sendEmail({ to, subject: "Titan Pro test email", text: "This is a test email from Titan Pro. Notifications are working." });
    res.json({ results: r });
  }));

  // ── Low-stock alert: build reorder list + send via email/SMS to ops ─────────
  // Reusable generator (also used by the scheduled/dashboard check).
  function buildReorderReport() {
    const rows = sqlite.prepare(
      "SELECT * FROM consumables WHERE is_active=1 AND on_hand <= reorder_point ORDER BY vendor, category, name"
    ).all() as any[];
    const items = rows.map((r) => {
      const target = Math.max((r.reorder_point ?? 0) * 2, (r.reorder_point ?? 0) + 1, 1);
      const suggestedQty = Math.max(Math.ceil(target - (r.on_hand ?? 0)), 1);
      return {
        id: r.id, name: r.name, sku: r.sku, unit: r.unit, vendor: r.vendor || "Unassigned Vendor",
        onHand: r.on_hand, reorderPoint: r.reorder_point, unitCost: r.unit_cost,
        suggestedQty, estCost: +(suggestedQty * (r.unit_cost ?? 0)).toFixed(2),
      };
    });
    const byVendor: Record<string, any[]> = {};
    for (const it of items) (byVendor[it.vendor] = byVendor[it.vendor] || []).push(it);
    const groups = Object.entries(byVendor).map(([vendor, list]) => ({
      vendor, items: list, estTotal: +list.reduce((s, i) => s + i.estCost, 0).toFixed(2),
    }));
    const estGrandTotal = +items.reduce((s, i) => s + i.estCost, 0).toFixed(2);
    return { count: items.length, items, groups, estGrandTotal };
  }

  function reorderText(report: ReturnType<typeof buildReorderReport>) {
    if (!report.count) return "All consumables are above their reorder points. Nothing to reorder.";
    const lines: string[] = [];
    lines.push(`TITAN RESTORATION — LOW STOCK / REORDER LIST`);
    lines.push(`${report.count} item(s) at or below reorder point. Est. total: $${report.estGrandTotal.toFixed(2)}`);
    lines.push("");
    for (const g of report.groups) {
      lines.push(`■ ${g.vendor}  (est $${g.estTotal.toFixed(2)})`);
      for (const it of g.items) {
        lines.push(`   - ${it.name}${it.sku ? ` [${it.sku}]` : ""}: on hand ${it.onHand} ${it.unit}, reorder ~${it.suggestedQty} ${it.unit} (@ $${(it.unitCost || 0).toFixed(2)})`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  function reorderHtml(report: ReturnType<typeof buildReorderReport>) {
    if (!report.count) return "<p>All consumables are above their reorder points. Nothing to reorder.</p>";
    let h = `<h2 style="margin:0 0 4px">Low Stock / Reorder List</h2>`;
    h += `<p style="margin:0 0 12px;color:#555">${report.count} item(s) at or below reorder point. Estimated total: <strong>$${report.estGrandTotal.toFixed(2)}</strong></p>`;
    for (const g of report.groups) {
      h += `<h3 style="margin:16px 0 4px">${escapeHtmlSafe(g.vendor)} <span style="font-weight:normal;color:#888">— est $${g.estTotal.toFixed(2)}</span></h3>`;
      h += `<table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr style="background:#f3f4f6"><th style="text-align:left;padding:6px 8px">Item</th><th style="text-align:left;padding:6px 8px">SKU</th><th style="text-align:right;padding:6px 8px">On hand</th><th style="text-align:right;padding:6px 8px">Reorder qty</th><th style="text-align:right;padding:6px 8px">Est. cost</th></tr></thead><tbody>`;
      for (const it of g.items) {
        h += `<tr><td style="padding:6px 8px;border-top:1px solid #eee">${escapeHtmlSafe(it.name)}</td><td style="padding:6px 8px;border-top:1px solid #eee">${escapeHtmlSafe(it.sku || "")}</td><td style="padding:6px 8px;border-top:1px solid #eee;text-align:right">${it.onHand} ${escapeHtmlSafe(it.unit)}</td><td style="padding:6px 8px;border-top:1px solid #eee;text-align:right">${it.suggestedQty} ${escapeHtmlSafe(it.unit)}</td><td style="padding:6px 8px;border-top:1px solid #eee;text-align:right">$${it.estCost.toFixed(2)}</td></tr>`;
      }
      h += `</tbody></table>`;
    }
    return h;
  }
  function escapeHtmlSafe(s: string) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  }

  // GET a text/plain reorder list (for copy/paste + download)
  app.get("/api/consumables/reorder-list.txt", requireStaffAuth, (_req, res) => {
    const report = buildReorderReport();
    res.type("text/plain").send(reorderText(report));
  });

  // POST send the low-stock reorder list to configured ops recipients (or overrides)
  app.post("/api/consumables/low-stock/notify", requireRole("owner", "admin"), wrapAsync(async (req, res) => {
    const report = buildReorderReport();
    if (!report.count) return res.json({ sent: false, reason: "no_low_stock", report });
    const s = getNotifySettings(sqlite);
    const body = req.body || {};
    const emailTo: string[] = body.emailRecipients || s.emailRecipients || [];
    const smsTo: string[] = body.smsRecipients || s.smsRecipients || [];
    const wantEmail = body.email != null ? !!body.email : s.lowStockEmail;
    const wantSms = body.sms != null ? !!body.sms : s.lowStockSms;
    const results: any[] = [];
    if (wantEmail && emailTo.length) {
      const r = await sendEmail({
        to: emailTo,
        subject: `Titan Pro — ${report.count} item(s) low on stock (reorder ~$${report.estGrandTotal.toFixed(2)})`,
        text: reorderText(report),
        html: reorderHtml(report),
      });
      results.push(...r);
    }
    if (wantSms && smsTo.length) {
      const sms = `Titan Pro: ${report.count} consumable(s) low on stock. Est reorder $${report.estGrandTotal.toFixed(2)}. Check Inventory > Reorder List.`;
      const r = await sendSms({ to: smsTo, body: sms });
      results.push(...r);
    }
    res.json({ sent: results.length > 0, count: report.count, results, report });
  }));


  // Single consumable + its transaction history
  app.get("/api/consumables/:id", (req, res) => {
    const row = sqlite.prepare("SELECT * FROM consumables WHERE id=?").get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: "Not found" });
    const txns = sqlite.prepare("SELECT * FROM consumable_transactions WHERE consumable_id=? ORDER BY created_at DESC, id DESC").all(req.params.id) as any[];
    res.json({ ...mapConsumable(row), transactions: txns.map(mapConsTxn) });
  });

  // Create consumable (manual entry). Any starting on_hand is logged as a restock txn.
  app.post("/api/consumables", (req, res) => {
    const d = req.body || {};
    if (!d.name || !String(d.name).trim()) return res.status(400).json({ error: "Name is required" });
    const now = new Date().toISOString();
    const onHand = Number(d.onHand) || 0;
    const row = sqlite.prepare(
      `INSERT INTO consumables (name, sku, category, unit, on_hand, reorder_point, unit_cost, vendor, location, notes, is_active, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,?) RETURNING *`
    ).get(
      String(d.name).trim(), d.sku || null, d.category || "general", d.unit || "each",
      onHand, Number(d.reorderPoint) || 0, Number(d.unitCost) || 0,
      d.vendor || null, d.location || null, d.notes || null, now
    ) as any;
    if (onHand > 0) {
      sqlite.prepare(
        `INSERT INTO consumable_transactions (consumable_id, type, quantity, unit_cost, source, reference, entered_by, balance_after, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(row.id, "restock", onHand, Number(d.unitCost) || 0, "manual", "Initial stock", (req as any).employee?.name || d.enteredBy || null, onHand, now);
    }
    res.json(mapConsumable(row));
  });

  // Update consumable metadata (NOT on_hand — use restock/usage/adjust for stock moves)
  app.patch("/api/consumables/:id", (req, res) => {
    const d = req.body || {};
    const allowed: Record<string, string> = {
      name: "name", sku: "sku", category: "category", unit: "unit",
      reorderPoint: "reorder_point", unitCost: "unit_cost", vendor: "vendor",
      location: "location", notes: "notes", isActive: "is_active",
    };
    const sets: string[] = []; const vals: any[] = [];
    for (const [k, col] of Object.entries(allowed)) {
      if (k in d) {
        sets.push(`${col} = ?`);
        vals.push(k === "isActive" ? (d[k] ? 1 : 0) : d[k]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "No updatable fields" });
    vals.push(req.params.id);
    const row = sqlite.prepare(`UPDATE consumables SET ${sets.join(", ")} WHERE id=? RETURNING *`).get(...vals) as any;
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(mapConsumable(row));
  });

  // Soft-delete (deactivate) a consumable
  app.delete("/api/consumables/:id", (req, res) => {
    sqlite.prepare("UPDATE consumables SET is_active=0 WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  // Restock (add to on_hand). Optionally update unit cost.
  app.post("/api/consumables/:id/restock", (req, res) => {
    const d = req.body || {};
    const qty = Number(d.quantity);
    if (!qty || qty <= 0) return res.status(400).json({ error: "Quantity must be greater than 0" });
    const c = sqlite.prepare("SELECT * FROM consumables WHERE id=?").get(req.params.id) as any;
    if (!c) return res.status(404).json({ error: "Not found" });
    const now = new Date().toISOString();
    const unitCost = d.unitCost != null ? Number(d.unitCost) : c.unit_cost;
    const newOnHand = (c.on_hand || 0) + qty;
    sqlite.prepare("UPDATE consumables SET on_hand=?, unit_cost=? WHERE id=?").run(newOnHand, unitCost, req.params.id);
    sqlite.prepare(
      `INSERT INTO consumable_transactions (consumable_id, type, quantity, unit_cost, source, reference, entered_by, balance_after, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(req.params.id, "restock", qty, unitCost, d.source || "manual", d.reference || null, (req as any).employee?.name || d.enteredBy || null, newOnHand, now);
    const row = sqlite.prepare("SELECT * FROM consumables WHERE id=?").get(req.params.id);
    res.json(mapConsumable(row));
  });

  // Manual adjustment (signed: +/-). For corrections, damage, shrinkage.
  app.post("/api/consumables/:id/adjust", (req, res) => {
    const d = req.body || {};
    const delta = Number(d.quantity);
    if (!delta || Number.isNaN(delta)) return res.status(400).json({ error: "Adjustment quantity required" });
    const c = sqlite.prepare("SELECT * FROM consumables WHERE id=?").get(req.params.id) as any;
    if (!c) return res.status(404).json({ error: "Not found" });
    const newOnHand = (c.on_hand || 0) + delta;
    if (newOnHand < 0) return res.status(400).json({ error: `Adjustment would drop stock below zero (on hand ${c.on_hand}).` });
    const now = new Date().toISOString();
    sqlite.prepare("UPDATE consumables SET on_hand=? WHERE id=?").run(newOnHand, req.params.id);
    sqlite.prepare(
      `INSERT INTO consumable_transactions (consumable_id, type, quantity, unit_cost, source, reference, entered_by, balance_after, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(req.params.id, "adjustment", delta, c.unit_cost || 0, "manual", d.reference || "Manual adjustment", (req as any).employee?.name || d.enteredBy || null, newOnHand, now);
    const row = sqlite.prepare("SELECT * FROM consumables WHERE id=?").get(req.params.id);
    res.json(mapConsumable(row));
  });

  // Bulk restock from a parsed PDF receipt. Body: { reference, vendor, lines:[{consumableId?, name, sku?, quantity, unitCost?, category?, unit?}] }
  // If consumableId present -> restock that item. Else match by SKU or name (case-insensitive); if no match, create new consumable then restock.
  app.post("/api/consumables/import-receipt", (req, res) => {
    const d = req.body || {};
    const lines: any[] = Array.isArray(d.lines) ? d.lines : [];
    if (!lines.length) return res.status(400).json({ error: "No line items to import" });
    const now = new Date().toISOString();
    const enteredBy = (req as any).employee?.name || d.enteredBy || null;
    const reference = d.reference || "PDF Receipt";
    const results: any[] = [];
    const tx = sqlite.transaction(() => {
      for (const ln of lines) {
        const qty = Number(ln.quantity);
        if (!qty || qty <= 0) { results.push({ name: ln.name, status: "skipped", reason: "invalid qty" }); continue; }
        const unitCost = ln.unitCost != null ? Number(ln.unitCost) : null;
        let target: any = null;
        if (ln.consumableId) {
          target = sqlite.prepare("SELECT * FROM consumables WHERE id=?").get(ln.consumableId);
        }
        if (!target && ln.sku) {
          target = sqlite.prepare("SELECT * FROM consumables WHERE sku IS NOT NULL AND lower(sku)=lower(?) AND is_active=1").get(ln.sku);
        }
        if (!target && ln.name) {
          target = sqlite.prepare("SELECT * FROM consumables WHERE lower(name)=lower(?) AND is_active=1").get(String(ln.name).trim());
        }
        let created = false;
        if (!target) {
          target = sqlite.prepare(
            `INSERT INTO consumables (name, sku, category, unit, on_hand, reorder_point, unit_cost, vendor, is_active, created_at)
             VALUES (?,?,?,?,?,?,?,?,1,?) RETURNING *`
          ).get(
            String(ln.name || "Imported item").trim(), ln.sku || null, ln.category || "general",
            ln.unit || "each", 0, 0, unitCost || 0, d.vendor || ln.vendor || null, now
          ) as any;
          created = true;
        }
        const finalUnitCost = unitCost != null ? unitCost : (target.unit_cost || 0);
        const newOnHand = (target.on_hand || 0) + qty;
        sqlite.prepare("UPDATE consumables SET on_hand=?, unit_cost=? WHERE id=?").run(newOnHand, finalUnitCost, target.id);
        sqlite.prepare(
          `INSERT INTO consumable_transactions (consumable_id, type, quantity, unit_cost, source, reference, entered_by, balance_after, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`
        ).run(target.id, "restock", qty, finalUnitCost, "pdf_receipt", reference, enteredBy, newOnHand, now);
        results.push({ consumableId: target.id, name: target.name, quantity: qty, status: created ? "created" : "restocked", onHand: newOnHand });
      }
    });
    tx();
    res.json({ imported: results.filter(r => r.status !== "skipped").length, results });
  });

  // ── Parse a vendor invoice/receipt PDF into structured line items ───────────
  // Sends the PDF to Claude (document block) and returns extracted vendor +
  // line items for on-screen review. Does NOT touch stock — the reviewed lines
  // are committed via POST /api/consumables/import-receipt. Degrades gracefully:
  // if the LLM key is absent (e.g. preview sandbox), returns llmAvailable:false
  // so the UI can fall back to manual entry.
  app.post("/api/consumables/parse-invoice", requireStaffAuth, wrapAsync(async (req, res) => {
    const d = req.body || {};
    let b64: string = d.pdfBase64 || "";
    if (!b64) return res.status(400).json({ error: "No PDF provided." });
    // Strip a data-URL prefix if present
    const comma = b64.indexOf("base64,");
    if (comma !== -1) b64 = b64.slice(comma + 7);

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.json({
        llmAvailable: false,
        vendor: null,
        reference: d.filename || null,
        lines: [],
        note: "AI reader is not enabled in this environment. Enter the line items manually, then import.",
      });
    }

    // Match against existing active consumables so the model can reuse ids/SKUs.
    const existing = sqlite.prepare(
      "SELECT id, name, sku, unit FROM consumables WHERE is_active=1 ORDER BY name"
    ).all() as any[];
    const catalog = existing.map((c) => `id=${c.id} | ${c.name}${c.sku ? ` [${c.sku}]` : ""} (${c.unit})`).join("\n") || "(none yet)";

    const system = [
      "You extract purchasable line items from a supplier invoice or receipt for a restoration company's consumables inventory.",
      "Return ONLY JSON, no prose. Shape:",
      '{ "vendor": string|null, "reference": string|null, "lines": [ { "name": string, "sku": string|null, "quantity": number, "unitCost": number|null, "unit": string|null, "category": string|null, "consumableId": number|null } ] }',
      "Rules:",
      "- quantity is the number of units received (a positive number). unitCost is price per single unit in dollars (not the line total).",
      "- If a line shows only a line total, divide by quantity to get unitCost.",
      "- reference = invoice number / PO number if visible.",
      "- Skip non-inventory lines (tax, shipping, subtotal, total, discounts, labor).",
      "- If a line clearly matches one of the EXISTING items below, set consumableId to that id and reuse its name.",
      "- category examples: cleaning, containment, drying, ppe, packaging, general.",
      "EXISTING ITEMS:",
      catalog,
    ].join("\n");

    try {
      const client = new Anthropic();
      const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
      const msg = await client.messages.create({
        model,
        max_tokens: 3000,
        system,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
            { type: "text", text: "Extract the purchasable inventory line items from this invoice as JSON." },
          ] as any,
        }],
      });
      const raw = msg.content.map((c: any) => (c.type === "text" ? c.text : "")).join("").trim();
      // Parse JSON out of a possibly fenced response
      let parsed: any = null;
      let t = raw;
      const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fence) t = fence[1].trim();
      const first = t.search(/[[{]/);
      const last = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
      if (first !== -1 && last !== -1) {
        try { parsed = JSON.parse(t.slice(first, last + 1)); } catch { parsed = null; }
      }
      if (!parsed) return res.status(422).json({ error: "Could not read the invoice. Try a clearer PDF or enter items manually.", llmAvailable: true });
      const linesIn: any[] = Array.isArray(parsed) ? parsed : (parsed.lines || []);
      const lines = linesIn
        .map((l) => ({
          name: String(l.name || "").trim(),
          sku: l.sku ? String(l.sku).trim() : null,
          quantity: Number(l.quantity) || 0,
          unitCost: l.unitCost == null ? null : Number(l.unitCost),
          unit: l.unit ? String(l.unit).trim() : "each",
          category: l.category ? String(l.category).trim() : "general",
          consumableId: l.consumableId ? Number(l.consumableId) : null,
        }))
        .filter((l) => l.name && l.quantity > 0);
      res.json({
        llmAvailable: true,
        vendor: parsed.vendor || d.vendor || null,
        reference: parsed.reference || d.filename || null,
        lines,
      });
    } catch (e: any) {
      res.status(502).json({ error: `Invoice reader failed: ${e?.message || "unknown error"}`, llmAvailable: true });
    }
  }));

  // Use a consumable on a job. Deducts on_hand (blocks at zero) and creates a job_costs (material) row.
  app.post("/api/consumables/:id/use", (req, res) => {
    const d = req.body || {};
    const qty = Number(d.quantity);
    const jobId = Number(d.jobId);
    if (!qty || qty <= 0) return res.status(400).json({ error: "Quantity must be greater than 0" });
    if (!jobId) return res.status(400).json({ error: "A job is required" });
    const c = sqlite.prepare("SELECT * FROM consumables WHERE id=?").get(req.params.id) as any;
    if (!c) return res.status(404).json({ error: "Not found" });
    if (qty > (c.on_hand || 0)) {
      return res.status(409).json({ error: `Not enough stock. On hand: ${c.on_hand} ${c.unit}. Restock before using this many.`, onHand: c.on_hand });
    }
    const now = new Date().toISOString();
    const unitCost = c.unit_cost || 0;
    const total = +(qty * unitCost).toFixed(2);
    const newOnHand = (c.on_hand || 0) - qty;
    const jobCost = sqlite.prepare(
      `INSERT INTO job_costs (job_id, category, description, quantity, unit_cost, total, vendor, receipt_ref, entered_by, cost_date, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING *`
    ).get(jobId, "material", `Consumable: ${c.name}${c.sku ? ` (${c.sku})` : ""}`, qty, unitCost, total, c.vendor || null, "inventory", (req as any).employee?.name || d.enteredBy || null, now.slice(0, 10), now) as any;
    sqlite.prepare("UPDATE consumables SET on_hand=? WHERE id=?").run(newOnHand, req.params.id);
    sqlite.prepare(
      `INSERT INTO consumable_transactions (consumable_id, type, quantity, unit_cost, job_id, job_cost_id, source, reference, entered_by, balance_after, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(req.params.id, "usage", -qty, unitCost, jobId, jobCost.id, "job_usage", d.reference || null, (req as any).employee?.name || d.enteredBy || null, newOnHand, now);
    const row = sqlite.prepare("SELECT * FROM consumables WHERE id=?").get(req.params.id);
    res.json({ consumable: mapConsumable(row), jobCostId: jobCost.id, lowStock: newOnHand <= (c.reorder_point || 0) });
  });

  // Consumables used on a specific job (from the transaction ledger)
  app.get("/api/jobs/:jobId/consumables", (req, res) => {
    const rows = sqlite.prepare(
      `SELECT t.*, c.name as c_name, c.sku as c_sku, c.unit as c_unit
       FROM consumable_transactions t JOIN consumables c ON c.id=t.consumable_id
       WHERE t.job_id=? AND t.type='usage' ORDER BY t.created_at DESC`
    ).all(req.params.jobId) as any[];
    res.json(rows.map(r => ({
      id: r.id, consumableId: r.consumable_id, name: r.c_name, sku: r.c_sku, unit: r.c_unit,
      quantity: Math.abs(r.quantity), unitCost: r.unit_cost, total: +(Math.abs(r.quantity) * (r.unit_cost || 0)).toFixed(2),
      jobCostId: r.job_cost_id, enteredBy: r.entered_by, createdAt: r.created_at,
    })));
  });

  // ── Job Costs ─────────────────────────────────────────────────────────────
  // Map a raw job_costs DB row (snake_case columns) to the camelCase shape the
  // frontend expects. Without this, fields like unitCost/costDate arrive as
  // undefined and crash the Job Costing page (fmt(undefined).toLocaleString()).
  const mapJobCost = (r: any) => r && ({
    id: r.id,
    jobId: r.job_id,
    category: r.category,
    description: r.description,
    quantity: r.quantity,
    unitCost: r.unit_cost,
    total: r.total,
    vendor: r.vendor,
    receiptRef: r.receipt_ref,
    enteredBy: r.entered_by,
    costDate: r.cost_date,
    phase: r.phase,
    createdAt: r.created_at,
  });
  app.get("/api/jobs/:jobId/costs", (req, res) => {
    const rows = sqlite.prepare("SELECT * FROM job_costs WHERE job_id=? ORDER BY cost_date DESC, created_at DESC").all(req.params.jobId) as any[];
    res.json(rows.map(mapJobCost));
  });
  app.post("/api/jobs/:jobId/costs", (req, res) => {
    const d = req.body;
    const now = new Date().toISOString();
    const total = (d.quantity||1) * (d.unitCost||0);
    const row = sqlite.prepare(`INSERT INTO job_costs (job_id, category, description, quantity, unit_cost, total, vendor, receipt_ref, entered_by, cost_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING *`)
      .get(req.params.jobId, d.category, d.description, d.quantity||1, d.unitCost||0, total, d.vendor||null, d.receiptRef||null, d.enteredBy||null, d.costDate||now.slice(0,10), now);
    res.json(mapJobCost(row));
  });
  app.patch("/api/costs/:id", (req, res) => {
    const d = req.body;
    const total = (d.quantity||1) * (d.unitCost||0);
    const row = sqlite.prepare(`UPDATE job_costs SET category=?, description=?, quantity=?, unit_cost=?, total=?, vendor=?, cost_date=? WHERE id=? RETURNING *`)
      .get(d.category, d.description, d.quantity||1, d.unitCost||0, total, d.vendor||null, d.costDate||null, req.params.id);
    res.json(mapJobCost(row));
  });
  app.delete("/api/costs/:id", (req, res) => {
    sqlite.prepare("DELETE FROM job_costs WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  // ── Supplements ───────────────────────────────────────────────────────────
  app.get("/api/supplements", (_req, res) => {
    const rows = sqlite.prepare("SELECT * FROM supplements ORDER BY created_at DESC").all();
    res.json(rows);
  });
  app.get("/api/jobs/:jobId/supplements", (req, res) => {
    const rows = sqlite.prepare("SELECT * FROM supplements WHERE job_id=? ORDER BY created_at DESC").all(req.params.jobId);
    res.json(rows);
  });
  app.post("/api/jobs/:jobId/supplements", (req, res) => {
    const d = req.body;
    const now = new Date().toISOString();
    const row = sqlite.prepare(`INSERT INTO supplements (job_id, title, amount_requested, carrier, adjuster_name, submitted_at, follow_up_due, status, notes, line_items, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING *`)
      .get(req.params.jobId, d.title, d.amountRequested||0, d.carrier||null, d.adjusterName||null, d.submittedAt||now.slice(0,10), d.followUpDue||null, d.status||'pending', d.notes||null, JSON.stringify(d.lineItems||[]), now);
    res.json(row);
  });
  app.patch("/api/supplements/:id", (req, res) => {
    const d = req.body;
    const row = sqlite.prepare(`UPDATE supplements SET title=?, amount_requested=?, amount_approved=?, carrier=?, adjuster_name=?, submitted_at=?, response_at=?, follow_up_due=?, status=?, notes=? WHERE id=? RETURNING *`)
      .get(d.title, d.amountRequested||0, d.amountApproved||null, d.carrier||null, d.adjusterName||null, d.submittedAt||null, d.responseAt||null, d.followUpDue||null, d.status||'pending', d.notes||null, req.params.id);
    res.json(row);
  });
  app.delete("/api/supplements/:id", (req, res) => {
    sqlite.prepare("DELETE FROM supplements WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  // Carrier scorecard (derived from jobs + supplements + invoices + payments)
  app.get("/api/carrier-scorecard", (_req, res) => {
    const jobs = sqlite.prepare("SELECT * FROM jobs WHERE (status IS NULL OR status != 'closed') AND insurance_carrier IS NOT NULL AND insurance_carrier != ''").all() as any[];
    const invoices = sqlite.prepare("SELECT * FROM invoices").all() as any[];
    const payments = sqlite.prepare("SELECT * FROM payments WHERE type='received'").all() as any[];
    const supps = sqlite.prepare("SELECT * FROM supplements").all() as any[];

    const carriers: Record<string, any> = {};
    for (const job of jobs) {
      const carrier = job.insurance_carrier;
      if (!carriers[carrier]) {
        carriers[carrier] = { carrier, totalJobs: 0, totalRevenue: 0, paidJobs: 0, avgDaysToPay: null, daysToPay: [], supplementsSubmitted: 0, supplementsApproved: 0, supplementsTotalRequested: 0, supplementsTotalApproved: 0, disputes: 0 };
      }
      const c = carriers[carrier];
      c.totalJobs++;
      // Revenue from invoices for this job
      const jobInvoices = invoices.filter((i: any) => i.job_id === job.id);
      const jobRevenue = jobInvoices.reduce((s: number, i: any) => s + (i.total || 0), 0);
      c.totalRevenue += jobRevenue;
      // Days to pay
      for (const inv of jobInvoices) {
        if (inv.paid_at && inv.created_at) {
          const days = Math.floor((new Date(inv.paid_at).getTime() - new Date(inv.created_at).getTime()) / (1000*60*60*24));
          c.daysToPay.push(days);
          c.paidJobs++;
        }
      }
      // Supplements
      const jobSupps = supps.filter((s: any) => s.job_id === job.id);
      c.supplementsSubmitted += jobSupps.length;
      const approved = jobSupps.filter((s: any) => s.status === 'approved' || s.status === 'partial');
      c.supplementsApproved += approved.length;
      c.supplementsTotalRequested += jobSupps.reduce((s: number, x: any) => s + (x.amount_requested||0), 0);
      c.supplementsTotalApproved += approved.reduce((s: number, x: any) => s + (x.amount_approved||x.amount_requested||0), 0);
      const denied = jobSupps.filter((s: any) => s.status === 'denied' || s.status === 'disputed');
      c.disputes += denied.length;
    }
    // Compute averages and grade
    const result = Object.values(carriers).map((c: any) => {
      c.avgDaysToPay = c.daysToPay.length ? Math.round(c.daysToPay.reduce((a: number,b: number)=>a+b,0)/c.daysToPay.length) : null;
      delete c.daysToPay;
      const suppApprovalRate = c.supplementsSubmitted > 0 ? Math.round((c.supplementsApproved/c.supplementsSubmitted)*100) : null;
      c.suppApprovalRate = suppApprovalRate;
      // Grade: A=fast pay + high supp approval, F=slow pay + denied supps
      let score = 50;
      if (c.avgDaysToPay !== null) score += c.avgDaysToPay <= 30 ? 25 : c.avgDaysToPay <= 60 ? 10 : -20;
      if (suppApprovalRate !== null) score += suppApprovalRate >= 80 ? 20 : suppApprovalRate >= 50 ? 5 : -15;
      if (c.disputes > 0) score -= c.disputes * 5;
      c.grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 45 ? 'D' : 'F';
      c.score = Math.max(0, Math.min(100, score));
      return c;
    });
    res.json(result.sort((a: any, b: any) => b.score - a.score));
  });

  // ── Follow-Up Sequences ───────────────────────────────────────────────────
  app.get("/api/follow-ups", (_req, res) => {
    const rows = sqlite.prepare("SELECT * FROM follow_up_sequences ORDER BY scheduled_at ASC").all();
    res.json(rows);
  });
  app.post("/api/follow-ups", (req, res) => {
    const d = req.body;
    const now = new Date().toISOString();
    const row = sqlite.prepare(`INSERT INTO follow_up_sequences (job_id, contact_id, sequence_type, scheduled_at, status, email_subject, email_body, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?) RETURNING *`)
      .get(d.jobId, d.contactId, d.sequenceType, d.scheduledAt, d.status||'pending', d.emailSubject||null, d.emailBody||null, d.notes||null, now);
    res.json(row);
  });
  app.patch("/api/follow-ups/:id", (req, res) => {
    const d = req.body;
    const row = sqlite.prepare(`UPDATE follow_up_sequences SET status=?, sent_at=?, email_subject=?, email_body=?, notes=? WHERE id=? RETURNING *`)
      .get(d.status, d.sentAt||null, d.emailSubject||null, d.emailBody||null, d.notes||null, req.params.id);
    res.json(row);
  });
  app.delete("/api/follow-ups/:id", (req, res) => {
    sqlite.prepare("DELETE FROM follow_up_sequences WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  // Auto-schedule follow-ups when job completes
  app.post("/api/jobs/:jobId/schedule-follow-ups", (req, res) => {
    const job = sqlite.prepare("SELECT * FROM jobs WHERE id=?").get(req.params.jobId) as any;
    if (!job || !job.contact_id) return res.json({ ok: false, reason: "no contact" });
    const now = new Date();
    const sequences = [
      { type: 'post_job_30d', days: 30, subject: 'How is everything at your property?', body: `Hi ${job.address ? 'valued customer' : 'there'},

We hope your property has fully recovered. It has been 30 days since Titan Restoration LLC completed work at ${job.address}. Please don't hesitate to reach out if you notice anything that needs attention.

Also, if you were happy with our service, a Google review would mean the world to us!

Titan Restoration LLC
706-922-0154` },
      { type: 'post_job_6mo', days: 180, subject: 'Seasonal check-in from Titan Restoration', body: `Hi there,

It's been about 6 months since we completed your restoration project at ${job.address}. Spring/Fall is a great time to have your property inspected for any moisture, mold, or storm vulnerabilities.

Call us anytime for a free inspection: 706-922-0154

Titan Restoration LLC` },
      { type: 'annual', days: 365, subject: 'Annual storm season reminder — Titan Restoration', body: `Hi there,

Hurricane and storm season is approaching. As a previous Titan Restoration client, we want to make sure your property is protected.

We offer free storm preparedness inspections for past clients. Call 706-922-0154 to schedule.

Titan Restoration LLC | Augusta, GA` },
    ];
    const created = [];
    for (const seq of sequences) {
      const scheduledAt = new Date(now.getTime() + seq.days * 24*60*60*1000).toISOString().slice(0,10);
      const existing = sqlite.prepare("SELECT id FROM follow_up_sequences WHERE job_id=? AND sequence_type=?").get(job.id, seq.type);
      if (!existing) {
        const row = sqlite.prepare(`INSERT INTO follow_up_sequences (job_id, contact_id, sequence_type, scheduled_at, status, email_subject, email_body, created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING *`)
          .get(job.id, job.contact_id, seq.type, scheduledAt, 'pending', seq.subject, seq.body, now.toISOString());
        created.push(row);
      }
    }
    res.json({ created });
  });

  // ── Safety Incidents ──────────────────────────────────────────────────────
  app.get("/api/safety-incidents", (_req, res) => {
    const rows = sqlite.prepare("SELECT * FROM safety_incidents ORDER BY incident_date DESC").all();
    res.json(rows);
  });
  app.get("/api/jobs/:jobId/safety-incidents", (req, res) => {
    const rows = sqlite.prepare("SELECT * FROM safety_incidents WHERE job_id=? ORDER BY incident_date DESC").all(req.params.jobId);
    res.json(rows);
  });
  app.post("/api/safety-incidents", (req, res) => {
    const d = req.body;
    const now = new Date().toISOString();
    const row = sqlite.prepare(`INSERT INTO safety_incidents (job_id, incident_type, severity, reported_by, incident_date, description, persons_involved, corrective_action, osha_recordable, follow_up_date, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`)
      .get(d.jobId||null, d.incidentType, d.severity||'low', d.reportedBy, d.incidentDate, d.description, d.personsInvolved||null, d.correctiveAction||null, d.oshaRecordable||0, d.followUpDate||null, d.status||'open', now);
    res.json(row);
  });
  app.patch("/api/safety-incidents/:id", (req, res) => {
    const d = req.body;
    const row = sqlite.prepare(`UPDATE safety_incidents SET incident_type=?, severity=?, description=?, corrective_action=?, osha_recordable=?, follow_up_date=?, closed_at=?, status=? WHERE id=? RETURNING *`)
      .get(d.incidentType, d.severity, d.description, d.correctiveAction||null, d.oshaRecordable||0, d.followUpDate||null, d.closedAt||null, d.status, req.params.id);
    res.json(row);
  });
  app.delete("/api/safety-incidents/:id", (req, res) => {
    sqlite.prepare("DELETE FROM safety_incidents WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  // ── Lead source attribution report ────────────────────────────────────────
  app.get("/api/reports/lead-attribution", (_req, res) => {
    const jobs = sqlite.prepare("SELECT * FROM jobs WHERE status IS NULL OR status != 'closed'").all() as any[];
    const invoices = sqlite.prepare("SELECT * FROM invoices").all() as any[];
    const payments = sqlite.prepare("SELECT * FROM payments WHERE type='received'").all() as any[];
    const contacts = sqlite.prepare("SELECT * FROM contacts").all() as any[];

    const sources: Record<string, any> = {};
    for (const job of jobs) {
      const src = job.lead_source || 'unknown';
      if (!sources[src]) sources[src] = { source: src, jobCount: 0, totalRevenue: 0, paidRevenue: 0, jobs: [] };
      sources[src].jobCount++;
      const jobInvs = invoices.filter((i: any) => i.job_id === job.id);
      const rev = jobInvs.reduce((s: number, i: any) => s + (i.total||0), 0);
      const paid = payments.filter((p: any) => jobInvs.some((i: any) => i.id === p.invoice_id)).reduce((s: number, p: any) => s + p.amount, 0);
      sources[src].totalRevenue += rev;
      sources[src].paidRevenue += paid;
      sources[src].jobs.push({ jobNumber: job.job_number, address: job.address, revenue: rev });
    }
    res.json(Object.values(sources).sort((a: any, b: any) => b.totalRevenue - a.totalRevenue));
  });

  // ── Referral Partner ROI ──────────────────────────────────────────────────
  app.get("/api/reports/partner-roi", (_req, res) => {
    const contacts = sqlite.prepare("SELECT * FROM contacts WHERE type='referral'").all() as any[];
    const jobs = sqlite.prepare("SELECT * FROM jobs WHERE status IS NULL OR status != 'closed'").all() as any[];
    const invoices = sqlite.prepare("SELECT * FROM invoices").all() as any[];
    const payouts = sqlite.prepare("SELECT * FROM payout_requests").all() as any[];
    const warrantyCalls = sqlite.prepare("SELECT * FROM warranty_calls").all() as any[];

    const result = contacts.map((c: any) => {
      const referredJobs = jobs.filter((j: any) =>
        j.referral_partner_id === c.id ||
        (j.lead_source === 'referral' && j.lead_source_detail && j.lead_source_detail.toLowerCase().includes(c.name.toLowerCase())) ||
        (j.insurance_carrier && c.company && j.insurance_carrier.toLowerCase().includes(c.company.toLowerCase()))
      );
      const totalRevenue = referredJobs.reduce((sum: number, j: any) => {
        const inv = invoices.filter((i: any) => i.job_id === j.id).reduce((s: number, i: any) => s + (i.total||0), 0);
        return sum + inv;
      }, 0);
      const partnerPayouts = payouts.filter((p: any) => p.contact_id === c.id);
      const totalPaid = partnerPayouts.filter((p: any) => p.status === 'paid').reduce((s: number, p: any) => s + (p.amount||0), 0);
      const totalPending = partnerPayouts.filter((p: any) => p.status !== 'paid').reduce((s: number, p: any) => s + (p.amount||0), 0);
      // Warranty calls for this partner
      const partnerWarrantyCalls = warrantyCalls.filter((w: any) =>
        w.partner_id === c.id || referredJobs.some((j: any) => j.id === w.job_id)
      );
      const warrantyCost = partnerWarrantyCalls.reduce((s: number, w: any) => s + (w.total_cost||0), 0);
      const warrantyCount = partnerWarrantyCalls.length;
      const roi = totalPaid > 0 ? (totalRevenue / totalPaid) : null;
      // Net value = revenue generated minus cost absorbed (payouts + warranty)
      const netValue = totalRevenue - totalPaid - warrantyCost;
      return {
        partnerId: c.id,
        partner: c.name,
        company: c.company,
        referralRate: c.referral_rate,
        jobsReferred: referredJobs.length,
        totalRevenue,
        totalPaid,
        totalPending,
        warrantyCost,
        warrantyCount,
        netValue,
        roi,
        jobs: referredJobs.map((j: any) => {
          const jobInvoiceTotal = invoices.filter((i: any) => i.job_id === j.id).reduce((s: number, i: any) => s + (i.total||0), 0);
          const jobWarrantyCalls = partnerWarrantyCalls.filter((w: any) => w.job_id === j.id);
          return {
            jobNumber: j.job_number,
            address: j.address,
            status: j.status,
            revenue: jobInvoiceTotal,
            warrantyCalls: jobWarrantyCalls.length,
            warrantyCost: jobWarrantyCalls.reduce((s: number, w: any) => s + (w.total_cost||0), 0),
          };
        }),
        warrantyCalls: partnerWarrantyCalls.map((w: any) => {
          const job = jobs.find((j: any) => j.id === w.job_id);
          return { ...w, jobNumber: job?.job_number, jobAddress: job?.address };
        }),
      };
    });
    res.json(result.sort((a: any, b: any) => b.totalRevenue - a.totalRevenue));
  });


  // ── Line Item Library ─────────────────────────────────────────────────────
  // The library backs the org-wide price book. Categories are free-form
  // strings so the admin can add / rename them without a schema change.
  app.get("/api/line-items", (req, res) => {
    res.json(storage.getLineItems(req.query.category as string | undefined));
  });
  // Distinct categories, sorted, so the estimate/invoice picker and the
  // admin manager both use one source of truth for the tab list.
  app.get("/api/line-items/categories", (_req, res) => {
    const rows = sqlite.prepare(
      "SELECT DISTINCT category FROM line_item_library ORDER BY category"
    ).all() as { category: string }[];
    res.json(rows.map(r => r.category).filter(Boolean));
  });
  // Bulk replace: wipe the entire library and repopulate from a CSV/JSON
  // payload. Wrapped in a transaction so a bad payload can't leave the
  // library half-empty. Admin-only intent — gated in the UI, not here, so
  // the endpoint stays reachable from ops scripts.
  app.post("/api/line-items/bulk-replace", (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items) return res.status(400).json({ error: "items[] required" });
    const now = new Date().toISOString();
    const tx = sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM line_item_library").run();
      const stmt = sqlite.prepare(
        `INSERT INTO line_item_library (category, sub_category, code, description, unit, unit_price, iicrc_ref, notes, is_custom, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const it of items) {
        const category = String(it.category || "").trim() || "General";
        const code = String(it.code || "").trim();
        const description = String(it.description || "").trim();
        if (!description) continue; // rows without a description are useless
        const unit = String(it.unit || "EA").trim() || "EA";
        const unitPrice = Number(it.unitPrice ?? it.unit_price ?? 0) || 0;
        const notes = it.notes ? String(it.notes) : null;
        stmt.run(category, null, code, description, unit, unitPrice, null, notes, 0, now);
      }
    });
    try { tx(); } catch (e: any) {
      return res.status(500).json({ error: e?.message || "bulk replace failed" });
    }
    const count = (sqlite.prepare("SELECT COUNT(*) c FROM line_item_library").get() as any).c;
    res.json({ ok: true, count });
  });
  // Bulk-append (used when the admin re-uploads a CSV that should ADD to
  // an existing library instead of replacing it — kept separate so the
  // destructive path is always explicit).
  app.post("/api/line-items/bulk-append", (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items) return res.status(400).json({ error: "items[] required" });
    const now = new Date().toISOString();
    const stmt = sqlite.prepare(
      `INSERT INTO line_item_library (category, sub_category, code, description, unit, unit_price, iicrc_ref, notes, is_custom, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = sqlite.transaction((rows: any[]) => {
      for (const it of rows) {
        const description = String(it.description || "").trim();
        if (!description) continue;
        stmt.run(
          String(it.category || "General").trim() || "General",
          null,
          String(it.code || "").trim(),
          description,
          String(it.unit || "EA").trim() || "EA",
          Number(it.unitPrice ?? it.unit_price ?? 0) || 0,
          null,
          it.notes ? String(it.notes) : null,
          0,
          now,
        );
      }
    });
    try { tx(items); } catch (e: any) {
      return res.status(500).json({ error: e?.message || "bulk append failed" });
    }
    const count = (sqlite.prepare("SELECT COUNT(*) c FROM line_item_library").get() as any).c;
    res.json({ ok: true, count });
  });
  app.post("/api/line-items", (req, res) => { res.json(storage.createLineItem(req.body)); });
  app.patch("/api/line-items/:id", (req, res) => {
    res.json(storage.updateLineItem(Number(req.params.id), req.body));
  });
  app.delete("/api/line-items/:id", (req, res) => {
    storage.deleteLineItem(Number(req.params.id)); res.json({ ok: true });
  });
  // Rename or delete a whole category in one call (updates all rows).
  app.patch("/api/line-items/categories/:name", (req, res) => {
    const from = String(req.params.name);
    const to = String(req.body?.newName || "").trim();
    if (!to) return res.status(400).json({ error: "newName required" });
    const r = sqlite.prepare("UPDATE line_item_library SET category = ? WHERE category = ?").run(to, from);
    res.json({ ok: true, updated: r.changes });
  });
  app.delete("/api/line-items/categories/:name", (req, res) => {
    const name = String(req.params.name);
    const r = sqlite.prepare("DELETE FROM line_item_library WHERE category = ?").run(name);
    res.json({ ok: true, deleted: r.changes });
  });

  // Bulk adjust unit prices across every row (optionally scoped to a category).
  // Body accepts either { addFlat: number } to add/subtract a flat dollar amount,
  // or { multiplyBy: number } to scale prices (e.g. 1.10 for +10%).
  // Category filter: { category: "Cat 1" } — omit to hit every row.
  // Prices are stored as INTEGER cents on the row, so we round to the nearest cent
  // and refuse to go below zero to avoid negative pricing bugs.
  app.post("/api/line-items/bulk-adjust", (req, res) => {
    const addFlat = Number(req.body?.addFlat);
    const multiplyBy = Number(req.body?.multiplyBy);
    const category = req.body?.category ? String(req.body.category) : null;
    const hasAdd = Number.isFinite(addFlat) && addFlat !== 0;
    const hasMul = Number.isFinite(multiplyBy) && multiplyBy > 0 && multiplyBy !== 1;
    if (!hasAdd && !hasMul) {
      return res.status(400).json({ error: "Provide addFlat or multiplyBy" });
    }
    const where = category ? "WHERE category = ?" : "";
    const params: any[] = category ? [category] : [];
    // Compute new price in SQL so we can wrap it in a single transaction.
    // unit_price column is REAL in this table (dollar decimals).
    const clauses: string[] = [];
    const setParams: any[] = [];
    if (hasMul) { clauses.push("unit_price * ?"); setParams.push(multiplyBy); }
    // Always chain: start with (unit_price [* multiplier]) then + addFlat
    const expr = (clauses[0] || "unit_price") + (hasAdd ? " + ?" : "");
    if (hasAdd) setParams.push(addFlat);
    // Round to nearest cent, clamp at 0.
    const sql = `UPDATE line_item_library SET unit_price = MAX(0, ROUND((${expr}) * 100) / 100.0) ${where}`;
    const r = sqlite.prepare(sql).run(...setParams, ...params);
    res.json({ ok: true, updated: r.changes, addFlat: hasAdd ? addFlat : 0, multiplyBy: hasMul ? multiplyBy : 1, category });
  });

  // ── Adjusters ─────────────────────────────────────────────────────────────
  app.get("/api/adjusters", (_req, res) => { res.json(storage.getAdjusters()); });
  app.post("/api/adjusters", (req, res) => { res.json(storage.createAdjuster(req.body)); });
  app.patch("/api/adjusters/:id", (req, res) => {
    res.json(storage.updateAdjuster(Number(req.params.id), req.body));
  });
  app.delete("/api/adjusters/:id", (req, res) => {
    storage.deleteAdjuster(Number(req.params.id)); res.json({ ok: true });
  });

  // ── Adjuster Meetings ─────────────────────────────────────────────────────
  app.get("/api/adjuster-meetings", (req, res) => {
    const jobId = req.query.jobId ? Number(req.query.jobId) : undefined;
    res.json(storage.getAdjusterMeetings(jobId));
  });
  app.get("/api/jobs/:jobId/adjuster-meetings", (req, res) => {
    res.json(storage.getAdjusterMeetings(Number(req.params.jobId)));
  });
  app.post("/api/adjuster-meetings", (req, res) => { res.json(storage.createAdjusterMeeting(req.body)); });
  app.patch("/api/adjuster-meetings/:id", (req, res) => {
    res.json(storage.updateAdjusterMeeting(Number(req.params.id), req.body));
  });
  app.delete("/api/adjuster-meetings/:id", (req, res) => {
    storage.deleteAdjusterMeeting(Number(req.params.id)); res.json({ ok: true });
  });

  // ── Inspection Checklists ─────────────────────────────────────────────────
  app.get("/api/jobs/:jobId/inspections", (req, res) => {
    res.json(storage.getInspectionChecklists(Number(req.params.jobId)));
  });
  app.post("/api/jobs/:jobId/inspections", (req, res) => {
    res.json(storage.createInspectionChecklist({ ...req.body, jobId: Number(req.params.jobId) }));
  });
  app.patch("/api/inspections/:id", (req, res) => {
    res.json(storage.updateInspectionChecklist(Number(req.params.id), req.body));
  });

  // ── Review Requests ───────────────────────────────────────────────────────
  app.get("/api/review-requests", (_req, res) => { res.json(storage.getReviewRequests()); });
  app.get("/api/jobs/:jobId/review-requests", (req, res) => {
    res.json(storage.getReviewRequests(Number(req.params.jobId)));
  });
  app.post("/api/review-requests", (req, res) => { res.json(storage.createReviewRequest(req.body)); });
  app.patch("/api/review-requests/:id", (req, res) => {
    res.json(storage.updateReviewRequest(Number(req.params.id), req.body));
  });
  app.delete("/api/review-requests/:id", (req, res) => {
    try { storage.deleteReviewRequest(Number(req.params.id)); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Review Feedback (rating capture / routing) ────────────────────────────
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS review_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER,
        job_id INTEGER,
        contact_id INTEGER,
        rating INTEGER NOT NULL DEFAULT 0,
        comment TEXT,
        routed TEXT NOT NULL DEFAULT 'public',
        created_at TEXT NOT NULL DEFAULT ''
      )
    `);
  } catch (_) {}
  const mapReviewFeedback = (r: any) => r == null ? r : ({
    id: r.id, requestId: r.request_id, jobId: r.job_id, contactId: r.contact_id,
    rating: r.rating, comment: r.comment, routed: r.routed, createdAt: r.created_at,
  });
  app.get("/api/review-feedback", (_req, res) => {
    try {
      const rows = sqlite.prepare("SELECT * FROM review_feedback ORDER BY id DESC").all();
      res.json((rows as any[]).map(mapReviewFeedback));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/review-feedback", (req, res) => {
    try {
      const { requestId, jobId, contactId, rating, comment } = req.body;
      const routed = Number(rating) >= 4 ? "public" : "private";
      const now = new Date().toISOString();
      const result = sqlite.prepare(
        "INSERT INTO review_feedback (request_id, job_id, contact_id, rating, comment, routed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(requestId ?? null, jobId ?? null, contactId ?? null, Number(rating) || 0, comment || null, routed, now);
      // Happy path (>=4 stars) marks the request as reviewed.
      if (routed === "public" && requestId) {
        try { storage.updateReviewRequest(Number(requestId), { status: "reviewed" }); } catch (_) {}
      }
      const row = sqlite.prepare("SELECT * FROM review_feedback WHERE id = ?").get(result.lastInsertRowid);
      res.status(201).json(mapReviewFeedback(row));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Storm CAT Command Center ──────────────────────────────────────────────
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS storm_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        event_type TEXT NOT NULL DEFAULT 'hail',
        severity TEXT,
        zip TEXT,
        area TEXT,
        status TEXT NOT NULL DEFAULT 'monitoring',
        jobs_created INTEGER NOT NULL DEFAULT 0,
        dispatched INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT ''
      )
    `);
  } catch (_) {}
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS storm_zips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zip TEXT UNIQUE,
        label TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT ''
      )
    `);
  } catch (_) {}
  const mapStormEvent = (r: any) => r == null ? r : ({
    id: r.id, name: r.name, eventType: r.event_type, severity: r.severity,
    zip: r.zip, area: r.area, status: r.status, jobsCreated: r.jobs_created,
    dispatched: !!r.dispatched, createdAt: r.created_at,
  });
  app.get("/api/storm-events", (_req, res) => {
    try {
      const rows = sqlite.prepare("SELECT * FROM storm_events ORDER BY id DESC").all();
      res.json((rows as any[]).map(mapStormEvent));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/storm-events", (req, res) => {
    try {
      const { name, eventType, severity, zip, area, status } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "name is required" });
      const now = new Date().toISOString();
      const result = sqlite.prepare(
        "INSERT INTO storm_events (name, event_type, severity, zip, area, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(name.trim(), eventType || "hail", severity || null, zip || null, area || null, status || "monitoring", now);
      const row = sqlite.prepare("SELECT * FROM storm_events WHERE id = ?").get(result.lastInsertRowid);
      res.status(201).json(mapStormEvent(row));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/storm-events/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing: any = sqlite.prepare("SELECT * FROM storm_events WHERE id = ?").get(id);
      if (!existing) return res.status(404).json({ error: "Not found" });
      const b = req.body;
      sqlite.prepare(
        `UPDATE storm_events SET name=?, event_type=?, severity=?, zip=?, area=?, status=?, jobs_created=?, dispatched=? WHERE id=?`
      ).run(
        b.name !== undefined ? b.name : existing.name,
        b.eventType !== undefined ? b.eventType : existing.event_type,
        b.severity !== undefined ? b.severity : existing.severity,
        b.zip !== undefined ? b.zip : existing.zip,
        b.area !== undefined ? b.area : existing.area,
        b.status !== undefined ? b.status : existing.status,
        b.jobsCreated !== undefined ? b.jobsCreated : existing.jobs_created,
        b.dispatched !== undefined ? (b.dispatched ? 1 : 0) : existing.dispatched,
        id
      );
      const row = sqlite.prepare("SELECT * FROM storm_events WHERE id = ?").get(id);
      res.json(mapStormEvent(row));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/storm-events/:id", (req, res) => {
    try { sqlite.prepare("DELETE FROM storm_events WHERE id = ?").run(Number(req.params.id)); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  const mapStormZip = (r: any) => r == null ? r : ({ id: r.id, zip: r.zip, label: r.label, active: !!r.active, createdAt: r.created_at });
  app.get("/api/storm-zips", (_req, res) => {
    try {
      const rows = sqlite.prepare("SELECT * FROM storm_zips ORDER BY id ASC").all();
      res.json((rows as any[]).map(mapStormZip));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/storm-zips", (req, res) => {
    try {
      const { zip, label } = req.body;
      if (!zip?.trim()) return res.status(400).json({ error: "zip is required" });
      const now = new Date().toISOString();
      sqlite.prepare(
        "INSERT INTO storm_zips (zip, label, active, created_at) VALUES (?, ?, 1, ?) ON CONFLICT(zip) DO UPDATE SET label=excluded.label, active=1"
      ).run(zip.trim(), label || null, now);
      const row = sqlite.prepare("SELECT * FROM storm_zips WHERE zip = ?").get(zip.trim());
      res.status(201).json(mapStormZip(row));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/storm-zips/:id", (req, res) => {
    try { sqlite.prepare("DELETE FROM storm_zips WHERE id = ?").run(Number(req.params.id)); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // Crew capacity stored in the integrations kv table.
  app.get("/api/storm-capacity", (_req, res) => {
    try {
      const row: any = sqlite.prepare("SELECT value FROM integrations WHERE key = 'storm_crew_capacity'").get();
      res.json({ value: row ? row.value : "available" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/storm-capacity", (req, res) => {
    try {
      const value = ["available", "limited", "full"].includes(req.body?.value) ? req.body.value : "available";
      sqlite.prepare("INSERT INTO integrations (key, value, updated_at) VALUES ('storm_crew_capacity', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
        .run(value, new Date().toISOString());
      res.json({ value });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Referral Auto-Nurture ─────────────────────────────────────────────────
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS referral_nurture_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'monthly_recap',
        period TEXT,
        sent_at TEXT,
        created_at TEXT NOT NULL DEFAULT ''
      )
    `);
  } catch (_) {}
  const mapNurtureLog = (r: any) => r == null ? r : ({
    id: r.id, contactId: r.contact_id, kind: r.kind, period: r.period, sentAt: r.sent_at, createdAt: r.created_at,
  });
  app.get("/api/referral-nurture", (_req, res) => {
    try {
      const rows = sqlite.prepare("SELECT * FROM referral_nurture_log ORDER BY id DESC").all();
      res.json((rows as any[]).map(mapNurtureLog));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/referral-nurture", (req, res) => {
    try {
      const { contactId, kind, period } = req.body;
      if (!contactId) return res.status(400).json({ error: "contactId is required" });
      const now = new Date().toISOString();
      const result = sqlite.prepare(
        "INSERT INTO referral_nurture_log (contact_id, kind, period, sent_at, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(Number(contactId), kind || "monthly_recap", period || null, now, now);
      const row = sqlite.prepare("SELECT * FROM referral_nurture_log WHERE id = ?").get(result.lastInsertRowid);
      res.status(201).json(mapNurtureLog(row));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Lead Source Costs (Campaign ROI) ──────────────────────────────────────
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS lead_source_costs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT UNIQUE,
        monthly_cost REAL NOT NULL DEFAULT 0,
        updated_at TEXT
      )
    `);
  } catch (_) {}
  const mapLeadCost = (r: any) => r == null ? r : ({ id: r.id, source: r.source, monthlyCost: r.monthly_cost, updatedAt: r.updated_at });
  app.get("/api/lead-source-costs", (_req, res) => {
    try {
      const rows = sqlite.prepare("SELECT * FROM lead_source_costs ORDER BY source ASC").all();
      res.json((rows as any[]).map(mapLeadCost));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/lead-source-costs", (req, res) => {
    try {
      const { source, monthlyCost } = req.body;
      if (!source?.trim()) return res.status(400).json({ error: "source is required" });
      sqlite.prepare(
        "INSERT INTO lead_source_costs (source, monthly_cost, updated_at) VALUES (?, ?, ?) ON CONFLICT(source) DO UPDATE SET monthly_cost=excluded.monthly_cost, updated_at=excluded.updated_at"
      ).run(source.trim(), Number(monthlyCost) || 0, new Date().toISOString());
      const row = sqlite.prepare("SELECT * FROM lead_source_costs WHERE source = ?").get(source.trim());
      res.status(201).json(mapLeadCost(row));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Certifications ────────────────────────────────────────────────────────
  app.get("/api/certifications", (req, res) => {
    res.json(storage.getCertifications(req.query.employee as string | undefined));
  });
  app.post("/api/certifications", (req, res) => { res.json(storage.createCertification(req.body)); });
  app.patch("/api/certifications/:id", (req, res) => {
    res.json(storage.updateCertification(Number(req.params.id), req.body));
  });
  app.delete("/api/certifications/:id", (req, res) => {
    storage.deleteCertification(Number(req.params.id)); res.json({ ok: true });
  });

  // ── A/R Aging Report ──────────────────────────────────────────────────────
  app.get("/api/reports/ar-aging", (_req, res) => {
    const invoices = storage.getInvoices() as any[];
    const contacts = storage.getContacts() as any[];
    const jobs = storage.getJobs() as any[];
    const now = new Date();
    const buckets: Record<string, any[]> = { "0-30": [], "31-60": [], "61-90": [], "90+": [] };
    let totalOutstanding = 0;
    invoices.filter((inv: any) => inv.status !== "paid" && inv.status !== "void").forEach((inv: any) => {
      const due = inv.dueDate ? new Date(inv.dueDate) : new Date(inv.createdAt);
      const days = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
      const contact = contacts.find((c: any) => c.id === inv.contactId);
      const job = jobs.find((j: any) => j.id === inv.jobId);
      const entry = { ...inv, daysOverdue: Math.max(0, days), contactName: contact?.name, jobNumber: job?.jobNumber, carrier: job?.insuranceCarrier };
      totalOutstanding += inv.total || 0;
      if (days <= 30) buckets["0-30"].push(entry);
      else if (days <= 60) buckets["31-60"].push(entry);
      else if (days <= 90) buckets["61-90"].push(entry);
      else buckets["90+"].push(entry);
    });
    res.json({ buckets, totalOutstanding, generatedAt: now.toISOString() });
  });

  // ── Profitability Report ──────────────────────────────────────────────────
  app.get("/api/reports/profitability", (_req, res) => {
    const jobs = storage.getJobs() as any[];
    const invoices = storage.getInvoices() as any[];
    const payments = storage.getPayments() as any[];
    const allCosts = sqlite.prepare("SELECT * FROM job_costs").all() as any[];
    const result = jobs.map((job: any) => {
      const jobInvoices = invoices.filter((inv: any) => inv.jobId === job.id);
      const totalInvoiced = jobInvoices.reduce((s: number, inv: any) => s + (inv.total || 0), 0);
      const totalCollected = payments.filter((p: any) => p.jobId === job.id && p.type === "received").reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const totalCosts = allCosts.filter((c: any) => c.job_id === job.id).reduce((s: number, c: any) => s + (c.actual_cost || 0), 0);
      const grossMargin = totalInvoiced > 0 ? ((totalInvoiced - totalCosts) / totalInvoiced * 100) : 0;
      return { jobId: job.id, jobNumber: job.jobNumber, address: job.address, lossType: job.lossType, assignedTech: job.assignedTech, insuranceCarrier: job.insuranceCarrier, totalInvoiced, totalCollected, totalCosts, grossMargin: Math.round(grossMargin * 10) / 10, status: job.status };
    });
    res.json(result);
  });

  // ── Supplement Auto-Draft ─────────────────────────────────────────────────
  app.post("/api/supplements/:id/auto-draft", (req, res) => {
    const allSupplements = sqlite.prepare("SELECT * FROM supplements WHERE id = ?").get(Number(req.params.id)) as any;
    if (!allSupplements) return res.status(404).json({ message: "Supplement not found" });
    const job = storage.getJob(allSupplements.job_id) as any;
    const state = job?.address?.includes("SC") ? "SC" : "GA";
    const statute = state === "SC"
      ? "S.C. Code Ann. § 38-59-20 (Unfair Claims Settlement Practices Act) requires carriers to acknowledge and act reasonably on all supplement requests within 30 days."
      : "O.C.G.A. § 33-6-34 (Unfair Claims Settlement Practices) prohibits carriers from refusing to pay claims without conducting a reasonable investigation.";
    const draft = `RE: Supplement Request — ${job?.job_number || "Job"} — ${allSupplements.supplement_type || "General Supplement"}

Dear ${job?.adjuster_name || "Adjuster"},

Pursuant to ${statute}

We respectfully submit this supplement for the following scope item(s) identified during the restoration process but not included in the initial estimate:

Item: ${allSupplements.description || allSupplements.supplement_type}
Amount Requested: $${allSupplements.requested_amount || "0.00"}
IICRC S500 Standard Reference: Section 9 — Drying Standards and Documentation Requirements

The additional work was necessary to meet IICRC S500 standards and restore the property to pre-loss condition. Supporting documentation including drying logs, moisture readings, and photo evidence is attached.

We request your review and approval within 15 business days per applicable state insurance regulations.

Respectfully,
Titan Restoration LLC
706-922-0154
cody@titanrestorationllc.com`;
    res.json({ draft, statute, state });
  });

  // ── Health check ─────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    try {
      const jobs = (sqlite.prepare("SELECT COUNT(*) as c FROM jobs WHERE status IS NULL OR status != 'closed'").get() as any).c;
      const contacts = (sqlite.prepare("SELECT COUNT(*) as c FROM contacts").get() as any).c;
      const invoices = (sqlite.prepare("SELECT COUNT(*) as c FROM invoices").get() as any).c;
      const walMode = (sqlite.prepare("PRAGMA journal_mode").get() as any).journal_mode;
      res.json({ status: "ok", jobs, contacts, invoices, db: walMode, ts: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ status: "error", error: e?.message });
    }
  });

  // Missing top-level collection GET routes (health scan + pages need these)
  app.get("/api/job-costs", (_req, res) => {
    try {
      const rows = sqlite.prepare("SELECT * FROM job_costs ORDER BY cost_date DESC, created_at DESC").all();
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/drying-records", (_req, res) => {
    try {
      const rows = sqlite.prepare("SELECT * FROM drying_records ORDER BY reading_date DESC").all();
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/job-documents", (_req, res) => {
    try {
      const rows = sqlite.prepare("SELECT * FROM job_documents ORDER BY created_at DESC").all();
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SUITE 3 ROUTES
  // ═══════════════════════════════════════════════════════════════════════

// ── Activity Log ─────────────────────────────────────────────────────────────
  app.get("/api/activity-log", (_req, res) => {
  const logs = sqlite.prepare("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 200").all();
  res.json(logs);
  });
  app.get("/api/activity-log/job/:jobId", (req, res) => {
  const logs = sqlite.prepare("SELECT * FROM activity_log WHERE job_id = ? ORDER BY created_at DESC").all(Number(req.params.jobId));
  res.json(logs);
  });
  app.post("/api/activity-log", (req, res) => {
  const { jobId, entityType, entityId, action, actor, description, metadata } = req.body;
  const now = new Date().toISOString();
  const result = sqlite.prepare(`INSERT INTO activity_log (job_id, entity_type, entity_id, action, actor, description, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(jobId || null, entityType || "job", entityId || null, action, actor || "System", description, JSON.stringify(metadata || {}), now);
  res.json({ id: result.lastInsertRowid });
  });

// ── SMS Messages ──────────────────────────────────────────────────────────────
  app.get("/api/sms", (_req, res) => {
  const msgs = sqlite.prepare("SELECT * FROM sms_messages ORDER BY created_at DESC").all();
  res.json(msgs);
  });
  app.get("/api/sms/job/:jobId", (req, res) => {
  const msgs = sqlite.prepare("SELECT * FROM sms_messages WHERE job_id = ? ORDER BY created_at ASC").all(Number(req.params.jobId));
  res.json(msgs);
  });
  app.get("/api/sms/contact/:contactId", (req, res) => {
  const msgs = sqlite.prepare("SELECT * FROM sms_messages WHERE contact_id = ? ORDER BY created_at ASC").all(Number(req.params.contactId));
  res.json(msgs);
  });
  app.post("/api/sms", wrapAsync(async (req, res) => {
  const { jobId, contactId, direction, from, to, body } = req.body;
  if (!body || !to) return res.status(400).json({ error: "body and to required" });
  const now = new Date().toISOString();
  // Send via Twilio when TWILIO_* env is configured; otherwise logged/simulated.
  const sendResults = await sendSms({ to, body });
  const r0 = sendResults[0];
  const status = r0?.status === "error" ? "failed" : "sent";
  const twilioSid = r0?.id || null;
  const result = sqlite.prepare(`INSERT INTO sms_messages (job_id, contact_id, direction, "from", "to", body, status, twilio_sid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(jobId || null, contactId || null, direction || "outbound", from || "Titan Restoration (706-922-0154)", to, body, status, twilioSid, now);
  // Also log activity
  if (jobId) {
    sqlite.prepare(`INSERT INTO activity_log (job_id, entity_type, action, actor, description, created_at) VALUES (?, 'sms', 'sms_sent', 'System', ?, ?)`).run(jobId, `SMS sent to ${to}: "${body.substring(0, 60)}${body.length > 60 ? '...' : ''}"`, now);
  }
  res.json({ id: result.lastInsertRowid, status, simulated: r0?.simulated ?? true, error: r0?.error });
  }));
  // Delete an SMS message (frontend SMS.tsx delete button).
  app.delete("/api/sms/:id", (req, res) => {
    try {
      sqlite.prepare("DELETE FROM sms_messages WHERE id = ?").run(Number(req.params.id));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

// ── Job Templates ─────────────────────────────────────────────────────────────
  app.get("/api/job-templates", (_req, res) => {
  const templates = sqlite.prepare("SELECT * FROM job_templates ORDER BY loss_type, name").all();
  res.json(templates);
  });
  app.get("/api/job-templates/:id", (req, res) => {
  const tmpl = sqlite.prepare("SELECT * FROM job_templates WHERE id = ?").get(Number(req.params.id));
  if (!tmpl) return res.status(404).json({ error: "Template not found" });
  res.json(tmpl);
  });
  app.post("/api/job-templates", (req, res) => {
  const { name, lossType, description, defaultScope, defaultEquipment, iicrcProtocol, estimatedDays } = req.body;
  const now = new Date().toISOString();
  const result = sqlite.prepare(`INSERT INTO job_templates (name, loss_type, description, default_scope, default_equipment, iicrc_protocol, estimated_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(name, lossType, description || null, JSON.stringify(defaultScope || []), JSON.stringify(defaultEquipment || []), iicrcProtocol || null, estimatedDays || null, now);
  res.json({ id: result.lastInsertRowid });
  });
  app.put("/api/job-templates/:id", (req, res) => {
  const { name, lossType, description, defaultScope, defaultEquipment, iicrcProtocol, estimatedDays } = req.body;
  sqlite.prepare(`UPDATE job_templates SET name=?, loss_type=?, description=?, default_scope=?, default_equipment=?, iicrc_protocol=?, estimated_days=? WHERE id=?`).run(name, lossType, description || null, JSON.stringify(defaultScope || []), JSON.stringify(defaultEquipment || []), iicrcProtocol || null, estimatedDays || null, Number(req.params.id));
  res.json({ ok: true });
  });
  app.delete("/api/job-templates/:id", (req, res) => {
  sqlite.prepare("DELETE FROM job_templates WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
  });

// ── Tech Notifications ────────────────────────────────────────────────────────
  app.get("/api/tech-notifications/:techName", (req, res) => {
  const notes = sqlite.prepare("SELECT * FROM tech_notifications WHERE tech_name = ? ORDER BY created_at DESC LIMIT 50").all(req.params.techName);
  res.json(notes);
  });
  app.get("/api/tech-notifications/:techName/unread-count", (req, res) => {
  const row = sqlite.prepare("SELECT COUNT(*) as count FROM tech_notifications WHERE tech_name = ? AND read = 0").get(req.params.techName) as any;
  res.json({ count: row.count });
  });
  app.post("/api/tech-notifications", (req, res) => {
  const { techName, type, title, body, jobId } = req.body;
  const now = new Date().toISOString();
  const result = sqlite.prepare(`INSERT INTO tech_notifications (tech_name, type, title, body, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(techName, type || "general", title, body, jobId || null, now);
  res.json({ id: result.lastInsertRowid });
  });
  app.patch("/api/tech-notifications/:id/read", (req, res) => {
  sqlite.prepare("UPDATE tech_notifications SET read = 1 WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
  });
  app.patch("/api/tech-notifications/:techName/read-all", (req, res) => {
  sqlite.prepare("UPDATE tech_notifications SET read = 1 WHERE tech_name = ?").run(req.params.techName);
  res.json({ ok: true });
  });

// ── Adjuster Portal ───────────────────────────────────────────────────────────
  app.get("/api/adjuster-portal/sessions", (_req, res) => {
  const sessions = sqlite.prepare("SELECT * FROM adjuster_portal_sessions ORDER BY created_at DESC").all();
  res.json(sessions);
  });
  app.post("/api/adjuster-portal/sessions", (req, res) => {
  const { adjusterId, adjusterName, carrier, jobIds, expiresInDays } = req.body;
  if (!adjusterName || !carrier) return res.status(400).json({ error: "adjusterName and carrier required" });
  const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2) + Date.now().toString(36);
  const expiresAt = new Date(Date.now() + ((expiresInDays || 30) * 24 * 60 * 60 * 1000)).toISOString();
  const now = new Date().toISOString();
  const result = sqlite.prepare(`INSERT INTO adjuster_portal_sessions (adjuster_id, adjuster_name, carrier, access_token, job_ids, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(adjusterId || null, adjusterName, carrier, token, JSON.stringify(jobIds || []), expiresAt, now);
  res.json({ id: result.lastInsertRowid, accessToken: token, expiresAt });
  });
  app.get("/api/adjuster-portal/access/:token", wrapAsync(async (req: any, res: any) => {
  const session = sqlite.prepare("SELECT * FROM adjuster_portal_sessions WHERE access_token = ? AND expires_at > ?").get(req.params.token, new Date().toISOString()) as any;
  if (!session) return res.status(401).json({ error: "Invalid or expired access token" });
  // Update last accessed
  sqlite.prepare("UPDATE adjuster_portal_sessions SET last_accessed_at = ? WHERE id = ?").run(new Date().toISOString(), session.id);
  const jobIds: number[] = JSON.parse(session.job_ids || "[]");
  const jobs = jobIds.length > 0 ? sqlite.prepare(`SELECT * FROM jobs WHERE id IN (${jobIds.map(() => "?").join(",")}) `).all(...jobIds) : [];
  // Company-level IICRC credentials (non-private — shows firm is qualified)
  const credentials = sqlite.prepare(
    "SELECT employee_name, cert_type, cert_number, issued_by, expiration_date, status FROM certifications WHERE status = 'active' ORDER BY cert_type"
  ).all();
  // For each job, attach drying records, photos, equipment log, estimates, supplements
  const enriched = (jobs as any[]).map((job: any) => {
    const drying = sqlite.prepare("SELECT * FROM drying_records WHERE job_id = ? ORDER BY reading_date ASC").all(job.id);
    // Include storage_key so hydration below can generate signed URLs for
    // bucket-backed photos. Legacy rows still have data_url populated.
    const photos = sqlite.prepare("SELECT id, filename, data_url, storage_key, caption, category, taken_at FROM photos WHERE job_id = ? ORDER BY taken_at ASC, id ASC").all(job.id);
    const estimates = sqlite.prepare("SELECT id, title, status, total, created_at FROM estimates WHERE job_id = ?").all(job.id);
    const equipmentLog = sqlite.prepare(`
      SELECT ed.id, ed.deployed_at, ed.returned_at, ed.days_out, e.name, e.category, e.model
      FROM equipment_deployments ed LEFT JOIN equipment e ON e.id = ed.equipment_id
      WHERE ed.job_id = ? ORDER BY ed.deployed_at ASC
    `).all(job.id);
    const equipmentOnSite = sqlite.prepare("SELECT id, name, category, model, deployed_at FROM equipment WHERE current_job_id = ? AND status = 'deployed'").all(job.id);
    const supplements = sqlite.prepare(
      "SELECT id, title, amount_requested, amount_approved, status, submitted_at, response_at, notes, line_items FROM supplements WHERE job_id = ? ORDER BY submitted_at DESC"
    ).all(job.id);
    return { ...job, dryingRecords: drying, photos, photoCount: photos.length, estimates, equipmentLog, equipmentOnSite, supplements };
  });
  // Hydrate photo URLs for every job in a single pass.
  for (const j of enriched) {
    await hydrateImageRows(j.photos as any[], { urlField: "data_url", keyField: "storage_key" });
  }
  res.json({ adjusterName: session.adjuster_name, carrier: session.carrier, credentials, jobs: enriched });
  }));

  // Adjuster responds to a supplement (approve / partial / request info) — read-only portal action
  app.post("/api/adjuster-portal/supplement-response", (req, res) => {
    const { token, supplementId, decision, amountApproved, note } = req.body || {};
    const session = sqlite.prepare("SELECT * FROM adjuster_portal_sessions WHERE access_token = ? AND expires_at > ?").get(token, new Date().toISOString()) as any;
    if (!session) return res.status(401).json({ error: "Invalid or expired access token" });
    const supp = sqlite.prepare("SELECT * FROM supplements WHERE id = ?").get(Number(supplementId)) as any;
    if (!supp) return res.status(404).json({ error: "Supplement not found" });
    const jobIds: number[] = JSON.parse(session.job_ids || "[]");
    if (!jobIds.includes(supp.job_id)) return res.status(403).json({ error: "Not authorized for this job" });
    const now = new Date().toISOString();
    const statusMap: Record<string, string> = { approved: "approved", partial: "partial", info: "info_requested", denied: "denied" };
    const newStatus = statusMap[decision] || "info_requested";
    const approved = decision === "approved" ? supp.amount_requested
      : decision === "partial" ? (Number(amountApproved) || 0)
      : null;
    const stamp = `[${session.adjuster_name} · ${session.carrier} · ${new Date(now).toLocaleDateString()}] ${decision.toUpperCase()}${note ? ": " + note : ""}`;
    const mergedNotes = supp.notes ? `${supp.notes}\n${stamp}` : stamp;
    sqlite.prepare("UPDATE supplements SET status = ?, amount_approved = ?, response_at = ?, notes = ? WHERE id = ?")
      .run(newStatus, approved, now, mergedNotes, supp.id);
    res.json({ ok: true, status: newStatus, amountApproved: approved });
  });
  app.delete("/api/adjuster-portal/sessions/:id", (req, res) => {
  sqlite.prepare("DELETE FROM adjuster_portal_sessions WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
  });

// ── AI Estimate Review ────────────────────────────────────────────────────────

  // ── AI Scope-to-Estimate Generator ──────────────────────────────────────────
  app.post("/api/estimates/:id/scope-generate", (req, res) => {
    try {
      const estimate = sqlite.prepare("SELECT * FROM estimates WHERE id = ?").get(Number(req.params.id)) as any;
      if (!estimate) return res.status(404).json({ error: "Estimate not found" });
      const job = sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(estimate.job_id) as any;

      const { scope, lossType: scopeLossType, squareFootage, affectedRooms } = req.body;
      if (!scope) return res.status(400).json({ error: "scope text required" });

      const text = scope.toLowerCase();
      const sqft = Number(squareFootage) || 0;
      const lossType = (scopeLossType || job?.loss_type || "").toLowerCase();

      // ── Parsing helpers ───────────────────────────────────────────────────
      const has = (...terms: string[]) => terms.some(t => text.includes(t));
      const num = (pattern: RegExp, fallback: number) => {
        const m = text.match(pattern);
        return m ? parseFloat(m[1]) : fallback;
      };

      // Extract key quantities from scope text
      const mentionedSqft   = num(/([\d,]+)\s*(?:sq\.?\s*f(?:ee)?t|sf)/i, sqft);
      const mentionedLF     = num(/([\d,]+)\s*(?:linear\s*f(?:ee)?t|lf)/i, 0);
      const mentionedRooms  = num(/([\d]+)\s*rooms?/i, affectedRooms || 1);
      const mentionedDays   = num(/([\d]+)\s*days?/i, 3);
      const mentionedFloors = num(/([\d]+)\s*fl(?:oors?)?/i, 1);
      const area = mentionedSqft || 400;
      const rooms = mentionedRooms || 1;
      const days = mentionedDays || 3;

      // Detect specific materials / conditions
      const hasHardwood   = has("hardwood", "wood floor", "engineered wood", "oak", "maple");
      const hasCarpet     = has("carpet", "carpeting", "rug");
      const hasDrywall    = has("drywall", "sheetrock", "gypsum", "wall", "ceiling");
      const hasInsulation = has("insulation", "batt", "blown-in");
      const hasCabinets   = has("cabinet", "kitchen", "vanity");
      const hasSubfloor   = has("subfloor", "sub-floor", "osb");
      const hasCat1       = has("category 1", "cat 1", "clean water", "supply line", "pipe break");
      const hasCat2       = has("category 2", "cat 2", "grey water", "dishwasher", "washing machine", "toilet overflow");
      const hasCat3       = has("category 3", "cat 3", "black water", "sewage", "sewer", "flood", "groundwater");
      const hasMold       = has("mold", "mould", "microbial", "fungal", "spore");
      const hasAsbestos   = has("asbestos", "popcorn ceiling", "vermiculite");
      const hasOdor       = has("odor", "odour", "smoke smell", "soot smell", "deodorize", "hydroxyl", "ozone");
      const hasContents   = has("contents", "furniture", "pack out", "pack-out", "belongings");
      const hasRoof       = has("roof", "shingle", "tarp", "decking", "fascia", "soffit");
      const hasWindow     = has("window", "glass", "frame", "sill");
      const hasElectrical = has("electrical", "wiring", "outlet", "panel", "breaker");
      const hasPlumbing   = has("plumbing", "pipe", "drain", "fixture", "toilet");
      const hasHvac       = has("hvac", "ductwork", "duct", "air handler", "furnace");
      const hasSoot       = has("soot", "char", "smoke", "scorch");
      const hasDemo       = has("demo", "demolition", "tear out", "removal", "remove");
      const hasEmergency  = has("emergency", "immediate", "urgent", "burst", "broken pipe");
      const hasBoardUp    = has("board up", "board-up", "secure", "tarping");
      const hasMoisture   = has("moisture", "wet", "saturated", "soaked", "readings");
      const hasContainment = has("containment", "barrier", "negative air", "plastic");
      const hasClearance  = has("clearance", "post-remediation", "post remediation", "testing", "air sample");
      const hasRecon      = has("reconstruction", "rebuild", "repair", "replace", "install", "drywall");
      const hasBasement   = has("basement", "crawl space", "crawlspace");
      const hasBathroom   = has("bathroom", "bath", "lavatory", "shower");
      const hasKitchen    = has("kitchen");

      // Water category determination
      const waterCat = hasCat3 ? 3 : hasCat2 ? 2 : hasCat1 ? 1 : 1;
      const extractionRate = waterCat === 1 ? 0.35 : waterCat === 2 ? 0.45 : 0.65;
      const antimicrobialRate = waterCat === 2 ? 0.35 : waterCat === 3 ? 0.55 : 0;

      // ── Line item builder ─────────────────────────────────────────────────
      const items: Array<{
        description: string; category: string; qty: number;
        unit: string; unitPrice: number; total: number; iicrcRef?: string;
      }> = [];

      let id = Date.now();
      const add = (description: string, category: string, qty: number, unit: string, unitPrice: number, iicrcRef?: string) => {
        const total = parseFloat((qty * unitPrice).toFixed(2));
        items.push({ id: id++, description, category, qty: parseFloat(qty.toFixed(2)), unit, unitPrice, total, iicrcRef });
      };

      // ════════════════════════════════════════════════════════════════════
      // WATER DAMAGE
      // ════════════════════════════════════════════════════════════════════
      const isWater = has("water", "flood", "leak", "moisture", "wet", "burst", "pipe") || lossType.includes("water");

      if (isWater || lossType === "water") {
        if (hasEmergency) add("Emergency Response / Mobilization", "emergency", 1, "LS", 495, "IICRC S500 §5.1");
        add(`Water Extraction – Category ${waterCat}`, "extraction", area, "SF", extractionRate, `IICRC S500 §7.3.${waterCat}`);
        if (hasHardwood) {
          add("Structural Drying – Hardwood Floor (inject/float)", "drying", area * 0.6, "SF", 1.95, "IICRC S500 §10.4");
          add("Floor Mat System – Hardwood Drying", "equipment", Math.ceil(area / 50), "EA", 45, "IICRC S500 §10.4");
        }
        if (hasCarpet) {
          add("Carpet Floating & Reinstall", "extraction", area * 0.4, "SF", 0.55, "IICRC S500 §8.2");
          add("Carpet Pad – Remove & Dispose", "demo", area * 0.4, "SF", 0.45, "IICRC S500 §8.2");
        }
        add(`Commercial LGR Dehumidifier – ${days} days`, "equipment", Math.ceil(area / 500) * days, "days", 85, "IICRC S500 §9.2");
        add(`Commercial Air Mover – ${days} days`, "equipment", Math.ceil(area / 100) * days, "days", 25, "IICRC S500 §9.3");
        if (hasMoisture) add("Moisture Mapping / Daily Monitoring Visits", "documentation", days, "visit", 135, "IICRC S500 §6.4");
        if (antimicrobialRate > 0) add(`Antimicrobial Application – Category ${waterCat}`, "treatment", area, "SF", antimicrobialRate, "IICRC S500 §12.3");
        if (hasHvac) add("HVAC Duct Cleaning – Contaminated System", "treatment", 1, "LS", 950, "IICRC S500 §11.5");
        if (hasBasement) {
          add("Basement/Crawlspace Dewatering Pump", "equipment", 1, "LS", 350, "IICRC S500 §7.1");
          add("Crawlspace Encapsulation – Vapor Barrier", "treatment", area * 0.5, "SF", 1.25, "IICRC S500 §12.4");
        }
      }

      // ════════════════════════════════════════════════════════════════════
      // DEMO / TEAR-OUT
      // ════════════════════════════════════════════════════════════════════
      if (hasDemo || hasDrywall || isWater) {
        if (hasDrywall) {
          add("Drywall Removal – Non-Salvageable (flood cut)", "demo", area * 0.5, "SF", 0.65, "IICRC S500 §12.1");
          if (hasInsulation) add("Batt Insulation – Remove & Bag", "demo", area * 0.5, "SF", 0.55, "IICRC S520 §7.2");
        }
        if (hasSubfloor) add("Subfloor Removal – Water Damaged OSB/Plywood", "demo", area * 0.3, "SF", 1.85, "IICRC S500 §12.1");
        if (hasCabinets) add("Cabinet Removal (Salvage)", "demo", rooms, "EA", 185, "Xactimate CAB-DEMO");
        if (hasAsbestos) {
          add("Asbestos Bulk Sampling (per sample)", "testing", 3, "EA", 285, "OSHA 1926.1101");
          add("Asbestos Abatement – Full Containment", "abatement", area, "SF", 4.50, "OSHA 1926.1101");
        }
        add("Debris Removal – Haul Off (Dumpster)", "demo", Math.ceil(area / 200), "load", 465, "Xactimate DEBRIS");
      }

      // ════════════════════════════════════════════════════════════════════
      // MOLD REMEDIATION
      // ════════════════════════════════════════════════════════════════════
      const isMold = hasMold || lossType.includes("mold");
      if (isMold) {
        add("Mold Remediation – Initial Assessment & Protocol", "mold", 1, "LS", 850, "IICRC S520 §5");
        if (hasContainment) {
          add("Containment Setup – Full Poly Barrier", "mold", rooms, "EA", 450, "IICRC S520 §7.3");
          add("Negative Air Machine / HEPA Air Scrubber", "equipment", rooms * days, "days", 95, "IICRC S520 §8.1");
        }
        add("Mold-Affected Material Removal & Bagging", "mold", area * 0.4, "SF", 2.25, "IICRC S520 §9.1");
        add("HEPA Vacuuming – All Affected Surfaces", "mold", area, "SF", 0.55, "IICRC S520 §9.3");
        add("Antimicrobial / Fungicide Application", "treatment", area, "SF", 0.65, "IICRC S520 §9.4");
        if (hasClearance) add("Post-Remediation Air Sampling & Clearance Testing", "mold", 1, "LS", 650, "IICRC S520 §11");
      }

      // ════════════════════════════════════════════════════════════════════
      // FIRE / SMOKE
      // ════════════════════════════════════════════════════════════════════
      const isFire = has("fire", "smoke", "soot", "char", "burn") || lossType.includes("fire");
      if (isFire) {
        if (hasEmergency || hasBoardUp) add("Emergency Board-Up & Site Security", "emergency", 1, "LS", 685, "IICRC S770 §4");
        if (hasRoof)  add("Emergency Roof Tarping", "emergency", Math.ceil(area / 100), "SQ", 235, "IICRC S770 §4.2");
        if (hasSoot) {
          add("Dry Sponge Cleaning – Walls & Ceilings", "cleaning", area * 1.3, "SF", 0.65, "IICRC S770 §8");
          add("Smoke/Soot Cleaning – Hard Surfaces", "cleaning", area, "SF", 1.25, "IICRC S770 §8.2");
          add("Chemical Sponge – Smoke Residue Removal", "cleaning", area * 0.5, "SF", 0.85, "IICRC S770 §8.3");
        }
        if (hasOdor) {
          add("Hydroxyl Generator – Odor Neutralization", "odor", days, "days", 285, "IICRC S770 §10");
          add("Thermal Fogging – Smoke Odor", "odor", area, "SF", 0.45, "IICRC S770 §10.2");
          add("Ozone Treatment (sealed area)", "odor", 1, "LS", 395, "IICRC S770 §10.3");
        }
        if (hasDrywall) add("Smoke-Damaged Drywall – Remove & Replace", "demo", area * 0.6, "SF", 0.65, "IICRC S770 §7");
        if (hasInsulation) add("Smoke-Saturated Insulation – Remove & Bag", "demo", area * 0.5, "SF", 0.55, "IICRC S770 §7.1");
      }

      // ════════════════════════════════════════════════════════════════════
      // STORM DAMAGE
      // ════════════════════════════════════════════════════════════════════
      const isStorm = has("storm", "hail", "wind", "tornado", "hurricane", "tree") || lossType.includes("storm");
      if (isStorm) {
        if (hasRoof) {
          add("Emergency Roof Tarping", "emergency", Math.ceil(area / 100), "SQ", 235, "IICRC S770");
          add("Roof Decking – Remove & Replace (OSB)", "reconstruction", area * 0.5, "SF", 2.85, "Xactimate RFG");
          add("Roof Shingles – 3-Tab / Architectural", "reconstruction", Math.ceil(area / 100), "SQ", 385, "Xactimate RFG");
          add("Drip Edge / Flashing Replacement", "reconstruction", mentionedLF || 80, "LF", 4.25, "Xactimate RFG");
          add("Gutters & Downspouts – Replace", "reconstruction", mentionedLF || 60, "LF", 12.50, "Xactimate EXT");
        }
        if (hasWindow) {
          add("Window – Remove & Replace (Vinyl Double-Pane)", "reconstruction", Math.ceil(rooms / 2), "EA", 485, "Xactimate WND");
          add("Window Frame Repair", "reconstruction", Math.ceil(rooms / 2), "EA", 95, "Xactimate WND");
        }
        if (hasBoardUp) add("Emergency Board-Up – Windows & Openings", "emergency", rooms, "EA", 185, "IICRC S770 §4");
      }

      // ════════════════════════════════════════════════════════════════════
      // RECONSTRUCTION (always runs if scope mentions rebuild/repair)
      // ════════════════════════════════════════════════════════════════════
      if (hasRecon && !isStorm) {
        if (hasDrywall) {
          add("Drywall Hang & Tape - New (1/2 in)", "reconstruction", area * 0.5, "SF", 1.85, "Xactimate DRW");
          add("Drywall Finish – Level 4 (paint-ready)", "reconstruction", area * 0.5, "SF", 0.95, "Xactimate DRW");
          add("Texture – Match Existing", "reconstruction", area * 0.5, "SF", 0.65, "Xactimate DRW");
          add("Interior Paint – Walls & Ceiling (2 coat)", "reconstruction", area * 1.3, "SF", 0.95, "Xactimate PNT");
        }
        if (hasSubfloor) add("Subfloor - OSB 3/4 in Install", "reconstruction", area * 0.3, "SF", 2.25, "Xactimate FLR");
        if (hasHardwood) add("Hardwood Flooring – Reinstall & Finish", "reconstruction", area * 0.5, "SF", 6.50, "Xactimate FLR");
        if (hasCarpet) {
          add("Carpet – Furnish & Install (mid-grade)", "reconstruction", area * 0.4, "SF", 3.85, "Xactimate FLR");
          add("Carpet Pad – 6lb Rebond", "reconstruction", area * 0.4, "SF", 0.65, "Xactimate FLR");
        }
        if (hasCabinets) {
          add("Kitchen Cabinets – Stock Replacement (per LF)", "reconstruction", mentionedLF || 12, "LF", 185, "Xactimate CAB");
          add("Countertop – Laminate Replacement", "reconstruction", mentionedLF || 10, "LF", 55, "Xactimate CAB");
        }
        if (hasInsulation) add("Batt Insulation – R-19 (walls)", "reconstruction", area * 0.5, "SF", 1.05, "Xactimate INS");
        if (hasElectrical) add("Electrical – Rough-In Repair (allowance)", "reconstruction", 1, "LS", 1250, "Xactimate ELE");
        if (hasPlumbing) add("Plumbing – Repair / Reconnect (allowance)", "reconstruction", 1, "LS", 950, "Xactimate PLB");
        if (hasHvac) add("HVAC – Duct Repair & Reconnect (allowance)", "reconstruction", 1, "LS", 1100, "Xactimate HVC");
        if (hasBathroom) {
          add("Bathroom – Reset Toilet", "reconstruction", 1, "EA", 145, "Xactimate PLB");
          add("Bathroom – Vanity & Sink Replacement", "reconstruction", 1, "EA", 485, "Xactimate PLB");
        }
        if (hasKitchen) {
          add("Kitchen – Appliance Disconnect & Reconnect", "reconstruction", 1, "LS", 275, "Xactimate APP");
        }
      }

      // ════════════════════════════════════════════════════════════════════
      // CONTENTS & ADDITIONAL SERVICES (any loss type)
      // ════════════════════════════════════════════════════════════════════
      if (hasContents) {
        add("Contents Pack-Out & Inventory", "contents", rooms, "room", 385, "Xactimate CNT");
        add("Contents Storage – Off-Site (per month)", "contents", 1, "month", 285, "Xactimate CNT");
        add("Contents Cleaning – Restore vs Replace Assessment", "contents", 1, "LS", 650, "Xactimate CNT");
      }

      // ── Standard add-ons always included on mitigation jobs ────────────────
      if (isWater || isFire || isMold) {
        add("Overhead & Profit (O&P) – 20%", "op", 1, "LS",
          parseFloat((items.reduce((s, i) => s + i.total, 0) * 0.20).toFixed(2)),
          "IICRC + O&P Doctrine (Mee v. Safeco)"
        );
      }

      // ── Final totals ──────────────────────────────────────────────────────
      const subtotal = parseFloat(items.reduce((s, i) => s + i.total, 0).toFixed(2));

      res.json({
        items,
        subtotal,
        total: subtotal,
        detectedScope: {
          lossType: isFire ? "fire" : isMold ? "mold" : isStorm ? "storm" : "water",
          waterCategory: isWater ? waterCat : null,
          squareFootage: area,
          rooms,
          days,
          flags: [
            hasAsbestos && "⚠️ Asbestos suspected — requires licensed abatement before demo",
            hasCat3 && "⚠️ Category 3 (black water) — full PPE and EPA-compliant disposal required",
            hasMold && "⚠️ Mold present — IICRC S520 protocol applies; clearance testing recommended",
          ].filter(Boolean),
        },
        message: `Generated ${items.length} line items from scope. Review quantities and adjust before sending.`,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/estimates/:id/ai-review", (req, res) => {
  const estimate = sqlite.prepare("SELECT * FROM estimates WHERE id = ?").get(Number(req.params.id)) as any;
  if (!estimate) return res.status(404).json({ error: "Estimate not found" });
  const job = sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(estimate.job_id) as any;
  const state = job?.address?.includes(", SC") ? "SC" : "GA";
  let lineItems: any[] = [];
  try { lineItems = JSON.parse(estimate.line_items || "[]"); } catch {}

  // Carrier-specific denial patterns based on historical data
  const carrierFlags: Record<string, string[]> = {
    "State Farm": ["Contents Pack-Out", "Ozone Machine", "Mold Assessment"],
    "Allstate": ["Emergency Response/Mobilization", "Hydroxyl Generator", "Containment Setup"],
    "Nationwide": ["Moisture Monitoring", "Full Containment", "Clearance Testing"],
    "USAA": ["Debris Removal", "General Cleanup"],
  };
  const carrier = job?.insuranceCarrier || "";
  const flaggedItems = carrierFlags[carrier] || [];

  const flags: any[] = [];
  lineItems.forEach((item: any) => {
    const desc = item.description || "";
    const isAtRisk = flaggedItems.some(f => desc.toLowerCase().includes(f.toLowerCase()));
    if (isAtRisk) {
      flags.push({
        lineItem: desc,
        risk: "high",
        carrier,
        suggestion: `${carrier} frequently disputes "${desc}". Strengthen with IICRC S500 Section reference, daily log documentation, and photo evidence. Add note: "Required per IICRC S500 §9 to achieve drying goals as documented in daily moisture logs."`,
        statute: state === "SC"
          ? "S.C. Code Ann. § 38-59-20 — Insurer must conduct reasonable investigation before denying any claim line item."
          : "O.C.G.A. § 33-6-34 — Prohibits insurers from refusing to pay claims without conducting a reasonable investigation based on all available information.",
      });
    }
    // Flag pricing outliers
    if (item.unitPrice && item.unit === "SF" && item.unitPrice > 2.5) {
      flags.push({
        lineItem: desc,
        risk: "medium",
        carrier,
        suggestion: `Unit price of $${item.unitPrice}/SF may be flagged as above Xactimate regional pricing for ${job?.address?.includes("GA") ? "Augusta, GA" : "SC"}. Consider adding documentation supporting the higher rate.`,
        statute: null,
      });
    }
  });

  const overallScore = Math.max(0, 100 - (flags.filter(f => f.risk === "high").length * 20) - (flags.filter(f => f.risk === "medium").length * 10));
  const summary = flags.length === 0
    ? `This estimate looks strong for ${carrier || "the carrier"}. No high-risk line items detected. ${state} insurance regulations support all documented scope items.`
    : `Found ${flags.filter(f => f.risk === "high").length} high-risk and ${flags.filter(f => f.risk === "medium").length} medium-risk items for ${carrier || "this carrier"}. Review flagged items and add supporting documentation before submission.`;

  res.json({ estimateId: estimate.id, carrier, state, overallScore, flags, summary, reviewedAt: new Date().toISOString() });
  });

// ── Completion Certificate (backend generation info) ──────────────────────────
  app.get("/api/jobs/:id/completion-packet", (req, res) => {
  const job = sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(Number(req.params.id)) as any;
  if (!job) return res.status(404).json({ error: "Job not found" });
  const contact = job.contact_id ? sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(job.contact_id) : null;
  const drying = sqlite.prepare("SELECT * FROM drying_records WHERE job_id = ? ORDER BY reading_date ASC").all(job.id);
  const documents = sqlite.prepare("SELECT * FROM job_documents WHERE job_id = ?").all(job.id);
  const estimates = sqlite.prepare("SELECT * FROM estimates WHERE job_id = ?").all(job.id);
  const invoices = sqlite.prepare("SELECT * FROM invoices WHERE job_id = ?").all(job.id);
  const photoCt = (sqlite.prepare("SELECT COUNT(*) as c FROM photos WHERE job_id = ?").get(job.id) as any).c;
  res.json({ job, contact, dryingRecords: drying, documents, estimates, invoices, photoCount: photoCt });
  });



  // ── Auth Routes ──────────────────────────────────────────────────────────────
  registerAuthRoutes(app, sqlite);

  // ── Job Notes Routes ────────────────────────────────────────────────────────
  // Ensure table exists on startup (safe migration).
  //
  // Historical schema had is_public default 0 (private). Cody's rule is
  // now 'every employee sees every note' — so we treat public as the
  // default going forward. New DBs created here get DEFAULT 1; existing
  // DBs keep whatever default they had, but the POST route now forces
  // isPublic=true unless the client explicitly opts out.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS job_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      author TEXT NOT NULL DEFAULT 'Titan Team',
      body TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 1,
      tag TEXT,
      edited_at TEXT,
      created_at TEXT NOT NULL DEFAULT ''
    )
  `);

  // One-time backfill: flip every existing private note to public so
  // notes typed before the visibility rule change are visible to the
  // whole crew. Gated by a marker in app_meta so it only runs once,
  // no matter how many times the server restarts. Owner can still turn
  // an individual note private later via the Notes tab edit UI.
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT
      )
    `);
    const marker = sqlite
      .prepare("SELECT value FROM app_meta WHERE key = 'job_notes_public_backfill_v1'")
      .get() as { value?: string } | undefined;
    if (!marker) {
      const before = sqlite
        .prepare("SELECT COUNT(*) AS n FROM job_notes WHERE is_public = 0")
        .get() as { n: number };
      const flipped = sqlite
        .prepare("UPDATE job_notes SET is_public = 1 WHERE is_public = 0")
        .run();
      sqlite
        .prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)")
        .run(
          "job_notes_public_backfill_v1",
          JSON.stringify({ flipped: flipped.changes, previouslyPrivate: before.n }),
          new Date().toISOString(),
        );
      if (flipped.changes > 0) {
        console.log(`[migration] job_notes: flipped ${flipped.changes} private note(s) to public`);
      }
    }
  } catch (e: any) {
    console.warn("[migration] job_notes public backfill failed:", e?.message || e);
  }

  // Map a raw job_notes DB row (snake_case) to the camelCase shape the client expects
  const mapJobNote = (r: any) => r == null ? r : ({
    id: r.id,
    jobId: r.job_id,
    author: r.author,
    body: r.body,
    isPublic: !!r.is_public,
    tag: r.tag,
    editedAt: r.edited_at,
    createdAt: r.created_at,
  });

  // GET all notes for a job (internal: all; public param: only public)
  app.get("/api/jobs/:jobId/notes", (req, res) => {
    const jobId = Number(req.params.jobId);
    const publicOnly = req.query.public === "true";
    try {
      const rows = publicOnly
        ? sqlite.prepare("SELECT * FROM job_notes WHERE job_id = ? AND is_public = 1 ORDER BY created_at ASC").all(jobId)
        : sqlite.prepare("SELECT * FROM job_notes WHERE job_id = ? ORDER BY created_at ASC").all(jobId);
      res.json((rows as any[]).map(mapJobNote));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST — create new note
  app.post("/api/jobs/:jobId/notes", (req, res) => {
    const jobId = Number(req.params.jobId);
    // Accept both { body } (canonical) and { text } (legacy from the mobile
    // Technician surface). Without this fallback, notes typed on the mobile
    // tech screen posted with 'text' were rejected as 'body is required' and
    // silently dropped — the user saw the field clear and assumed it saved.
    //
    // `notify` is an optional array of employee IDs — those employees get an
    // email + bell when the note is created. This is the explicit, chip-picker
    // recipient list from the Add Note UI (NOT parsed from the body).
    const { author, body, text, isPublic, tag, notify } = req.body || {};
    const noteBody = (body ?? text ?? "").toString();
    const notifyIds: number[] = Array.isArray(notify)
      ? notify.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];
    if (!noteBody.trim()) return res.status(400).json({ error: "body is required" });
    try {
      const now = new Date().toISOString();
      const result = sqlite.prepare(
        "INSERT INTO job_notes (job_id, author, body, is_public, tag, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        // Default isPublic to true so every note is visible to every employee.
        // The old default (false = private) meant a note typed by one tech was
        // invisible to everyone else, which broke the 'shared job history' UX
        // the team expects.
      ).run(jobId, author || "Titan Team", noteBody.trim(), isPublic === false ? 0 : 1, tag || null, now);
      const note = sqlite.prepare("SELECT * FROM job_notes WHERE id = ?").get(result.lastInsertRowid);

      // ── Notify: explicit recipient fan-out (bell + email) ────────────────
      // Recipients come from the client's Notify chip picker — no @-parsing.
      // Best-effort: any failure here must NOT break note creation.
      try {
        const job: any = storage.getJob(jobId);
        const jobNum = job?.jobNumber ? `Job ${job.jobNumber}` : `Job #${jobId}`;
        const link = `/jobs/${jobId}`;
        const roster = notifier.activeEmployeeRoster();
        // Resolve the author's employee ID by name (best-effort). Used to (a)
        // strip the author from the recipient list if they picked themselves
        // and (b) send email FROM the author's connected Gmail.
        const authorRow = author
          ? roster.find(e => e.name.toLowerCase() === String(author).toLowerCase())
          : undefined;

        // Filter recipients: must be active, not the author, dedupe.
        const activeIds = new Set(roster.map(e => e.id));
        const targetIds = Array.from(new Set(notifyIds))
          .filter(id => activeIds.has(id))
          .filter(id => !authorRow || id !== authorRow.id);

        if (targetIds.length > 0) {
          // 1) In-app bell for every recipient.
          notifier.notifyMany(targetIds, {
            type: "note_mentioned",
            title: `${author || "Someone"} sent you a note on ${jobNum}`,
            body: noteBody.trim().slice(0, 240),
            jobId,
            link,
          });

          // 2) Email fan-out — fire-and-forget so slow SMTP never blocks the response.
          if (authorRow) {
            const custName = (job?.customerName || job?.customer_name || null) as string | null;
            const jobAddr = (job?.serviceAddress || job?.service_address || job?.address || null) as string | null;
            void sendMentionEmails(sqlite, {
              authorEmployeeId: authorRow.id,
              authorName: author || authorRow.name,
              recipientEmployeeIds: targetIds,
              jobId,
              jobNumber: job?.jobNumber || null,
              jobAddress: jobAddr,
              customerName: custName,
              noteBody: noteBody.trim(),
              noteIsPublic: isPublic !== false,
              noteTag: tag || null,
            }).catch(e => console.error("[notes] email fan-out threw:", e?.message || e));
          } else {
            console.log("[notes] skipping email fan-out: author name not resolved to employee:", author);
          }
        }

        // 3) Fallback: assigned tech gets a bell (no email) when NOT already
        // a recipient and NOT the author. Preserves the previous behaviour
        // where the assigned tech got a heads-up on every new note.
        const assignedName: string | undefined = job?.assignedTech || undefined;
        if (assignedName && assignedName !== author) {
          const assigned = roster.find(e => e.name === assignedName);
          if (assigned && !targetIds.includes(assigned.id)) {
            notifier.notify({
              employeeId: assigned.id,
              type: "note_added",
              title: `New note on ${jobNum}`,
              body: noteBody.trim().slice(0, 240),
              jobId,
              link,
            });
          }
        }
      } catch (e: any) {
        console.error("[notes] notification fan-out failed:", e?.message || e);
      }

      res.status(201).json(mapJobNote(note));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH — edit note body, visibility, or tag
  app.patch("/api/jobs/:jobId/notes/:noteId", (req, res) => {
    const noteId = Number(req.params.noteId);
    const { body, isPublic, tag, author } = req.body;
    try {
      const existing: any = sqlite.prepare("SELECT * FROM job_notes WHERE id = ?").get(noteId);
      if (!existing) return res.status(404).json({ error: "Note not found" });
      const now = new Date().toISOString();
      sqlite.prepare(
        `UPDATE job_notes SET
          body = ?, is_public = ?, tag = ?, author = ?, edited_at = ?
         WHERE id = ?`
      ).run(
        body !== undefined ? body.trim() : existing.body,
        isPublic !== undefined ? (isPublic ? 1 : 0) : existing.is_public,
        tag !== undefined ? tag : existing.tag,
        author !== undefined ? author : existing.author,
        now,
        noteId
      );
      const updated = sqlite.prepare("SELECT * FROM job_notes WHERE id = ?").get(noteId);
      res.json(mapJobNote(updated));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE — remove a note
  app.delete("/api/jobs/:jobId/notes/:noteId", (req, res) => {
    const noteId = Number(req.params.noteId);
    try {
      sqlite.prepare("DELETE FROM job_notes WHERE id = ?").run(noteId);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/notes (top-level) — for health scan
  app.get("/api/notes", (_req, res) => {
    try {
      const rows = sqlite.prepare("SELECT * FROM job_notes ORDER BY created_at DESC LIMIT 100").all();
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Server-side auth guard for suite/route-planner APIs ─────────────────────
  // These modules register their routes without per-route auth. Since the app can
  // run on a network-reachable host, we require a valid staff session for every
  // one of their endpoints by mounting requireStaffAuth on each path prefix before
  // the routes themselves are registered. This gates ~129 endpoints in one place.
  const SUITE_AUTH_PREFIXES = [
    // suite4
    "/api/carrier-ar", "/api/comm-timeline", "/api/compliance-checklists",
    "/api/drone-assessments", "/api/emergency-intakes", "/api/equipment-maintenance",
    "/api/iicrc-checklist-items", "/api/iot-readings", "/api/iot-sensors",
    "/api/reports", "/api/storm-campaigns", "/api/subrogation", "/api/tpa-programs",
    // suite5
    "/api/appointment-reminders", "/api/ar-followup", "/api/ar-followup-log",
    "/api/ar-followup-rules", "/api/departure-checklists", "/api/hazmat-flags",
    "/api/lien-waivers", "/api/qb-sync", "/api/qb-sync-log", "/api/time-clock",
    // suite6
    "/api/adjuster-courses", "/api/adjuster-enrollments", "/api/approved-claims",
    "/api/general-conditions", "/api/op-rebuttal", "/api/supplement-tracker",
    "/api/vehicle-maintenance", "/api/vehicles", "/api/xact-audit",
    // route planner
    "/api/route-stops", "/api/routes", "/api/trips",
    // consumables inventory
    "/api/consumables",
    // HR module
    "/api/hr",
  ];
  for (const prefix of SUITE_AUTH_PREFIXES) {
    app.use(prefix, requireStaffAuth);
  }

  // ── Suite 5 Routes ──────────────────────────────────────────────────────────────
  registerSuite5Routes(app, sqlite, { requireRole });
  registerSuite6Routes(app, sqlite);
  registerAIAgentRoutes(app, sqlite);

  // ── HR Management Module + AI HR Assistant (additive, self-contained) ───────
  registerHRRoutes(app, sqlite);

  // ── Gmail Integration (OAuth, per-employee) — DORMANT until GOOGLE_CLIENT_ID
  //    & GOOGLE_CLIENT_SECRET are set. Test-safe: reports configured:false and
  //    makes no live Google calls when unconfigured. ───────────────────────────
  registerGmailRoutes(app, sqlite, { requireStaffAuth, requireRole });

  // ── Marketing AI Routes (additive: custom + seasonal posts + learning) ──────
  registerMarketingAIRoutes(app, sqlite);

  // ── Team Presence & Activity (additive: heartbeat + OWNER-ONLY reporting) ───
  registerPresenceRoutes(app, sqlite);

  // ── Suite 4 Routes ─────────────────────────────────────────────────────────
  registerSuite4Routes(app, sqlite, { requireRole });
  registerQuickAddAndESignRoutes(app, sqlite, { requireRole }, notifier);

  // ── Route Planner Routes ───────────────────────────────────────────────────
  registerRoutePlannerRoutes(app, sqlite);


  // ── Withdrawal Requests ───────────────────────────────────────────────────
  // Migrate table
  const wdCols = sqlite.prepare("PRAGMA table_info(withdrawal_requests)").all().map((c: any) => c.name);
  if (!wdCols.includes("id")) {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payout_method_id INTEGER,
      method_snapshot TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      partner_note TEXT,
      admin_note TEXT,
      requested_at TEXT NOT NULL DEFAULT '',
      processed_at TEXT
    )`);
  }

  // GET all withdrawal requests (admin) or by contactId (partner)
  app.get("/api/withdrawal-requests", (req, res) => {
    try {
      const contactId = req.query.contactId ? Number(req.query.contactId) : null;
      const rows = contactId
        ? sqlite.prepare("SELECT * FROM withdrawal_requests WHERE contact_id = ? ORDER BY requested_at DESC").all(contactId)
        : sqlite.prepare("SELECT * FROM withdrawal_requests ORDER BY requested_at DESC").all();
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST — partner submits withdrawal request
  app.post("/api/withdrawal-requests", (req, res) => {
    try {
      const { contactId, amount, payoutMethodId, partnerNote } = req.body;
      if (!contactId || !amount || amount <= 0) return res.status(400).json({ error: "contactId and positive amount required" });

      // Verify partner has sufficient available balance
      const allPayouts: any[] = sqlite.prepare("SELECT * FROM payout_requests WHERE contact_id = ? AND status = 'paid'").all(Number(contactId));
      const allWithdrawals: any[] = sqlite.prepare("SELECT * FROM withdrawal_requests WHERE contact_id = ? AND status NOT IN ('rejected')").all(Number(contactId));
      const totalEarned = allPayouts.reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const totalWithdrawn = allWithdrawals.reduce((s: number, w: any) => s + (w.amount || 0), 0);
      const available = totalEarned - totalWithdrawn;

      if (amount > available + 0.01) {
        return res.status(400).json({ error: `Insufficient balance. Available: $${available.toFixed(2)}` });
      }

      // Snapshot the payout method at time of request
      let methodSnapshot = null;
      if (payoutMethodId) {
        const method: any = sqlite.prepare("SELECT * FROM payout_methods WHERE id = ?").get(Number(payoutMethodId));
        if (method) methodSnapshot = JSON.stringify({ method: method.method, handle: method.handle });
      }

      const now = new Date().toISOString();
      const result: any = sqlite.prepare(
        "INSERT INTO withdrawal_requests (contact_id, amount, payout_method_id, method_snapshot, status, partner_note, requested_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)"
      ).run(Number(contactId), Number(amount), payoutMethodId || null, methodSnapshot, partnerNote || null, now);

      const row = sqlite.prepare("SELECT * FROM withdrawal_requests WHERE id = ?").get(result.lastInsertRowid);

      // Post notification to internal messaging
      const contact: any = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(Number(contactId));
      const partnerName = contact?.name || "Partner";
      const methodParsed = methodSnapshot ? JSON.parse(methodSnapshot) : null;
      const methodStr = methodParsed ? `${methodParsed.method.replace("_"," ")} (${methodParsed.handle})` : "No method on file";
      sqlite.prepare(
        "INSERT INTO messages (channel_id, author, body, created_at) VALUES (1, 'Titan Pro Bot', ?, ?)"
      ).run(
        `💸 WITHDRAWAL REQUEST
${partnerName} has requested a withdrawal of $${Number(amount).toFixed(2)} via ${methodStr}.
Approve in Partner Portal → Admin View.
📞 706-922-0154`,
        now
      );

      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH — admin updates status (approve / processing / paid / rejected)
  app.patch("/api/withdrawal-requests/:id", (req, res) => {
    try {
      const { status, adminNote } = req.body;
      const now = new Date().toISOString();
      const isDone = status === "paid" || status === "rejected";
      sqlite.prepare(
        "UPDATE withdrawal_requests SET status = ?, admin_note = ?, processed_at = ? WHERE id = ?"
      ).run(status, adminNote || null, isDone ? now : null, Number(req.params.id));
      const row = sqlite.prepare("SELECT * FROM withdrawal_requests WHERE id = ?").get(Number(req.params.id));
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET available balance for a partner
  app.get("/api/partner/:contactId/balance", (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      if (!partnerAccessAllowed(req, contactId))
        return res.status(403).json({ error: "Not authorized to view this account." });
      const allPayouts: any[] = sqlite.prepare("SELECT amount FROM payout_requests WHERE contact_id = ? AND status = 'paid'").all(contactId);
      const allWithdrawals: any[] = sqlite.prepare("SELECT amount FROM withdrawal_requests WHERE contact_id = ? AND status NOT IN ('rejected')").all(contactId);
      const totalEarned = allPayouts.reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const totalWithdrawn = allWithdrawals.reduce((s: number, w: any) => s + (w.amount || 0), 0);
      const available = Math.max(0, totalEarned - totalWithdrawn);
      res.json({ totalEarned, totalWithdrawn, available });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Referral Company Portal Summary ────────────────────────────────────────
  // For a referral COMPANY contact, aggregate everything Titan has actually PAID
  // out (payments of type 'referral_payout') to the company itself AND to every
  // referral tech attached to it (contacts.parent_company_id = companyId).
  // Returns a company total plus a per-tech breakdown. Access is limited to the
  // company's own portal token or a valid staff session.
  app.get("/api/partner/:contactId/company-summary", (req, res) => {
    try {
      const companyId = Number(req.params.contactId);
      if (!partnerAccessAllowed(req, companyId))
        return res.status(403).json({ error: "Not authorized to view this account." });
      const company: any = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      // The company contact + all attached referral techs.
      const techs: any[] = sqlite.prepare(
        "SELECT * FROM contacts WHERE parent_company_id = ? ORDER BY name ASC"
      ).all(companyId);
      const memberIds = [companyId, ...techs.map((t: any) => t.id)];
      const placeholders = memberIds.map(() => "?").join(",");

      // All referral payouts paid to any member.
      const payouts: any[] = sqlite.prepare(
        `SELECT * FROM payments WHERE type = 'referral_payout' AND contact_id IN (${placeholders}) ORDER BY paid_at DESC`
      ).all(...memberIds);

      const jobs: any[] = sqlite.prepare("SELECT id, job_number, address FROM jobs WHERE status IS NULL OR status != 'closed'").all();
      const jobById: Record<number, any> = {};
      jobs.forEach((j: any) => { jobById[j.id] = j; });

      const sumFor = (cid: number) =>
        payouts.filter((p: any) => p.contact_id === cid)
          .reduce((s: number, p: any) => s + (p.amount || 0), 0);

      const perTech = [
        { id: company.id, name: company.name + " (company direct)", email: company.email, paid: sumFor(company.id), isCompany: true },
        ...techs.map((t: any) => ({ id: t.id, name: t.name, email: t.email, paid: sumFor(t.id), isCompany: false })),
      ];

      const totalPaid = payouts.reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const payments = payouts.map((p: any) => {
        const payee = memberIds.includes(p.contact_id)
          ? (p.contact_id === companyId ? company.name : (techs.find((t: any) => t.id === p.contact_id)?.name || ""))
          : "";
        const job = p.job_id ? jobById[p.job_id] : null;
        return {
          id: p.id, amount: p.amount, method: p.method, reference: p.reference,
          paidAt: p.paid_at, payee, jobNumber: job?.job_number || null, jobAddress: job?.address || null,
        };
      });

      res.json({
        company: { id: company.id, name: company.name, email: company.email, phone: company.phone },
        totalPaid,
        techCount: techs.length,
        perTech,
        payments,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });


  // ── Referral Partner Jobs API ─────────────────────────────────────────────
  // Migrate: add referral_partner_id to jobs if missing
  const jobColsForPartner = sqlite.prepare("PRAGMA table_info(jobs)").all().map((c: any) => c.name);
  if (!jobColsForPartner.includes("referral_partner_id")) {
    sqlite.exec("ALTER TABLE jobs ADD COLUMN referral_partner_id INTEGER");
  }

  // GET /api/partner/:contactId/jobs — all jobs linked to this partner
  // Matches via: referral_partner_id OR payout_requests link OR lead_source_detail name match
  app.get("/api/partner/:contactId/jobs", (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      if (!partnerAccessAllowed(req, contactId))
        return res.status(403).json({ error: "Not authorized to view this account." });
      const contact: any = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(contactId);
      if (!contact) return res.status(404).json({ error: "Partner not found" });

      // All jobs
      const allJobs: any[] = sqlite.prepare("SELECT * FROM jobs WHERE status IS NULL OR status != 'closed' ORDER BY created_at DESC").all();

      // All payout requests for this partner
      const myPayouts: any[] = sqlite.prepare("SELECT * FROM payout_requests WHERE contact_id = ?").all(contactId);
      const payoutJobIds = new Set(myPayouts.filter((p: any) => p.job_id).map((p: any) => p.job_id));

      // All public notes per job
      const allPublicNotes: any[] = sqlite.prepare(
        "SELECT * FROM job_notes WHERE is_public = 1 ORDER BY created_at ASC"
      ).all();

      // All invoices for revenue
      const allInvoices: any[] = sqlite.prepare("SELECT * FROM invoices").all();

      // Match jobs to this partner
      const partnerJobs = allJobs.filter((j: any) => {
        if (j.referral_partner_id === contactId) return true;
        if (payoutJobIds.has(j.id)) return true;
        if (
          j.lead_source === "referral" &&
          j.lead_source_detail &&
          contact.name &&
          j.lead_source_detail.toLowerCase().includes(contact.name.toLowerCase())
        ) return true;
        return false;
      });

      // Enrich each job
      const enriched = partnerJobs.map((j: any) => {
        const jobPayouts = myPayouts.filter((p: any) => p.job_id === j.id);
        const jobInvoices = allInvoices.filter((inv: any) => inv.job_id === j.id);
        const totalInvoiced = jobInvoices.reduce((s: number, inv: any) => s + (inv.total || 0), 0);
        const pendingPayout = jobPayouts.find((p: any) => p.status === "pending" || p.status === "approved");
        const paidPayout = jobPayouts.filter((p: any) => p.status === "paid").reduce((s: number, p: any) => s + (p.amount || 0), 0);
        const publicNotes = allPublicNotes.filter((n: any) => n.job_id === j.id);

        return {
          id: j.id,
          jobNumber: j.job_number,
          address: j.address,
          lossType: j.loss_type,
          status: j.status,
          progressStage: j.progress_stage,
          assignedTech: j.assigned_tech,
          insuranceCarrier: j.insurance_carrier,
          createdAt: j.created_at,
          jobComplete: j.job_complete,
          mitigationStart: j.mitigation_start,
          totalInvoiced,
          pendingPayoutAmount: pendingPayout ? pendingPayout.amount : null,
          pendingPayoutStatus: pendingPayout ? pendingPayout.status : null,
          pendingPayoutId: pendingPayout ? pendingPayout.id : null,
          paidToDate: paidPayout,
          publicNotes: publicNotes.map((n: any) => ({
            id: n.id, author: n.author, body: n.body, createdAt: n.created_at, tag: n.tag,
          })),
        };
      });

      // Summary totals
      const totalEarned = myPayouts.filter((p: any) => p.status === "paid").reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const totalPending = myPayouts.filter((p: any) => p.status === "pending" || p.status === "approved").reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const totalInvoicedAll = enriched.reduce((s: number, j: any) => s + j.totalInvoiced, 0);

      // Warranty call totals for this partner
      const myWarrantyCalls: any[] = sqlite.prepare("SELECT * FROM warranty_calls WHERE partner_id = ?").all(contactId);
      const totalWarrantyCost = myWarrantyCalls.reduce((s: number, w: any) => s + (w.total_cost || 0), 0);
      const totalWarrantyCount = myWarrantyCalls.length;

      // Partnership start date: use partner_since if set, else earliest referred job, else contact row creation
      const earliestJob = enriched.length > 0
        ? enriched.reduce((a: any, b: any) => (a.createdAt < b.createdAt ? a : b))
        : null;
      const partnerSince = contact.partner_since || (earliestJob ? earliestJob.createdAt : null);

      const totalJobsCount = enriched.length;
      const activeJobsCount = enriched.filter((j: any) => j.status !== "complete" && j.status !== "closed").length;
      const completedJobsCount = enriched.filter((j: any) => j.status === "complete").length;

      // ── Capacity indicator ────────────────────────────────────────────────
      // Soft target of concurrent active jobs Titan can comfortably service for this partner
      const capacityTarget = 8;
      const capacityPct = Math.min(100, Math.round((activeJobsCount / capacityTarget) * 100));
      const capacityLabel = capacityPct >= 90 ? "At capacity" : capacityPct >= 60 ? "Filling up" : "Ready for more";

      // ── Derived lifetime metrics ──────────────────────────────────────────
      const avgJobValue = totalJobsCount > 0 ? Math.round(totalInvoicedAll / totalJobsCount) : 0;
      const closeRate = totalJobsCount > 0 ? Math.round((completedJobsCount / totalJobsCount) * 100) : 0;
      const nowYear = new Date().getFullYear();
      const jobsThisYear = enriched.filter((j: any) => j.createdAt && new Date(j.createdAt).getFullYear() === nowYear).length;
      // Goodwill = value Titan absorbed on partner's behalf (warranty visits + complimentary work)
      const goodwillValue = totalWarrantyCost;

      res.json({
        partner: { id: contact.id, name: contact.name, company: contact.company, type: contact.type, partnerSince },
        jobs: enriched,
        summary: {
          totalJobs: totalJobsCount,
          activeJobs: activeJobsCount,
          completedJobs: completedJobsCount,
          totalInvoiced: totalInvoicedAll,
          totalEarned,
          totalPending,
          totalWarrantyCost,
          totalWarrantyCount,
          partnerSince,
          capacityTarget,
          capacityPct,
          capacityLabel,
          avgJobValue,
          closeRate,
          jobsThisYear,
          goodwillValue,
        },
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/jobs/:id/referral-partner — assign a referral partner to a job (admin)
  app.patch("/api/jobs/:id/referral-partner", (req, res) => {
    try {
      const { referralPartnerId } = req.body;
      sqlite.prepare("UPDATE jobs SET referral_partner_id = ? WHERE id = ?").run(
        referralPartnerId || null,
        Number(req.params.id)
      );
      const job: any = sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(Number(req.params.id));
      res.json(job);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });


  // ── Job Sketches ─────────────────────────────────────────────────────────
  // Migrate table on startup
  const sketchCols = sqlite.prepare("PRAGMA table_info(job_sketches)").all().map((c: any) => c.name);
  if (!sketchCols.includes("id")) {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS job_sketches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      sketch_data TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    )`);
  }

  app.get("/api/jobs/:jobId/sketch", (req, res) => {
    try {
      const jobId = Number(req.params.jobId);
      const row: any = sqlite.prepare("SELECT * FROM job_sketches WHERE job_id = ?").get(jobId);
      if (!row) return res.json({ sketchData: null });
      res.json({ id: row.id, jobId: row.job_id, sketchData: row.sketch_data, updatedAt: row.updated_at });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/jobs/:jobId/sketch", (req, res) => {
    try {
      const jobId = Number(req.params.jobId);
      const { sketchData } = req.body;
      if (!sketchData) return res.status(400).json({ error: "sketchData required" });
      const now = new Date().toISOString();
      const existing: any = sqlite.prepare("SELECT id FROM job_sketches WHERE job_id = ?").get(jobId);
      if (existing) {
        sqlite.prepare("UPDATE job_sketches SET sketch_data = ?, updated_at = ? WHERE job_id = ?").run(sketchData, now, jobId);
      } else {
        sqlite.prepare("INSERT INTO job_sketches (job_id, sketch_data, updated_at, created_at) VALUES (?, ?, ?, ?)").run(jobId, sketchData, now, now);
      }
      const row: any = sqlite.prepare("SELECT * FROM job_sketches WHERE job_id = ?").get(jobId);
      res.json({ id: row.id, jobId: row.job_id, sketchData: row.sketch_data, updatedAt: row.updated_at });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/jobs/:jobId/sketch", (req, res) => {
    try {
      sqlite.prepare("DELETE FROM job_sketches WHERE job_id = ?").run(Number(req.params.jobId));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });


  // ── BD Calendar Events ──────────────────────────────────────────────────────
  // Ensure table exists
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS bd_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'meeting',
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      location TEXT,
      notes TEXT,
      contact_id INTEGER,
      contact_email TEXT,
      contact_name TEXT,
      notify_partner INTEGER DEFAULT 1,
      notified INTEGER DEFAULT 0,
      created_by TEXT DEFAULT 'Cody Brantley',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `);

  app.get("/api/bd-events", (_req, res) => {
    res.json(storage.getBdEvents());
  });

  app.get("/api/bd-events/:id", (req, res) => {
    const ev = storage.getBdEvent(Number(req.params.id));
    if (!ev) return res.status(404).json({ error: "Not found" });
    res.json(ev);
  });

  app.post("/api/bd-events", (req, res) => {
    const ev = storage.createBdEvent(req.body);
    // Send email notification to partner if requested
    if (ev.notifyPartner && ev.contactEmail) {
      const eventTypeLabel = (ev.eventType || "meeting").replace(/_/g, " ");
      const dateStr = ev.date;
      const timeStr = ev.startTime + (ev.endTime ? ` – ${ev.endTime}` : "");
      const subject = `You're Invited: ${ev.title} — ${dateStr}`;
      const body = `Hi ${ev.contactName || "Partner"},\n\nTitan Restoration LLC has scheduled a ${eventTypeLabel} with you:\n\n📅 ${ev.title}\n🗓 Date: ${dateStr}\n⏰ Time: ${timeStr}\n📍 Location: ${ev.location || "TBD"}\n\n${ev.notes ? `Notes: ${ev.notes}\n\n` : ""}If you have any questions please reach out to us at 706-922-0154 or reply to this message.\n\nLooking forward to connecting!\n\nCody Brantley\nTitan Restoration LLC\n706-922-0154\ntitanrestorationllc.com`;
      storage.createEmail({
        folder: "sent",
        from: "cody@titanrestorationllc.com",
        to: ev.contactEmail,
        subject,
        body,
        read: 1,
      });
      storage.updateBdEvent(ev.id, { notified: 1 });
      ev.notified = 1;
    }
    res.json(ev);
  });

  app.patch("/api/bd-events/:id", (req, res) => {
    const ev = storage.updateBdEvent(Number(req.params.id), req.body);
    if (!ev) return res.status(404).json({ error: "Not found" });
    // Re-send notification if email/notify changed
    if (req.body.notifyPartner && ev.contactEmail && !ev.notified) {
      const eventTypeLabel = (ev.eventType || "meeting").replace(/_/g, " ");
      const timeStr = ev.startTime + (ev.endTime ? ` – ${ev.endTime}` : "");
      const subject = `Updated Invite: ${ev.title} — ${ev.date}`;
      const body = `Hi ${ev.contactName || "Partner"},\n\nYour scheduled ${eventTypeLabel} with Titan Restoration has been updated:\n\n📅 ${ev.title}\n🗓 Date: ${ev.date}\n⏰ Time: ${timeStr}\n📍 Location: ${ev.location || "TBD"}\n\n${ev.notes ? `Notes: ${ev.notes}\n\n` : ""}Questions? Call 706-922-0154.\n\nCody Brantley\nTitan Restoration LLC`;
      storage.createEmail({ folder: "sent", from: "cody@titanrestorationllc.com", to: ev.contactEmail, subject, body, read: 1 });
      storage.updateBdEvent(ev.id, { notified: 1 });
    }
    res.json(ev);
  });

  app.delete("/api/bd-events/:id", (req, res) => {
    storage.deleteBdEvent(Number(req.params.id));
    res.json({ success: true });
  });


  // ── Warranty Calls ──────────────────────────────────────────────────────────
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS warranty_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      partner_id INTEGER,
      partner_name TEXT,
      issue_description TEXT NOT NULL,
      resolution TEXT,
      tech_assigned TEXT,
      visit_date TEXT NOT NULL,
      labor_hours REAL DEFAULT 0,
      labor_rate REAL DEFAULT 65,
      material_cost REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      charged_to_partner INTEGER DEFAULT 0,
      internal_note TEXT,
      partner_note TEXT,
      notify_partner INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT ''
    )
  `);

  app.get("/api/warranty-calls", (req, res) => {
    const jobId = req.query.jobId ? Number(req.query.jobId) : undefined;
    const partnerId = req.query.partnerId ? Number(req.query.partnerId) : undefined;
    res.json(storage.getWarrantyCalls(jobId, partnerId));
  });

  app.post("/api/warranty-calls", (req, res) => {
    const wc = storage.createWarrantyCall(req.body);
    // Post internal messaging notification
    const cost = (wc.totalCost || 0).toFixed(2);
    const partnerTag = wc.partnerName ? ` | Partner: ${wc.partnerName}` : "";
    storage.createMessage({
      channelId: 1,
      author: "Titan Pro Bot",
      body: `🔧 WARRANTY CALL LOGGED — Job #${wc.jobId}${partnerTag}\nIssue: ${wc.issueDescription}\nVisit: ${wc.visitDate} | Tech: ${wc.techAssigned || "TBD"}\nCost absorbed: $${cost} (Labor: ${wc.laborHours}h × $${wc.laborRate}/hr + Materials: $${(wc.materialCost||0).toFixed(2)})\nCharged to partner: $0.00 (complimentary)`,
      createdAt: new Date().toISOString(),
    });
    res.json(wc);
  });

  app.patch("/api/warranty-calls/:id", (req, res) => {
    const wc = storage.updateWarrantyCall(Number(req.params.id), req.body);
    if (!wc) return res.status(404).json({ error: "Not found" });
    res.json(wc);
  });

  app.delete("/api/warranty-calls/:id", (req, res) => {
    storage.deleteWarrantyCall(Number(req.params.id));
    res.json({ success: true });
  });

  // Partner warranty summary (for partner portal — shows partner their own records)
  app.get("/api/partner/:contactId/warranty-calls", (req, res) => {
    if (!partnerAccessAllowed(req, Number(req.params.contactId)))
      return res.status(403).json({ error: "Not authorized to view this account." });
    const calls = storage.getWarrantyCalls(undefined, Number(req.params.contactId));
    const jobs = sqlite.prepare("SELECT * FROM jobs WHERE status IS NULL OR status != 'closed'").all() as any[];
    const enriched = calls.map((wc: any) => {
      const job = jobs.find((j: any) => j.id === wc.jobId);
      return {
        ...wc,
        jobNumber: job?.job_number || `#${wc.jobId}`,
        jobAddress: job?.address || "Unknown",
      };
    });
    const totalCostAbsorbed = enriched.reduce((s: number, w: any) => s + (w.totalCost || 0), 0);
    const totalCalls = enriched.length;
    res.json({ calls: enriched, totalCalls, totalCostAbsorbed });
  });


  // ── Job-number integrity migration — 2026-08-14 ─────────────────────────────
  // Production data had duplicate + inconsistent job numbers
  // ("TP-2026-Augusta-0428" collided across two distinct jobs;
  // "Tp-26-Augusta-0423" mixed-case; "TP-26-Augusta-0420" short-year).
  // Fix in three passes:
  //   1. Uppercase the "TP-" prefix on any historical row.
  //   2. Normalize short-year "TP-26-..." → "TP-2026-...".
  //   3. For any duplicate job_number, keep the earliest job (lowest id)
  //      and suffix later collisions with "-DUP<id>" so the unique index
  //      can be created without data loss. The suffix is intentionally
  //      ugly so staff notice and rename.
  try {
    sqlite.exec("UPDATE jobs SET job_number = REPLACE(job_number, 'Tp-', 'TP-') WHERE job_number LIKE 'Tp-%'");
    sqlite.exec("UPDATE jobs SET job_number = REPLACE(job_number, 'TP-26-', 'TP-2026-') WHERE job_number LIKE 'TP-26-%'");
    const dups: any[] = sqlite.prepare(
      "SELECT job_number, MIN(id) AS keep_id FROM jobs WHERE job_number IS NOT NULL AND job_number <> '' GROUP BY job_number HAVING COUNT(*) > 1"
    ).all();
    for (const d of dups) {
      const dupRows: any[] = sqlite.prepare(
        "SELECT id FROM jobs WHERE job_number = ? AND id <> ?"
      ).all(d.job_number, d.keep_id);
      for (const r of dupRows) {
        sqlite.prepare("UPDATE jobs SET job_number = ? WHERE id = ?")
          .run(`${d.job_number}-DUP${r.id}`, r.id);
        console.log(`[jobs] resolved duplicate job_number "${d.job_number}" on id=${r.id}`);
      }
    }
    sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_job_number ON jobs(job_number)");
  } catch (e: any) {
    console.warn("[migration] job-number normalization skipped:", e?.message || e);
  }

  // Ramp was never wired to real payouts. Removing the endpoints, UI, and tables.
  try { sqlite.exec(`DROP TABLE IF EXISTS ramp_transactions`); } catch(_) {}
  try { sqlite.exec(`DROP TABLE IF EXISTS ramp_payments`); } catch(_) {}
  try { sqlite.prepare(`DELETE FROM integrations WHERE key = 'ramp'`).run(); } catch(_) {}

  // ── Partner Since migration ─────────────────────────────────────────────────
  try { sqlite.exec(`ALTER TABLE contacts ADD COLUMN partner_since TEXT`); } catch(_) {}
  // DocuSketch column migrations
  try { sqlite.exec(`ALTER TABLE jobs ADD COLUMN docusketch_url TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE jobs ADD COLUMN docusketch_project_name TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE jobs ADD COLUMN docusketch_status TEXT DEFAULT 'none'`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE jobs ADD COLUMN docusketch_sketch_url TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE jobs ADD COLUMN docusketch_notes TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE jobs ADD COLUMN docusketch_completed_at TEXT`); } catch(_) {}
  // Geocode columns for the Service Area map on the dashboard.
  try { sqlite.exec(`ALTER TABLE jobs ADD COLUMN latitude REAL`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE jobs ADD COLUMN longitude REAL`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE jobs ADD COLUMN geocoded_at TEXT`); } catch(_) {}
  // Division / job scope column. Drives the 3-way scope selector on New Job
  // and the Mitigation / Reconstruction phase filter on JobDetail + Buckets.
  // Existing rows default to NULL (= 'both', legacy behavior).
  try { sqlite.exec(`ALTER TABLE jobs ADD COLUMN division TEXT`); } catch(_) {}

  // Live tech location fixes (owner/admin map overlay). One row per employee;
  // upserted on every geolocation ping and deleted on clock-out so techs
  // don't linger on the map after their shift.
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS tech_locations (
        employee_id INTEGER PRIMARY KEY,
        employee_name TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy_meters REAL,
        job_id INTEGER,
        captured_at TEXT NOT NULL
      )
    `);
  } catch(_) {}

  // ── MEGA-MIGRATION: 11-feature build (2026-07-30) ───────────────────────
  //
  // Escalation drafts outbox: universal table used by adjuster/carrier response
  // (#1), AR promise-to-pay (#2), COI nags (#16), and cert reminders (#18).
  // Every scheduled trigger inserts a row here; user reviews + one-clicks send.
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS escalation_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,           -- 'adjuster_silence' | 'ar_stalled' | 'coi_expiring' | 'cert_expiring' | 'weekly_ar_digest'
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        recipient_name TEXT,
        recipient_email TEXT,
        recipient_phone TEXT,
        related_job_id INTEGER,
        related_invoice_id INTEGER,
        related_contact_id INTEGER,
        related_employee_id INTEGER,
        related_coi_id INTEGER,
        related_cert_id INTEGER,
        status TEXT DEFAULT 'draft',  -- 'draft' | 'sent' | 'dismissed'
        sent_at TEXT,
        sent_by TEXT,
        dedupe_key TEXT UNIQUE,       -- e.g. 'adjuster_silence:job=17:day=2026-07-30'
        created_at TEXT NOT NULL
      )
    `);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_esc_status ON escalation_drafts(status, created_at DESC)`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_esc_type ON escalation_drafts(type)`);
  } catch(_) {}

  // #1: Adjuster contact log — real "last contact" tracking, decoupled from
  // invoice/payment dates. Every logged call/email/text writes a row and
  // powers the silence timer.
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS adjuster_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        adjuster_name TEXT,
        contacted_by TEXT NOT NULL,
        method TEXT NOT NULL,         -- 'call' | 'email' | 'text' | 'in_person' | 'other'
        direction TEXT DEFAULT 'outbound', -- 'inbound' | 'outbound'
        notes TEXT,
        contacted_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_adjcontact_job ON adjuster_contacts(job_id, contacted_at DESC)`);
  } catch(_) {}

  // #2: Invoice touch log — per-invoice "contacted" record + status upgrade.
  // Adds promise_to_pay / dispute / stalled to invoices without breaking
  // the existing draft|sent|paid|overdue enum.
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS invoice_touches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        touched_by TEXT NOT NULL,
        method TEXT NOT NULL,
        outcome TEXT,                 -- 'promise_to_pay' | 'disputed' | 'no_answer' | 'other'
        promise_date TEXT,            -- YYYY-MM-DD if outcome=promise_to_pay
        promise_amount REAL,
        notes TEXT,
        touched_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_inv_touch ON invoice_touches(invoice_id, touched_at DESC)`);
  } catch(_) {}
  try { sqlite.exec(`ALTER TABLE invoices ADD COLUMN followup_status TEXT`); } catch(_) {} // 'contacted'|'promised'|'disputed'|'stalled'
  try { sqlite.exec(`ALTER TABLE invoices ADD COLUMN last_touched_at TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE invoices ADD COLUMN promise_to_pay_date TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE invoices ADD COLUMN promise_to_pay_amount REAL`); } catch(_) {}

  // #9: last-touch tracking on partner contacts.
  try { sqlite.exec(`ALTER TABLE contacts ADD COLUMN last_touched_at TEXT`); } catch(_) {}

  // #13: per-job margin floor override (falls back to org default).
  try { sqlite.exec(`ALTER TABLE jobs ADD COLUMN margin_floor_pct REAL`); } catch(_) {}

  // #5: geofence radius per job (meters). Default 200 ft ≈ 61m.
  try { sqlite.exec(`ALTER TABLE jobs ADD COLUMN geofence_radius_m REAL DEFAULT 61`); } catch(_) {}

  // #16: extend coi_records to support W9 as a document type. w9 rows have
  // expiration_date = end of tax year; nag scheduler treats it uniformly.
  // (No schema change needed — document_type text field already supports it.)
  // Also add a "blocked" flag so dispatch-lock is explicit not derived.
  try { sqlite.exec(`ALTER TABLE contacts ADD COLUMN dispatch_blocked INTEGER DEFAULT 0`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE contacts ADD COLUMN dispatch_block_reason TEXT`); } catch(_) {}

  // #17: e-sign hardening — IP + user-agent + signed-PDF snapshot path.
  try { sqlite.exec(`ALTER TABLE job_documents ADD COLUMN signer_ip TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE job_documents ADD COLUMN signer_user_agent TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE job_documents ADD COLUMN signed_pdf_path TEXT`); } catch(_) {}

  // #12: storm_events — auto vs manual origin + external alert id.
  try { sqlite.exec(`ALTER TABLE storm_events ADD COLUMN origin TEXT DEFAULT 'manual'`); } catch(_) {} // 'manual' | 'noaa'
  try { sqlite.exec(`ALTER TABLE storm_events ADD COLUMN noaa_alert_id TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE storm_events ADD COLUMN noaa_severity TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE storm_events ADD COLUMN noaa_event TEXT`); } catch(_) {}

  // #18: external-document uploads for estimates and invoices.
  // Techs & PMs can drop a PDF/JPG written outside Titan Pro (Xactimate,
  // Symbility, a subcontractor's invoice, an insurance carrier's approval,
  // whatever) into the job's estimate or invoice list. `source = 'external'`
  // rows are minimal: just the file + total + vendor label. Internal rows
  // (source = 'internal' or NULL) keep the full line-items behavior.
  try { sqlite.exec(`ALTER TABLE estimates ADD COLUMN source TEXT DEFAULT 'internal'`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE estimates ADD COLUMN external_file_url TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE estimates ADD COLUMN external_file_key TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE estimates ADD COLUMN external_file_name TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE estimates ADD COLUMN external_file_mime TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE estimates ADD COLUMN external_file_size INTEGER`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE estimates ADD COLUMN external_vendor TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE estimates ADD COLUMN uploaded_by TEXT`); } catch(_) {}

  try { sqlite.exec(`ALTER TABLE invoices ADD COLUMN source TEXT DEFAULT 'internal'`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE invoices ADD COLUMN external_file_url TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE invoices ADD COLUMN external_file_key TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE invoices ADD COLUMN external_file_name TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE invoices ADD COLUMN external_file_mime TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE invoices ADD COLUMN external_file_size INTEGER`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE invoices ADD COLUMN external_vendor TEXT`); } catch(_) {}
  try { sqlite.exec(`ALTER TABLE invoices ADD COLUMN uploaded_by TEXT`); } catch(_) {}

  // Scheduler heartbeat table — tracks last run of each job so a restart
  // doesn't re-fire hourly tasks and we can see it's alive.
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS scheduler_runs (
        job_name TEXT PRIMARY KEY,
        last_run_at TEXT,
        last_status TEXT,
        last_summary TEXT
      )
    `);
  } catch(_) {}

  // ── Live Tech Locations ─────────────────────────────────────────────────────
  // POST /api/tech-locations/me
  //   Any authenticated active employee can push their own position. We use
  //   the session's employee identity — clients cannot spoof another tech.
  //   We refuse the write unless the employee has an open time_clock row,
  //   which means "off the clock" = no position leaks even if the browser
  //   somehow keeps firing.
  app.post("/api/tech-locations/me", requireStaffAuth, wrapAsync((req: any, res: any) => {
    const emp = req.employee;
    if (!emp?.id) return res.status(401).json({ error: "Unauthenticated" });

    const { latitude, longitude, accuracy } = req.body ?? {};
    if (typeof latitude !== "number" || typeof longitude !== "number"
        || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: "latitude and longitude required" });
    }

    // Must be clocked in — look up latest open time_clock row for this employee.
    const open: any = sqlite.prepare(
      "SELECT id, job_id FROM time_clock WHERE (employee_id = ? OR employee_name = ?) AND clock_out_at IS NULL ORDER BY id DESC LIMIT 1"
    ).get(emp.id, emp.name);
    if (!open) {
      // Silently succeed with a hint so client can stop pinging. Not an error
      // because it's normal for the tracker to still fire once after clock-out.
      return res.json({ ok: true, tracked: false, reason: "not_clocked_in" });
    }

    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO tech_locations (employee_id, employee_name, latitude, longitude, accuracy_meters, job_id, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(employee_id) DO UPDATE SET
        employee_name = excluded.employee_name,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        accuracy_meters = excluded.accuracy_meters,
        job_id = excluded.job_id,
        captured_at = excluded.captured_at
    `).run(emp.id, emp.name, latitude, longitude, Number.isFinite(accuracy) ? accuracy : null, open.job_id ?? null, now);

    res.json({ ok: true, tracked: true });
  }));

  // GET /api/tech-locations
  //   Owner/admin only. Returns each clocked-in tech's latest fix, filtered
  //   to fixes captured in the last 10 minutes (stale fixes are hidden so a
  //   frozen tab doesn't leave a ghost pin on the map).
  app.get("/api/tech-locations", requireRole("owner", "admin"), wrapAsync((_req: any, res: any) => {
    const cutoffMs = Date.now() - 10 * 60 * 1000;
    const rows: any[] = sqlite.prepare(`
      SELECT tl.*, j.job_number, j.address AS job_address
      FROM tech_locations tl
      LEFT JOIN jobs j ON j.id = tl.job_id
      WHERE tl.captured_at IS NOT NULL
    `).all();
    const fresh = rows.filter(r => {
      const t = Date.parse(r.captured_at);
      return Number.isFinite(t) && t >= cutoffMs;
    });
    res.json(fresh.map(r => ({
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      latitude: r.latitude,
      longitude: r.longitude,
      accuracyMeters: r.accuracy_meters,
      jobId: r.job_id,
      jobNumber: r.job_number,
      jobAddress: r.job_address,
      capturedAt: r.captured_at,
    })));
  }));


  // ── DocuSketch integration per job ──────────────────────────────────────────
  app.patch("/api/jobs/:id/docusketch", wrapAsync((req, res) => {
    const jobId = parseInt(req.params.id);
    const { docusketchUrl, docusketchProjectName, docusketchStatus, docusketchSketchUrl, docusketchNotes } = req.body;
    const job: any = sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const completedAt = docusketchStatus === "complete" && job.docusketch_status !== "complete"
      ? new Date().toISOString()
      : (docusketchStatus === "complete" ? job.docusketch_completed_at : null);

    sqlite.prepare(`UPDATE jobs SET
      docusketch_url = ?,
      docusketch_project_name = ?,
      docusketch_status = ?,
      docusketch_sketch_url = ?,
      docusketch_notes = ?,
      docusketch_completed_at = ?
      WHERE id = ?`).run(
        docusketchUrl ?? job.docusketch_url,
        docusketchProjectName ?? job.docusketch_project_name,
        docusketchStatus ?? job.docusketch_status,
        docusketchSketchUrl ?? job.docusketch_sketch_url,
        docusketchNotes ?? job.docusketch_notes,
        completedAt,
        jobId
    );
    const updated: any = sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    res.json(updated);
  }));


  // ══════════════════════════════════════════════════════════════════════════
  // INTEGRATIONS — shared kv-table + generic GET/PATCH settings API
  // Used by QuickBooks (see below) and any future third-party integration.
  // ══════════════════════════════════════════════════════════════════════════

  try { sqlite.exec(`CREATE TABLE IF NOT EXISTS integrations (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`); } catch(_) {}
  try { sqlite.exec(`CREATE TABLE IF NOT EXISTS qb_invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER, qb_invoice_id TEXT, qb_customer_id TEXT, status TEXT DEFAULT 'synced', synced_at TEXT, qb_link TEXT)`); } catch(_) {}
  try { sqlite.exec(`CREATE TABLE IF NOT EXISTS qb_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER, qb_payment_id TEXT, amount REAL, received_at TEXT, created_at TEXT)`); } catch(_) {}
  // Stripe Checkout sessions (test mode). status: open | paid | expired. payout_status: pending | in_transit | paid
  try { sqlite.exec(`CREATE TABLE IF NOT EXISTS stripe_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT UNIQUE, invoice_id INTEGER, contact_id INTEGER, amount REAL, currency TEXT DEFAULT 'usd', status TEXT DEFAULT 'open', payment_intent TEXT, card_brand TEXT, card_last4 TEXT, payout_status TEXT DEFAULT 'pending', payout_arrival TEXT, paid_at TEXT, created_at TEXT)`); } catch(_) {}

  // GET integration settings (owner/admin only — returns masked token)
  app.get("/api/integrations/:key", wrapAsync((req, res) => {
    const row: any = sqlite.prepare("SELECT * FROM integrations WHERE key = ?").get(req.params.key);
    if (!row) return res.json({ configured: false });
    const val = JSON.parse(row.value || "{}");
    // Mask sensitive fields
    if (val.apiKey) val.apiKeyMasked = "•".repeat(val.apiKey.length - 6) + val.apiKey.slice(-6);
    delete val.apiKey;
    if (val.clientSecret) { val.clientSecretMasked = "••••••" + val.clientSecret.slice(-4); delete val.clientSecret; }
    res.json({ configured: true, ...val, updatedAt: row.updated_at });
  }));

  // PATCH integration settings — save API keys
  app.patch("/api/integrations/:key", wrapAsync((req, res) => {
    const existing: any = sqlite.prepare("SELECT value FROM integrations WHERE key = ?").get(req.params.key);
    const current = existing ? JSON.parse(existing.value || "{}") : {};
    const merged = { ...current, ...req.body };
    sqlite.prepare("INSERT INTO integrations (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(req.params.key, JSON.stringify(merged), new Date().toISOString());
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // QUICKBOOKS INTEGRATION — Invoice sync + payment receive
  // ══════════════════════════════════════════════════════════════════════════

  // Reusable helper: push a Titan invoice to QuickBooks (Accounts Receivable).
  // Returns { ok, qbInvoiceId, qbLink } or throws with a friendly message.
  async function syncInvoiceToQb(invoiceId: number): Promise<{ ok: true; qbInvoiceId: string; qbLink: string; alreadySynced?: boolean }> {
    const cfg: any = sqlite.prepare("SELECT value FROM integrations WHERE key = 'quickbooks'").get();
    if (!cfg) throw new Error("QuickBooks not configured. Add credentials in Settings → Integrations.");
    const { accessToken, realmId } = JSON.parse(cfg.value || "{}");
    if (!accessToken || !realmId) throw new Error("QuickBooks not fully connected. Please complete OAuth setup.");

    // Idempotent: if already synced, return the existing link.
    const existing: any = sqlite.prepare("SELECT * FROM qb_invoices WHERE invoice_id = ?").get(invoiceId);
    if (existing?.qb_invoice_id) return { ok: true, qbInvoiceId: existing.qb_invoice_id, qbLink: existing.qb_link, alreadySynced: true };

    const inv: any = sqlite.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
    if (!inv) throw new Error("Invoice not found");
    const contact: any = inv.contact_id ? sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(inv.contact_id) : null;
    const lineItems: any[] = JSON.parse(inv.line_items || "[]");
    const now = new Date().toISOString();
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;

    // Build QBO Invoice payload. If the contact has an email, attach it so QBO
    // can email the invoice, and enable online (card/ACH) payment on the invoice.
    const qbInvoice: any = {
      Line: lineItems.length > 0 ? lineItems.map((li: any, i: number) => ({
        LineNum: i + 1,
        Amount: parseFloat(li.total || li.amount || 0),
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: "1", name: li.description || "Service" },
          Qty: li.quantity || 1,
          UnitPrice: li.unitPrice || li.total || 0,
        },
      })) : [{ Amount: inv.total || 0, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "1", name: "Restoration Services" }, Qty: 1, UnitPrice: inv.total || 0 } }],
      CustomerRef: { value: contact?.qb_customer_id || "1", name: contact?.name || "Customer" },
      DocNumber: inv.invoice_number,
      DueDate: inv.due_date,
      CustomerMemo: { value: `Titan Restoration LLC — ${inv.invoice_number}` },
      AllowOnlineCreditCardPayment: true,
      AllowOnlineACHPayment: true,
    };
    if (contact?.email) qbInvoice.BillEmail = { Address: contact.email };

    const resp = await fetch(`${baseUrl}/invoice?minorversion=65`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(qbInvoice),
    });
    const data = await resp.json() as any;
    if (!resp.ok) throw new Error(data?.Fault?.Error?.[0]?.Message || JSON.stringify(data));

    const qbInvId = data?.Invoice?.Id;
    const qbLink = `https://app.qbo.intuit.com/app/invoice?txnId=${qbInvId}`;
    sqlite.prepare("INSERT INTO qb_invoices (invoice_id, qb_invoice_id, qb_customer_id, status, synced_at, qb_link) VALUES (?, ?, ?, 'synced', ?, ?) ON CONFLICT DO NOTHING")
      .run(invoiceId, qbInvId, contact?.qb_customer_id, now, qbLink);
    return { ok: true, qbInvoiceId: qbInvId, qbLink };
  }

  // Reusable helper: email a synced QBO invoice to the customer via QuickBooks'
  // native send endpoint. Returns { sent, sentTo } or throws.
  async function sendQbInvoiceEmail(invoiceId: number, overrideEmail?: string): Promise<{ sent: boolean; sentTo?: string }> {
    const cfg: any = sqlite.prepare("SELECT value FROM integrations WHERE key = 'quickbooks'").get();
    const { accessToken, realmId } = JSON.parse(cfg?.value || "{}");
    if (!accessToken || !realmId) throw new Error("QuickBooks not connected.");
    const qbRow: any = sqlite.prepare("SELECT * FROM qb_invoices WHERE invoice_id = ?").get(invoiceId);
    if (!qbRow?.qb_invoice_id) throw new Error("Invoice not yet synced to QuickBooks.");
    const inv: any = sqlite.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
    const contact: any = inv?.contact_id ? sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(inv.contact_id) : null;
    const email = overrideEmail || contact?.email;
    if (!email) return { sent: false }; // no email on file — nothing to send to
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
    const resp = await fetch(`${baseUrl}/invoice/${qbRow.qb_invoice_id}/send?sendTo=${encodeURIComponent(email)}&minorversion=65`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/octet-stream", "Accept": "application/json" },
    });
    const data = await resp.json() as any;
    if (!resp.ok) throw new Error(data?.Fault?.Error?.[0]?.Message || "QuickBooks send failed");
    sqlite.prepare("UPDATE qb_invoices SET status = 'sent' WHERE invoice_id = ?").run(invoiceId);
    return { sent: true, sentTo: email };
  }

  // POST /api/qb/sync-invoice — push a Titan invoice to QuickBooks
  app.post("/api/qb/sync-invoice", wrapAsync(async (req, res) => {
    try {
      const result = await syncInvoiceToQb(Number(req.body.invoiceId));
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }));

  // POST /api/qb/create-and-send — create a Titan invoice, sync it to QuickBooks,
  // and email it to the customer from QuickBooks, all in one step.
  // Always creates the invoice even if QB is unavailable (graceful degradation).
  // body: same as POST /api/invoices, plus optional { sendToCustomer: true }
  app.post("/api/qb/create-and-send", wrapAsync(async (req, res) => {
    const { sendToCustomer = true, ...invoiceData } = req.body || {};
    // 1) Create the Titan invoice (single source of truth)
    const invoice: any = storage.createInvoice(invoiceData);
    const out: any = { invoice, synced: false, sent: false, qbLink: null, warnings: [] as string[] };

    // 2) Sync to QuickBooks
    try {
      const sync = await syncInvoiceToQb(invoice.id);
      out.synced = true;
      out.qbLink = sync.qbLink;
    } catch (err: any) {
      out.warnings.push(`Invoice created, but not synced to QuickBooks: ${err.message}`);
      return res.json(out); // can't send if not synced
    }

    // 3) Email it to the customer from QuickBooks
    if (sendToCustomer) {
      try {
        const sent = await sendQbInvoiceEmail(invoice.id);
        out.sent = sent.sent;
        out.sentTo = sent.sentTo;
        if (!sent.sent) out.warnings.push("Invoice synced to QuickBooks, but the customer has no email on file — add one to their contact to send automatically.");
      } catch (err: any) {
        out.warnings.push(`Invoice synced, but QuickBooks couldn't email it: ${err.message}`);
      }
    }
    res.json(out);
  }));

  // POST /api/qb/send-invoice — email an already-synced invoice to the customer
  app.post("/api/qb/send-invoice", wrapAsync(async (req, res) => {
    try {
      // Sync first if needed, then send
      await syncInvoiceToQb(Number(req.body.invoiceId));
      const sent = await sendQbInvoiceEmail(Number(req.body.invoiceId), req.body.email);
      if (!sent.sent) return res.status(400).json({ error: "No email on file for this customer. Add an email to their contact first." });
      res.json({ ok: true, sent: true, sentTo: sent.sentTo });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }));

  // POST /api/qb/send-payment-link — send QB payment link to customer email
  app.post("/api/qb/send-payment-link", wrapAsync(async (req, res) => {
    const { invoiceId } = req.body;
    const qbRow: any = sqlite.prepare("SELECT * FROM qb_invoices WHERE invoice_id = ?").get(invoiceId);
    if (!qbRow) return res.status(400).json({ error: "Invoice not yet synced to QuickBooks. Sync first." });
    // In production: use QBO email endpoint. Here we return the link for manual send or email module.
    res.json({ ok: true, paymentLink: qbRow.qb_link, message: "Share this link with your customer to pay via QuickBooks." });
  }));

  // GET /api/qb/invoices — list synced invoices
  app.get("/api/qb/invoices", wrapAsync((req, res) => {
    const rows = sqlite.prepare("SELECT qi.*, i.invoice_number, i.total, i.status FROM qb_invoices qi LEFT JOIN invoices i ON qi.invoice_id = i.id ORDER BY qi.synced_at DESC").all();
    res.json(rows);
  }));

  // GET /api/qb/invoice-status — per-invoice QB sync + payment state for the Invoices UI
  app.get("/api/qb/invoice-status", wrapAsync((req, res) => {
    const rows = sqlite.prepare("SELECT invoice_id, qb_invoice_id, qb_link, status FROM qb_invoices").all() as any[];
    const pays = sqlite.prepare("SELECT invoice_id, amount, received_at FROM qb_payments").all() as any[];
    const map: Record<string, any> = {};
    rows.forEach(r => { map[r.invoice_id] = { synced: true, qbInvoiceId: r.qb_invoice_id, qbLink: r.qb_link, qbStatus: r.status }; });
    pays.forEach(p => { if (map[p.invoice_id]) { map[p.invoice_id].paidInQb = true; map[p.invoice_id].paidAmount = p.amount; map[p.invoice_id].receivedAt = p.received_at; } });
    res.json(map);
  }));

  // Refresh a QuickBooks access token using the stored refresh token. Returns the
  // (possibly refreshed) access token, or null if QB isn't fully connected.
  async function qbAccessToken(): Promise<{ accessToken: string; realmId: string } | null> {
    const cfg: any = sqlite.prepare("SELECT value FROM integrations WHERE key = 'quickbooks'").get();
    if (!cfg) return null;
    const v = JSON.parse(cfg.value || "{}");
    if (!v.realmId || !v.refreshToken || !v.clientId || !v.clientSecret) {
      return v.accessToken && v.realmId ? { accessToken: v.accessToken, realmId: v.realmId } : null;
    }
    try {
      const r = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(`${v.clientId}:${v.clientSecret}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: v.refreshToken }).toString(),
      });
      const t = await r.json() as any;
      if (!r.ok || !t.access_token) return v.accessToken ? { accessToken: v.accessToken, realmId: v.realmId } : null;
      const updated = { ...v, accessToken: t.access_token, refreshToken: t.refresh_token || v.refreshToken, connectedAt: new Date().toISOString() };
      sqlite.prepare("INSERT INTO integrations (key, value, updated_at) VALUES ('quickbooks', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .run(JSON.stringify(updated), new Date().toISOString());
      return { accessToken: t.access_token, realmId: v.realmId };
    } catch {
      return v.accessToken ? { accessToken: v.accessToken, realmId: v.realmId } : null;
    }
  }

  // POST /api/qb/receive-payment — pull payment status from QuickBooks for a synced
  // invoice. If QB shows it paid (balance 0), record a `received` payment in Titan
  // and mark the invoice paid. This is how customer payments made in QuickBooks
  // (card/ACH via the QBO pay link) flow back into Titan Pro.
  app.post("/api/qb/receive-payment", wrapAsync(async (req, res) => {
    const { invoiceId } = req.body;
    const qbRow: any = sqlite.prepare("SELECT * FROM qb_invoices WHERE invoice_id = ?").get(invoiceId);
    if (!qbRow || !qbRow.qb_invoice_id) return res.status(400).json({ error: "Invoice not yet synced to QuickBooks. Sync it first." });

    const auth = await qbAccessToken();
    if (!auth) return res.status(400).json({ error: "QuickBooks not connected. Connect it in Settings \u2192 Integrations." });

    const inv: any = sqlite.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
    if (!inv) return res.status(404).json({ error: "Invoice not found" });

    try {
      // Read the invoice back from QBO to check its outstanding Balance.
      const url = `https://quickbooks.api.intuit.com/v3/company/${auth.realmId}/invoice/${qbRow.qb_invoice_id}?minorversion=65`;
      const r = await fetch(url, { headers: { "Authorization": `Bearer ${auth.accessToken}`, "Accept": "application/json" } });
      const data = await r.json() as any;
      if (!r.ok) throw new Error(data?.Fault?.Error?.[0]?.Message || `QuickBooks returned ${r.status}`);

      const qbInv = data?.Invoice || {};
      const totalAmt = Number(qbInv.TotalAmt ?? inv.total ?? 0);
      const balance = Number(qbInv.Balance ?? totalAmt);
      const paidAmount = Math.round((totalAmt - balance) * 100) / 100;

      if (balance > 0.005) {
        // Not fully paid yet — report current state without recording anything.
        return res.json({ ok: true, paid: false, balance, totalAmt, paidAmount, message: paidAmount > 0 ? `Partially paid in QuickBooks ($${paidAmount.toLocaleString()} of $${totalAmt.toLocaleString()}). Balance $${balance.toLocaleString()} still due.` : "No payment recorded in QuickBooks yet." });
      }

      // Fully paid in QB — reconcile into Titan (idempotent: skip if already recorded).
      const already: any = sqlite.prepare("SELECT * FROM qb_payments WHERE invoice_id = ?").get(invoiceId);
      const now = new Date().toISOString();
      if (!already) {
        storage.createPayment({
          invoiceId, amount: totalAmt, method: "quickbooks", type: "received",
          contactId: inv.contact_id || null, jobId: inv.job_id || null,
          reference: `QuickBooks payment \u2014 ${inv.invoice_number}`,
        } as any);
        sqlite.prepare("INSERT INTO qb_payments (invoice_id, qb_payment_id, amount, received_at, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(invoiceId, qbInv.Id || null, totalAmt, now, now);
        sqlite.prepare("UPDATE qb_invoices SET status = 'paid' WHERE invoice_id = ?").run(invoiceId);
      }
      storage.updateInvoice(invoiceId, { status: "paid", paidAt: now });

      res.json({ ok: true, paid: true, amount: totalAmt, alreadyRecorded: !!already, message: already ? "Payment was already reconciled from QuickBooks." : `Payment of $${totalAmt.toLocaleString()} received from QuickBooks and recorded.` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  // POST /api/qb/oauth/start — initiate QuickBooks OAuth flow
  app.get("/api/qb/oauth/start", (req, res) => {
    const cfg: any = sqlite.prepare("SELECT value FROM integrations WHERE key = 'quickbooks'").get();
    if (!cfg) return res.status(400).json({ error: "QuickBooks client ID not configured." });
    const { clientId } = JSON.parse(cfg.value || "{}");
    if (!clientId) return res.status(400).json({ error: "QuickBooks client ID not set." });
    const redirectUri = encodeURIComponent(`${req.protocol}://${req.get("host")}/api/qb/oauth/callback`);
    const scope = encodeURIComponent("com.intuit.quickbooks.accounting");
    const state = "titan_pro_qb";
    const authUrl = `https://appcenter.intuit.com/connect/oauth2?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`;
    res.json({ authUrl });
  });

  // GET /api/qb/oauth/callback
  app.get("/api/qb/oauth/callback", wrapAsync(async (req, res) => {
    const { code, realmId } = req.query as any;
    const cfg: any = sqlite.prepare("SELECT value FROM integrations WHERE key = 'quickbooks'").get();
    if (!cfg) return res.status(400).send("QuickBooks not configured");
    const { clientId, clientSecret } = JSON.parse(cfg.value || "{}");
    const redirectUri = `${req.protocol}://${req.get("host")}/api/qb/oauth/callback`;

    try {
      const tokenResp = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString(),
      });
      const tokens = await tokenResp.json() as any;
      const existing: any = sqlite.prepare("SELECT value FROM integrations WHERE key = 'quickbooks'").get();
      const current = existing ? JSON.parse(existing.value) : {};
      const updated = { ...current, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, realmId, connectedAt: new Date().toISOString() };
      sqlite.prepare("INSERT INTO integrations (key, value, updated_at) VALUES ('quickbooks', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .run(JSON.stringify(updated), new Date().toISOString());
      res.send(`<html><body><script>window.close();</script><p>QuickBooks connected! You can close this window.</p></body></html>`);
    } catch (err: any) {
      res.status(500).send("OAuth error: " + err.message);
    }
  }));


  // ══════════════════════════════════════════════════════════════════════════
  // STRIPE CHECKOUT — Customer-portal "Pay Now" (TEST MODE)
  // ------------------------------------------------------------------------
  // Set STRIPE_SECRET_KEY (sk_test_...) in the environment to use the REAL
  // Stripe Checkout API. When absent, the app runs a faithful *simulated*
  // Stripe Checkout so the entire experience is testable end-to-end. Swapping
  // to live/real Stripe is a one-line change (add the env key) — the rest of
  // the flow (session create → hosted checkout → verify → record payment →
  // payout timeline) is identical.
  // ══════════════════════════════════════════════════════════════════════════
  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "";
  const STRIPE_LIVE = STRIPE_KEY.startsWith("sk_");
  const fmtUsd = (n: number) => (n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

  // POST /api/customer-portal/stripe/create-checkout
  // body: { invoiceId, contactId }  → returns { checkoutUrl, sessionId, simulated }
  app.post("/api/customer-portal/stripe/create-checkout", wrapAsync(async (req, res) => {
    const { invoiceId, contactId } = req.body || {};
    if (!portalOwnsContact(req, Number(contactId)))
      return res.status(403).json({ error: "Not authorized to pay on this account." });
    const invoice: any = sqlite.prepare("SELECT * FROM invoices WHERE id = ?").get(Number(invoiceId));
    if (!invoice) return res.status(404).json({ error: "Invoice not found." });
    if (invoice.status === "paid") return res.status(400).json({ error: "This invoice is already paid." });
    const amount = Number(invoice.total || 0);
    if (!(amount > 0)) return res.status(400).json({ error: "Invoice has no balance due." });
    const now = new Date().toISOString();
    const origin = `${req.protocol}://${req.get("host")}`;

    if (STRIPE_LIVE) {
      // Real Stripe Checkout Session
      const params = new URLSearchParams();
      params.append("mode", "payment");
      params.append("line_items[0][price_data][currency]", "usd");
      params.append("line_items[0][price_data][product_data][name]", `Invoice ${invoice.invoice_number || invoiceId} — Titan Restoration`);
      params.append("line_items[0][price_data][unit_amount]", String(Math.round(amount * 100)));
      params.append("line_items[0][quantity]", "1");
      params.append("metadata[invoiceId]", String(invoiceId));
      params.append("metadata[contactId]", String(contactId));
      params.append("success_url", `${origin}/api/customer-portal/stripe/return?session_id={CHECKOUT_SESSION_ID}`);
      params.append("cancel_url", `${origin}/api/customer-portal/stripe/return?session_id={CHECKOUT_SESSION_ID}&canceled=1`);
      const sResp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${STRIPE_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const s = await sResp.json() as any;
      if (s.error) return res.status(400).json({ error: s.error.message });
      sqlite.prepare("INSERT INTO stripe_sessions (session_id, invoice_id, contact_id, amount, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)")
        .run(s.id, Number(invoiceId), Number(contactId), amount, now);
      return res.json({ checkoutUrl: s.url, sessionId: s.id, simulated: false });
    }

    // Simulated Stripe Checkout — create a session and point to our hosted checkout page
    const sessionId = `cs_test_sim_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sqlite.prepare("INSERT INTO stripe_sessions (session_id, invoice_id, contact_id, amount, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)")
      .run(sessionId, Number(invoiceId), Number(contactId), amount, now);
    const checkoutUrl = `${origin}/api/customer-portal/stripe/checkout?session_id=${sessionId}`;
    res.json({ checkoutUrl, sessionId, simulated: true });
  }));

  // GET /api/customer-portal/stripe/checkout?session_id=...
  // Simulated Stripe-hosted checkout page (test mode). Renders a Stripe-like
  // card form; on submit it marks the session paid and redirects back.
  app.get("/api/customer-portal/stripe/checkout", (req, res) => {
    const sessionId = String(req.query.session_id || "");
    const s: any = sqlite.prepare("SELECT * FROM stripe_sessions WHERE session_id = ?").get(sessionId);
    if (!s) return res.status(404).send("Checkout session not found.");
    const inv: any = sqlite.prepare("SELECT * FROM invoices WHERE id = ?").get(s.invoice_id);
    const invNum = inv?.invoice_number || `#${s.invoice_id}`;
    const amt = fmtUsd(s.amount);
    const origin = `${req.protocol}://${req.get("host")}`;
    const alreadyPaid = s.status === "paid";
    res.set("Content-Type", "text/html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Checkout — Titan Restoration</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f9fc;color:#30313d;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px}
  .wrap{width:100%;max-width:420px}
  .test-banner{background:#0a2540;color:#fff;font-size:12px;font-weight:600;text-align:center;padding:7px;border-radius:8px 8px 0 0;letter-spacing:.02em}
  .card{background:#fff;border:1px solid #e6e6e6;border-top:none;border-radius:0 0 12px 12px;box-shadow:0 4px 24px rgba(0,0,0,.06);overflow:hidden}
  .head{padding:24px 28px 8px}
  .merchant{font-size:13px;color:#6b7280;font-weight:600}
  .amt{font-size:30px;font-weight:700;margin-top:2px;color:#0a2540}
  .desc{font-size:13px;color:#6b7280;margin-top:2px}
  form{padding:8px 28px 28px}
  label{display:block;font-size:12px;font-weight:600;color:#4b5563;margin:14px 0 5px}
  .inp{width:100%;padding:11px 12px;border:1px solid #d0d5dd;border-radius:8px;font-size:14px;outline:none;transition:border .15s,box-shadow .15s}
  .inp:focus{border-color:#635bff;box-shadow:0 0 0 3px rgba(99,91,255,.15)}
  .row{display:flex;gap:10px}.row .inp{flex:1}
  .pay{width:100%;margin-top:20px;padding:12px;background:#635bff;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;transition:background .15s}
  .pay:hover{background:#4d47cc}.pay:disabled{opacity:.6;cursor:not-allowed}
  .hint{font-size:11px;color:#8792a2;margin-top:14px;line-height:1.5;text-align:center}
  .lock{font-size:11px;color:#6b7280;text-align:center;margin-top:16px}
  .powered{font-size:11px;color:#8792a2;text-align:center;margin-top:10px}
  .powered b{color:#635bff}
  .fill{background:#f0eeff;border-color:#635bff}
  .cancel{display:block;text-align:center;margin-top:14px;font-size:13px;color:#635bff;text-decoration:none}
</style></head>
<body><div class="wrap">
  <div class="test-banner">TEST MODE — No real charge will be made</div>
  <div class="card">
    <div class="head">
      <div class="merchant">Titan Restoration LLC</div>
      <div class="amt">${amt}</div>
      <div class="desc">Invoice ${invNum}</div>
    </div>
    <form id="f">
      <label>Email</label>
      <input class="inp" id="email" type="email" placeholder="you@example.com" value="customer@example.com">
      <label>Card information</label>
      <input class="inp" id="card" inputmode="numeric" placeholder="4242 4242 4242 4242">
      <div class="row" style="margin-top:8px">
        <input class="inp" id="exp" placeholder="MM / YY">
        <input class="inp" id="cvc" placeholder="CVC">
      </div>
      <label>Name on card</label>
      <input class="inp" id="name" placeholder="Full name" value="Test Customer">
      <button class="pay" id="pay" type="submit">${alreadyPaid ? "Already paid — return" : "Pay " + amt}</button>
      <div class="hint">Use test card <b>4242 4242 4242 4242</b>, any future expiry, any CVC.<br>Tap "Autofill test card" to fill it in.</div>
      <a class="cancel" href="${origin}/api/customer-portal/stripe/return?session_id=${sessionId}&canceled=1">Cancel and return</a>
      <div class="powered">Powered by <b>stripe</b> · Terms · Privacy</div>
    </form>
  </div>
</div>
<script>
  var card=document.getElementById('card'),exp=document.getElementById('exp'),cvc=document.getElementById('cvc');
  // Autofill helper: clicking the hint fills the test card
  document.querySelector('.hint').addEventListener('click',function(){card.value='4242 4242 4242 4242';exp.value='12 / 34';cvc.value='123';card.classList.add('fill');exp.classList.add('fill');cvc.classList.add('fill');});
  card.addEventListener('input',function(e){var v=e.target.value.replace(/\\D/g,'').slice(0,16);e.target.value=v.replace(/(.{4})/g,'$1 ').trim();});
  exp.addEventListener('input',function(e){var v=e.target.value.replace(/\\D/g,'').slice(0,4);e.target.value=v.length>2?v.slice(0,2)+' / '+v.slice(2):v;});
  cvc.addEventListener('input',function(e){e.target.value=e.target.value.replace(/\\D/g,'').slice(0,4);});
  document.getElementById('f').addEventListener('submit',function(ev){
    ev.preventDefault();
    var btn=document.getElementById('pay');
    var num=card.value.replace(/\\s/g,'');
    if(${alreadyPaid ? "true" : "false"}){window.location.href='${origin}/api/customer-portal/stripe/return?session_id=${sessionId}';return;}
    if(num.length<15){card.classList.add('fill');card.focus();card.style.borderColor='#df1b41';return;}
    btn.disabled=true;btn.textContent='Processing…';
    fetch('${origin}/api/customer-portal/stripe/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:'${sessionId}',card:num})})
      .then(function(r){return r.json();})
      .then(function(d){window.location.href='${origin}/api/customer-portal/stripe/return?session_id=${sessionId}';})
      .catch(function(){btn.disabled=false;btn.textContent='Pay ${amt}';});
  });
</script>
</body></html>`);
  });

  // POST /api/customer-portal/stripe/complete  (simulated card submission)
  // body: { session_id, card } → marks the session paid (idempotent)
  app.post("/api/customer-portal/stripe/complete", (req, res) => {
    const { session_id, card } = req.body || {};
    const s: any = sqlite.prepare("SELECT * FROM stripe_sessions WHERE session_id = ?").get(String(session_id));
    if (!s) return res.status(404).json({ error: "Session not found." });
    if (s.status === "paid") return res.json({ ok: true, alreadyPaid: true });
    const last4 = String(card || "4242424242424242").replace(/\D/g, "").slice(-4) || "4242";
    const now = new Date().toISOString();
    // Simulated payout arrival: Stripe standard payout ~2 business days
    const arrival = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    sqlite.prepare("UPDATE stripe_sessions SET status='paid', payment_intent=?, card_brand='visa', card_last4=?, paid_at=?, payout_status='pending', payout_arrival=? WHERE session_id=?")
      .run(`pi_test_sim_${Date.now()}`, last4, now, arrival, String(session_id));
    res.json({ ok: true });
  });

  // Shared helper: finalize a paid session → record payment + mark invoice paid (idempotent)
  function finalizeStripeSession(s: any): { recorded: boolean } {
    const existing: any = sqlite.prepare("SELECT id FROM payments WHERE reference = ?").get(`stripe:${s.session_id}`);
    if (existing) return { recorded: false };
    storage.createPayment({
      invoiceId: s.invoice_id, jobId: null, contactId: s.contact_id,
      type: "received", amount: s.amount, method: "credit_card",
      reference: `stripe:${s.session_id}`,
      notes: `Stripe Checkout${STRIPE_LIVE ? "" : " (test mode)"} · card ending ${s.card_last4 || "4242"}`,
      paidAt: s.paid_at || new Date().toISOString(),
    } as any);
    if (s.invoice_id) storage.updateInvoice(s.invoice_id, { status: "paid", paidAt: s.paid_at || new Date().toISOString() });
    return { recorded: true };
  }

  // GET /api/customer-portal/stripe/return?session_id=...  (redirect target)
  // Verifies session, finalizes payment, and renders a tiny page that signals
  // the opener (portal) and closes, or shows a status if opened directly.
  app.get("/api/customer-portal/stripe/return", (req, res) => {
    const sessionId = String(req.query.session_id || "");
    const canceled = String(req.query.canceled || "") === "1";
    const s: any = sqlite.prepare("SELECT * FROM stripe_sessions WHERE session_id = ?").get(sessionId);
    let outcome = "error";
    if (s) {
      if (s.status === "paid") { finalizeStripeSession(s); outcome = "paid"; }
      else if (canceled) outcome = "canceled";
      else outcome = "pending";
    }
    const msg = outcome === "paid" ? "Payment successful" : outcome === "canceled" ? "Payment canceled" : "Returning to portal…";
    res.set("Content-Type", "text/html").send(`<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:-apple-system,sans-serif;background:#f6f9fc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#0a2540}.b{text-align:center}.c{font-size:44px}</style></head>
<body><div class="b"><div class="c">${outcome === "paid" ? "✅" : outcome === "canceled" ? "↩️" : "⏳"}</div><p>${msg}</p><p style="font-size:13px;color:#6b7280">You can close this window.</p></div>
<script>try{if(window.opener){window.opener.postMessage({type:'stripe-checkout',outcome:'${outcome}',sessionId:'${sessionId}'},'*');setTimeout(function(){window.close();},900);}}catch(e){}</script>
</body></html>`);
  });

  // GET /api/customer-portal/stripe/session/:sessionId — poll session status
  app.get("/api/customer-portal/stripe/session/:sessionId", (req, res) => {
    const s: any = sqlite.prepare("SELECT * FROM stripe_sessions WHERE session_id = ?").get(String(req.params.sessionId));
    if (!s) return res.status(404).json({ error: "Session not found." });
    if (s.status === "paid") finalizeStripeSession(s);
    res.json({
      sessionId: s.session_id, status: s.status, amount: s.amount,
      invoiceId: s.invoice_id, cardLast4: s.card_last4, paidAt: s.paid_at,
      payoutStatus: s.payout_status, payoutArrival: s.payout_arrival, simulated: !STRIPE_LIVE,
    });
  });

  // GET /api/customer-portal/stripe/payouts/:contactId — payout timeline for this customer's payments
  app.get("/api/customer-portal/stripe/payouts/:contactId", (req, res) => {
    const contactId = Number(req.params.contactId);
    if (!portalOwnsContact(req, contactId))
      return res.status(403).json({ error: "Not authorized to view this account." });
    const rows = sqlite.prepare("SELECT * FROM stripe_sessions WHERE contact_id = ? AND status = 'paid' ORDER BY paid_at DESC").all(contactId) as any[];
    res.json(rows.map((r) => stripePayoutView(r)));
  });

  // GET /api/stripe/payouts — owner-facing: ALL Stripe payouts to the company bank
  app.get("/api/stripe/payouts", (req, res) => {
    const rows = sqlite.prepare("SELECT * FROM stripe_sessions WHERE status = 'paid' ORDER BY paid_at DESC").all() as any[];
    const views = rows.map((r) => stripePayoutView(r));
    const totals = views.reduce((acc: any, v: any) => {
      acc.gross += v.amount; acc.fee += v.fee; acc.net += v.net;
      acc[v.payoutStatus] = (acc[v.payoutStatus] || 0) + v.net;
      return acc;
    }, { gross: 0, fee: 0, net: 0 });
    res.json({ payouts: views, totals, simulated: !STRIPE_LIVE });
  });

  // Compute a payout view for a paid session, auto-advancing the simulated
  // payout status over time (pending → in_transit → paid) like real Stripe payouts.
  function stripePayoutView(r: any) {
    const paidAtMs = r.paid_at ? new Date(r.paid_at).getTime() : Date.now();
    const ageHrs = (Date.now() - paidAtMs) / 36e5;
    // Simulated timeline: funds captured now → in transit after ~24h → deposited after ~48h
    let payoutStatus = r.payout_status || "pending";
    if (!STRIPE_LIVE) {
      if (ageHrs >= 48) payoutStatus = "paid";
      else if (ageHrs >= 24) payoutStatus = "in_transit";
      else payoutStatus = "pending";
      if (payoutStatus !== r.payout_status) {
        try { sqlite.prepare("UPDATE stripe_sessions SET payout_status=? WHERE id=?").run(payoutStatus, r.id); } catch (_) {}
      }
    }
    const fee = Math.round((r.amount * 0.029 + 0.30) * 100) / 100; // Stripe 2.9% + $0.30
    const net = Math.round((r.amount - fee) * 100) / 100;
    const inv: any = sqlite.prepare("SELECT invoice_number FROM invoices WHERE id = ?").get(r.invoice_id);
    return {
      sessionId: r.session_id, invoiceId: r.invoice_id, invoiceNumber: inv?.invoice_number || null,
      amount: r.amount, fee, net, cardLast4: r.card_last4, paidAt: r.paid_at,
      payoutStatus, payoutArrival: r.payout_arrival,
    };
  }


  // ══════════════════════════════════════════════════════════════════════════
  // PAYMENT REMINDERS — email dunning engine (cadence-driven)
  // Sends escalating reminder emails on unpaid invoices as they age past their
  // due date. Cadence is configurable; each send is logged to invoice_reminders
  // (deduped per invoice+step) and mirrored into the Emails "sent" folder.
  // ══════════════════════════════════════════════════════════════════════════
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS invoice_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      contact_id INTEGER,
      step_days INTEGER NOT NULL,
      days_overdue INTEGER NOT NULL,
      amount REAL,
      channel TEXT DEFAULT 'email',
      to_email TEXT,
      subject TEXT,
      body TEXT,
      status TEXT DEFAULT 'sent',
      sent_at TEXT NOT NULL
    )`);
  } catch (_) {}

  // Default cadence: days-past-due at which each escalating reminder fires.
  const DEFAULT_REMINDER_SETTINGS = {
    enabled: true,
    steps: [
      { days: 7,  tone: "friendly",  label: "Friendly reminder" },
      { days: 14, tone: "firm",      label: "Second notice" },
      { days: 30, tone: "urgent",    label: "Past-due notice" },
      { days: 45, tone: "final",     label: "Final notice" },
    ],
    fromEmail: "cody@titanrestorationllc.com",
    companyName: "Titan Restoration LLC",
    companyPhone: "706-922-0154",
  };

  function readReminderSettings(): any {
    try {
      const row: any = sqlite.prepare("SELECT value FROM integrations WHERE key = 'reminder_settings'").get();
      if (row && row.value) return { ...DEFAULT_REMINDER_SETTINGS, ...JSON.parse(row.value) };
    } catch (_) {}
    return DEFAULT_REMINDER_SETTINGS;
  }

  function money(n: number): string {
    return "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Compute the effective "clock start" for overdue math: prefer due date,
  // fall back to created date. Returns days past that date (can be negative).
  function invoiceDaysOverdue(inv: any): number {
    const base = inv.due_date ? new Date(inv.due_date).getTime()
               : (inv.created_at ? new Date(inv.created_at).getTime() : null);
    if (!base) return -9999;
    return Math.floor((Date.now() - base) / 86400000);
  }

  // Build the reminder email content for a given step tone.
  function buildReminderEmail(inv: any, contact: any, step: any, daysOverdue: number, s: any) {
    const name = contact?.name || "Valued Customer";
    const num = inv.invoice_number || `#${inv.id}`;
    const amt = money(inv.total);
    const portal = "your customer portal";
    const sign = `\n\nThank you,\n${s.companyName}\n${s.companyPhone}`;
    let subject: string, body: string;
    switch (step.tone) {
      case "firm":
        subject = `Second notice: Invoice ${num} (${amt}) is ${daysOverdue} days past due`;
        body = `Hi ${name},\n\nWe wanted to follow up on invoice ${num} for ${amt}, which is now ${daysOverdue} days past due. If payment is already on its way, thank you — please disregard. Otherwise you can pay securely online through ${portal}.` + sign;
        break;
      case "urgent":
        subject = `Past-due: Invoice ${num} (${amt}) — ${daysOverdue} days overdue`;
        body = `Hi ${name},\n\nInvoice ${num} for ${amt} is now ${daysOverdue} days past due. Please arrange payment at your earliest convenience to keep your account in good standing. You can pay online through ${portal}, or call us to make arrangements.` + sign;
        break;
      case "final":
        subject = `FINAL NOTICE: Invoice ${num} (${amt}) — ${daysOverdue} days overdue`;
        body = `Hi ${name},\n\nThis is a final notice regarding invoice ${num} for ${amt}, now ${daysOverdue} days past due. Please remit payment immediately to avoid further collection steps. If you believe this is in error or need to discuss a payment plan, contact us right away at ${s.companyPhone}.` + sign;
        break;
      default: // friendly
        subject = `Friendly reminder: Invoice ${num} (${amt}) is due`;
        body = `Hi ${name},\n\nJust a friendly reminder that invoice ${num} for ${amt} is now ${daysOverdue} days past its due date. You can pay securely online through ${portal} whenever it's convenient. Thanks for your business!` + sign;
    }
    return { subject, body };
  }

  // Determine, for each unpaid non-draft invoice, the highest cadence step it
  // qualifies for that has NOT yet been sent.
  function computeReminderQueue() {
    const s = readReminderSettings();
    const steps = [...(s.steps || [])].sort((a: any, b: any) => a.days - b.days);
    const invoices = sqlite.prepare(
      "SELECT * FROM invoices WHERE status != 'paid' AND status != 'draft'"
    ).all() as any[];
    const contacts = sqlite.prepare("SELECT * FROM contacts").all() as any[];
    const queue: any[] = [];
    for (const inv of invoices) {
      const daysOverdue = invoiceDaysOverdue(inv);
      if (daysOverdue < (steps[0]?.days ?? 7)) continue;
      // Highest step whose threshold has passed.
      const eligible = steps.filter((st: any) => daysOverdue >= st.days);
      if (!eligible.length) continue;
      const step = eligible[eligible.length - 1];
      const already = sqlite.prepare(
        "SELECT id FROM invoice_reminders WHERE invoice_id = ? AND step_days = ?"
      ).get(inv.id, step.days);
      const contact = contacts.find((c: any) => c.id === inv.contact_id);
      queue.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        contactId: inv.contact_id,
        contactName: contact?.name || null,
        toEmail: contact?.email || null,
        amount: inv.total,
        dueDate: inv.due_date,
        daysOverdue,
        step,
        alreadySent: !!already,
      });
    }
    // Sort most overdue first.
    queue.sort((a, b) => b.daysOverdue - a.daysOverdue);
    return { settings: s, queue };
  }

  // Send one reminder for a specific invoice + step. Records email + log row.
  function sendOneReminder(item: any, s: any) {
    const inv: any = sqlite.prepare("SELECT * FROM invoices WHERE id = ?").get(item.invoiceId);
    if (!inv) throw new Error("Invoice not found");
    const contact: any = item.contactId ? sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(item.contactId) : null;
    const toEmail = contact?.email || null;
    const { subject, body } = buildReminderEmail(inv, contact, item.step, item.daysOverdue, s);
    const nowIso = new Date().toISOString();
    const status = toEmail ? "sent" : "skipped_no_email";
    if (toEmail) {
      try {
        storage.createEmail({ folder: "sent", from: s.fromEmail, to: toEmail, subject, body, read: 1 } as any);
      } catch (_) {}
    }
    sqlite.prepare(
      `INSERT INTO invoice_reminders (invoice_id, contact_id, step_days, days_overdue, amount, channel, to_email, subject, body, status, sent_at)
       VALUES (?, ?, ?, ?, ?, 'email', ?, ?, ?, ?, ?)`
    ).run(inv.id, item.contactId || null, item.step.days, item.daysOverdue, inv.total, toEmail, subject, body, status, nowIso);
    return { invoiceId: inv.id, invoiceNumber: inv.invoice_number, step: item.step, status, toEmail, subject };
  }

  // GET settings
  app.get("/api/reminders/settings", requireRole("owner", "admin"), (_req, res) => {
    res.json(readReminderSettings());
  });
  // PUT settings
  app.put("/api/reminders/settings", requireRole("owner", "admin"), (req, res) => {
    const merged = { ...readReminderSettings(), ...req.body };
    sqlite.prepare(
      "INSERT INTO integrations (key, value, updated_at) VALUES ('reminder_settings', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
    ).run(JSON.stringify(merged), new Date().toISOString());
    res.json(merged);
  });

  // GET the current reminder queue (who is due for what step, and whether sent)
  app.get("/api/reminders/queue", requireRole("owner", "admin"), (_req, res) => {
    res.json(computeReminderQueue());
  });

  // GET reminder history (log)
  app.get("/api/reminders/history", requireRole("owner", "admin"), (_req, res) => {
    const rows = sqlite.prepare(
      `SELECT r.*, i.invoice_number, c.name as contact_name
       FROM invoice_reminders r
       LEFT JOIN invoices i ON r.invoice_id = i.id
       LEFT JOIN contacts c ON r.contact_id = c.id
       ORDER BY r.sent_at DESC LIMIT 200`
    ).all();
    res.json(rows);
  });

  // POST send a single reminder for a specific invoice + step
  app.post("/api/reminders/send", requireRole("owner", "admin"), (req, res) => {
    const { invoiceId, stepDays } = req.body || {};
    if (!invoiceId) return res.status(400).json({ error: "invoiceId required" });
    const { settings, queue } = computeReminderQueue();
    const item = queue.find((q: any) => q.invoiceId === Number(invoiceId) && (stepDays == null || q.step.days === Number(stepDays)));
    if (!item) return res.status(404).json({ error: "No pending reminder for that invoice" });
    if (item.alreadySent) return res.status(409).json({ error: "Reminder for this step already sent" });
    const result = sendOneReminder(item, settings);
    res.json(result);
  });

  // POST run the engine — send every pending reminder in the queue
  app.post("/api/reminders/run", requireRole("owner", "admin"), (req, res) => {
    const { settings, queue } = computeReminderQueue();
    if (settings.enabled === false && !req.body?.force) {
      return res.json({ sent: [], skipped: queue.length, disabled: true });
    }
    const pending = queue.filter((q: any) => !q.alreadySent);
    const sent: any[] = [];
    for (const item of pending) sent.push(sendOneReminder(item, settings));
    res.json({ sent, count: sent.length, considered: queue.length });
  });


  // ══════════════════════════════════════════════════════════════════════════
  // PAYMENT RECONCILIATION — Stripe payouts ↔ invoices ↔ QuickBooks status
  // One view that matches money across systems and surfaces gaps:
  //  • Stripe captured a payment but the invoice isn't marked paid
  //  • Invoice is paid but never synced/marked paid in QuickBooks
  //  • Payment recorded with no matching invoice
  // ══════════════════════════════════════════════════════════════════════════
  app.get("/api/reconciliation", requireRole("owner", "admin"), (_req, res) => {
    const invoices = sqlite.prepare("SELECT * FROM invoices").all() as any[];
    const payments = sqlite.prepare("SELECT * FROM payments WHERE type = 'received' OR type IS NULL").all() as any[];
    const stripeSessions = sqlite.prepare("SELECT * FROM stripe_sessions").all() as any[];
    let qbInvoices: any[] = [];
    try { qbInvoices = sqlite.prepare("SELECT * FROM qb_invoices").all() as any[]; } catch (_) {}
    let qbPayments: any[] = [];
    try { qbPayments = sqlite.prepare("SELECT * FROM qb_payments").all() as any[]; } catch (_) {}
    const contacts = sqlite.prepare("SELECT id, name FROM contacts").all() as any[];
    const cName = (id: any) => contacts.find((c: any) => c.id === id)?.name || null;

    const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

    const rows = invoices
      .filter((inv) => inv.status !== "draft")
      .map((inv) => {
        const invPayments = payments.filter((p) => p.invoice_id === inv.id);
        const paidAmount = round2(invPayments.reduce((s, p) => s + (p.amount || 0), 0));
        const stripe = stripeSessions.filter((ss) => ss.invoice_id === inv.id);
        const stripePaid = stripe.some((ss) => ss.status === "paid");
        const stripeAmount = round2(stripe.filter((ss) => ss.status === "paid").reduce((s, ss) => s + (ss.amount || 0), 0));
        const qb = qbInvoices.find((q) => q.invoice_id === inv.id);
        const qbSynced = !!qb;
        const qbStatus = qb?.status || null; // synced | sent | paid
        const qbPaid = qbStatus === "paid" || qbPayments.some((p) => p.invoice_id === inv.id);
        const total = round2(inv.total);
        const balance = round2(total - paidAmount);
        const flags: string[] = [];
        // Reconciliation checks
        if (stripePaid && inv.status !== "paid") flags.push("stripe_paid_invoice_open");
        if (paidAmount >= total && total > 0 && inv.status !== "paid") flags.push("fully_paid_not_marked");
        if (inv.status === "paid" && !qbPaid && qbSynced) flags.push("paid_not_in_qb");
        if (inv.status === "paid" && !qbSynced) flags.push("paid_not_synced_to_qb");
        if (paidAmount > 0 && paidAmount < total && total > 0) flags.push("partial_payment");
        if (stripePaid && stripeAmount > 0 && Math.abs(stripeAmount - paidAmount) > 0.01) flags.push("stripe_amount_mismatch");
        return {
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number,
          contactId: inv.contact_id,
          contactName: cName(inv.contact_id),
          status: inv.status,
          total,
          paidAmount,
          balance,
          stripePaid,
          stripeAmount,
          qbSynced,
          qbStatus,
          qbPaid,
          qbLink: qb?.qb_link || null,
          flags,
          reconciled: flags.length === 0,
        };
      });

    // Payments that reference an invoice id that doesn't exist / is a draft
    const orphanPayments = payments
      .filter((p) => {
        if (!p.invoice_id) return true;
        const inv = invoices.find((i) => i.id === p.invoice_id);
        return !inv || inv.status === "draft";
      })
      .map((p) => ({
        paymentId: p.id,
        invoiceId: p.invoice_id,
        amount: round2(p.amount),
        method: p.method,
        reference: p.reference,
        contactName: cName(p.contact_id),
        paidAt: p.paid_at,
      }));

    const summary = {
      totalInvoices: rows.length,
      reconciled: rows.filter((r) => r.reconciled).length,
      needsAttention: rows.filter((r) => !r.reconciled).length,
      orphanPayments: orphanPayments.length,
      openBalance: round2(rows.filter((r) => r.status !== "paid").reduce((s, r) => s + r.balance, 0)),
      collectedTotal: round2(rows.reduce((s, r) => s + r.paidAmount, 0)),
      stripeCollected: round2(rows.reduce((s, r) => s + r.stripeAmount, 0)),
    };

    res.json({ summary, rows, orphanPayments });
  });


  // ══════════════════════════════════════════════════════════════════════════
  // MIGRATION CENTER — Slack / CompanyCam / Dash live-API import
  // Reuses the generic `integrations` kv table for credentials (masked on read).
  // Sync results are recorded in `migration_syncs` for an audit trail.
  // ══════════════════════════════════════════════════════════════════════════
  try { sqlite.exec(`CREATE TABLE IF NOT EXISTS migration_syncs (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, scope TEXT, status TEXT, records INTEGER DEFAULT 0, detail TEXT, error TEXT, run_by TEXT, created_at TEXT)`); } catch(_) {}

  function readIntegration(key: string): any {
    const row: any = sqlite.prepare("SELECT value FROM integrations WHERE key = ?").get(key);
    return row ? JSON.parse(row.value || "{}") : {};
  }

  // --- Test connection: validates a token by hitting each provider's identity endpoint ---
  app.post("/api/migration/:source/test", requireRole("owner", "admin"), wrapAsync(async (req, res) => {
    const source = req.params.source;
    const cfg = readIntegration(source);
    const token = cfg.apiKey || cfg.token || req.body?.token;
    if (!token) return res.status(400).json({ ok: false, error: "No API token saved. Save credentials first." });
    try {
      if (source === "slack") {
        const r = await fetch("https://slack.com/api/auth.test", { headers: { Authorization: `Bearer ${token}` } });
        const d: any = await r.json();
        if (!d.ok) throw new Error(d.error || "Slack auth failed");
        return res.json({ ok: true, account: d.team || d.user, detail: `Connected to workspace \"${d.team}\" as ${d.user}` });
      }
      if (source === "companycam") {
        const r = await fetch("https://api.companycam.com/v2/users/current", { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
        if (!r.ok) throw new Error(`CompanyCam returned ${r.status}`);
        const d: any = await r.json();
        const name = d?.data?.first_name ? `${d.data.first_name} ${d.data.last_name||""}`.trim() : (d?.first_name || "account");
        return res.json({ ok: true, account: name, detail: `Connected to CompanyCam as ${name}` });
      }
      if (source === "dash") {
        const base = (cfg.baseUrl || req.body?.baseUrl || "https://api.dashsolution.com").replace(/\/$/, "");
        const r = await fetch(`${base}/v1/me`, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
        if (!r.ok) throw new Error(`Dash returned ${r.status}`);
        const d: any = await r.json();
        return res.json({ ok: true, account: d?.name || d?.email || "account", detail: `Connected to Dash (${base})` });
      }
      return res.status(400).json({ ok: false, error: "Unknown source" });
    } catch (err: any) {
      return res.status(502).json({ ok: false, error: `Could not reach ${source}: ${err.message}` });
    }
  }));

  // --- Sync: pull records from a provider into Titan. Runs one or more scopes. ---
  // Body: { scopes: string[] }.  Live-fetches from provider, upserts into local tables,
  // records a migration_syncs row per scope. Designed to be resilient — a failure in
  // one scope does not abort the others.
  app.post("/api/migration/:source/sync", requireRole("owner", "admin"), wrapAsync(async (req, res) => {
    const source = req.params.source;
    const cfg = readIntegration(source);
    const token = cfg.apiKey || cfg.token;
    const emp = (req as any).employee;
    const now = () => new Date().toISOString();
    if (!token) return res.status(400).json({ error: "No API token saved. Save credentials first." });
    const scopes: string[] = Array.isArray(req.body?.scopes) && req.body.scopes.length ? req.body.scopes : ["all"];
    const results: any[] = [];

    const logSync = (scope: string, status: string, records: number, detail: string, error?: string) => {
      sqlite.prepare("INSERT INTO migration_syncs (source, scope, status, records, detail, error, run_by, created_at) VALUES (?,?,?,?,?,?,?,?)")
        .run(source, scope, status, records, detail || null, error || null, emp?.name || "system", now());
      results.push({ source, scope, status, records, detail, error });
    };

    const upsertContact = (name: string, extra: any = {}) => {
      if (!name) return;
      const existing: any = sqlite.prepare("SELECT id FROM contacts WHERE lower(name) = lower(?) LIMIT 1").get(name);
      if (existing) return; // dedupe by name
      sqlite.prepare("INSERT INTO contacts (name, type, email, phone, company, notes) VALUES (?,?,?,?,?,?)")
        .run(name, extra.type || "imported", extra.email || null, extra.phone || null, extra.company || null, `Imported from ${source}`);
    };

    try {
      if (source === "slack") {
        for (const scope of scopes) {
          try {
            if (scope === "channels" || scope === "all") {
              const r = await fetch("https://slack.com/api/conversations.list?limit=200&types=public_channel,private_channel", { headers: { Authorization: `Bearer ${token}` } });
              const d: any = await r.json();
              if (!d.ok) throw new Error(d.error);
              const chans = d.channels || [];
              sqlite.exec(`CREATE TABLE IF NOT EXISTS imported_slack_channels (id TEXT PRIMARY KEY, name TEXT, purpose TEXT, imported_at TEXT)`);
              for (const c of chans) sqlite.prepare("INSERT OR REPLACE INTO imported_slack_channels (id,name,purpose,imported_at) VALUES (?,?,?,?)").run(c.id, c.name, c.purpose?.value || "", now());
              logSync("channels", "success", chans.length, `${chans.length} channels imported`);
            }
            if (scope === "messages" || scope === "all") {
              // Messages depend on channels; pull recent history from up to 10 channels
              const chans = sqlite.prepare("SELECT id,name FROM imported_slack_channels LIMIT 10").all() as any[];
              sqlite.exec(`CREATE TABLE IF NOT EXISTS imported_slack_messages (ts TEXT, channel TEXT, user TEXT, text TEXT, imported_at TEXT)`);
              let count = 0;
              for (const c of chans) {
                const r = await fetch(`https://slack.com/api/conversations.history?channel=${c.id}&limit=100`, { headers: { Authorization: `Bearer ${token}` } });
                const d: any = await r.json();
                if (d.ok) for (const m of (d.messages || [])) { sqlite.prepare("INSERT INTO imported_slack_messages (ts,channel,user,text,imported_at) VALUES (?,?,?,?,?)").run(m.ts, c.name, m.user || "", m.text || "", now()); count++; }
              }
              logSync("messages", "success", count, `${count} messages imported from ${chans.length} channels`);
            }
            if (scope === "files" || scope === "all") {
              const r = await fetch("https://slack.com/api/files.list?count=200", { headers: { Authorization: `Bearer ${token}` } });
              const d: any = await r.json();
              if (!d.ok) throw new Error(d.error);
              const files = d.files || [];
              sqlite.exec(`CREATE TABLE IF NOT EXISTS imported_slack_files (id TEXT PRIMARY KEY, name TEXT, mimetype TEXT, url TEXT, imported_at TEXT)`);
              for (const f of files) sqlite.prepare("INSERT OR REPLACE INTO imported_slack_files (id,name,mimetype,url,imported_at) VALUES (?,?,?,?,?)").run(f.id, f.name, f.mimetype, f.url_private, now());
              logSync("files", "success", files.length, `${files.length} files catalogued`);
            }
            if (scope === "contacts" || scope === "all") {
              const r = await fetch("https://slack.com/api/users.list?limit=200", { headers: { Authorization: `Bearer ${token}` } });
              const d: any = await r.json();
              if (!d.ok) throw new Error(d.error);
              const members = (d.members || []).filter((m: any) => !m.is_bot && !m.deleted && m.id !== "USLACKBOT");
              for (const m of members) upsertContact(m.real_name || m.name, { email: m.profile?.email, type: "imported" });
              logSync("contacts", "success", members.length, `${members.length} people synced (deduplicated)`);
            }
          } catch (e: any) { logSync(scope, "error", 0, "", e.message); }
        }
      } else if (source === "companycam") {
        for (const scope of scopes) {
          try {
            if (scope === "photos" || scope === "all") {
              const r = await fetch("https://api.companycam.com/v2/photos?per_page=100", { headers: { Authorization: `Bearer ${token}` } });
              if (!r.ok) throw new Error(`status ${r.status}`);
              const d: any = await r.json();
              const photos = d?.data || d || [];
              sqlite.exec(`CREATE TABLE IF NOT EXISTS imported_companycam_photos (id TEXT PRIMARY KEY, project_id TEXT, uri TEXT, captured_at TEXT, imported_at TEXT)`);
              for (const p of photos) sqlite.prepare("INSERT OR REPLACE INTO imported_companycam_photos (id,project_id,uri,captured_at,imported_at) VALUES (?,?,?,?,?)").run(String(p.id), String(p.project_id||""), p.uris?.[0]?.uri || p.uri || "", p.captured_at || "", now());
              logSync("photos", "success", photos.length, `${photos.length} job photos imported`);
            }
            if (scope === "documents" || scope === "all") {
              const r = await fetch("https://api.companycam.com/v2/documents?per_page=100", { headers: { Authorization: `Bearer ${token}` } });
              if (!r.ok) throw new Error(`status ${r.status}`);
              const d: any = await r.json();
              const docs = d?.data || d || [];
              sqlite.exec(`CREATE TABLE IF NOT EXISTS imported_companycam_docs (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, url TEXT, imported_at TEXT)`);
              for (const doc of docs) sqlite.prepare("INSERT OR REPLACE INTO imported_companycam_docs (id,project_id,name,url,imported_at) VALUES (?,?,?,?,?)").run(String(doc.id), String(doc.project_id||""), doc.name || "", doc.url || "", now());
              logSync("documents", "success", docs.length, `${docs.length} documents imported`);
            }
            if (scope === "contacts" || scope === "all") {
              const r = await fetch("https://api.companycam.com/v2/users?per_page=100", { headers: { Authorization: `Bearer ${token}` } });
              if (!r.ok) throw new Error(`status ${r.status}`);
              const d: any = await r.json();
              const users = d?.data || d || [];
              for (const u of users) upsertContact(`${u.first_name||""} ${u.last_name||""}`.trim(), { email: u.email_address || u.email, type: "imported" });
              logSync("contacts", "success", users.length, `${users.length} people synced (deduplicated)`);
            }
          } catch (e: any) { logSync(scope, "error", 0, "", e.message); }
        }
      } else if (source === "dash") {
        const base = (cfg.baseUrl || "https://api.dashsolution.com").replace(/\/$/, "");
        const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
        for (const scope of scopes) {
          try {
            if (scope === "jobs" || scope === "all") {
              const r = await fetch(`${base}/v1/jobs?limit=200`, { headers: H });
              if (!r.ok) throw new Error(`status ${r.status}`);
              const d: any = await r.json();
              const jobs = d?.data || d?.jobs || d || [];
              sqlite.exec(`CREATE TABLE IF NOT EXISTS imported_dash_jobs (id TEXT PRIMARY KEY, job_number TEXT, customer TEXT, status TEXT, address TEXT, raw TEXT, imported_at TEXT)`);
              for (const j of jobs) sqlite.prepare("INSERT OR REPLACE INTO imported_dash_jobs (id,job_number,customer,status,address,raw,imported_at) VALUES (?,?,?,?,?,?,?)").run(String(j.id), j.job_number || j.number || "", j.customer_name || j.customer || "", j.status || "", j.address || "", JSON.stringify(j), now());
              logSync("jobs", "success", jobs.length, `${jobs.length} jobs imported`);
            }
            if (scope === "estimates" || scope === "all") {
              const r = await fetch(`${base}/v1/estimates?limit=200`, { headers: H });
              if (!r.ok) throw new Error(`status ${r.status}`);
              const d: any = await r.json();
              const ests = d?.data || d?.estimates || d || [];
              sqlite.exec(`CREATE TABLE IF NOT EXISTS imported_dash_estimates (id TEXT PRIMARY KEY, job_id TEXT, total REAL, status TEXT, raw TEXT, imported_at TEXT)`);
              for (const e of ests) sqlite.prepare("INSERT OR REPLACE INTO imported_dash_estimates (id,job_id,total,status,raw,imported_at) VALUES (?,?,?,?,?,?)").run(String(e.id), String(e.job_id||""), Number(e.total||0), e.status||"", JSON.stringify(e), now());
              logSync("estimates", "success", ests.length, `${ests.length} estimates imported`);
            }
            if (scope === "financials" || scope === "all") {
              const r = await fetch(`${base}/v1/payments?limit=200`, { headers: H });
              if (!r.ok) throw new Error(`status ${r.status}`);
              const d: any = await r.json();
              const pays = d?.data || d?.payments || d || [];
              sqlite.exec(`CREATE TABLE IF NOT EXISTS imported_dash_financials (id TEXT PRIMARY KEY, job_id TEXT, amount REAL, kind TEXT, paid_at TEXT, raw TEXT, imported_at TEXT)`);
              for (const p of pays) sqlite.prepare("INSERT OR REPLACE INTO imported_dash_financials (id,job_id,amount,kind,paid_at,raw,imported_at) VALUES (?,?,?,?,?,?,?)").run(String(p.id), String(p.job_id||""), Number(p.amount||0), p.type||"payment", p.paid_at||p.date||"", JSON.stringify(p), now());
              logSync("financials", "success", pays.length, `${pays.length} financial records imported`);
            }
            if (scope === "contacts" || scope === "all") {
              const r = await fetch(`${base}/v1/customers?limit=200`, { headers: H });
              if (!r.ok) throw new Error(`status ${r.status}`);
              const d: any = await r.json();
              const custs = d?.data || d?.customers || d || [];
              for (const c of custs) upsertContact(c.name || `${c.first_name||""} ${c.last_name||""}`.trim(), { email: c.email, phone: c.phone, company: c.company, type: "customer" });
              logSync("contacts", "success", custs.length, `${custs.length} customers synced (deduplicated)`);
            }
            if (scope === "notes" || scope === "all") {
              // Pull all job notes from Dash so each file stays complete.
              const r = await fetch(`${base}/v1/notes?limit=500`, { headers: H });
              if (!r.ok) throw new Error(`status ${r.status}`);
              const d: any = await r.json();
              const notes = d?.data || d?.notes || d || [];
              sqlite.exec(`CREATE TABLE IF NOT EXISTS imported_dash_notes (id TEXT PRIMARY KEY, job_id TEXT, author TEXT, body TEXT, tag TEXT, created_at TEXT, imported_at TEXT)`);
              let linked = 0;
              for (const n of notes) {
                sqlite.prepare("INSERT OR REPLACE INTO imported_dash_notes (id,job_id,author,body,tag,created_at,imported_at) VALUES (?,?,?,?,?,?,?)")
                  .run(String(n.id), String(n.job_id||n.job||""), n.author||n.user||"Dash", n.body||n.text||n.note||"", n.tag||n.category||"", n.created_at||n.date||now(), now());
                // Merge into the live job_notes table when we can map the Dash job number to a local job.
                const jobNum = n.job_number || n.job_no || null;
                const local: any = jobNum ? sqlite.prepare("SELECT id FROM jobs WHERE job_number=?").get(String(jobNum)) : null;
                if (local) {
                  const dup = sqlite.prepare("SELECT id FROM job_notes WHERE job_id=? AND body=?").get(local.id, n.body||n.text||"");
                  if (!dup) { sqlite.prepare("INSERT INTO job_notes (job_id, author, body, is_public, tag, created_at) VALUES (?,?,?,0,?,?)").run(local.id, `Dash: ${n.author||"import"}`, n.body||n.text||n.note||"", n.tag||"imported", n.created_at||now()); linked++; }
                }
              }
              logSync("notes", "success", notes.length, `${notes.length} notes imported (${linked} merged into live files)`);
            }
            if (scope === "documents" || scope === "all") {
              // Pull all job documents from Dash so each file stays complete.
              const r = await fetch(`${base}/v1/documents?limit=500`, { headers: H });
              if (!r.ok) throw new Error(`status ${r.status}`);
              const d: any = await r.json();
              const docs = d?.data || d?.documents || d || [];
              sqlite.exec(`CREATE TABLE IF NOT EXISTS imported_dash_documents (id TEXT PRIMARY KEY, job_id TEXT, name TEXT, doc_type TEXT, url TEXT, raw TEXT, imported_at TEXT)`);
              for (const doc of docs) sqlite.prepare("INSERT OR REPLACE INTO imported_dash_documents (id,job_id,name,doc_type,url,raw,imported_at) VALUES (?,?,?,?,?,?,?)")
                .run(String(doc.id), String(doc.job_id||doc.job||""), doc.name||doc.title||"", doc.type||doc.doc_type||"other", doc.url||doc.download_url||"", JSON.stringify(doc), now());
              logSync("documents", "success", docs.length, `${docs.length} documents imported`);
            }
          } catch (e: any) { logSync(scope, "error", 0, "", e.message); }
        }
      } else {
        return res.status(400).json({ error: "Unknown source" });
      }
    } catch (err: any) {
      logSync("all", "error", 0, "", err.message);
    }

    const totalRecords = results.reduce((s, r) => s + (r.records || 0), 0);
    const anyError = results.some(r => r.status === "error");
    res.json({ ok: !anyError, source, totalRecords, results });
  }));

  // --- Sync history (audit trail) ---
  app.get("/api/migration/history", requireRole("owner", "admin"), wrapAsync((req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS migration_syncs (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, scope TEXT, status TEXT, records INTEGER DEFAULT 0, detail TEXT, error TEXT, run_by TEXT, created_at TEXT)`); } catch(_) {}
    const rows = sqlite.prepare("SELECT * FROM migration_syncs ORDER BY id DESC LIMIT 100").all();
    res.json(rows);
  }));

  // --- Import summary counts (for the Migration Center dashboard) ---
  app.get("/api/migration/summary", requireRole("owner", "admin"), wrapAsync((req, res) => {
    const count = (t: string) => { try { return (sqlite.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c; } catch { return 0; } };
    res.json({
      slack: { channels: count("imported_slack_channels"), messages: count("imported_slack_messages"), files: count("imported_slack_files") },
      companycam: { photos: count("imported_companycam_photos"), documents: count("imported_companycam_docs") },
      dash: { jobs: count("imported_dash_jobs"), estimates: count("imported_dash_estimates"), financials: count("imported_dash_financials") },
      contactsImported: (() => { try { return (sqlite.prepare("SELECT COUNT(*) c FROM contacts WHERE type = 'imported'").get() as any).c; } catch { return 0; } })(),
    });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // DOCUMENT BUILDER — saved branded report/document templates
  // ══════════════════════════════════════════════════════════════════════════
  try { sqlite.exec(`CREATE TABLE IF NOT EXISTS doc_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT DEFAULT 'pdf', config TEXT, updated_by TEXT, created_at TEXT, updated_at TEXT)`); } catch(_) {}
  app.get("/api/doc-templates", requireRole("owner", "admin"), wrapAsync((req, res) => {
    res.json(sqlite.prepare("SELECT * FROM doc_templates ORDER BY updated_at DESC, id DESC").all());
  }));
  app.post("/api/doc-templates", requireRole("owner", "admin"), wrapAsync((req, res) => {
    const emp = (req as any).employee;
    const { name, kind, config } = req.body;
    const now = new Date().toISOString();
    const r = sqlite.prepare("INSERT INTO doc_templates (name, kind, config, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?)")
      .run(name || "Untitled", kind || "pdf", JSON.stringify(config || {}), emp?.name || "", now, now);
    res.json(sqlite.prepare("SELECT * FROM doc_templates WHERE id = ?").get(r.lastInsertRowid));
  }));
  app.patch("/api/doc-templates/:id", requireRole("owner", "admin"), wrapAsync((req, res) => {
    const emp = (req as any).employee;
    const { name, kind, config } = req.body;
    const cur: any = sqlite.prepare("SELECT * FROM doc_templates WHERE id = ?").get(Number(req.params.id));
    if (!cur) return res.status(404).json({ error: "Not found" });
    sqlite.prepare("UPDATE doc_templates SET name = ?, kind = ?, config = ?, updated_by = ?, updated_at = ? WHERE id = ?")
      .run(name ?? cur.name, kind ?? cur.kind, JSON.stringify(config ?? JSON.parse(cur.config||"{}")), emp?.name || "", new Date().toISOString(), Number(req.params.id));
    res.json(sqlite.prepare("SELECT * FROM doc_templates WHERE id = ?").get(Number(req.params.id)));
  }));
  app.delete("/api/doc-templates/:id", requireRole("owner", "admin"), wrapAsync((req, res) => {
    sqlite.prepare("DELETE FROM doc_templates WHERE id = ?").run(Number(req.params.id));
    res.json({ success: true });
  }));

  // --- Job documents bundle (for combined-PDF packet printing) ---
  // Returns the job + all its documents (including file_data) so the client can
  // assemble a single print packet. Owner/admin/tech may read.
  app.get("/api/jobs/:id/documents-bundle", requireStaffAuth, wrapAsync((req, res) => {
    const jobId = Number(req.params.id);
    const job: any = sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    const contact: any = job.contact_id ? sqlite.prepare("SELECT name, email, phone, address FROM contacts WHERE id = ?").get(job.contact_id) : null;
    const docs = storage.getJobDocuments(jobId);
    res.json({ job, contact, documents: docs });
  }));

  // ── AR Follow-Up Rules ────────────────────────────────────────────────────
  app.get("/api/ar-followup-rules", (_req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS ar_followup_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, days_threshold INTEGER NOT NULL, action TEXT NOT NULL, message_template TEXT, assignee TEXT, created_at TEXT DEFAULT '')`); } catch(_) {}
    const rules = sqlite.prepare("SELECT * FROM ar_followup_rules ORDER BY days_threshold").all();
    res.json(rules);
  });
  app.post("/api/ar-followup-rules", (req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS ar_followup_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, days_threshold INTEGER NOT NULL, action TEXT NOT NULL, message_template TEXT, assignee TEXT, created_at TEXT DEFAULT '')`); } catch(_) {}
    const { daysThreshold, action, messageTemplate, assignee } = req.body;
    const r = sqlite.prepare("INSERT INTO ar_followup_rules (days_threshold, action, message_template, assignee, created_at) VALUES (?,?,?,?,?)").run(daysThreshold, action, messageTemplate||null, assignee||null, new Date().toISOString());
    res.json(sqlite.prepare("SELECT * FROM ar_followup_rules WHERE id=?").get(r.lastInsertRowid));
  });
  app.delete("/api/ar-followup-rules/:id", (req, res) => {
    sqlite.prepare("DELETE FROM ar_followup_rules WHERE id=?").run(Number(req.params.id));
    res.json({ success: true });
  });

  // Run AR follow-up engine — returns which invoices need action today
  app.get("/api/ar-followup-engine", (_req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS ar_followup_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, days_threshold INTEGER NOT NULL, action TEXT NOT NULL, message_template TEXT, assignee TEXT, created_at TEXT DEFAULT '')`); } catch(_) {}
    const rules = sqlite.prepare("SELECT * FROM ar_followup_rules ORDER BY days_threshold").all() as any[];
    const invoices = sqlite.prepare("SELECT i.*, j.address, j.insurance_carrier, j.contact_id FROM invoices i LEFT JOIN jobs j ON i.job_id = j.id WHERE i.status != 'paid' AND i.status != 'draft'").all() as any[];
    const contacts = sqlite.prepare("SELECT * FROM contacts").all() as any[];
    const now = Date.now();
    const actions: any[] = [];
    for (const inv of invoices) {
      const sentDate = inv.created_at ? new Date(inv.created_at).getTime() : null;
      if (!sentDate) continue;
      const daysOut = Math.floor((now - sentDate) / 86400000);
      for (const rule of rules) {
        if (daysOut >= rule.days_threshold) {
          const contact = contacts.find((c: any) => c.id === inv.contact_id);
          actions.push({ invoice: inv, rule, daysOut, contact, message: (rule.message_template || "Invoice {invoiceNumber} is {days} days overdue. Please remit payment at your earliest convenience. — Titan Restoration LLC 706-922-0154").replace("{invoiceNumber}", inv.invoice_number || inv.id).replace("{days}", daysOut) });
        }
      }
    }
    res.json(actions);
  });

  // ── SMS on Jobs — per-job thread ──────────────────────────────────────────
  app.get("/api/jobs/:id/sms", (req, res) => {
    const msgs = sqlite.prepare("SELECT * FROM sms_messages WHERE job_id=? ORDER BY created_at ASC").all(Number(req.params.id));
    res.json(msgs);
  });
  app.post("/api/jobs/:id/sms", (req, res) => {
    try { sqlite.exec(`ALTER TABLE sms_messages ADD COLUMN job_id INTEGER`); } catch(_) {}
    const { body, direction, to, from: from_ } = req.body;
    const r = sqlite.prepare(`INSERT INTO sms_messages (contact_id, job_id, direction, body, "to", "from", status, created_at) VALUES (?,?,?,?,?,?,?,?)`).run(req.body.contactId||null, Number(req.params.id), direction||'outbound', body, to||'', from_||'Titan Restoration (706-922-0154)', 'sent', new Date().toISOString());
    res.json(sqlite.prepare("SELECT * FROM sms_messages WHERE id=?").get(r.lastInsertRowid));
  });

  // ── Equipment Return Alerts ───────────────────────────────────────────────
  app.get("/api/equipment-alerts", (_req, res) => {
    try { sqlite.exec(`ALTER TABLE equipment_deployments ADD COLUMN expected_return_date TEXT`); } catch(_) {}
    const deps = sqlite.prepare(`
      SELECT ed.*, e.name as equipment_name, e.category as equipment_type, j.job_number, j.address, j.assigned_tech
      FROM equipment_deployments ed
      LEFT JOIN equipment e ON ed.equipment_id = e.id
      LEFT JOIN jobs j ON ed.job_id = j.id
      WHERE ed.returned_at IS NULL
    `).all() as any[];
    const now = Date.now();
    const alerts = deps.map((d: any) => {
      const deployedDays = Math.floor((now - new Date(d.deployed_at).getTime()) / 86400000);
      const isOverdue = d.expected_return_date ? new Date(d.expected_return_date).getTime() < now : deployedDays > 14;
      return { ...d, deployedDays, isOverdue };
    }).filter((d: any) => d.isOverdue);
    res.json(alerts);
  });
  app.patch("/api/equipment-deployments/:id/expected-return", (req, res) => {
    try { sqlite.exec(`ALTER TABLE equipment_deployments ADD COLUMN expected_return_date TEXT`); } catch(_) {}
    sqlite.prepare("UPDATE equipment_deployments SET expected_return_date=? WHERE id=?").run(req.body.expectedReturnDate, Number(req.params.id));
    res.json(sqlite.prepare("SELECT * FROM equipment_deployments WHERE id=?").get(Number(req.params.id)));
  });

  // ── Carrier Response Time Tracker ─────────────────────────────────────────
  app.get("/api/reports/carrier-response-time", (_req, res) => {
    const jobs = sqlite.prepare("SELECT * FROM jobs WHERE (status IS NULL OR status != 'closed') AND insurance_carrier IS NOT NULL AND insurance_carrier != ''").all() as any[];
    const invoices = sqlite.prepare("SELECT * FROM invoices").all() as any[];
    const payments = sqlite.prepare("SELECT * FROM payments WHERE type='received'").all() as any[];
    const byCarrier: Record<string, any> = {};
    for (const job of jobs) {
      const carrier = job.insurance_carrier;
      if (!byCarrier[carrier]) byCarrier[carrier] = { carrier, jobs: 0, totalDays: 0, paid: 0, fastest: 999, slowest: 0, adjusterData: {} };
      byCarrier[carrier].jobs++;
      const jobInvoices = invoices.filter((i: any) => i.job_id === job.id);
      const jobPayments = payments.filter((p: any) => jobInvoices.some((i: any) => i.id === p.invoice_id));
      for (const inv of jobInvoices) {
        const pmt = jobPayments.find((p: any) => p.invoice_id === inv.id);
        if (pmt && inv.created_at && pmt.paid_at) {
          const days = Math.floor((new Date(pmt.paid_at).getTime() - new Date(inv.created_at).getTime()) / 86400000);
          if (days >= 0) {
            byCarrier[carrier].totalDays += days;
            byCarrier[carrier].paid++;
            byCarrier[carrier].fastest = Math.min(byCarrier[carrier].fastest, days);
            byCarrier[carrier].slowest = Math.max(byCarrier[carrier].slowest, days);
          }
        }
        if (job.adjuster_name) {
          const adj = job.adjuster_name;
          if (!byCarrier[carrier].adjusterData[adj]) byCarrier[carrier].adjusterData[adj] = { name: adj, jobs: 0, totalDays: 0, paid: 0 };
          byCarrier[carrier].adjusterData[adj].jobs++;
        }
      }
    }
    const results = Object.values(byCarrier).map((c: any) => ({
      ...c,
      avgDays: c.paid > 0 ? Math.round(c.totalDays / c.paid) : null,
      fastest: c.fastest === 999 ? null : c.fastest,
      adjusters: Object.values(c.adjusterData),
    })).sort((a: any, b: any) => (a.avgDays ?? 999) - (b.avgDays ?? 999));
    res.json(results);
  });

  // ── Profitability by Loss Type ────────────────────────────────────────────
  app.get("/api/reports/profitability-by-type", (_req, res) => {
    const jobs = sqlite.prepare("SELECT * FROM jobs WHERE status IS NULL OR status != 'closed'").all() as any[];
    const invoices = sqlite.prepare("SELECT * FROM invoices").all() as any[];
    const payments = sqlite.prepare("SELECT * FROM payments WHERE type='received'").all() as any[];
    const costs = sqlite.prepare("SELECT * FROM job_costs").all() as any[];
    const byType: Record<string, any> = {};
    for (const job of jobs) {
      const lt = job.loss_type || "unknown";
      if (!byType[lt]) byType[lt] = { lossType: lt, jobs: 0, totalInvoiced: 0, totalCollected: 0, totalCosts: 0, totalCycleDays: 0, jobsWithCycle: 0 };
      byType[lt].jobs++;
      const jobInv = invoices.filter((i: any) => i.job_id === job.id);
      byType[lt].totalInvoiced += jobInv.reduce((s: number, i: any) => s + (i.total || 0), 0);
      const jobPmts = payments.filter((p: any) => jobInv.some((i: any) => i.id === p.invoice_id));
      byType[lt].totalCollected += jobPmts.reduce((s: number, p: any) => s + (p.amount || 0), 0);
      byType[lt].totalCosts += costs.filter((c: any) => c.job_id === job.id).reduce((s: number, c: any) => s + (c.total || 0), 0);
      if (job.created_at && job.job_complete) {
        const days = Math.floor((new Date(job.job_complete).getTime() - new Date(job.created_at).getTime()) / 86400000);
        if (days >= 0) { byType[lt].totalCycleDays += days; byType[lt].jobsWithCycle++; }
      }
    }
    const results = Object.values(byType).map((t: any) => ({
      ...t,
      avgJobValue: t.jobs > 0 ? Math.round(t.totalInvoiced / t.jobs) : 0,
      grossMargin: t.totalInvoiced > 0 ? Math.round(((t.totalInvoiced - t.totalCosts) / t.totalInvoiced) * 100) : 0,
      collectionRate: t.totalInvoiced > 0 ? Math.round((t.totalCollected / t.totalInvoiced) * 100) : 0,
      avgCycleDays: t.jobsWithCycle > 0 ? Math.round(t.totalCycleDays / t.jobsWithCycle) : null,
    })).sort((a: any, b: any) => b.totalInvoiced - a.totalInvoiced);
    res.json(results);
  });

  // ── Tech Daily Summary ────────────────────────────────────────────────────
  app.get("/api/tech-daily/:tech", (req, res) => {
    const tech = decodeURIComponent(req.params.tech);
    const jobs = sqlite.prepare("SELECT * FROM jobs WHERE assigned_tech=? AND status NOT IN ('complete','closed')").all(tech) as any[];
    const today = new Date().toISOString().slice(0, 10);
    const scheduled = sqlite.prepare("SELECT s.*, j.job_number, j.address, j.loss_type FROM shifts s LEFT JOIN jobs j ON s.job_id = j.id WHERE s.tech_name=? AND s.shift_date=?").all(tech, today);
    res.json({ tech, activeJobs: jobs, scheduledToday: scheduled, date: today, phone: "706-922-0154" });
  });

  // ── Job Age Alerts ────────────────────────────────────────────────────────
  app.get("/api/job-age-alerts", (req, res) => {
    const thresholdDays = Number(req.query.days || 7);
    const jobs = sqlite.prepare("SELECT * FROM jobs WHERE status NOT IN ('complete','closed')").all() as any[];
    const now = Date.now();
    const stale = jobs.map((j: any) => {
      // Use the most recent stage-change date or createdAt
      const dates = [j.invoice_sent_date, j.wip_date, j.pre_production_date, j.sales_date, j.created_at].filter(Boolean);
      const latestDate = dates.reduce((latest: any, d: any) => {
        const t = new Date(d).getTime();
        return t > latest ? t : latest;
      }, 0);
      const stuckDays = latestDate > 0 ? Math.floor((now - latestDate) / 86400000) : null;
      return { ...j, stuckDays, progressStage: j.progress_stage || "pending_sale" };
    }).filter((j: any) => j.stuckDays !== null && j.stuckDays >= thresholdDays);
    res.json(stale.sort((a: any, b: any) => (b.stuckDays || 0) - (a.stuckDays || 0)));
  });

  // ── Google Review Request ─────────────────────────────────────────────────
  app.post("/api/jobs/:id/review-request", (req, res) => {
    const job = sqlite.prepare("SELECT * FROM jobs WHERE id=?").get(Number(req.params.id)) as any;
    if (!job) return res.status(404).json({ error: "Job not found" });
    const contact = job.contact_id ? sqlite.prepare("SELECT * FROM contacts WHERE id=?").get(job.contact_id) as any : null;
    const reviewLink = "https://g.page/r/YOUR_GOOGLE_PLACE_ID/review";
    const message = `Hi${contact?.name ? " " + contact.name.split(" ")[0] : ""}! Thank you for choosing Titan Restoration. We hope your experience was excellent. If you have a moment, we'd appreciate a Google review: ${reviewLink} — Titan Restoration LLC 706-922-0154`;
    // Log as SMS outbound
    try {
      sqlite.prepare(`INSERT INTO sms_messages (contact_id, job_id, direction, body, "to", "from", status, created_at) VALUES (?,?,?,?,?,?,?,?)`).run(
        job.contact_id||null, job.id, "outbound", message, contact?.phone||"", "Titan Restoration (706-922-0154)", "sent", new Date().toISOString()
      );
    } catch(_) {}
    res.json({ success: true, message, phone: contact?.phone });
  });



  // ── Credit Memo CRUD ──────────────────────────────────────────────────────
  app.post("/api/jobs/:id/credit-memo", (req, res) => {
    try { sqlite.exec(`ALTER TABLE payments ADD COLUMN credit_memo INTEGER DEFAULT 0`); } catch(_) {}
    try { sqlite.exec(`ALTER TABLE payments ADD COLUMN memo_reason TEXT`); } catch(_) {}
    const { amount, reason, invoiceId } = req.body;
    const r = sqlite.prepare(`INSERT INTO payments (job_id, invoice_id, type, amount, credit_memo, memo_reason, paid_at) VALUES (?,?,?,?,1,?,?)`)
      .run(Number(req.params.id), invoiceId || null, 'credit_memo', Math.abs(amount || 0), reason || '', new Date().toISOString());
    res.json(sqlite.prepare("SELECT * FROM payments WHERE id=?").get(r.lastInsertRowid));
  });


  // ── IICRC Deviation Log (#29) ──────────────────────────────────────────────
  app.get("/api/iicrc-deviations", (_req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS iicrc_deviations (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, deviation_type TEXT NOT NULL, description TEXT NOT NULL, iicrc_section TEXT, justification TEXT, approved_by TEXT, status TEXT NOT NULL DEFAULT 'pending', requires_reinspection INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT '')`); } catch(_) {}
    res.json(sqlite.prepare("SELECT * FROM iicrc_deviations ORDER BY id DESC").all());
  });
  app.post("/api/iicrc-deviations", (req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS iicrc_deviations (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, deviation_type TEXT NOT NULL, description TEXT NOT NULL, iicrc_section TEXT, justification TEXT, approved_by TEXT, status TEXT NOT NULL DEFAULT 'pending', requires_reinspection INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT '')`); } catch(_) {}
    const { job_id, deviation_type, description, iicrc_section, justification, approved_by, status, requires_reinspection, created_at } = req.body;
    const r = sqlite.prepare(`INSERT INTO iicrc_deviations (job_id, deviation_type, description, iicrc_section, justification, approved_by, status, requires_reinspection, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(job_id||null, deviation_type||'', description||'', iicrc_section||'', justification||'', approved_by||'', status||'pending', requires_reinspection?1:0, created_at||new Date().toISOString());
    res.json(sqlite.prepare("SELECT * FROM iicrc_deviations WHERE id=?").get(r.lastInsertRowid));
  });
  app.patch("/api/iicrc-deviations/:id", (req, res) => {
    const { status } = req.body;
    sqlite.prepare("UPDATE iicrc_deviations SET status=? WHERE id=?").run(status||'pending', Number(req.params.id));
    res.json(sqlite.prepare("SELECT * FROM iicrc_deviations WHERE id=?").get(Number(req.params.id)));
  });
  app.delete("/api/iicrc-deviations/:id", (req, res) => {
    sqlite.prepare("DELETE FROM iicrc_deviations WHERE id=?").run(Number(req.params.id));
    res.json({ success: true });
  });

  // ── COI Records (#30) ─────────────────────────────────────────────────────
  app.get("/api/coi-records", (_req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS coi_records (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER, document_type TEXT NOT NULL, document_number TEXT, issuer TEXT, expires_at TEXT NOT NULL, document_url TEXT, status TEXT NOT NULL DEFAULT 'active', alert_sent_30 INTEGER DEFAULT 0, alert_sent_7 INTEGER DEFAULT 0, notes TEXT, created_at TEXT NOT NULL DEFAULT '')`); } catch(_) {}
    res.json(sqlite.prepare("SELECT * FROM coi_records ORDER BY expires_at ASC").all());
  });
  app.post("/api/coi-records", (req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS coi_records (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER, document_type TEXT NOT NULL, document_number TEXT, issuer TEXT, expires_at TEXT NOT NULL, document_url TEXT, status TEXT NOT NULL DEFAULT 'active', alert_sent_30 INTEGER DEFAULT 0, alert_sent_7 INTEGER DEFAULT 0, notes TEXT, created_at TEXT NOT NULL DEFAULT '')`); } catch(_) {}
    const { contact_id, document_type, document_number, issuer, expires_at, status, notes, created_at } = req.body;
    const r = sqlite.prepare(`INSERT INTO coi_records (contact_id, document_type, document_number, issuer, expires_at, status, notes, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(contact_id||null, document_type||'', document_number||'', issuer||'', expires_at||'', status||'active', notes||'', created_at||new Date().toISOString());
    res.json(sqlite.prepare("SELECT * FROM coi_records WHERE id=?").get(r.lastInsertRowid));
  });
  app.delete("/api/coi-records/:id", (req, res) => {
    sqlite.prepare("DELETE FROM coi_records WHERE id=?").run(Number(req.params.id));
    res.json({ success: true });
  });

  // ── LMS Courses (#31) ─────────────────────────────────────────────────────
  app.get("/api/lms-courses", (_req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS lms_courses (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, category TEXT NOT NULL DEFAULT 'iicrc', content_url TEXT, content_type TEXT NOT NULL DEFAULT 'video', quiz_json TEXT DEFAULT '[]', duration_mins INTEGER DEFAULT 0, required_role TEXT DEFAULT 'all', created_at TEXT NOT NULL DEFAULT '')`); } catch(_) {}
    res.json(sqlite.prepare("SELECT * FROM lms_courses ORDER BY id DESC").all());
  });
  app.post("/api/lms-courses", (req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS lms_courses (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, category TEXT NOT NULL DEFAULT 'iicrc', content_url TEXT, content_type TEXT NOT NULL DEFAULT 'video', quiz_json TEXT DEFAULT '[]', duration_mins INTEGER DEFAULT 0, required_role TEXT DEFAULT 'all', created_at TEXT NOT NULL DEFAULT '')`); } catch(_) {}
    const { title, description, category, content_url, content_type, duration_mins, required_role, created_at } = req.body;
    const r = sqlite.prepare(`INSERT INTO lms_courses (title, description, category, content_url, content_type, duration_mins, required_role, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(title||'', description||'', category||'iicrc', content_url||'', content_type||'video', duration_mins||0, required_role||'all', created_at||new Date().toISOString());
    res.json(sqlite.prepare("SELECT * FROM lms_courses WHERE id=?").get(r.lastInsertRowid));
  });
  app.delete("/api/lms-courses/:id", (req, res) => {
    sqlite.prepare("DELETE FROM lms_courses WHERE id=?").run(Number(req.params.id));
    res.json({ success: true });
  });

  // ── LMS Enrollments (#31) ────────────────────────────────────────────────
  app.get("/api/lms-enrollments", (_req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS lms_enrollments (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, employee_id INTEGER NOT NULL, employee_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'assigned', score INTEGER, started_at TEXT, completed_at TEXT, assigned_at TEXT NOT NULL DEFAULT '')`); } catch(_) {}
    res.json(sqlite.prepare("SELECT * FROM lms_enrollments ORDER BY id DESC").all());
  });
  app.post("/api/lms-enrollments", (req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS lms_enrollments (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, employee_id INTEGER NOT NULL, employee_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'assigned', score INTEGER, started_at TEXT, completed_at TEXT, assigned_at TEXT NOT NULL DEFAULT '')`); } catch(_) {}
    const { course_id, employee_id, employee_name, status, assigned_at } = req.body;
    const r = sqlite.prepare(`INSERT INTO lms_enrollments (course_id, employee_id, employee_name, status, assigned_at) VALUES (?,?,?,?,?)`)
      .run(course_id||0, employee_id||0, employee_name||'', status||'assigned', assigned_at||new Date().toISOString());
    res.json(sqlite.prepare("SELECT * FROM lms_enrollments WHERE id=?").get(r.lastInsertRowid));
  });
  app.patch("/api/lms-enrollments/:id", (req, res) => {
    const { status, score, started_at, completed_at } = req.body;
    const existing = sqlite.prepare("SELECT * FROM lms_enrollments WHERE id=?").get(Number(req.params.id)) as any;
    if (!existing) return res.status(404).json({ error: "Not found" });
    sqlite.prepare("UPDATE lms_enrollments SET status=?, score=?, started_at=?, completed_at=? WHERE id=?")
      .run(status||existing.status, score??existing.score, started_at||existing.started_at, completed_at||existing.completed_at, Number(req.params.id));
    res.json(sqlite.prepare("SELECT * FROM lms_enrollments WHERE id=?").get(Number(req.params.id)));
  });

  // ── Payment Plans (#5) ────────────────────────────────────────────────────
  app.get("/api/payment-plans", (_req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS payment_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL, contact_id INTEGER, total_amount REAL NOT NULL, down_payment REAL DEFAULT 0, installment_count INTEGER NOT NULL DEFAULT 3, frequency TEXT NOT NULL DEFAULT 'monthly', status TEXT NOT NULL DEFAULT 'active', stripe_customer_id TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT '')`); } catch(_) {}
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS payment_plan_installments (id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, due_date TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', paid_at TEXT, stripe_payment_intent_id TEXT)`); } catch(_) {}
    res.json(sqlite.prepare("SELECT * FROM payment_plans ORDER BY id DESC").all());
  });
  app.post("/api/payment-plans", (req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS payment_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL, contact_id INTEGER, total_amount REAL NOT NULL, down_payment REAL DEFAULT 0, installment_count INTEGER NOT NULL DEFAULT 3, frequency TEXT NOT NULL DEFAULT 'monthly', status TEXT NOT NULL DEFAULT 'active', stripe_customer_id TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT '')`); } catch(_) {}
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS payment_plan_installments (id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, due_date TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', paid_at TEXT, stripe_payment_intent_id TEXT)`); } catch(_) {}
    const { job_id, contact_id, total_amount, down_payment, installment_count, frequency, notes, created_at } = req.body;
    const r = sqlite.prepare(`INSERT INTO payment_plans (job_id, contact_id, total_amount, down_payment, installment_count, frequency, notes, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(job_id||0, contact_id||null, total_amount||0, down_payment||0, installment_count||3, frequency||'monthly', notes||'', created_at||new Date().toISOString());
    const planId = r.lastInsertRowid;
    // Generate installments
    const remaining = (total_amount||0) - (down_payment||0);
    const count = installment_count || 3;
    const installAmt = Math.round((remaining / count) * 100) / 100;
    const now = new Date();
    for (let i = 0; i < count; i++) {
      const due = new Date(now);
      if (frequency === 'weekly') due.setDate(due.getDate() + 7 * (i + 1));
      else if (frequency === 'biweekly') due.setDate(due.getDate() + 14 * (i + 1));
      else due.setMonth(due.getMonth() + (i + 1));
      sqlite.prepare("INSERT INTO payment_plan_installments (plan_id, due_date, amount, status) VALUES (?,?,?,?)")
        .run(planId, due.toISOString().slice(0, 10), installAmt, 'pending');
    }
    res.json(sqlite.prepare("SELECT * FROM payment_plans WHERE id=?").get(planId));
  });
  app.get("/api/payment-plans/:id/installments", (req, res) => {
    res.json(sqlite.prepare("SELECT * FROM payment_plan_installments WHERE plan_id=? ORDER BY due_date").all(Number(req.params.id)));
  });
  // Mark an installment paid / update its status (frontend PaymentPlans.tsx).
  app.patch("/api/payment-plan-installments/:id", (req, res) => {
    try {
      const existing = sqlite.prepare("SELECT * FROM payment_plan_installments WHERE id=?").get(Number(req.params.id)) as any;
      if (!existing) return res.status(404).json({ error: "Not found" });
      const status = req.body?.status ?? existing.status;
      const paidAt = req.body?.paidAt ?? req.body?.paid_at ?? (status === "paid" ? new Date().toISOString() : existing.paid_at);
      const spi = req.body?.stripePaymentIntentId ?? req.body?.stripe_payment_intent_id ?? existing.stripe_payment_intent_id;
      sqlite.prepare("UPDATE payment_plan_installments SET status=?, paid_at=?, stripe_payment_intent_id=? WHERE id=?")
        .run(status, paidAt || null, spi || null, Number(req.params.id));
      res.json(sqlite.prepare("SELECT * FROM payment_plan_installments WHERE id=?").get(Number(req.params.id)));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Safety Checklists (#10) ───────────────────────────────────────────────
  app.get("/api/safety-checklists", (_req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS safety_checklists (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL, tech_name TEXT NOT NULL, checklist_type TEXT NOT NULL DEFAULT 'pre_job', items_json TEXT NOT NULL DEFAULT '[]', photos_json TEXT DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending', completed_at TEXT, created_at TEXT NOT NULL DEFAULT '')`); } catch(_) {}
    res.json(sqlite.prepare("SELECT * FROM safety_checklists ORDER BY id DESC").all());
  });
  app.post("/api/safety-checklists", wrapAsync(async (req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS safety_checklists (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL, tech_name TEXT NOT NULL, checklist_type TEXT NOT NULL DEFAULT 'pre_job', items_json TEXT NOT NULL DEFAULT '[]', photos_json TEXT DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending', completed_at TEXT, created_at TEXT NOT NULL DEFAULT '')`); } catch(_) {}
    const { job_id, tech_name, checklist_type, items_json, photos_json, status, completed_at, created_at } = req.body;

    // photos_json historically stored an array of data URLs. When the bucket
    // is configured, replace each data-URL entry with { storageKey } so the
    // JSON stays small and the raw bytes live in object storage. Legacy
    // entries (already URLs or already {storageKey}) pass through unchanged.
    const incoming: any[] = Array.isArray(photos_json) ? photos_json : [];
    const normalized = await Promise.all(incoming.map(async (entry: any) => {
      const url = typeof entry === "string" ? entry : (entry?.dataUrl ?? entry?.url ?? "");
      if (!url) return entry;
      const stored = await writeImageFieldSafe(url, "checklists");
      if (stored.storageKey) return { storageKey: stored.storageKey };
      return typeof entry === "string" ? entry : { ...entry, dataUrl: stored.dataUrl };
    }));

    const r = sqlite.prepare(`INSERT INTO safety_checklists (job_id, tech_name, checklist_type, items_json, photos_json, status, completed_at, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(job_id||0, tech_name||'', checklist_type||'pre_job', JSON.stringify(items_json||[]), JSON.stringify(normalized), status||'pending', completed_at||null, created_at||new Date().toISOString());
    res.json(sqlite.prepare("SELECT * FROM safety_checklists WHERE id=?").get(r.lastInsertRowid));
  }));
  app.patch("/api/safety-checklists/:id", (req, res) => {
    const { status, items_json, completed_at } = req.body;
    const existing = sqlite.prepare("SELECT * FROM safety_checklists WHERE id=?").get(Number(req.params.id)) as any;
    if (!existing) return res.status(404).json({ error: "Not found" });
    sqlite.prepare("UPDATE safety_checklists SET status=?, items_json=?, completed_at=? WHERE id=?")
      .run(status||existing.status, items_json ? JSON.stringify(items_json) : existing.items_json, completed_at||existing.completed_at, Number(req.params.id));
    res.json(sqlite.prepare("SELECT * FROM safety_checklists WHERE id=?").get(Number(req.params.id)));
  });

  // ── NPS Surveys (#15) ─────────────────────────────────────────────────────
  app.get("/api/nps-surveys", (_req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS nps_surveys (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL, contact_id INTEGER, score INTEGER NOT NULL, feedback TEXT, tech_rating INTEGER, cleanliness_rating INTEGER, communication_rating INTEGER, would_refer INTEGER DEFAULT 0, review_requested INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT '')`); } catch(_) {}
    res.json(sqlite.prepare("SELECT * FROM nps_surveys ORDER BY id DESC").all());
  });
  app.post("/api/nps-surveys", (req, res) => {
    try { sqlite.exec(`CREATE TABLE IF NOT EXISTS nps_surveys (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL, contact_id INTEGER, score INTEGER NOT NULL, feedback TEXT, tech_rating INTEGER, cleanliness_rating INTEGER, communication_rating INTEGER, would_refer INTEGER DEFAULT 0, review_requested INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT '')`); } catch(_) {}
    const { job_id, contact_id, score, feedback, tech_rating, cleanliness_rating, communication_rating, would_refer, review_requested, created_at } = req.body;
    const r = sqlite.prepare(`INSERT INTO nps_surveys (job_id, contact_id, score, feedback, tech_rating, cleanliness_rating, communication_rating, would_refer, review_requested, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(job_id||0, contact_id||null, score||0, feedback||'', tech_rating||null, cleanliness_rating||null, communication_rating||null, would_refer?1:0, review_requested?1:0, created_at||new Date().toISOString());
    res.json(sqlite.prepare("SELECT * FROM nps_surveys WHERE id=?").get(r.lastInsertRowid));
  });
  // Record a customer's response to an NPS survey (frontend NPSSurveys.tsx).
  app.patch("/api/nps-surveys/:id/respond", (req, res) => {
    try {
      const existing = sqlite.prepare("SELECT * FROM nps_surveys WHERE id=?").get(Number(req.params.id)) as any;
      if (!existing) return res.status(404).json({ error: "Not found" });
      const score = req.body?.score ?? existing.score;
      const feedback = req.body?.feedback ?? existing.feedback;
      sqlite.prepare("UPDATE nps_surveys SET score=?, feedback=? WHERE id=?")
        .run(score ?? 0, feedback ?? "", Number(req.params.id));
      res.json(sqlite.prepare("SELECT * FROM nps_surveys WHERE id=?").get(Number(req.params.id)));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Technician Scorecard ───────────────────────────────────────────────────
  // Aggregates per-tech performance from jobs (assigned_tech), photos, drying
  // records, and NPS surveys. Powers the previously-broken TechScorecard page.
  app.get("/api/tech-scorecard", (_req, res) => {
    try {
      const jobs = sqlite.prepare("SELECT * FROM jobs WHERE status IS NULL OR status != 'closed'").all() as any[];
      const photos = sqlite.prepare("SELECT job_id FROM photos").all() as any[];
      const drying = sqlite.prepare("SELECT job_id FROM drying_records").all() as any[];
      const nps = sqlite.prepare("SELECT * FROM nps_surveys").all() as any[];

      const photosByJob: Record<number, number> = {};
      for (const p of photos) photosByJob[p.job_id] = (photosByJob[p.job_id] || 0) + 1;
      const dryingJobs = new Set(drying.map((d: any) => d.job_id));
      const npsByJob: Record<number, number[]> = {};
      for (const n of nps) { if (n.job_id != null) (npsByJob[n.job_id] ||= []).push(Number(n.score) || 0); }

      const byTech: Record<string, any> = {};
      for (const j of jobs) {
        const name = (j.assigned_tech || "").trim();
        if (!name) continue;
        const t = byTech[name] ||= {
          name, jobsCompleted: 0, _photoJobs: 0, _photoTotal: 0,
          _dryingEligible: 0, _dryingDone: 0, _npsScores: [] as number[],
          _months: new Set<string>(),
        };
        t.jobsCompleted += 1;
        const pc = photosByJob[j.id] || 0;
        if (pc > 0) { t._photoJobs += 1; t._photoTotal += pc; }
        // Water jobs are drying-eligible; count compliance as having drying logs.
        const lt = String(j.loss_type || "").toLowerCase();
        if (lt.includes("water") || lt.includes("flood") || lt.includes("storm")) {
          t._dryingEligible += 1;
          if (dryingJobs.has(j.id)) t._dryingDone += 1;
        }
        for (const s of (npsByJob[j.id] || [])) t._npsScores.push(s);
        if (j.created_at) t._months.add(String(j.created_at).slice(0, 7));
      }

      const scorecard = Object.values(byTech).map((t: any) => {
        const monthsActive = Math.max(1, t._months.size);
        return {
          name: t.name,
          jobsCompleted: t.jobsCompleted,
          avgPhotosPerJob: t._photoJobs ? Math.round((t._photoTotal / t._photoJobs) * 10) / 10 : 0,
          dryingCompliance: t._dryingEligible ? Math.round((t._dryingDone / t._dryingEligible) * 100) : 100,
          avgNps: t._npsScores.length ? Math.round((t._npsScores.reduce((a: number, b: number) => a + b, 0) / t._npsScores.length) * 10) / 10 : 0,
          npsCount: t._npsScores.length,
          jobsPerMonth: Math.round((t.jobsCompleted / monthsActive) * 10) / 10,
        };
      }).sort((a, b) => b.jobsCompleted - a.jobsCompleted);

      res.json(scorecard);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Cash Flow Calendar (#3) ───────────────────────────────────────────────
  // (data pulled from existing invoices/payments — no new table needed)
  // 13-week rolling cash flow. Returns 13 consecutive weeks (starting this week's
  // Monday). Each week carries expectedInflow (open invoices projected to their
  // due date), scheduledCosts (pending/approved payout requests + active equipment
  // deployments), openInvoiceCount, and a `detail` breakdown so the UI can let the
  // user click a week and review exactly what drives the numbers.
  app.get("/api/cash-flow/13-week", requireRole("owner", "admin"), (_req, res) => {
    // Monday (local) of the week containing `d`.
    function mondayOf(d: Date): Date {
      const day = d.getDay();
      const diff = (day === 0 ? -6 : 1 - day);
      const m = new Date(d);
      m.setDate(d.getDate() + diff);
      m.setHours(0, 0, 0, 0);
      return m;
    }
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const startMonday = mondayOf(new Date());
    // Build 13 week windows [start, end] inclusive (end = Sunday).
    const weeks = [] as Array<{ index: number; weekStart: string; weekEnd: string; start: Date; end: Date; expectedInflow: number; scheduledCosts: number; openInvoiceCount: number; detail: { inflow: any[]; costs: any[] } }>;
    for (let i = 0; i < 13; i++) {
      const s = new Date(startMonday); s.setDate(startMonday.getDate() + i * 7);
      const e = new Date(s); e.setDate(s.getDate() + 6); e.setHours(23, 59, 59, 999);
      weeks.push({ index: i, weekStart: ymd(s), weekEnd: ymd(e), start: s, end: e, expectedInflow: 0, scheduledCosts: 0, openInvoiceCount: 0, detail: { inflow: [], costs: [] } });
    }
    const findWeek = (dt: Date) => weeks.find(w => dt >= w.start && dt <= w.end) || null;

    const jobs = storage.getJobs() as any[];
    const contacts = storage.getContacts() as any[];
    const jobNum = (id: any) => jobs.find(j => j.id === id)?.jobNumber || null;
    const contactName = (id: any) => contacts.find(c => c.id === id)?.name || null;

    // Expected inflow: open (unpaid, non-void) invoices projected to their due date
    // (fallback: created_at + 30 days). Only invoices landing within the 13-week window count.
    const openInvoices = sqlite.prepare("SELECT id, invoice_number, total, due_date, created_at, job_id, contact_id, status FROM invoices WHERE status NOT IN ('paid','void')").all() as any[];
    for (const inv of openInvoices) {
      let proj: Date | null = null;
      if (inv.due_date) proj = new Date(inv.due_date);
      else if (inv.created_at) { proj = new Date(inv.created_at); proj.setDate(proj.getDate() + 30); }
      if (!proj || isNaN(proj.getTime())) continue;
      const w = findWeek(proj);
      if (!w) continue;
      w.expectedInflow += inv.total || 0;
      w.openInvoiceCount += 1;
      w.detail.inflow.push({ id: inv.id, invoiceNumber: inv.invoice_number, amount: inv.total || 0, jobId: inv.job_id, jobNumber: jobNum(inv.job_id), contactName: contactName(inv.contact_id), status: inv.status, projectedDate: ymd(proj) });
    }

    // Scheduled costs: pending/approved payout requests (by paid_at if set, else created_at).
    const payouts = sqlite.prepare("SELECT id, amount, status, description, job_id, contact_id, paid_at, created_at FROM payout_requests WHERE status NOT IN ('rejected','cancelled')").all() as any[];
    for (const po of payouts) {
      const dStr = po.paid_at || po.created_at;
      if (!dStr) continue;
      const dt = new Date(dStr);
      const w = findWeek(dt);
      if (!w) continue;
      w.scheduledCosts += po.amount || 0;
      w.detail.costs.push({ id: po.id, type: "payout", amount: po.amount || 0, label: po.description || "Payout request", status: po.status, jobId: po.job_id, jobNumber: jobNum(po.job_id), contactName: contactName(po.contact_id), date: ymd(dt) });
    }

    // Scheduled costs: active equipment deployments projected to expected return date
    // (fallback deployed_at). Uses billed_amount as the cost estimate.
    const deployments = sqlite.prepare("SELECT id, job_id, deployed_at, returned_at, expected_return_date, billed_amount FROM equipment_deployments WHERE returned_at IS NULL").all() as any[];
    for (const dep of deployments) {
      const dStr = dep.expected_return_date || dep.deployed_at;
      if (!dStr || !dep.billed_amount) continue;
      const dt = new Date(dStr);
      const w = findWeek(dt);
      if (!w) continue;
      w.scheduledCosts += dep.billed_amount || 0;
      w.detail.costs.push({ id: dep.id, type: "equipment", amount: dep.billed_amount || 0, label: "Equipment deployment", jobId: dep.job_id, jobNumber: jobNum(dep.job_id), date: ymd(dt) });
    }

    res.json(weeks.map(w => ({ index: w.index, weekStart: w.weekStart, weekEnd: w.weekEnd, expectedInflow: Math.round(w.expectedInflow), scheduledCosts: Math.round(w.scheduledCosts), openInvoiceCount: w.openInvoiceCount, detail: w.detail })));
  });

  app.get("/api/cash-flow/forecast", (_req, res) => {
    const invoices = sqlite.prepare("SELECT * FROM invoices WHERE status != 'void'").all() as any[];
    const payments = sqlite.prepare("SELECT * FROM payments WHERE type='received'").all() as any[];
    const forecast: Record<string, { expected: number; received: number; invoices: number }> = {};
    for (const inv of invoices) {
      const dueDate = (inv.due_date || inv.created_at || '').slice(0, 7); // YYYY-MM
      if (!dueDate) continue;
      if (!forecast[dueDate]) forecast[dueDate] = { expected: 0, received: 0, invoices: 0 };
      forecast[dueDate].expected += inv.total || 0;
      forecast[dueDate].invoices++;
    }
    for (const p of payments) {
      const paidDate = (p.paid_at || p.created_at || '').slice(0, 7);
      if (!paidDate) continue;
      if (!forecast[paidDate]) forecast[paidDate] = { expected: 0, received: 0, invoices: 0 };
      forecast[paidDate].received += p.amount || 0;
    }
    res.json(Object.entries(forecast).map(([month, data]) => ({ month, ...data })).sort((a, b) => a.month.localeCompare(b.month)));
  });

  // ── Generic edit/delete for create-only resources (additive) ────────────────
  // Fills missing PATCH/DELETE so every module's records can be edited & deleted.
  // Registered here (after all hand-written routes, before the 404 catch-all) so
  // it detects and skips any endpoints already defined above.
  // Mega-build routes (2026-07-30): 11-feature build.
  // Registered before the CRUD gap-filler so its explicit handlers take priority.
  registerMegaBuildRoutes(app, sqlite, { requireRole, requireStaffAuth, wrapAsync });

  // Kick off the in-process scheduler (adjuster silence, AR stalled, COI/cert
  // reminders, NOAA polling). See server/scheduler.ts.
  startScheduler(sqlite);

  registerCrudGapRoutes(app, sqlite, { requireRole, requireStaffAuth });

  // Unmatched /api/* routes should return a clean JSON 404 rather than falling
  // through to the SPA's index.html catch-all. Registered last so it only
  // catches genuinely-unknown API paths (all real routes above take priority).
  app.all(/^\/api\/.*/, (req, res) => {
    res.status(404).json({ error: "Not found", path: req.path });
  });

  return httpServer;
}

// ── Process-level crash guards ──────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

