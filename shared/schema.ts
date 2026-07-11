import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Contacts ────────────────────────────────────────────────────────────────
export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull().default("customer"), // customer | sub | referral
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  company: text("company"),
  referralRate: real("referral_rate"), // percentage e.g. 5
  notes: text("notes"),
  portalPin: text("portal_pin"), // 4-digit PIN for customer portal
  parentCompanyId: integer("parent_company_id"), // referral tech -> parent referral company contact
  isReferralCompany: integer("is_referral_company", { mode: "boolean" }), // 1 = a referral COMPANY that groups techs
});
export const insertContactSchema = createInsertSchema(contacts).omit({ id: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;

// ── Jobs ─────────────────────────────────────────────────────────────────────
export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobNumber: text("job_number").notNull(),
  contactId: integer("contact_id"),
  lossType: text("loss_type").notNull(), // water | fire | mold | storm | biohazard | reconstruction
  status: text("status").notNull().default("new"), // new | mitigation | drying | reconstruction | complete | closed
  address: text("address"),
  description: text("description"),
  assignedTech: text("assigned_tech"),
  insuranceCarrier: text("insurance_carrier"),
  claimNumber: text("claim_number"),
  adjusterName: text("adjuster_name"),
  adjusterPhone: text("adjuster_phone"),
  adjusterEmail: text("adjuster_email"),
  policyNumber: text("policy_number"),
  // Milestone dates
  mitigationStart: text("mitigation_start"),
  dryOutComplete: text("dry_out_complete"),
  reconstructionStart: text("reconstruction_start"),
  jobComplete: text("job_complete"),
  // Progress pipeline stage + dates
  progressStage: text("progress_stage").default("pending_sale"), // pending_sale | pre_production | wip | invoice_pending | accounts_receivable | complete
  salesDate: text("sales_date"),           // Date job was sold/confirmed
  preProductionDate: text("pre_production_date"), // Date pre-production work begins
  wipDate: text("wip_date"),               // Date active work in progress began
  invoiceSentDate: text("invoice_sent_date"),  // Date final invoice was sent
  invoicePaidDate: text("invoice_paid_date"),  // Date invoice was paid / AR collected
  // Partner payout tracking
  partnerPayoutApplied: real("partner_payout_applied"),
  partnerPayoutDate: text("partner_payout_date"),
  // Lead source tracking
  leadSource: text("lead_source"), // referral | google | door_knock | insurance_direct | repeat | other
  leadSourceDetail: text("lead_source_detail"), // e.g. partner name or campaign
  division: text("division"), // mitigation | reconstruction | both — division profitability tag
  location: text("location"), // Augusta | Columbia — service market/branch
  referralPartnerId: integer("referral_partner_id"), // FK to contacts.id — the partner who referred this job
  // DocuSketch integration
  docusketchUrl: text("docusketch_url"),           // Shared 360° tour URL from DocuSketch
  docusketchProjectName: text("docusketch_project_name"), // Project name as entered in DocuSketch
  docusketchStatus: text("docusketch_status").default("none"), // none | pending | complete
  docusketchSketchUrl: text("docusketch_sketch_url"),  // Direct link to sketch PDF/ESX download
  docusketchNotes: text("docusketch_notes"),        // Internal notes about the scan
  docusketchCompletedAt: text("docusketch_completed_at"), // When scan was marked complete
  // Notes stored as JSON array
  notes: text("notes").default("[]"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertJobSchema = createInsertSchema(jobs).omit({ id: true });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;

// ── Estimates ────────────────────────────────────────────────────────────────
export const estimates = sqliteTable("estimates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"), // draft | sent | approved | rejected
  lineItems: text("line_items").notNull().default("[]"), // JSON array
  subtotal: real("subtotal").default(0),
  tax: real("tax").default(0),
  total: real("total").default(0),
  notes: text("notes"),
  phase: text("phase").default("mitigation"), // mitigation | reconstruction
  // Negotiation / rebuttal data
  rebuttalText: text("rebuttal_text"),
  carrierAdjustment: real("carrier_adjustment"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertEstimateSchema = createInsertSchema(estimates).omit({ id: true });
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimates.$inferSelect;

// ── Invoices ─────────────────────────────────────────────────────────────────
export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  contactId: integer("contact_id"),
  invoiceNumber: text("invoice_number").notNull(),
  status: text("status").notNull().default("draft"), // draft | sent | paid | overdue
  lineItems: text("line_items").notNull().default("[]"),
  subtotal: real("subtotal").default(0),
  tax: real("tax").default(0),
  total: real("total").default(0),
  originalTotal: real("original_total"),        // amount before any insurance reduction
  adjustment: real("adjustment").default(0),    // dollar reduction agreed at settlement
  adjustmentReason: text("adjustment_reason"),  // why the amount was reduced
  dueDate: text("due_date"),
  paidAt: text("paid_at"),
  notes: text("notes"),
  phase: text("phase").default("mitigation"), // mitigation | reconstruction
  createdAt: text("created_at").notNull().default(""),
});
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// ── Payments ─────────────────────────────────────────────────────────────────
export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id"),
  jobId: integer("job_id"),
  contactId: integer("contact_id"),
  type: text("type").notNull().default("received"), // received | sub_payment | referral_payout
  amount: real("amount").notNull(),
  method: text("method"), // check | ach | credit_card | cash
  reference: text("reference"),
  notes: text("notes"),
  paidAt: text("paid_at").notNull().default(""),
});
export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof payments.$inferSelect;

// ── Photos ───────────────────────────────────────────────────────────────────
export const photos = sqliteTable("photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  filename: text("filename").notNull(),
  dataUrl: text("data_url").notNull(), // base64
  caption: text("caption"),
  category: text("category").default("general"), // general | before | during | after | damage | moisture
  phase: text("phase").default("mitigation"), // mitigation | reconstruction
  takenAt: text("taken_at").notNull().default(""),
});
export const insertPhotoSchema = createInsertSchema(photos).omit({ id: true });
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type Photo = typeof photos.$inferSelect;

// ── Messaging ────────────────────────────────────────────────────────────────
export const channels = sqliteTable("channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertChannelSchema = createInsertSchema(channels).omit({ id: true });
export type InsertChannel = z.infer<typeof insertChannelSchema>;
export type Channel = typeof channels.$inferSelect;

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  channelId: integer("channel_id").notNull(),
  author: text("author").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(""),
});
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// ── Customer Portal Messages (two-way homeowner <-> Titan thread, per job) ────
export const customerMessages = sqliteTable("customer_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  contactId: integer("contact_id").notNull(),
  // "customer" (homeowner) | "titan" (Titan team)
  sender: text("sender").notNull(),
  authorName: text("author_name"),
  body: text("body").notNull(),
  readByStaff: integer("read_by_staff").default(0),
  readByCustomer: integer("read_by_customer").default(0),
  createdAt: text("created_at").notNull().default(""),
});
export const insertCustomerMessageSchema = createInsertSchema(customerMessages).omit({ id: true });
export type InsertCustomerMessage = z.infer<typeof insertCustomerMessageSchema>;
export type CustomerMessage = typeof customerMessages.$inferSelect;

// ── Emails ───────────────────────────────────────────────────────────────────
export const emails = sqliteTable("emails", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  folder: text("folder").notNull().default("inbox"), // inbox | sent | drafts
  from: text("from").notNull(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  read: integer("read").default(0),
  createdAt: text("created_at").notNull().default(""),
});
export const insertEmailSchema = createInsertSchema(emails).omit({ id: true });
export type InsertEmail = z.infer<typeof insertEmailSchema>;
export type Email = typeof emails.$inferSelect;

// ── Scheduling / Shifts ──────────────────────────────────────────────────────
export const shifts = sqliteTable("shifts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id"),          // linked job (optional)
  techName: text("tech_name").notNull(),
  shiftDate: text("shift_date").notNull(), // YYYY-MM-DD
  startTime: text("start_time"),           // HH:MM
  endTime: text("end_time"),
  title: text("title"),
  notes: text("notes"),
  notificationSent: integer("notification_sent").default(0),
  createdAt: text("created_at").notNull().default(""),
});
export const insertShiftSchema = createInsertSchema(shifts).omit({ id: true });
export type InsertShift = z.infer<typeof insertShiftSchema>;
export type Shift = typeof shifts.$inferSelect;

