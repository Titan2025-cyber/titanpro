// Comprehensive demo-data seed for Titan Pro portal QA.
// Idempotent-ish: clears the demo rows it manages, then re-inserts.
const db = require("better-sqlite3")("data.db");

const now = new Date();
const iso = (d) => d.toISOString();
const daysAgo = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return iso(d); };
const dateStr = (n) => daysAgo(n).slice(0, 10);

function cols(t) { return db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name); }
function insert(table, row) {
  const valid = cols(table);
  const keys = Object.keys(row).filter(k => valid.includes(k));
  const sql = `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`;
  return db.prepare(sql).run(...keys.map(k => row[k]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Clean managed demo tables
for (const t of ["equipment_deployments","drying_records","photos","supplements","customer_messages","warranty_calls","adjuster_portal_sessions","payout_requests","invoices"]) {
  try { db.prepare(`DELETE FROM ${t}`).run(); } catch (e) { console.log("skip clear", t, e.message); }
}
db.prepare("DELETE FROM equipment").run();
db.prepare("DELETE FROM certifications").run();
db.prepare("DELETE FROM job_notes WHERE is_public = 1").run();

// ─────────────────────────────────────────────────────────────────────────────
// Assign referral partner (Tom Bradley = id 6) to jobs 1 & 2 so the partner portal is rich
db.prepare("UPDATE jobs SET referral_partner_id = 6, insurance_carrier = 'State Farm', adjuster_name = 'Tom Bradley', adjuster_phone = '706-555-0501', adjuster_email = 'tbradley@statefarm.com', claim_number = 'SF-2026-88401', policy_number = 'POL-4471193', mitigation_start = ? WHERE id = 1").run(daysAgo(5));
db.prepare("UPDATE jobs SET referral_partner_id = 6, insurance_carrier = 'State Farm', adjuster_name = 'Tom Bradley', adjuster_phone = '706-555-0501', adjuster_email = 'tbradley@statefarm.com', claim_number = 'SF-2026-88377', policy_number = 'POL-2298104', job_complete = ? WHERE id = 2").run(daysAgo(2));
db.prepare("UPDATE contacts SET partner_since = ? WHERE id = 6").run("2024-03-15T00:00:00.000Z");
// Set addresses if blank
db.prepare("UPDATE jobs SET address = COALESCE(NULLIF(address,''),'482 Riverwatch Pkwy, Augusta, GA 30901') WHERE id = 1").run();
db.prepare("UPDATE jobs SET address = COALESCE(NULLIF(address,''),'1130 Walton Way, Augusta, GA 30904') WHERE id = 2").run();
db.prepare("UPDATE jobs SET address = COALESCE(NULLIF(address,''),'77 Broad St, Augusta, GA 30901') WHERE id = 3").run();

// ─────────────────────────────────────────────────────────────────────────────
// Invoices — drive partner revenue + tier
insert("invoices", { job_id: 1, contact_id: 1, invoice_number: "INV-2026-001", status: "sent",  line_items: "[]", subtotal: 14200, tax: 0, total: 14200, due_date: daysAgo(-10), created_at: daysAgo(4) });
insert("invoices", { job_id: 2, contact_id: 2, invoice_number: "INV-2026-002", status: "paid",  line_items: "[]", subtotal: 38650, tax: 0, total: 38650, paid_at: daysAgo(1), due_date: daysAgo(5), created_at: daysAgo(6) });

// Payout requests for partner 6 (paid + pending) → available balance + earnings history
insert("payout_requests", { contact_id: 6, job_id: 2, amount: 1932, status: "paid",     requested_at: daysAgo(3),  method_snapshot: JSON.stringify({ method: "ach", handle: "****4021" }) });
insert("payout_requests", { contact_id: 6, job_id: 1, amount: 710,  status: "approved", requested_at: daysAgo(1),  method_snapshot: JSON.stringify({ method: "ach", handle: "****4021" }) });
insert("payout_requests", { contact_id: 6, job_id: 2, amount: 500,  status: "paid",     requested_at: daysAgo(30), method_snapshot: JSON.stringify({ method: "venmo", handle: "@tbradley" }) });

// Warranty calls for partner 6 → goodwill/value provided
insert("warranty_calls", { job_id: 2, partner_id: 6, partner_name: "Tom Bradley", issue_description: "Minor baseboard gap after reconstruction", resolution: "Re-caulked and touch-up paint", tech_assigned: "Derek M.", visit_date: daysAgo(1), labor_hours: 1.5, labor_rate: 65, material_cost: 22, total_cost: 119.5, charged_to_partner: 0, notify_partner: 1, partner_note: "Handled at no charge — client very happy.", created_at: daysAgo(1) });
insert("warranty_calls", { job_id: 2, partner_id: 6, partner_name: "Tom Bradley", issue_description: "Squeaky floor board follow-up", resolution: "Secured subfloor fasteners", tech_assigned: "Derek M.", visit_date: daysAgo(0), labor_hours: 1, labor_rate: 65, material_cost: 8, total_cost: 73, charged_to_partner: 0, notify_partner: 1, partner_note: "Complimentary courtesy visit.", created_at: daysAgo(0) });

// Public job notes (partner-visible progress updates)
insert("job_notes", { job_id: 1, author: "Derek M. (Titan)", body: "Extraction complete. 6 air movers + 2 dehumidifiers staged. Structural drying underway.", is_public: 1, tag: "progress", created_at: daysAgo(4) });
insert("job_notes", { job_id: 2, author: "Sam R. (Titan)", body: "Reconstruction complete and final walkthrough passed. Client signed off.", is_public: 1, tag: "milestone", created_at: daysAgo(2) });

// ─────────────────────────────────────────────────────────────────────────────
// Equipment (some deployed to job 1)
const eq = [
  { name: "Phoenix 200 MAX", category: "dehumidifier", serial_number: "PHX-200-8841", model: "200 MAX LGR", daily_rate: 95, status: "deployed", current_job_id: 1, deployed_at: daysAgo(4), purchase_cost: 2400, runtime_hours: 96, service_interval_hrs: 500, last_service_at: daysAgo(60) },
  { name: "Phoenix 200 MAX #2", category: "dehumidifier", serial_number: "PHX-200-8842", model: "200 MAX LGR", daily_rate: 95, status: "deployed", current_job_id: 1, deployed_at: daysAgo(4), purchase_cost: 2400, runtime_hours: 96, service_interval_hrs: 500, last_service_at: daysAgo(60) },
  { name: "AirMax Velo #1", category: "air_mover", serial_number: "AM-VELO-1201", model: "Velo Pro", daily_rate: 22, status: "deployed", current_job_id: 1, deployed_at: daysAgo(4), purchase_cost: 320, runtime_hours: 96 },
  { name: "AirMax Velo #2", category: "air_mover", serial_number: "AM-VELO-1202", model: "Velo Pro", daily_rate: 22, status: "deployed", current_job_id: 1, deployed_at: daysAgo(4), purchase_cost: 320, runtime_hours: 96 },
  { name: "AirMax Velo #3", category: "air_mover", serial_number: "AM-VELO-1203", model: "Velo Pro", daily_rate: 22, status: "deployed", current_job_id: 1, deployed_at: daysAgo(4), purchase_cost: 320, runtime_hours: 96 },
  { name: "AirMax Velo #4", category: "air_mover", serial_number: "AM-VELO-1204", model: "Velo Pro", daily_rate: 22, status: "deployed", current_job_id: 1, deployed_at: daysAgo(4), purchase_cost: 320, runtime_hours: 96 },
  { name: "DefendAir HEPA 500", category: "air_scrubber", serial_number: "DA-HEPA-5510", model: "HEPA 500", daily_rate: 65, status: "deployed", current_job_id: 1, deployed_at: daysAgo(4), purchase_cost: 1100, runtime_hours: 96 },
  { name: "Protimeter MMS2", category: "moisture_meter", serial_number: "PM-MMS2-3301", model: "MMS2", daily_rate: 0, status: "available", purchase_cost: 850, runtime_hours: 0 },
];
const eqIds = eq.map(e => insert("equipment", e).lastInsertRowid);

// Equipment deployments for job 1 (audit log)
for (let i = 0; i < 7; i++) {
  insert("equipment_deployments", { equipment_id: eqIds[i], job_id: 1, deployed_at: daysAgo(4), days_out: 4, billed_amount: eq[i].daily_rate * 4, notes: "On-site drying" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Drying records for job 1 — multi-day RH trend showing progress
const dryDays = [
  { day: 1, temp: 78, rh: 62, dew: 63, gpp: 118, goal: 0, done: 0, obs: "Initial readings. High moisture in subfloor and lower drywall." },
  { day: 2, temp: 82, rh: 54, dew: 60, gpp: 98,  goal: 0, done: 0, obs: "RH dropping steadily. Drywall MC down 4 points." },
  { day: 3, temp: 84, rh: 47, dew: 56, gpp: 82,  goal: 0, done: 0, obs: "Good progress. Subfloor nearing dry standard." },
  { day: 4, temp: 83, rh: 41, dew: 52, gpp: 68,  goal: 1, done: 0, obs: "Drying goal met on most surfaces. One area still monitoring." },
];
dryDays.forEach((r, i) => {
  const moisture = JSON.stringify([
    { location: "Living Room - South Wall", material: "Drywall", reading: (18 - r.day * 2.5).toFixed(1), gpp: r.gpp, target: 9 },
    { location: "Living Room - Subfloor", material: "OSB Subfloor", reading: (28 - r.day * 3).toFixed(1), gpp: r.gpp, target: 12 },
    { location: "Hallway - Baseboard", material: "Pine Trim", reading: (16 - r.day * 2).toFixed(1), gpp: r.gpp, target: 10 },
  ]);
  insert("drying_records", {
    job_id: 1, reading_date: dateStr(4 - i), reading_time: "09:15", tech_name: "Derek M.", day_number: r.day,
    water_category: "2", water_class: "3", moisture_readings: moisture, temp_f: r.temp, rh_pct: r.rh, gpp: r.gpp, dew_point_f: r.dew,
    equipment: JSON.stringify(["2 LGR dehumidifiers", "4 air movers", "1 air scrubber"]),
    affected_areas: JSON.stringify(["Living Room", "Hallway"]),
    drying_goal_met: r.goal, structural_drying_complete: r.done, observations: r.obs, created_at: daysAgo(4 - i),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Photos for job 1 (tiny inline SVG data URLs so the browser renders something)
function svgDataUrl(label, hue) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'><rect width='400' height='300' fill='hsl(${hue},45%,82%)'/><rect x='0' y='0' width='400' height='40' fill='hsl(${hue},50%,60%)'/><text x='16' y='27' font-family='Arial' font-size='18' fill='white'>${label}</text><text x='200' y='170' font-family='Arial' font-size='16' fill='hsl(${hue},40%,35%)' text-anchor='middle'>Job Photo</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
const photos = [
  { category: "before", caption: "Living room - initial water damage", hue: 10 },
  { category: "before", caption: "Hallway baseboard saturation", hue: 15 },
  { category: "during", caption: "Air movers + dehumidifiers deployed", hue: 200 },
  { category: "during", caption: "Drywall removal for drying access", hue: 210 },
  { category: "moisture", caption: "Moisture meter reading - south wall", hue: 260 },
  { category: "moisture", caption: "Thermal image of affected subfloor", hue: 270 },
  { category: "equipment", caption: "Dehumidifier condensate line", hue: 160 },
  { category: "after", caption: "Area dried to standard - ready for rebuild", hue: 130 },
];
photos.forEach((p, i) => insert("photos", { job_id: 1, filename: `job1_${i}.svg`, data_url: svgDataUrl(p.category, p.hue), caption: p.caption, category: p.category, taken_at: daysAgo(4 - Math.floor(i / 2)) }));
// A couple for job 2
insert("photos", { job_id: 2, filename: "job2_0.svg", data_url: svgDataUrl("before", 20), caption: "Fire damage - kitchen", category: "before", taken_at: daysAgo(10) });
insert("photos", { job_id: 2, filename: "job2_1.svg", data_url: svgDataUrl("after", 130), caption: "Rebuilt kitchen", category: "after", taken_at: daysAgo(2) });

// ─────────────────────────────────────────────────────────────────────────────
// Certifications (IICRC) — for adjuster credentialing panel
const certs = [
  { employee_name: "Derek Malone", cert_type: "WRT - Water Damage Restoration Technician", cert_number: "IICRC-WRT-448122", issued_date: "2023-05-10", expiration_date: "2027-05-10" },
  { employee_name: "Derek Malone", cert_type: "ASD - Applied Structural Drying", cert_number: "IICRC-ASD-448190", issued_date: "2023-06-02", expiration_date: "2027-06-02" },
  { employee_name: "Sam Reyes", cert_type: "FSRT - Fire & Smoke Restoration", cert_number: "IICRC-FSRT-551203", issued_date: "2022-11-15", expiration_date: "2026-11-15" },
  { employee_name: "Titan Restoration LLC", cert_type: "IICRC Certified Firm", cert_number: "IICRC-FIRM-90114", issued_date: "2021-01-20", expiration_date: "2027-01-20" },
];
certs.forEach(c => insert("certifications", { ...c, issued_by: "IICRC", status: "active" }));

// ─────────────────────────────────────────────────────────────────────────────
// Supplements for job 1 (adjuster response UI)
insert("supplements", { job_id: 1, title: "Additional drywall removal - hidden moisture behind cabinets", amount_requested: 1850, carrier: "State Farm", adjuster_name: "Tom Bradley", submitted_at: daysAgo(2), status: "pending", follow_up_due: daysAgo(-3), line_items: JSON.stringify([{ desc: "Remove/replace lower cabinets", qty: 1, price: 1200 }, { desc: "Additional drying days", qty: 2, price: 650 }]), notes: "Moisture mapping revealed saturation behind sink base cabinets not visible at initial inspection." });
insert("supplements", { job_id: 1, title: "Antimicrobial application - Category 2 water", amount_requested: 420, carrier: "State Farm", adjuster_name: "Tom Bradley", submitted_at: daysAgo(3), status: "pending", follow_up_due: daysAgo(-2), line_items: JSON.stringify([{ desc: "Antimicrobial treatment", qty: 350, price: 420 }]), notes: "Per IICRC S500 for Cat 2 loss." });

// ─────────────────────────────────────────────────────────────────────────────
// Customer messages (two-way) for job 1 / contact 1
insert("customer_messages", { job_id: 1, contact_id: 1, sender: "staff", author_name: "Derek M.", body: "Hi Robert & Linda — equipment is running well. We expect drying to complete in about 2 more days. Let us know if the noise is an issue overnight.", read_by_staff: 1, read_by_customer: 1, created_at: daysAgo(3) });
insert("customer_messages", { job_id: 1, contact_id: 1, sender: "customer", author_name: "Linda Hayes", body: "Thank you! The team has been great. Is it okay to unplug one fan in the guest room at night?", read_by_staff: 1, read_by_customer: 1, created_at: daysAgo(3) });
insert("customer_messages", { job_id: 1, contact_id: 1, sender: "staff", author_name: "Derek M.", body: "Please keep them all running for now — turning one off could extend the drying time. Only 2 more days! Appreciate your patience.", read_by_staff: 1, read_by_customer: 0, created_at: daysAgo(2) });

// ─────────────────────────────────────────────────────────────────────────────
// Adjuster portal session — token for QA (jobs 1 & 2, State Farm / Tom Bradley)
const token = "demo-adjuster-token-sf2026";
insert("adjuster_portal_sessions", { adjuster_id: 6, adjuster_name: "Tom Bradley", carrier: "State Farm", access_token: token, job_ids: JSON.stringify([1, 2]), expires_at: daysAgo(-30), last_accessed_at: null, created_at: daysAgo(0) });

console.log("Seed complete.");
console.log("Adjuster access token:", token);
console.log("Counts:",
  ["equipment","equipment_deployments","drying_records","photos","certifications","supplements","customer_messages","warranty_calls","payout_requests","invoices","adjuster_portal_sessions"]
    .map(t => `${t}=${db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c}`).join("  "));