// ── Payout Methods ───────────────────────────────────────────────────────────
export const payoutMethods = sqliteTable("payout_methods", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contactId: integer("contact_id").notNull(),
  method: text("method").notNull(), // cashapp | venmo | zelle | direct_deposit
  handle: text("handle"),           // $cashtag, phone, email, routing info (JSON)
  isDefault: integer("is_default").default(0),
  createdAt: text("created_at").notNull().default(""),
});
export const insertPayoutMethodSchema = createInsertSchema(payoutMethods).omit({ id: true });
export type InsertPayoutMethod = z.infer<typeof insertPayoutMethodSchema>;
export type PayoutMethod = typeof payoutMethods.$inferSelect;

// ── Payout Requests ──────────────────────────────────────────────────────────
export const payoutRequests = sqliteTable("payout_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contactId: integer("contact_id").notNull(),
  jobId: integer("job_id"),          // linked job for auto-apply
  amount: real("amount").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | paid
  payoutMethodId: integer("payout_method_id"),
  description: text("description"),
  adminNotes: text("admin_notes"),
  paidAt: text("paid_at"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertPayoutRequestSchema = createInsertSchema(payoutRequests).omit({ id: true });
export type InsertPayoutRequest = z.infer<typeof insertPayoutRequestSchema>;
export type PayoutRequest = typeof payoutRequests.$inferSelect;

// ── Drying Records (IICRC S500) ──────────────────────────────────────────────
export const dryingRecords = sqliteTable("drying_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  // Header info
  readingDate: text("reading_date").notNull(),   // YYYY-MM-DD
  readingTime: text("reading_time"),              // HH:MM
  techName: text("tech_name").notNull(),
  dayNumber: integer("day_number").default(1),    // Day 1, Day 2, etc.
  // IICRC S500 Classification
  waterCategory: text("water_category").notNull().default("category1"), // category1|category2|category3
  waterClass: text("water_class").notNull().default("class2"),           // class1|class2|class3|class4
  // Structural moisture readings (JSON array of { location, material, reading, gpp, target })
  moistureReadings: text("moisture_readings").notNull().default("[]"),
  // Psychrometric data
  tempF: real("temp_f"),          // Ambient temperature °F
  rhPct: real("rh_pct"),           // Relative humidity %
  gpp: real("gpp"),                // Grains per pound (calculated)
  dewPointF: real("dew_point_f"),  // Dew point °F
  specificHumidity: real("specific_humidity"),
  // Equipment log (JSON array of { type, qty, placement, serialNumber })
  equipment: text("equipment").notNull().default("[]"),
  // Affected areas (JSON array of { room, material, sqft, wetPct })
  affectedAreas: text("affected_areas").notNull().default("[]"),
  // Goal tracking
  dryingGoalMet: integer("drying_goal_met").default(0), // 0=no 1=yes
  structuralDryingComplete: integer("structural_drying_complete").default(0),
  // Notes / observations
  observations: text("observations"),
  // Signature (tech attestation)
  techSignature: text("tech_signature"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertDryingRecordSchema = createInsertSchema(dryingRecords).omit({ id: true });
export type InsertDryingRecord = z.infer<typeof insertDryingRecordSchema>;
export type DryingRecord = typeof dryingRecords.$inferSelect;

// ── Employees (auth + role-based access) ─────────────────────────────────
export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // Role: owner | admin | tech | sales | office
  role: text("role").default("tech").notNull(),
  // Position title displayed in UI (e.g. "Lead Technician", "Project Manager")
  position: text("position"),
  gmailEmail: text("gmail_email"),
  phone: text("phone"),
  // Auth — bcrypt hash of password; PIN is 4–6 digits stored as hash too
  passwordHash: text("password_hash"),
  pin: text("pin"),                  // plain 4-digit PIN for quick field login (hashed on server)
  // JSON array of explicitly granted or denied extra permissions
  // e.g. ["jobs:write","invoices:read"] — merges with role defaults
  permissions: text("permissions").default("[]"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: text("last_login_at"),
  avatarInitials: text("avatar_initials"),  // auto-derived if null
  createdAt: text("created_at").notNull().default(""),
});
export const insertEmployeeSchema = createInsertSchema(employees).omit({ id: true });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employees.$inferSelect;

// ── Portal Sessions ──────────────────────────────────────────────────────────
export const portalSessions = sqliteTable("portal_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contactId: integer("contact_id").notNull(),
  sessionToken: text("session_token").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(""),
});
export const insertPortalSessionSchema = createInsertSchema(portalSessions).omit({ id: true });
export type InsertPortalSession = z.infer<typeof insertPortalSessionSchema>;
export type PortalSession = typeof portalSessions.$inferSelect;

// ── Job Documents (e-signatures + PDF uploads) ────────────────────────────────
export const jobDocuments = sqliteTable("job_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  // "work_authorization" | "deviation_of_standard" | "pdf_upload" | "other"
  docType: text("doc_type").notNull(),
  title: text("title").notNull(),
  // For signed forms: JSON blob of form field values
  formData: text("form_data"),
  // Signature as base64 data URL (canvas PNG)
  signatureData: text("signature_data"),
  signerName: text("signer_name"),
  signerRole: text("signer_role"),  // "homeowner" | "insured" | "tech" | "contractor"
  signedAt: text("signed_at"),
  // For PDF uploads: base64 data URL of the file
  fileData: text("file_data"),
  fileName: text("file_name"),
  fileMimeType: text("file_mime_type"),
  fileSize: integer("file_size"),
  // Status: "unsigned" | "signed" | "uploaded"
  status: text("status").notNull().default("unsigned"),
  phase: text("phase").default("mitigation"), // mitigation | reconstruction
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertJobDocumentSchema = createInsertSchema(jobDocuments).omit({ id: true });
export type InsertJobDocument = z.infer<typeof insertJobDocumentSchema>;
export type JobDocument = typeof jobDocuments.$inferSelect;

// ── Equipment ─────────────────────────────────────────────────────────────────
export const equipment = sqliteTable("equipment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),           // e.g. "LGR Dehumidifier #3"
  category: text("category").notNull(),   // dehumidifier | air_mover | air_scrubber | hepa | moisture_meter | other
  serialNumber: text("serial_number"),
  model: text("model"),
  dailyRate: real("daily_rate").default(0), // billing rate per day
  status: text("status").default("available"), // available | deployed | maintenance | retired
  currentJobId: integer("current_job_id"),
  deployedAt: text("deployed_at"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertEquipmentSchema = createInsertSchema(equipment).omit({ id: true });
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type Equipment = typeof equipment.$inferSelect;

// ── Equipment Deployments (history log) ──────────────────────────────────────
export const equipmentDeployments = sqliteTable("equipment_deployments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  equipmentId: integer("equipment_id").notNull(),
  jobId: integer("job_id").notNull(),
  deployedAt: text("deployed_at").notNull(),
  returnedAt: text("returned_at"),
  daysOut: integer("days_out"),
  billedAmount: real("billed_amount"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertEquipmentDeploymentSchema = createInsertSchema(equipmentDeployments).omit({ id: true });
export type InsertEquipmentDeployment = z.infer<typeof insertEquipmentDeploymentSchema>;
export type EquipmentDeployment = typeof equipmentDeployments.$inferSelect;

// ── Job Costs (actual vs estimated) ──────────────────────────────────────────
export const jobCosts = sqliteTable("job_costs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  category: text("category").notNull(), // labor | material | subcontractor | equipment | overhead | other
  description: text("description").notNull(),
  quantity: real("quantity").default(1),
  unitCost: real("unit_cost").default(0),
  total: real("total").default(0),
  vendor: text("vendor"),
  receiptRef: text("receipt_ref"),
  enteredBy: text("entered_by"),
  costDate: text("cost_date"),
  phase: text("phase").default("mitigation"), // mitigation | reconstruction
  createdAt: text("created_at").notNull().default(""),
});
export const insertJobCostSchema = createInsertSchema(jobCosts).omit({ id: true });
export type InsertJobCost = z.infer<typeof insertJobCostSchema>;
export type JobCost = typeof jobCosts.$inferSelect;

// ── Supplements ──────────────────────────────────────────────────────────────
export const supplements = sqliteTable("supplements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  title: text("title").notNull(),
  amountRequested: real("amount_requested").default(0),
  amountApproved: real("amount_approved"),
  carrier: text("carrier"),
  adjusterName: text("adjuster_name"),
  submittedAt: text("submitted_at"),
  responseAt: text("response_at"),
  followUpDue: text("follow_up_due"),
  status: text("status").default("pending"), // pending | approved | partial | denied | disputed
  notes: text("notes"),
  lineItems: text("line_items").default("[]"), // JSON
  createdAt: text("created_at").notNull().default(""),
});
export const insertSupplementSchema = createInsertSchema(supplements).omit({ id: true });
export type InsertSupplement = z.infer<typeof insertSupplementSchema>;
export type Supplement = typeof supplements.$inferSelect;

// ── Follow-Up Sequences ───────────────────────────────────────────────────────
export const followUpSequences = sqliteTable("follow_up_sequences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  contactId: integer("contact_id").notNull(),
  sequenceType: text("sequence_type").notNull(), // post_job_30d | post_job_6mo | annual | custom
  scheduledAt: text("scheduled_at").notNull(),
  sentAt: text("sent_at"),
  status: text("status").default("pending"), // pending | sent | skipped
  emailSubject: text("email_subject"),
  emailBody: text("email_body"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertFollowUpSequenceSchema = createInsertSchema(followUpSequences).omit({ id: true });
export type InsertFollowUpSequence = z.infer<typeof insertFollowUpSequenceSchema>;
export type FollowUpSequence = typeof followUpSequences.$inferSelect;

// ── Safety Incidents ──────────────────────────────────────────────────────────
export const safetyIncidents = sqliteTable("safety_incidents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id"),
  incidentType: text("incident_type").notNull(), // injury | near_miss | property_damage | ppe_violation | environmental | other
  severity: text("severity").default("low"), // low | medium | high | critical
  reportedBy: text("reported_by").notNull(),
  incidentDate: text("incident_date").notNull(),
  description: text("description").notNull(),
  personsInvolved: text("persons_involved"),  // JSON array
  correctiveAction: text("corrective_action"),
  oshaRecordable: integer("osha_recordable").default(0), // 0 | 1
  followUpDate: text("follow_up_date"),
  closedAt: text("closed_at"),
  status: text("status").default("open"), // open | investigating | closed
  createdAt: text("created_at").notNull().default(""),
});
export const insertSafetyIncidentSchema = createInsertSchema(safetyIncidents).omit({ id: true });
export type InsertSafetyIncident = z.infer<typeof insertSafetyIncidentSchema>;
export type SafetyIncident = typeof safetyIncidents.$inferSelect;

// ── Line Item Library (Xactimate-style) ──────────────────────────────────────
export const lineItemLibrary = sqliteTable("line_item_library", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull(), // demo | drying | cleaning | reconstruction | contents | other
  subCategory: text("sub_category"),
  code: text("code").notNull(),         // e.g. WTR-DEM-001
  description: text("description").notNull(),
  unit: text("unit").notNull(),         // SF | LF | EA | HR | DAY | LS
  unitPrice: real("unit_price").notNull(),
  iicrcRef: text("iicrc_ref"),          // IICRC standard reference
  notes: text("notes"),
  isCustom: integer("is_custom").default(0), // 0=standard 1=user-defined
  createdAt: text("created_at").notNull().default(""),
});
export const insertLineItemSchema = createInsertSchema(lineItemLibrary).omit({ id: true });
export type InsertLineItem = z.infer<typeof insertLineItemSchema>;
export type LineItem = typeof lineItemLibrary.$inferSelect;

// ── Adjuster Contacts ─────────────────────────────────────────────────────────
export const adjusters = sqliteTable("adjusters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  carrier: text("carrier").notNull(),
  territory: text("territory"),         // e.g. "Augusta GA / CSRA"
  email: text("email"),
  phone: text("phone"),
  preferredContact: text("preferred_contact").default("email"), // email | phone | text
  notes: text("notes"),
  claimsCount: integer("claims_count").default(0),
  avgPayDays: real("avg_pay_days"),     // computed: avg days carrier pays
  createdAt: text("created_at").notNull().default(""),
});
export const insertAdjusterSchema = createInsertSchema(adjusters).omit({ id: true });
export type InsertAdjuster = z.infer<typeof insertAdjusterSchema>;
export type Adjuster = typeof adjusters.$inferSelect;

// ── Adjuster Meetings ─────────────────────────────────────────────────────────
export const adjusterMeetings = sqliteTable("adjuster_meetings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  adjusterId: integer("adjuster_id"),
  adjusterName: text("adjuster_name"),  // fallback if no adjuster record
  meetingDate: text("meeting_date").notNull(),
  meetingTime: text("meeting_time"),
  location: text("location"),
  purpose: text("purpose").default("walkthrough"), // walkthrough | reinspection | scope_review | final
  outcome: text("outcome"),
  followUpRequired: integer("follow_up_required").default(0),
  confirmationSent: integer("confirmation_sent").default(0),
  createdAt: text("created_at").notNull().default(""),
});
export const insertAdjusterMeetingSchema = createInsertSchema(adjusterMeetings).omit({ id: true });
export type InsertAdjusterMeeting = z.infer<typeof insertAdjusterMeetingSchema>;
export type AdjusterMeeting = typeof adjusterMeetings.$inferSelect;

// ── Pre-Job Inspection Checklist ──────────────────────────────────────────────
export const inspectionChecklists = sqliteTable("inspection_checklists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  inspectedBy: text("inspected_by").notNull(),
  inspectionDate: text("inspection_date").notNull(),
  // Moisture baseline readings (JSON: [{location, reading, unit}])
  moistureReadings: text("moisture_readings").default("[]"),
  // Pre-existing damage (JSON: [{area, description, photoRef}])
  preExistingDamage: text("pre_existing_damage").default("[]"),
  // Scope confirmed items (JSON array of strings)
  scopeItems: text("scope_items").default("[]"),
  // Checklist items (JSON: [{item, checked, notes}])
  checklistItems: text("checklist_items").default("[]"),
  generalNotes: text("general_notes"),
  // Signature
  signedBy: text("signed_by"),
  signatureData: text("signature_data"), // base64
  signedAt: text("signed_at"),
  status: text("status").default("draft"), // draft | complete
  createdAt: text("created_at").notNull().default(""),
});
export const insertInspectionChecklistSchema = createInsertSchema(inspectionChecklists).omit({ id: true });
export type InsertInspectionChecklist = z.infer<typeof insertInspectionChecklistSchema>;
export type InspectionChecklist = typeof inspectionChecklists.$inferSelect;

// ── Review Requests ───────────────────────────────────────────────────────────
export const reviewRequests = sqliteTable("review_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  contactId: integer("contact_id").notNull(),
  channel: text("channel").default("email"), // email | sms
  status: text("status").default("pending"), // pending | sent | clicked | reviewed | skipped
  sentAt: text("sent_at"),
  reviewUrl: text("review_url"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertReviewRequestSchema = createInsertSchema(reviewRequests).omit({ id: true });
export type InsertReviewRequest = z.infer<typeof insertReviewRequestSchema>;
export type ReviewRequest = typeof reviewRequests.$inferSelect;

// ── IICRC Certifications ──────────────────────────────────────────────────────
export const certifications = sqliteTable("certifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeName: text("employee_name").notNull(),
  certType: text("cert_type").notNull(), // WRT | ASD | AMRT | FSRT | OSHA10 | OSHA30 | CCT | RCT | other
  certNumber: text("cert_number"),
  issuedBy: text("issued_by").default("IICRC"),
  issuedDate: text("issued_date"),
  expirationDate: text("expiration_date"),
  status: text("status").default("active"), // active | expiring_soon | expired
  alertSent60: integer("alert_sent_60").default(0),
  alertSent30: integer("alert_sent_30").default(0),
  createdAt: text("created_at").notNull().default(""),
});
export const insertCertificationSchema = createInsertSchema(certifications).omit({ id: true });
export type InsertCertification = z.infer<typeof insertCertificationSchema>;
export type Certification = typeof certifications.$inferSelect;

// ── Activity Log (Job Timeline) ──────────────────────────────────────────────
export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id"),
  entityType: text("entity_type").notNull().default("job"), // job | estimate | invoice | drying | payment | document
  entityId: integer("entity_id"),
  action: text("action").notNull(), // created | updated | status_changed | note_added | photo_added | signed | paid | assigned
  actor: text("actor").notNull().default("System"),
  description: text("description").notNull(),
  metadata: text("metadata").default("{}"), // JSON blob for extra context
  createdAt: text("created_at").notNull().default(""),
});
export const insertActivityLogSchema = createInsertSchema(activityLog).omit({ id: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLog.$inferSelect;

// ── SMS Threads ───────────────────────────────────────────────────────────────
export const smsMessages = sqliteTable("sms_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id"),
  contactId: integer("contact_id"),
  direction: text("direction").notNull().default("outbound"), // inbound | outbound
  from: text("from").notNull(),
  to: text("to").notNull(),
  body: text("body").notNull(),
  status: text("status").default("sent"), // sent | delivered | failed | received
  twilioSid: text("twilio_sid"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertSmsMessageSchema = createInsertSchema(smsMessages).omit({ id: true });
export type InsertSmsMessage = z.infer<typeof insertSmsMessageSchema>;
export type SmsMessage = typeof smsMessages.$inferSelect;

// ── Job Templates ─────────────────────────────────────────────────────────────
export const jobTemplates = sqliteTable("job_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  lossType: text("loss_type").notNull(),
  description: text("description"),
  defaultScope: text("default_scope").notNull().default("[]"), // JSON array of line items
  defaultEquipment: text("default_equipment").notNull().default("[]"), // JSON array
  iicrcProtocol: text("iicrc_protocol"), // reference text
  estimatedDays: integer("estimated_days"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertJobTemplateSchema = createInsertSchema(jobTemplates).omit({ id: true });
export type InsertJobTemplate = z.infer<typeof insertJobTemplateSchema>;
export type JobTemplate = typeof jobTemplates.$inferSelect;

// ── Adjuster Portal Sessions ──────────────────────────────────────────────────
export const adjusterPortalSessions = sqliteTable("adjuster_portal_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  adjusterId: integer("adjuster_id"),
  adjusterName: text("adjuster_name").notNull(),
  carrier: text("carrier").notNull(),
  accessToken: text("access_token").notNull(),
  jobIds: text("job_ids").notNull().default("[]"), // JSON array of job IDs they can view
  expiresAt: text("expires_at").notNull(),
  lastAccessedAt: text("last_accessed_at"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertAdjusterPortalSessionSchema = createInsertSchema(adjusterPortalSessions).omit({ id: true });
export type InsertAdjusterPortalSession = z.infer<typeof insertAdjusterPortalSessionSchema>;
export type AdjusterPortalSession = typeof adjusterPortalSessions.$inferSelect;

// ── Tech Notifications ────────────────────────────────────────────────────────
export const techNotifications = sqliteTable("tech_notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  techName: text("tech_name").notNull(),
  type: text("type").notNull().default("assignment"), // assignment | drying_alert | follow_up | message | general
  title: text("title").notNull(),
  body: text("body").notNull(),
  jobId: integer("job_id"),
  read: integer("read").default(0),
  createdAt: text("created_at").notNull().default(""),
});
export const insertTechNotificationSchema = createInsertSchema(techNotifications).omit({ id: true });
export type InsertTechNotification = z.infer<typeof insertTechNotificationSchema>;
export type TechNotification = typeof techNotifications.$inferSelect;

// ── Suite 4: Carrier AR Intelligence ─────────────────────────────────────────
export const carrierArEvents = sqliteTable("carrier_ar_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  invoiceId: integer("invoice_id"),
  carrier: text("carrier").notNull(),
  eventType: text("event_type").notNull(), // invoice_sent | follow_up_30 | follow_up_60 | follow_up_90 | paid | disputed | denied
  amount: real("amount"),
  daysOutstanding: integer("days_outstanding"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertCarrierArEventSchema = createInsertSchema(carrierArEvents).omit({ id: true });
export type InsertCarrierArEvent = z.infer<typeof insertCarrierArEventSchema>;
export type CarrierArEvent = typeof carrierArEvents.$inferSelect;

// ── Suite 4: TPA Programs ────────────────────────────────────────────────────
export const tpaPrograms = sqliteTable("tpa_programs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),        // e.g. "Contractor Connection"
  carrier: text("carrier"),
  thresholdResponseHrs: integer("threshold_response_hrs").default(2),
  thresholdCycleDays: integer("threshold_cycle_days").default(30),
  thresholdCsatMin: real("threshold_csat_min").default(4.0),
  thresholdDocPct: integer("threshold_doc_pct").default(95),
  status: text("status").default("active"), // active | inactive
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertTpaProgramSchema = createInsertSchema(tpaPrograms).omit({ id: true });
export type InsertTpaProgram = z.infer<typeof insertTpaProgramSchema>;
export type TpaProgram = typeof tpaPrograms.$inferSelect;

export const tpaJobMetrics = sqliteTable("tpa_job_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tpaProgramId: integer("tpa_program_id").notNull(),
  jobId: integer("job_id").notNull(),
  responseHrs: real("response_hrs"),
  cycleDays: integer("cycle_days"),
  csatScore: real("csat_score"),
  docComplete: integer("doc_complete").default(0), // 0|1
  disputed: integer("disputed").default(0),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertTpaJobMetricSchema = createInsertSchema(tpaJobMetrics).omit({ id: true });
export type InsertTpaJobMetric = z.infer<typeof insertTpaJobMetricSchema>;
export type TpaJobMetric = typeof tpaJobMetrics.$inferSelect;

// ── Suite 4: Unified Communications ─────────────────────────────────────────
export const commTimeline = sqliteTable("comm_timeline", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id"),
  contactId: integer("contact_id"),
  channel: text("channel").notNull(), // email | sms | call | internal | note
  direction: text("direction").default("inbound"), // inbound | outbound | internal
  from: text("from"),
  to: text("to"),
  subject: text("subject"),
  body: text("body").notNull(),
  aiTag: text("ai_tag"),       // auto-tagged category: status_update | supplement | payment | scheduling | other
  aiSummary: text("ai_summary"),
  jobTagConfidence: real("job_tag_confidence").default(1.0),
  createdAt: text("created_at").notNull().default(""),
});
export const insertCommTimelineSchema = createInsertSchema(commTimeline).omit({ id: true });
export type InsertCommTimeline = z.infer<typeof insertCommTimelineSchema>;
export type CommTimeline = typeof commTimeline.$inferSelect;

// ── Suite 4: IoT Sensor Readings ──────────────────────────────────────────────
export const iotSensors = sqliteTable("iot_sensors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  sensorId: text("sensor_id").notNull(),  // device ID / serial
  brand: text("brand").default("manual"), // tramex | omnisense | govee | manual
  location: text("location").notNull(),   // e.g. "Kitchen Wall - North"
  material: text("material").default("drywall"), // drywall | subfloor | concrete | wood | other
  targetWme: real("target_wme").default(16), // IICRC S500 target WME%
  status: text("status").default("active"), // active | removed | complete
  createdAt: text("created_at").notNull().default(""),
});
export const insertIotSensorSchema = createInsertSchema(iotSensors).omit({ id: true });
export type InsertIotSensor = z.infer<typeof insertIotSensorSchema>;
export type IotSensor = typeof iotSensors.$inferSelect;

export const iotReadings = sqliteTable("iot_readings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sensorId: integer("sensor_id").notNull(),
  jobId: integer("job_id").notNull(),
  wme: real("wme").notNull(),       // Wood Moisture Equivalent %
  tempF: real("temp_f"),
  rhPct: real("rh_pct"),
  isAlert: integer("is_alert").default(0), // 1 if above target WME
  readingAt: text("reading_at").notNull().default(""),
  createdAt: text("created_at").notNull().default(""),
});
export const insertIotReadingSchema = createInsertSchema(iotReadings).omit({ id: true });
export type InsertIotReading = z.infer<typeof insertIotReadingSchema>;
export type IotReading = typeof iotReadings.$inferSelect;

// ── Suite 4: IICRC Compliance Checklists ──────────────────────────────────────
export const complianceChecklists = sqliteTable("compliance_checklists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  standard: text("standard").notNull(), // S500 | S520 | S700 | S900
  lossCategory: text("loss_category").notNull(), // cat1_water | cat2_water | cat3_water | class1-4 | fire_smoke | mold | precursors
  completedItems: text("completed_items").notNull().default("[]"), // JSON array of completed item IDs
  flaggedItems: text("flagged_items").notNull().default("[]"),     // JSON array of items with issues
  overallStatus: text("overall_status").default("incomplete"), // incomplete | in_progress | compliant | non_compliant
  techName: text("tech_name"),
  preBuiltVintage: integer("pre_built_vintage").default(0), // 1 = pre-1978 building (lead/asbestos triggers)
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
});
export const insertComplianceChecklistSchema = createInsertSchema(complianceChecklists).omit({ id: true });
export type InsertComplianceChecklist = z.infer<typeof insertComplianceChecklistSchema>;
export type ComplianceChecklist = typeof complianceChecklists.$inferSelect;

// ── Suite 4: Emergency Intake ─────────────────────────────────────────────────
export const emergencyIntakes = sqliteTable("emergency_intakes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  callerName: text("caller_name"),
  callerPhone: text("caller_phone").notNull(),
  address: text("address"),
  lossType: text("loss_type"),     // water | fire | mold | storm | other
  waterCategory: text("water_category"), // category1 | category2 | category3
  activeFlow: integer("active_flow").default(0), // 1=yes still flowing
  roomCount: integer("room_count"),
  electricalExposure: integer("electrical_exposure").default(0),
  urgencyScore: integer("urgency_score").default(5), // 1-10
  dispatchedTech: text("dispatched_tech"),
  dispatchedAt: text("dispatched_at"),
  linkedJobId: integer("linked_job_id"),
  aiNotes: text("ai_notes"),       // AI triage summary
  status: text("status").default("pending"), // pending | dispatched | converted | cancelled
  createdAt: text("created_at").notNull().default(""),
});
export const insertEmergencyIntakeSchema = createInsertSchema(emergencyIntakes).omit({ id: true });
export type InsertEmergencyIntake = z.infer<typeof insertEmergencyIntakeSchema>;
export type EmergencyIntake = typeof emergencyIntakes.$inferSelect;

// ── Suite 4: Referral Profitability ───────────────────────────────────────────
// Uses existing contacts + jobs + payments tables — no new table needed,
// computed via report endpoints

// ── Suite 4: Equipment Lifecycle ─────────────────────────────────────────────
export const equipmentMaintenanceLogs = sqliteTable("equipment_maintenance_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  equipmentId: integer("equipment_id").notNull(),
  maintenanceType: text("maintenance_type").notNull(), // filter_replace | inspection | repair | calibration | service
  performedBy: text("performed_by"),
  cost: real("cost").default(0),
  runtimeHoursAtService: real("runtime_hours_at_service"),
  notes: text("notes"),
  nextServiceDue: text("next_service_due"), // ISO date
  performedAt: text("performed_at").notNull().default(""),
  createdAt: text("created_at").notNull().default(""),
});
export const insertEquipmentMaintenanceLogSchema = createInsertSchema(equipmentMaintenanceLogs).omit({ id: true });
export type InsertEquipmentMaintenanceLog = z.infer<typeof insertEquipmentMaintenanceLogSchema>;
export type EquipmentMaintenanceLog = typeof equipmentMaintenanceLogs.$inferSelect;

// Add runtimeHours + purchaseCost to equipment (migration-safe via storage init)

// ── Suite 4: Subrogation Cases ────────────────────────────────────────────────
export const subrogationCases = sqliteTable("subrogation_cases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  potentialScore: text("potential_score").default("low"), // low | medium | high
  causeOfLoss: text("cause_of_loss"),
  responsibleParty: text("responsible_party"),
  liabilityNotes: text("liability_notes"),
  status: text("status").default("identified"), // identified | package_built | submitted | recovery_pending | recovered | closed
  packageBuiltAt: text("package_built_at"),
  submittedAt: text("submitted_at"),
  recoveryAmount: real("recovery_amount"),
  recoveryDate: text("recovery_date"),
  carrierContact: text("carrier_contact"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertSubrogationCaseSchema = createInsertSchema(subrogationCases).omit({ id: true });
export type InsertSubrogationCase = z.infer<typeof insertSubrogationCaseSchema>;
export type SubrogationCase = typeof subrogationCases.$inferSelect;

// ── Suite 4: Storm Marketing Campaigns ────────────────────────────────────────
export const stormCampaigns = sqliteTable("storm_campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventType: text("event_type").notNull(), // hail | wind | flood | tornado | hurricane | fire | freeze
  triggerDate: text("trigger_date").notNull(),
  affectedZips: text("affected_zip_codes").notNull().default("[]"), // JSON array
  severity: text("severity").default("moderate"), // minor | moderate | major | catastrophic
  status: text("status").default("draft"), // draft | active | paused | complete
  // Campaign actions
  googleAdsActivated: integer("google_ads_activated").default(0),
  adsBudgetIncrease: real("ads_budget_increase"),
  smsContactsCount: integer("sms_contacts_count").default(0),
  emailContactsCount: integer("email_contacts_count").default(0),
  gbpUpdated: integer("gbp_updated").default(0),
  // Results
  leadsGenerated: integer("leads_generated").default(0),
  jobsBooked: integer("jobs_booked").default(0),
  revenueAttributed: real("revenue_attributed").default(0),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertStormCampaignSchema = createInsertSchema(stormCampaigns).omit({ id: true });
export type InsertStormCampaign = z.infer<typeof insertStormCampaignSchema>;
export type StormCampaign = typeof stormCampaigns.$inferSelect;

// ── Suite 4: Drone/LiDAR Assessments ─────────────────────────────────────────
export const droneAssessments = sqliteTable("drone_assessments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  flightDate: text("flight_date").notNull(),
  pilotName: text("pilot_name"),
  equipmentUsed: text("equipment_used"), // e.g. "DJI Mavic 3 Pro + LiDAR module"
  // Damage classification (JSON: [{zone, damageType, severity, sqft}])
  damageZones: text("damage_zones").notNull().default("[]"),
  totalDamagedSqft: real("total_damaged_sqft"),
  // Findings
  structuralConcerns: text("structural_concerns"),
  accessPointNotes: text("access_point_notes"),
  aiClassificationNotes: text("ai_classification_notes"),
  // Files stored as JSON array of {filename, dataUrl, type}
  imageFiles: text("image_files").notNull().default("[]"),
  modelFile: text("model_file"),     // 3D model reference
  status: text("status").default("draft"), // draft | complete | xactimate_ready
  xactimateNotes: text("xactimate_notes"), // output for Xactimate import
  createdAt: text("created_at").notNull().default(""),
});
export const insertDroneAssessmentSchema = createInsertSchema(droneAssessments).omit({ id: true });
export type InsertDroneAssessment = z.infer<typeof insertDroneAssessmentSchema>;
export type DroneAssessment = typeof droneAssessments.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 5 SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

// ── Suite 5: QB Sync Log ──────────────────────────────────────────────────────
export const qbSyncLog = sqliteTable("qb_sync_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(), // invoice | payment | job_cost
  entityId: integer("entity_id").notNull(),
  qbId: text("qb_id"),
  status: text("status").notNull().default("pending"), // pending | synced | error
  errorMessage: text("error_message"),
  syncedAt: text("synced_at"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertQbSyncLogSchema = createInsertSchema(qbSyncLog).omit({ id: true });
export type InsertQbSyncLog = z.infer<typeof insertQbSyncLogSchema>;
export type QbSyncLog = typeof qbSyncLog.$inferSelect;

// ── Suite 5: AR Follow-Up Rules ───────────────────────────────────────────────
export const arFollowUpRules = sqliteTable("ar_followup_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  triggerDays: integer("trigger_days").notNull(), // 15, 30, 45
  channel: text("channel").notNull().default("sms"), // sms | email | both
  messageTemplate: text("message_template").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(""),
});
export const insertArFollowUpRuleSchema = createInsertSchema(arFollowUpRules).omit({ id: true });
export type InsertArFollowUpRule = z.infer<typeof insertArFollowUpRuleSchema>;
export type ArFollowUpRule = typeof arFollowUpRules.$inferSelect;

export const arFollowUpLog = sqliteTable("ar_followup_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id").notNull(),
  ruleId: integer("rule_id").notNull(),
  sentAt: text("sent_at").notNull(),
  channel: text("channel").notNull(),
  messageBody: text("message_body").notNull(),
  status: text("status").notNull().default("sent"), // sent | failed
});
export const insertArFollowUpLogSchema = createInsertSchema(arFollowUpLog).omit({ id: true });
export type InsertArFollowUpLog = z.infer<typeof insertArFollowUpLogSchema>;
export type ArFollowUpLog = typeof arFollowUpLog.$inferSelect;

// ── Suite 5: Lien Waivers ─────────────────────────────────────────────────────
export const lienWaivers = sqliteTable("lien_waivers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  waiverType: text("waiver_type").notNull(), // conditional_progress | unconditional_progress | conditional_final | unconditional_final
  state: text("state").notNull().default("GA"), // GA | SC
  throughDate: text("through_date"),
  amount: real("amount"),
  signerName: text("signer_name"),
  signerTitle: text("signer_title"),
  signedAt: text("signed_at"),
  status: text("status").notNull().default("draft"), // draft | sent | signed | filed
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertLienWaiverSchema = createInsertSchema(lienWaivers).omit({ id: true });
export type InsertLienWaiver = z.infer<typeof insertLienWaiverSchema>;
export type LienWaiver = typeof lienWaivers.$inferSelect;

// ── Suite 5: GPS Time Clock ───────────────────────────────────────────────────
export const timeClock = sqliteTable("time_clock", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id"),
  employeeName: text("employee_name").notNull(),
  jobId: integer("job_id"),
  clockInAt: text("clock_in_at").notNull(),
  clockOutAt: text("clock_out_at"),
  clockInLat: real("clock_in_lat"),
  clockInLng: real("clock_in_lng"),
  clockOutLat: real("clock_out_lat"),
  clockOutLng: real("clock_out_lng"),
  durationMinutes: integer("duration_minutes"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertTimeClockSchema = createInsertSchema(timeClock).omit({ id: true });
export type InsertTimeClock = z.infer<typeof insertTimeClockSchema>;
export type TimeClock = typeof timeClock.$inferSelect;

// ── Suite 5: Pre-Departure Checklists ─────────────────────────────────────────
export const departureChecklists = sqliteTable("departure_checklists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  employeeName: text("employee_name").notNull(),
  lossType: text("loss_type"),
  items: text("items").notNull().default("[]"), // JSON: [{label, checked, required}]
  completedAt: text("completed_at"),
  allRequiredComplete: integer("all_required_complete", { mode: "boolean" }).default(false),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertDepartureChecklistSchema = createInsertSchema(departureChecklists).omit({ id: true });
export type InsertDepartureChecklist = z.infer<typeof insertDepartureChecklistSchema>;
export type DepartureChecklist = typeof departureChecklists.$inferSelect;

// ── Suite 5: Appointment Reminders ────────────────────────────────────────────
export const appointmentReminders = sqliteTable("appointment_reminders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  scheduledFor: text("scheduled_for").notNull(),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  reminderType: text("reminder_type").notNull().default("24h"), // 24h | 2h | custom
  channel: text("channel").notNull().default("sms"), // sms | email | both
  status: text("status").notNull().default("scheduled"), // scheduled | sent | cancelled
  sentAt: text("sent_at"),
  messageBody: text("message_body"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertAppointmentReminderSchema = createInsertSchema(appointmentReminders).omit({ id: true });
export type InsertAppointmentReminder = z.infer<typeof insertAppointmentReminderSchema>;
export type AppointmentReminder = typeof appointmentReminders.$inferSelect;

// ── Suite 5: Hazmat Flags ─────────────────────────────────────────────────────
export const hazmatFlags = sqliteTable("hazmat_flags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  flagType: text("flag_type").notNull(), // lead_rp | asbestos | mold | drug_residue | biohazard
  riskLevel: text("risk_level").notNull().default("low"), // low | medium | high | critical
  yearBuilt: integer("year_built"),
  autoDetected: integer("auto_detected", { mode: "boolean" }).default(true),
  acknowledged: integer("acknowledged", { mode: "boolean" }).default(false),
  acknowledgedBy: text("acknowledged_by"),
  acknowledgedAt: text("acknowledged_at"),
  documentationRequired: text("documentation_required"), // e.g. "EPA RRP Form, Lead Test Report"
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertHazmatFlagSchema = createInsertSchema(hazmatFlags).omit({ id: true });
export type InsertHazmatFlag = z.infer<typeof insertHazmatFlagSchema>;
export type HazmatFlag = typeof hazmatFlags.$inferSelect;

// ════════════════════════════════════════════════════════════════════════════
// SUITE 6 — Revenue Maximization + Fleet
// ════════════════════════════════════════════════════════════════════════════

// ── Suite 6: Xactimate Line Item Audit Flags ──────────────────────────────────
export const xactAuditFlags = sqliteTable("xact_audit_flags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  estimateId: integer("estimate_id"),
  lossType: text("loss_type").notNull(),
  code: text("code").notNull(),           // e.g. WTREQ, WTRNAFAN
  description: text("description").notNull(),
  estimatedValue: real("estimated_value").default(0),
  status: text("status").notNull().default("flagged"), // flagged | added | dismissed
  dismissedBy: text("dismissed_by"),
  addedAt: text("added_at"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertXactAuditFlagSchema = createInsertSchema(xactAuditFlags).omit({ id: true });
export type InsertXactAuditFlag = z.infer<typeof insertXactAuditFlagSchema>;
export type XactAuditFlag = typeof xactAuditFlags.$inferSelect;

// ── Suite 6: Past Approved Claims Library ─────────────────────────────────────
export const approvedClaims = sqliteTable("approved_claims", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  carrier: text("carrier").notNull(),
  claimNumber: text("claim_number"),
  jobId: integer("job_id"),
  lossType: text("loss_type"),
  lineItemCode: text("line_item_code").notNull(),
  lineItemDescription: text("line_item_description").notNull(),
  approvedAmount: real("approved_amount"),
  approvedDate: text("approved_date"),
  adjusterName: text("adjuster_name"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertApprovedClaimSchema = createInsertSchema(approvedClaims).omit({ id: true });
export type InsertApprovedClaim = z.infer<typeof insertApprovedClaimSchema>;
export type ApprovedClaim = typeof approvedClaims.$inferSelect;

// ── Suite 6: Supplement Tracker (Prompt-Pay) ──────────────────────────────────
export const supplementTrackers = sqliteTable("supplement_trackers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  carrier: text("carrier").notNull(),
  claimNumber: text("claim_number"),
  state: text("state").notNull().default("GA"), // GA | SC
  submittedAt: text("submitted_at").notNull(),
  deadlineDays: integer("deadline_days").notNull().default(15),
  deadlineDate: text("deadline_date"),
  status: text("status").notNull().default("pending"), // pending | responded | escalated | closed
  respondedAt: text("responded_at"),
  approvedAmount: real("approved_amount"),
  deniedAmount: real("denied_amount"),
  followUpSentAt: text("follow_up_sent_at"),
  escalatedAt: text("escalated_at"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertSupplementTrackerSchema = createInsertSchema(supplementTrackers).omit({ id: true });
export type InsertSupplementTracker = z.infer<typeof insertSupplementTrackerSchema>;
export type SupplementTracker = typeof supplementTrackers.$inferSelect;

// ── Suite 6: Adjuster CE Courses ──────────────────────────────────────────────
export const adjusterCourses = sqliteTable("adjuster_courses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  category: text("category").notNull(), // water | fire | mold | storm | general
  creditHours: real("credit_hours").notNull().default(1),
  description: text("description"),
  content: text("content"),  // JSON: [{section, body, quiz?}]
  status: text("status").notNull().default("draft"), // draft | published
  createdAt: text("created_at").notNull().default(""),
});
export const insertAdjusterCourseSchema = createInsertSchema(adjusterCourses).omit({ id: true });
export type InsertAdjusterCourse = z.infer<typeof insertAdjusterCourseSchema>;
export type AdjusterCourse = typeof adjusterCourses.$inferSelect;

export const adjusterEnrollments = sqliteTable("adjuster_enrollments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  courseId: integer("course_id").notNull(),
  adjusterId: integer("adjuster_id"),
  adjusterName: text("adjuster_name").notNull(),
  adjusterEmail: text("adjuster_email"),
  carrier: text("carrier"),
  completedAt: text("completed_at"),
  score: integer("score"),
  certificateIssued: integer("certificate_issued", { mode: "boolean" }).default(false),
  createdAt: text("created_at").notNull().default(""),
});
export const insertAdjusterEnrollmentSchema = createInsertSchema(adjusterEnrollments).omit({ id: true });
export type InsertAdjusterEnrollment = z.infer<typeof insertAdjusterEnrollmentSchema>;
export type AdjusterEnrollment = typeof adjusterEnrollments.$inferSelect;

// ── Suite 6: General Conditions Checklist (per job) ───────────────────────────
export const generalConditionsChecklist = sqliteTable("general_conditions_checklist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  items: text("items").notNull().default("[]"), // JSON: [{code, label, category, billed, estimatedValue, notes}]
  totalMissed: real("total_missed").default(0),
  totalBilled: real("total_billed").default(0),
  completedBy: text("completed_by"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertGeneralConditionsSchema = createInsertSchema(generalConditionsChecklist).omit({ id: true });
export type InsertGeneralConditions = z.infer<typeof insertGeneralConditionsSchema>;
export type GeneralConditions = typeof generalConditionsChecklist.$inferSelect;

// ── Suite 6: Vehicle Fleet ────────────────────────────────────────────────────
export const vehicles = sqliteTable("vehicles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),           // e.g. "F-250 #1"
  make: text("make"),
  model: text("model"),
  year: integer("year"),
  vin: text("vin"),
  licensePlate: text("license_plate"),
  color: text("color"),
  status: text("status").notNull().default("active"), // active | in_shop | retired
  assignedTo: text("assigned_to"),
  currentMileage: integer("current_mileage").default(0),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertVehicleSchema = createInsertSchema(vehicles).omit({ id: true });
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehicles.$inferSelect;

export const vehicleMaintenanceLogs = sqliteTable("vehicle_maintenance_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vehicleId: integer("vehicle_id").notNull(),
  type: text("type").notNull(), // oil_change | tire_rotation | brake_service | inspection | repair | other
  description: text("description").notNull(),
  performedBy: text("performed_by"),     // shop name or employee
  mileageAtService: integer("mileage_at_service"),
  cost: real("cost").default(0),
  invoiceNumber: text("invoice_number"),
  serviceDate: text("service_date").notNull(),
  nextServiceMileage: integer("next_service_mileage"),
  nextServiceDate: text("next_service_date"),
  status: text("status").notNull().default("completed"), // scheduled | completed
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertVehicleMaintenanceLogSchema = createInsertSchema(vehicleMaintenanceLogs).omit({ id: true });
export type InsertVehicleMaintenanceLog = z.infer<typeof insertVehicleMaintenanceLogSchema>;
export type VehicleMaintenanceLog = typeof vehicleMaintenanceLogs.$inferSelect;

// ── Ramp Transactions ─────────────────────────────────────────────────────────
export const rampTransactions = sqliteTable("ramp_transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rampId: text("ramp_id"),                    // Ramp's own transaction ID (dedup)
  jobId: integer("job_id"),                   // matched job (nullable until assigned)
  cardHolder: text("card_holder"),
  merchantName: text("merchant_name"),
  merchantCategory: text("merchant_category"),
  amount: real("amount").notNull(),           // always positive (expense)
  currency: text("currency").notNull().default("USD"),
  transactionDate: text("transaction_date").notNull(),
  memo: text("memo"),
  costCategory: text("cost_category"),        // e.g. materials, fuel, equipment, labor, other
  matchStatus: text("match_status").notNull().default("unmatched"), // unmatched | auto | manual | skipped
  importedAt: text("imported_at").notNull().default(""),
  notes: text("notes"),
});
export const insertRampTransactionSchema = createInsertSchema(rampTransactions).omit({ id: true });
export type InsertRampTransaction = z.infer<typeof insertRampTransactionSchema>;
export type RampTransaction = typeof rampTransactions.$inferSelect;

// ── Route Planner ─────────────────────────────────────────────────────────────
export const savedRoutes = sqliteTable("saved_routes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull().default("dedicated"), // dedicated | priority_followup | canvass
  description: text("description"),
  assignedTo: text("assigned_to"),
  color: text("color").notNull().default("#3b82f6"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  estimatedDuration: integer("estimated_duration"), // minutes
  estimatedMiles: real("estimated_miles"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
});
export const insertSavedRouteSchema = createInsertSchema(savedRoutes).omit({ id: true });
export type InsertSavedRoute = z.infer<typeof insertSavedRouteSchema>;
export type SavedRoute = typeof savedRoutes.$inferSelect;

export const routeStops = sqliteTable("route_stops", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  routeId: integer("route_id").notNull(),
  jobId: integer("job_id"),           // linked job (optional)
  contactId: integer("contact_id"),   // linked contact/partner (optional)
  label: text("label").notNull(),     // display name
  address: text("address").notNull(),
  lat: real("lat"),
  lng: real("lng"),
  stopType: text("stop_type").notNull().default("visit"), // visit | canvass | drop_off | pickup | follow_up
  priority: integer("priority").notNull().default(1), // 1=high 2=medium 3=low
  orderIndex: integer("order_index").notNull().default(0),
  notes: text("notes"),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  completedAt: text("completed_at"),
});
export const insertRouteStopSchema = createInsertSchema(routeStops).omit({ id: true });
export type InsertRouteStop = z.infer<typeof insertRouteStopSchema>;
export type RouteStop = typeof routeStops.$inferSelect;

export const routeTrips = sqliteTable("route_trips", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  routeId: integer("route_id").notNull(),
  assignedTo: text("assigned_to"),
  scheduledDate: text("scheduled_date").notNull(),
  status: text("status").notNull().default("scheduled"), // scheduled | in_progress | complete | cancelled
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  actualMiles: real("actual_miles"),
  stopResults: text("stop_results"),  // JSON: {stopId: outcome}
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertRouteTripSchema = createInsertSchema(routeTrips).omit({ id: true });
export type InsertRouteTrip = z.infer<typeof insertRouteTripSchema>;
export type RouteTrip = typeof routeTrips.$inferSelect;

// ── Job Notes ─────────────────────────────────────────────────────────────────
export const jobNotes = sqliteTable("job_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  author: text("author").notNull().default("Titan Team"),
  body: text("body").notNull(),
  isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
  tag: text("tag"),                  // @mention tag (optional)
  editedAt: text("edited_at"),       // set when note is revised
  createdAt: text("created_at").notNull().default(""),
});
export const insertJobNoteSchema = createInsertSchema(jobNotes).omit({ id: true });
export type InsertJobNote = z.infer<typeof insertJobNoteSchema>;
export type JobNote = typeof jobNotes.$inferSelect;

// ── Staff Auth Sessions ────────────────────────────────────────────────────
export const staffSessions = sqliteTable("staff_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull(),
  sessionToken: text("session_token").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(""),
});
export const insertStaffSessionSchema = createInsertSchema(staffSessions).omit({ id: true });
export type InsertStaffSession = z.infer<typeof insertStaffSessionSchema>;
export type StaffSession = typeof staffSessions.$inferSelect;

// ── Job Sketches (Mitigation Floor Plan) ─────────────────────────────────────
export const jobSketches = sqliteTable("job_sketches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  sketchData: text("sketch_data").notNull().default("{}"), // JSON SketchData
  updatedAt: text("updated_at").notNull().default(""),
  createdAt: text("created_at").notNull().default(""),
});
export const insertJobSketchSchema = createInsertSchema(jobSketches).omit({ id: true });
export type InsertJobSketch = z.infer<typeof insertJobSketchSchema>;
export type JobSketch = typeof jobSketches.$inferSelect;

// ── Withdrawal Requests (Partner self-service) ────────────────────────────────
export const withdrawalRequests = sqliteTable("withdrawal_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contactId: integer("contact_id").notNull(),        // partner
  amount: real("amount").notNull(),                   // amount requested
  payoutMethodId: integer("payout_method_id"),        // chosen method
  methodSnapshot: text("method_snapshot"),            // JSON: {method, handle} at time of request
  status: text("status").notNull().default("pending"), // pending | approved | processing | paid | rejected
  partnerNote: text("partner_note"),                  // optional note from partner
  adminNote: text("admin_note"),                      // note from Cody when actioning
  requestedAt: text("requested_at").notNull().default(""),
  processedAt: text("processed_at"),                  // when paid/rejected
});
export const insertWithdrawalRequestSchema = createInsertSchema(withdrawalRequests).omit({ id: true });
export type InsertWithdrawalRequest = z.infer<typeof insertWithdrawalRequestSchema>;
export type WithdrawalRequest = typeof withdrawalRequests.$inferSelect;

// ── BD Calendar Events ────────────────────────────────────────────────────────
export const bdEvents = sqliteTable("bd_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  eventType: text("event_type").notNull().default("meeting"), // breakfast | lunch | coffee | chamber | meeting | other
  date: text("date").notNull(),          // ISO date YYYY-MM-DD
  startTime: text("start_time").notNull(), // HH:MM
  endTime: text("end_time"),              // HH:MM optional
  location: text("location"),
  notes: text("notes"),
  contactId: integer("contact_id"),       // linked partner/contact
  contactEmail: text("contact_email"),    // email to notify (may differ from contact record)
  contactName: text("contact_name"),      // display name for notification
  notifyPartner: integer("notify_partner").default(1), // 1 = send email invite
  notified: integer("notified").default(0),            // 1 = notification sent
  createdBy: text("created_by").default("Cody Brantley"),
  createdAt: text("created_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
});
export const insertBdEventSchema = createInsertSchema(bdEvents).omit({ id: true });
export type InsertBdEvent = z.infer<typeof insertBdEventSchema>;
export type BdEvent = typeof bdEvents.$inferSelect;

// ── Partner Warranty Calls (free fix-it visits on partner-referred jobs) ──────
export const warrantyCalls = sqliteTable("warranty_calls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),             // which job the call was for
  partnerId: integer("partner_id"),               // which referral partner's job
  partnerName: text("partner_name"),              // denormalized for fast display
  issueDescription: text("issue_description").notNull(),  // what needed fixing
  resolution: text("resolution"),                 // what was done
  techAssigned: text("tech_assigned"),
  visitDate: text("visit_date").notNull(),        // YYYY-MM-DD
  laborHours: real("labor_hours").default(0),     // hours spent
  laborRate: real("labor_rate").default(65),      // $/hr (Titan's cost rate)
  materialCost: real("material_cost").default(0), // out-of-pocket materials
  totalCost: real("total_cost").default(0),       // computed: labor*rate + materials
  chargedToPartner: integer("charged_to_partner").default(0), // always 0 = free
  internalNote: text("internal_note"),            // private note (admin only)
  partnerNote: text("partner_note"),              // message shown to partner
  notifyPartner: integer("notify_partner").default(1),
  createdAt: text("created_at").notNull().default(""),
});
export const insertWarrantyCallSchema = createInsertSchema(warrantyCalls).omit({ id: true });
export type InsertWarrantyCall = z.infer<typeof insertWarrantyCallSchema>;
export type WarrantyCall = typeof warrantyCalls.$inferSelect;

// ── Payment Plans (#5) ────────────────────────────────────────────────────────
export const paymentPlans = sqliteTable("payment_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  contactId: integer("contact_id").notNull(),
  totalAmount: real("total_amount").notNull(),
  depositPct: real("deposit_pct").notNull().default(25),
  depositAmount: real("deposit_amount").notNull().default(0),
  installmentAmount: real("installment_amount").notNull().default(0),
  installmentCount: integer("installment_count").notNull().default(4),
  frequency: text("frequency").notNull().default("monthly"), // weekly | biweekly | monthly
  status: text("status").notNull().default("draft"), // draft | active | paid | cancelled
  stripeCustomerId: text("stripe_customer_id"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertPaymentPlanSchema = createInsertSchema(paymentPlans).omit({ id: true });
export type InsertPaymentPlan = z.infer<typeof insertPaymentPlanSchema>;
export type PaymentPlan = typeof paymentPlans.$inferSelect;

export const paymentPlanInstallments = sqliteTable("payment_plan_installments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  planId: integer("plan_id").notNull(),
  dueDate: text("due_date").notNull(),
  amount: real("amount").notNull(),
  status: text("status").notNull().default("pending"), // pending | paid | overdue | waived
  paidAt: text("paid_at"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
});
export const insertPaymentPlanInstallmentSchema = createInsertSchema(paymentPlanInstallments).omit({ id: true });
export type InsertPaymentPlanInstallment = z.infer<typeof insertPaymentPlanInstallmentSchema>;
export type PaymentPlanInstallment = typeof paymentPlanInstallments.$inferSelect;

// ── Safety Checklists (#10) ───────────────────────────────────────────────────
export const safetyChecklists = sqliteTable("safety_checklists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  techName: text("tech_name").notNull(),
  checklistDate: text("checklist_date").notNull(),
  ppeVerified: integer("ppe_verified", { mode: "boolean" }).default(false),
  electricalHazard: integer("electrical_hazard", { mode: "boolean" }).default(false),
  electricalNotes: text("electrical_notes"),
  airQualityCheck: integer("air_quality_check", { mode: "boolean" }).default(false),
  moldFlag: integer("mold_flag", { mode: "boolean" }).default(false),
  asbestosFlag: integer("asbestos_flag", { mode: "boolean" }).default(false),
  confinedSpaceFlag: integer("confined_space_flag", { mode: "boolean" }).default(false),
  slipHazard: integer("slip_hazard", { mode: "boolean" }).default(false),
  biohazardFlag: integer("biohazard_flag", { mode: "boolean" }).default(false),
  overallPass: integer("overall_pass", { mode: "boolean" }).default(true),
  photoUrls: text("photo_urls").default("[]"), // JSON array
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertSafetyChecklistSchema = createInsertSchema(safetyChecklists).omit({ id: true });
export type InsertSafetyChecklist = z.infer<typeof insertSafetyChecklistSchema>;
export type SafetyChecklist = typeof safetyChecklists.$inferSelect;

// ── NPS Surveys (#15) ─────────────────────────────────────────────────────────
export const npsSurveys = sqliteTable("nps_surveys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  contactId: integer("contact_id"),
  contactName: text("contact_name"),
  score: integer("score"), // 0-10, null = not responded
  feedback: text("feedback"),
  category: text("category"), // promoter | passive | detractor
  reviewLinkClicked: integer("review_link_clicked", { mode: "boolean" }).default(false),
  sentAt: text("sent_at").notNull().default(""),
  respondedAt: text("responded_at"),
  status: text("status").notNull().default("sent"), // sent | responded | closed
});
export const insertNpsSurveySchema = createInsertSchema(npsSurveys).omit({ id: true });
export type InsertNpsSurvey = z.infer<typeof insertNpsSurveySchema>;
export type NpsSurvey = typeof npsSurveys.$inferSelect;

// ── IICRC Deviation Log (#29) ─────────────────────────────────────────────────
export const iicrcDeviations = sqliteTable("iicrc_deviations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  dryingRecordId: integer("drying_record_id"),
  standard: text("standard").notNull().default("S500"), // S500 | S520 | S540
  sectionRef: text("section_ref").notNull(), // e.g. "S500 Section 12.3"
  deviationType: text("deviation_type").notNull(), // extended_dry_time | non_standard_equipment | temp_out_of_range | other
  description: text("description").notNull(),
  justification: text("justification").notNull(),
  techName: text("tech_name").notNull(),
  approvedBy: text("approved_by"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertIicrcDeviationSchema = createInsertSchema(iicrcDeviations).omit({ id: true });
export type InsertIicrcDeviation = z.infer<typeof insertIicrcDeviationSchema>;
export type IicrcDeviation = typeof iicrcDeviations.$inferSelect;

// ── COI & License Tracker (#30) ───────────────────────────────────────────────
export const coiRecords = sqliteTable("coi_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull().default("sub"), // sub | employee | titan
  entityName: text("entity_name").notNull(),
  contactId: integer("contact_id"),
  documentType: text("document_type").notNull(), // coi | ga_license | sc_license | policy | other
  documentNumber: text("document_number"),
  issuer: text("issuer"),
  expiresAt: text("expires_at").notNull(),
  documentUrl: text("document_url"),
  status: text("status").notNull().default("active"), // active | expiring_soon | expired
  alertSent30: integer("alert_sent_30", { mode: "boolean" }).default(false),
  alertSent7: integer("alert_sent_7", { mode: "boolean" }).default(false),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(""),
});
export const insertCoiRecordSchema = createInsertSchema(coiRecords).omit({ id: true });
export type InsertCoiRecord = z.infer<typeof insertCoiRecordSchema>;
export type CoiRecord = typeof coiRecords.$inferSelect;

// ── LMS Courses (#31) ─────────────────────────────────────────────────────────
export const lmsCourses = sqliteTable("lms_courses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull().default("iicrc"), // iicrc | sop | safety | equipment | software
  contentUrl: text("content_url"), // link to video or PDF
  contentType: text("content_type").notNull().default("video"), // video | pdf | article | quiz
  quizJson: text("quiz_json").default("[]"), // JSON array of {question, options, answer}
  durationMins: integer("duration_mins").default(0),
  requiredRole: text("required_role").default("all"), // all | tech | sales | office
  createdAt: text("created_at").notNull().default(""),
});
export const insertLmsCourseSchema = createInsertSchema(lmsCourses).omit({ id: true });
export type InsertLmsCourse = z.infer<typeof insertLmsCourseSchema>;
export type LmsCourse = typeof lmsCourses.$inferSelect;

export const lmsEnrollments = sqliteTable("lms_enrollments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  courseId: integer("course_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  employeeName: text("employee_name").notNull(),
  status: text("status").notNull().default("assigned"), // assigned | in_progress | completed | failed
  score: integer("score"), // quiz score 0-100
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  assignedAt: text("assigned_at").notNull().default(""),
});
export const insertLmsEnrollmentSchema = createInsertSchema(lmsEnrollments).omit({ id: true });
export type InsertLmsEnrollment = z.infer<typeof insertLmsEnrollmentSchema>;
export type LmsEnrollment = typeof lmsEnrollments.$inferSelect;

// ── Global Search Index (#37) — uses SQLite FTS5 via raw SQL ─────────────────
// No Drizzle table needed — created via raw exec on startup
