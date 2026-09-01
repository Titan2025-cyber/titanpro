/**
 * pdfEngine.ts — Titan Restoration LLC Branded PDF Generator
 *
 * Generates production-quality signed PDFs entirely client-side using jsPDF.
 * No server round-trip required. Output is a base64 data URL that can be:
 *   - Downloaded directly
 *   - Stored in the job_documents.fileData field
 *   - Opened in a new tab for preview
 */

import jsPDF from "jspdf";
import { fmtDate } from "@/lib/dates";

// jsPDF's `output("datauristring")` returns a URI shaped like
//   data:application/pdf;filename=generated.pdf;base64,...
// That extra `;filename=generated.pdf` parameter is NOT part of the standard
// data-URI grammar; strict parsers (nodemailer, our own dataUriToBlob, Gmail
// MIME builder) skip past it or fail entirely, which produced broken email
// attachments and black-tab downloads. `finalizePdf()` normalizes every PDF
// this engine emits into the canonical `data:application/pdf;base64,...` form
// so every downstream path handles it identically.
function finalizePdf(doc: jsPDF): string {
  const uri = doc.output("datauristring");
  const commaIdx = uri.indexOf(",");
  if (commaIdx < 0) return uri;
  const body = uri.slice(commaIdx + 1);
  return `data:application/pdf;base64,${body}`;
}

// ─── Brand constants ─────────────────────────────────────────────────────────
const RED   = [204, 0, 0]   as const;  // Titan red  #CC0000
const BLUE  = [30, 90, 180] as const;  // Titan blue #1E5AB4
const DARK  = [20, 20, 20]  as const;  // Near-black
const GRAY  = [100, 100, 100] as const;
const LGRAY = [220, 220, 220] as const;
const WHITE = [255, 255, 255] as const;
const OFFWHITE = [248, 248, 250] as const;

// ─── Types ───────────────────────────────────────────────────────────────────
export interface WorkAuthPDFData {
  jobNumber: string;
  signerName: string;
  relationship: string;
  propertyAddress: string;
  authorizationScope: string;
  startDate: string;
  insuranceCarrier: string;
  claimNumber: string;
  policyNumber?: string;
  specialInstructions?: string;
  signatureDataUrl: string;   // base64 PNG from canvas
  signedAt: string;           // ISO timestamp
  techName?: string;
  lossType?: string;
  assignedTech?: string;
}

export interface DeviationPDFData {
  jobNumber: string;
  signerName: string;
  techName: string;
  propertyAddress: string;
  iicrcStandard: string;
  deviationCategory: string;
  standardRequirement: string;
  proposedDeviation: string;
  reasonForDeviation: string;
  alternativeMethod: string;
  insuranceCarrierApproval: string;
  carrierRepName?: string;
  claimNumber?: string;
  signatureDataUrl: string;
  techSignatureDataUrl?: string;
  signedAt: string;
}

export interface RightToRenovatePDFData {
  jobNumber: string;
  signerName: string;
  relationship: string;
  propertyAddress: string;
  yearBuilt?: string;
  leadStatus: string;         // "pre1978" | "post1978" | "unknown" | "exempt"
  renovationScope?: string;
  deliveryMethod: string;     // "in_person" | "email" | "mail"
  pamphletVersion?: string;
  signatureDataUrl: string;   // base64 PNG from canvas
  signedAt: string;           // ISO timestamp
  assignedTech?: string;
}

export interface DirectionToPayPDFData {
  jobNumber: string;
  signerName: string;
  relationship: string;
  propertyAddress: string;
  dateOfLoss?: string;
  lossType?: string;
  insuranceCarrier: string;
  claimNumber: string;
  policyNumber?: string;
  adjusterName?: string;
  adjusterEmail?: string;
  adjusterPhone?: string;
  mortgageeName?: string;
  mortgageeLoanNumber?: string;
  signatureDataUrl: string;
  signedAt: string;
}

export interface CustomPricingPDFData {
  jobNumber: string;
  signerName: string;
  relationship: string;
  propertyAddress: string;
  insuranceCarrier?: string;
  claimNumber?: string;
  policyNumber?: string;
  lossType?: string;
  signatureDataUrl: string;
  signedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function setFont(doc: jsPDF, weight: "normal" | "bold", size: number, color = DARK) {
  doc.setFont("helvetica", weight);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

function hRule(doc: jsPDF, y: number, color = LGRAY, lw = 0.3) {
  doc.setDrawColor(...color);
  doc.setLineWidth(lw);
  doc.line(14, y, 196, y);
}

function field(doc: jsPDF, label: string, value: string, x: number, y: number, maxW = 82) {
  setFont(doc, "bold", 7.5, GRAY);
  doc.text(label.toUpperCase(), x, y);
  setFont(doc, "normal", 9, DARK);
  const lines = doc.splitTextToSize(value || "—", maxW);
  doc.text(lines, x, y + 4.5);
  return y + 4.5 + (lines.length - 1) * 4.5;
}

function badge(doc: jsPDF, text: string, x: number, y: number, bgColor = BLUE) {
  const w = doc.getTextWidth(text) + 6;
  doc.setFillColor(...bgColor);
  doc.roundedRect(x, y - 4, w, 6.5, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...WHITE);
  doc.text(text, x + 3, y);
}

function drawHeader(doc: jsPDF, title: string, subtitle: string, docId: string) {
  const W = 210, H = 297;

  // Red accent bar top
  doc.setFillColor(...RED);
  doc.rect(0, 0, W, 22, "F");

  // Company name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...WHITE);
  doc.text("TITAN RESTORATION LLC", 14, 10);

  // Tagline
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(255, 200, 200);
  doc.text("Recover · Restore · Rebuild", 14, 16);

  // Contact info right-aligned
  doc.setFontSize(7.5);
  doc.setTextColor(...WHITE);
  doc.text("706-922-0154  |  cody@titanaugusta.com  |  titanaugusta.pro", 196, 10, { align: "right" });
  doc.text("Augusta, GA  |  CSRA  |  Licensed & Insured", 196, 16, { align: "right" });

  // Blue accent bar
  doc.setFillColor(...BLUE);
  doc.rect(0, 22, W, 16, "F");

  // Document title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...WHITE);
  doc.text(title, 14, 31);

  // Subtitle / doc ID right
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(180, 210, 255);
  doc.text(subtitle, 14, 36.5);
  doc.text(docId, 196, 36.5, { align: "right" });

  return 50; // return cursor y after header
}

function drawFooter(doc: jsPDF, pageNum: number, totalPages: number) {
  const W = 210;
  doc.setFillColor(...RED);
  doc.rect(0, 283, W, 14, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...WHITE);
  doc.text("Titan Restoration LLC  ·  706-922-0154  ·  titanaugusta.pro  ·  Augusta, GA", 14, 290);
  doc.text(`Page ${pageNum} of ${totalPages}`, 196, 290, { align: "right" });
  doc.setFontSize(6.5);
  doc.setTextColor(255, 200, 200);
  doc.text("This document was electronically executed and is legally binding. Retain for your records.", 14, 294);
}

// ─────────────────────────────────────────────────────────────────────────────
// WORK AUTHORIZATION PDF
// ─────────────────────────────────────────────────────────────────────────────
export function generateWorkAuthPDF(data: WorkAuthPDFData): string {
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const W = 215.9;

  const scopeLabels: Record<string, string> = {
    mitigation: "Emergency Mitigation Only",
    mitigation_reconstruction: "Mitigation & Reconstruction",
    full: "Full Scope of Restoration",
    assessment: "Assessment / Inspection Only",
  };

  const signedDate = fmtDate(data.signedAt, {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"
  });

  const docId = `WA-${data.jobNumber}-${Date.now().toString(36).toUpperCase()}`;
  let y = drawHeader(doc, "AUTHORIZATION TO PERFORM RESTORATION SERVICES", `Job File: ${data.jobNumber}`, docId);

  // ── Section 1: Job + Property Info ─────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("1  JOB & PROPERTY INFORMATION", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  doc.setFillColor(...OFFWHITE);
  doc.roundedRect(14, y - 2, 182, 30, 2, 2, "F");
  y += 2;

  const col1 = 18, col2 = 110;
  let r1 = y, r2 = y;

  r1 = field(doc, "Property Owner / Insured", data.signerName, col1, r1) + 5;
  r1 = field(doc, "Relationship to Property", data.relationship, col1, r1) + 5;

  r2 = field(doc, "Job Number", data.jobNumber, col2, r2) + 5;
  r2 = field(doc, "Loss Type", (data.lossType || "").charAt(0).toUpperCase() + (data.lossType || "").slice(1) || "—", col2, r2) + 5;

  y = Math.max(r1, r2) + 2;
  const addrEnd = field(doc, "Property Address", data.propertyAddress, col1, y, 175);
  y = addrEnd + 8;

  // ── Section 2: Insurance ────────────────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("2  INSURANCE INFORMATION", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  doc.setFillColor(...OFFWHITE);
  doc.roundedRect(14, y - 2, 182, 22, 2, 2, "F");
  y += 2;

  // Only print insurance fields that actually have values; if none are on file,
  // show a single clean line instead of a grid of "—" placeholders.
  const hasIns = !!(data.insuranceCarrier || data.claimNumber || data.policyNumber);
  if (!hasIns) {
    setFont(doc, "normal", 9, GRAY);
    doc.text("No insurance information on file.", col1, y + 3);
    y += 12;
  } else {
    let i1 = y, i2 = y;
    if (data.insuranceCarrier) i1 = field(doc, "Insurance Carrier", data.insuranceCarrier, col1, i1) + 5;
    if (data.claimNumber) i2 = field(doc, "Claim Number", data.claimNumber, col2, i2) + 5;
    y = Math.max(i1, i2);
    if (data.policyNumber) {
      field(doc, "Policy Number", data.policyNumber, col1, y);
      y += 5;
    }
    y += 12;
  }

  // ── Section 3: Scope ────────────────────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("3  SCOPE OF AUTHORIZATION", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  doc.setFillColor(...OFFWHITE);
  doc.roundedRect(14, y - 2, 182, 14, 2, 2, "F");
  y += 2;

  setFont(doc, "bold", 10, RED);
  doc.text(scopeLabels[data.authorizationScope] || data.authorizationScope, 18, y + 4);
  badge(doc, "AUTHORIZED", 150, y + 5, RED);
  y += 18;

  field(doc, "Authorization Date", fmtDate(data.startDate, { year: "numeric", month: "long", day: "numeric" }), 18, y);
  if (data.assignedTech) field(doc, "Assigned Technician", data.assignedTech, 110, y);
  y += 12;

  if (data.specialInstructions) {
    setFont(doc, "bold", 9, BLUE);
    doc.text("4  SPECIAL INSTRUCTIONS / ACCESS NOTES", 14, y);
    hRule(doc, y + 2, BLUE, 0.5);
    y += 8;
    doc.setFillColor(...OFFWHITE);
    const lines = doc.splitTextToSize(data.specialInstructions, 172);
    doc.roundedRect(14, y - 2, 182, lines.length * 4.5 + 6, 2, 2, "F");
    setFont(doc, "normal", 9, DARK);
    doc.text(lines, 18, y + 3);
    y += lines.length * 4.5 + 10;
  }

  // ── Section: Legal Authorization Text ──────────────────────────────────────
  const sectionNum = data.specialInstructions ? "5" : "4";
  setFont(doc, "bold", 9, BLUE);
  doc.text(`${sectionNum}  TERMS & CONDITIONS OF AUTHORIZATION`, 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  const isSC = /,\s*SC\b/i.test(data.propertyAddress || "");
  const stateLaw = isSC ? "South Carolina" : "Georgia";

  const legalText = [
    "I, the undersigned Property Owner / Authorized Representative (\"Owner\"), authorize Titan Restoration LLC (\"Contractor\") to enter the property above and perform the mitigation, remediation, and/or restoration services described in the Scope of Authorization. Owner represents that Owner has legal authority to authorize this work.",
    "",
    "1. SCOPE & IICRC STANDARDS. Contractor will perform work using generally accepted industry practices and applicable IICRC standards (S500 water, S520 mold, S700 fire, S760 trauma) as loss conditions require. Additional or changed work will be documented in a written change order.",
    "",
    "2. PRICING. Work is priced using Contractor's published pricing schedule for equipment, labor, materials, and services actually performed. This pricing may differ from insurance software defaults (e.g., Xactimate). Owner acknowledges receiving Contractor's Custom Pricing Acknowledgment, which is incorporated by reference.",
    "",
    "3. PRIMARY PAYMENT OBLIGATION. Owner is the primary party responsible for full payment of all services rendered, regardless of insurance coverage. Owner shall pay any deductible, non-covered items, depreciation holdback withheld until completion, betterment/upgrades, and any shortfall between Contractor's invoice and insurance proceeds. Payment is due within 30 days of invoice.",
    "",
    "4. DIRECTION TO PAY / INSURANCE PROCEEDS. Owner directs their insurance carrier and any mortgagee to include Titan Restoration LLC as a co-payee on all loss-payment drafts for this claim and to send Titan's portion of proceeds directly to Titan Restoration LLC. Owner authorizes Contractor to speak with the carrier about scope, pricing, and payment status. This is a direction to pay only; it is not a public-adjuster engagement, and Contractor will not negotiate claim coverage on Owner's behalf.",
    "",
    "5. ENDORSEMENT & PROOF OF LOSS. Owner shall promptly endorse any insurance draft naming Contractor as a payee, cooperate in a sworn proof of loss when required, and forward to Contractor any insurance proceeds received that are attributable to work performed by Contractor, within 5 business days of receipt.",
    "",
    "6. LATE PAYMENT, INTEREST & COLLECTIONS. Undisputed balances not paid within 30 days accrue interest at 1% per month (12% APR) or the maximum rate allowed by law, whichever is lower. Owner shall pay Contractor's reasonable collection costs, court costs, and attorneys' fees incurred to collect any undisputed balance.",
    "",
    "7. LIEN RIGHTS. Owner acknowledges that Contractor may file and enforce a mechanic's/materialman's lien against the property under S.C. Code Title 29, Ch. 5 (SC) or O.C.G.A. Title 44, Ch. 14, Art. 8 (GA) for unpaid work, without waiving any other rights.",
    "",
    "8. PROMPT PAY (CARRIER). Owner acknowledges that carriers must acknowledge and pay undisputed claims within statutory time limits: S.C. Code § 38-59-20 and O.C.G.A. §§ 13-11-1 to 13-11-11. Contractor may reference these statutes in Direction-to-Pay correspondence to Owner's carrier.",
    "",
    "9. ACCESS, POWER & UTILITIES. Owner will provide safe access, continuous electrical power for drying and remediation equipment, and reasonable use of water. Owner will not disable, unplug, or move Contractor's equipment; if equipment is disabled or removed without written approval, resulting damage or delay is Owner's responsibility.",
    "",
    "10. GOVERNING LAW, VENUE & CANCELLATION. This Authorization is governed by the laws of " + stateLaw + ". SC HOMEOWNERS: You have the right to cancel this contract within 3 business days after signing if signed at a location other than Contractor's regular place of business. GA HOMEOWNERS: If Owner's insurance carrier issues a written denial of coverage for this loss, Owner may cancel this Authorization within 5 business days of receiving the written denial (HB 423). Cancellation must be in writing and delivered to Contractor at cody@titanaugusta.com. Owner remains responsible for the reasonable value of work already performed and materials already ordered.",
  ];

  doc.setFillColor(...OFFWHITE);
  const legalLines = doc.splitTextToSize(legalText.join("\n"), 172);
  const legalH = legalLines.length * 3.8 + 8;
  doc.roundedRect(14, y - 2, 182, legalH, 2, 2, "F");
  setFont(doc, "normal", 7.8, DARK);
  doc.text(legalLines, 18, y + 3);
  y += legalH + 8;

  // ── Signature Block ─────────────────────────────────────────────────────────
  // Check if we need a new page
  if (y > 220) {
    doc.addPage();
    y = 20;
  }

  setFont(doc, "bold", 9, BLUE);
  doc.text("ELECTRONIC SIGNATURE & EXECUTION", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  // Sig box
  doc.setFillColor(...WHITE);
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.5);
  doc.roundedRect(14, y, 182, 52, 2, 2, "FD");

  // Signer info
  setFont(doc, "bold", 8, GRAY);
  doc.text("SIGNED BY", 20, y + 7);
  setFont(doc, "bold", 11, DARK);
  doc.text(data.signerName, 20, y + 14);
  setFont(doc, "normal", 8, GRAY);
  doc.text(data.relationship, 20, y + 19);

  // Date/time
  setFont(doc, "bold", 8, GRAY);
  doc.text("DATE & TIME", 110, y + 7);
  setFont(doc, "normal", 9, DARK);
  doc.text(signedDate, 110, y + 14);

  // "Electronically Signed" badge
  badge(doc, "✓  ELECTRONICALLY SIGNED", 110, y + 22, [0, 150, 80]);

  // Signature image
  try {
    doc.addImage(data.signatureDataUrl, "PNG", 18, y + 24, 80, 22);
  } catch (e) {
    setFont(doc, "italic", 9, GRAY);
    doc.text("[Signature on file]", 20, y + 36);
  }

  // Sig line
  doc.setDrawColor(...DARK);
  doc.setLineWidth(0.3);
  doc.line(18, y + 48, 98, y + 48);
  setFont(doc, "normal", 7, GRAY);
  doc.text("Electronic Signature — " + data.signerName, 18, y + 51);

  y += 58;

  // Document ID block
  doc.setFillColor(240, 245, 255);
  doc.roundedRect(14, y, 182, 16, 2, 2, "F");
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("DOCUMENT ID", 18, y + 5);
  setFont(doc, "normal", 8, DARK);
  doc.text(docId, 18, y + 10);
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("GENERATED", 80, y + 5);
  setFont(doc, "normal", 8, DARK);
  doc.text(new Date().toLocaleString(), 80, y + 10);
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("TITAN RESTORATION LLC", 150, y + 5);
  setFont(doc, "normal", 7.5, RED);
  doc.text("706-922-0154  ·  titanaugusta.pro", 150, y + 10);

  y += 22;

  // Footer
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, i, totalPages);
  }

  return finalizePdf(doc);
}

// ─────────────────────────────────────────────────────────────────────────────
// RIGHT TO RENOVATE / EPA RENOVATE RIGHT PAMPHLET ACKNOWLEDGMENT PDF
// ─────────────────────────────────────────────────────────────────────────────
export function generateRightToRenovatePDF(data: RightToRenovatePDFData): string {
  const doc = new jsPDF({ unit: "mm", format: "letter" });

  const leadLabels: Record<string, string> = {
    pre1978: "Built before 1978 — Lead-Safe Practices Apply",
    post1978: "Built 1978 or later — Exempt from RRP",
    unknown: "Year Built Unknown — Assumed Pre-1978",
    exempt: "Exempt (verified lead-free / no paint disturbed)",
  };
  const deliveryLabels: Record<string, string> = {
    in_person: "Hand-delivered in person",
    email: "Delivered by email",
    mail: "Delivered by U.S. mail",
  };

  const signedDate = fmtDate(data.signedAt, {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"
  });

  const docId = `RTR-${data.jobNumber}-${Date.now().toString(36).toUpperCase()}`;
  let y = drawHeader(doc, "RIGHT TO RENOVATE — PAMPHLET ACKNOWLEDGMENT", `Job File: ${data.jobNumber}`, docId);

  // ── Section 1: Property & Owner ────────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("1  PROPERTY & OWNER INFORMATION", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  doc.setFillColor(...OFFWHITE);
  doc.roundedRect(14, y - 2, 182, 30, 2, 2, "F");
  y += 2;

  const col1 = 18, col2 = 110;
  let r1 = y, r2 = y;
  r1 = field(doc, "Property Owner / Recipient", data.signerName, col1, r1) + 5;
  r1 = field(doc, "Relationship to Property", data.relationship, col1, r1) + 5;
  r2 = field(doc, "Job Number", data.jobNumber, col2, r2) + 5;
  r2 = field(doc, "Year Built", data.yearBuilt || "Not stated", col2, r2) + 5;
  y = Math.max(r1, r2) + 2;
  const addrEnd = field(doc, "Property Address", data.propertyAddress, col1, y, 175);
  y = addrEnd + 8;

  // ── Section 2: Lead Status ─────────────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("2  LEAD-BASED PAINT STATUS", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  doc.setFillColor(...OFFWHITE);
  doc.roundedRect(14, y - 2, 182, 14, 2, 2, "F");
  y += 2;
  setFont(doc, "bold", 10, RED);
  doc.text(leadLabels[data.leadStatus] || data.leadStatus, 18, y + 4);
  y += 18;

  if (data.renovationScope) {
    field(doc, "Renovation / Work Scope", data.renovationScope, 18, y, 175);
    y += 12;
  }

  // ── Section 3: Acknowledgment text ─────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("3  ACKNOWLEDGMENT OF RECEIPT", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  const ackText = [
    "Federal law (the EPA Renovation, Repair and Painting Rule, 40 CFR Part 745) requires that contractors performing renovation, repair, or painting projects that disturb painted surfaces in homes, child-care facilities, or schools built before 1978 provide the owner and/or occupants with the EPA-approved lead-hazard information pamphlet \"Renovate Right: Important Lead Hazard Information for Families, Child Care Providers and Schools\" before work begins.",
    "",
    "By signing below, I acknowledge that:",
    "",
    "1. RECEIPT OF PAMPHLET: I received a copy of the EPA \"Renovate Right\" lead-hazard information pamphlet from Titan Restoration LLC before any renovation, repair, or painting work that may disturb painted surfaces began at the above property.",
    "",
    "2. RIGHT TO RENOVATE: I understand my rights regarding lead-safe work practices and that Titan Restoration LLC will follow EPA lead-safe work practices where the RRP Rule applies.",
    "",
    "3. PRE-1978 HOUSING: If this property was built before 1978, I understand that lead-safe work practices are required by federal law unless the components affected have been documented as lead-free.",
    "",
    "4. RECORDKEEPING: This signed acknowledgment will be retained in the job file for a minimum of three (3) years as required by federal recordkeeping rules.",
    "",
    "This acknowledgment is governed by the laws of the State of " + (data.propertyAddress?.includes(", SC") ? "South Carolina" : "Georgia") + " and applicable federal EPA regulations.",
  ];

  doc.setFillColor(...OFFWHITE);
  const ackLines = doc.splitTextToSize(ackText.join("\n"), 172);
  const ackH = ackLines.length * 3.8 + 8;
  doc.roundedRect(14, y - 2, 182, ackH, 2, 2, "F");
  setFont(doc, "normal", 7.8, DARK);
  doc.text(ackLines, 18, y + 3);
  y += ackH + 6;

  field(doc, "Pamphlet Delivery Method", deliveryLabels[data.deliveryMethod] || data.deliveryMethod, 18, y);
  field(doc, "Pamphlet Version", data.pamphletVersion || "EPA-740-K-10-001 (current)", 110, y);
  y += 12;

  // ── Signature Block ─────────────────────────────────────────────────────────
  if (y > 210) { doc.addPage(); y = 20; }

  setFont(doc, "bold", 9, BLUE);
  doc.text("ELECTRONIC SIGNATURE & EXECUTION", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  doc.setFillColor(...WHITE);
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.5);
  doc.roundedRect(14, y, 182, 52, 2, 2, "FD");

  setFont(doc, "bold", 8, GRAY);
  doc.text("SIGNED BY", 20, y + 7);
  setFont(doc, "bold", 11, DARK);
  doc.text(data.signerName, 20, y + 14);
  setFont(doc, "normal", 8, GRAY);
  doc.text(data.relationship, 20, y + 19);

  setFont(doc, "bold", 8, GRAY);
  doc.text("DATE & TIME", 110, y + 7);
  setFont(doc, "normal", 9, DARK);
  doc.text(signedDate, 110, y + 14);

  badge(doc, "ELECTRONICALLY SIGNED", 110, y + 22, [0, 150, 80]);

  try {
    doc.addImage(data.signatureDataUrl, "PNG", 18, y + 24, 80, 22);
  } catch (e) {
    setFont(doc, "italic", 9, GRAY);
    doc.text("[Signature on file]", 20, y + 36);
  }

  doc.setDrawColor(...DARK);
  doc.setLineWidth(0.3);
  doc.line(18, y + 48, 98, y + 48);
  setFont(doc, "normal", 7, GRAY);
  doc.text("Electronic Signature — " + data.signerName, 18, y + 51);
  y += 58;

  doc.setFillColor(240, 245, 255);
  doc.roundedRect(14, y, 182, 16, 2, 2, "F");
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("DOCUMENT ID", 18, y + 5);
  setFont(doc, "normal", 8, DARK);
  doc.text(docId, 18, y + 10);
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("GENERATED", 80, y + 5);
  setFont(doc, "normal", 8, DARK);
  doc.text(new Date().toLocaleString(), 80, y + 10);
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("TITAN RESTORATION LLC", 150, y + 5);
  setFont(doc, "normal", 7.5, RED);
  doc.text("706-922-0154  ·  titanaugusta.pro", 150, y + 10);

  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, i, totalPages);
  }

  return finalizePdf(doc);
}

// ─────────────────────────────────────────────────────────────────────────────
// DIRECTION TO PAY NOTICE PDF (carrier notice, homeowner-signed)
// ─────────────────────────────────────────────────────────────────────────────
export function generateDirectionToPayPDF(data: DirectionToPayPDFData): string {
  const doc = new jsPDF({ unit: "mm", format: "letter" });

  const isSC = /,\s*SC\b/i.test(data.propertyAddress || "");
  const stateLaw = isSC ? "South Carolina" : "Georgia";

  const signedDate = fmtDate(data.signedAt, {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"
  });

  const docId = `DTP-${data.jobNumber}-${Date.now().toString(36).toUpperCase()}`;
  let y = drawHeader(doc, "DIRECTION TO PAY — NOTICE TO INSURANCE CARRIER", `Job File: ${data.jobNumber}`, docId);

  // ── Section 1: To / From ──────────────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("1  DELIVERED TO", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  doc.setFillColor(...OFFWHITE);
  doc.roundedRect(14, y - 2, 182, 26, 2, 2, "F");
  y += 2;

  let l = y, r = y;
  l = field(doc, "Insurance Carrier", data.insuranceCarrier, 18, l) + 5;
  if (data.adjusterName) l = field(doc, "Adjuster", data.adjusterName, 18, l) + 5;

  if (data.adjusterEmail) r = field(doc, "Adjuster Email", data.adjusterEmail, 110, r) + 5;
  if (data.adjusterPhone) r = field(doc, "Adjuster Phone", data.adjusterPhone, 110, r) + 5;

  y = Math.max(l, r) + 6;

  // ── Section 2: Claim identifiers ──────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("2  CLAIM IDENTIFIERS", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  doc.setFillColor(...OFFWHITE);
  doc.roundedRect(14, y - 2, 182, 30, 2, 2, "F");
  y += 2;

  let a = y, b = y;
  a = field(doc, "Insured / Property Owner", data.signerName, 18, a) + 5;
  a = field(doc, "Property Address", data.propertyAddress, 18, a, 82) + 5;

  b = field(doc, "Claim Number", data.claimNumber, 110, b) + 5;
  if (data.policyNumber) b = field(doc, "Policy Number", data.policyNumber, 110, b) + 5;
  if (data.dateOfLoss) b = field(doc, "Date of Loss", fmtDate(data.dateOfLoss, { year: "numeric", month: "long", day: "numeric" }), 110, b) + 5;

  y = Math.max(a, b) + 6;

  if (data.mortgageeName) {
    setFont(doc, "bold", 9, BLUE);
    doc.text("3  MORTGAGEE (CO-PAYEE)", 14, y);
    hRule(doc, y + 2, BLUE, 0.5);
    y += 8;
    doc.setFillColor(...OFFWHITE);
    doc.roundedRect(14, y - 2, 182, 14, 2, 2, "F");
    y += 2;
    field(doc, "Mortgagee", data.mortgageeName, 18, y);
    if (data.mortgageeLoanNumber) field(doc, "Loan #", data.mortgageeLoanNumber, 110, y);
    y += 12;
  }

  // ── Instructions to carrier ────────────────────────────────────────────────
  const instrNum = data.mortgageeName ? "4" : "3";
  setFont(doc, "bold", 9, BLUE);
  doc.text(`${instrNum}  DIRECTION TO PAY — INSTRUCTIONS TO CARRIER`, 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  const instrText = [
    "As the named Insured, I direct the above carrier and any mortgagee holding my policy proceeds to comply with the following on the claim identified above:",
    "",
    "1. NAME TITAN AS CO-PAYEE. On all loss-payment drafts issued for this claim (Actual Cash Value, Recoverable Depreciation, supplements, and any additional payments), include \"Titan Restoration LLC\" as a named co-payee alongside the Insured and any mortgagee.",
    "",
    "2. SEND TITAN'S PORTION DIRECTLY. Mail or ACH Titan Restoration LLC's portion of the proceeds directly to Titan at 706-922-0154 / cody@titanaugusta.com, using the mailing/EFT details Titan provides on request.",
    "",
    "3. SHARE SCOPE AND ESTIMATE INFORMATION. Provide Titan with copies of the claim estimate, scope sheet, and any supplements at the same time they are shared with the Insured, so pricing and scope can be reconciled prior to close-out.",
    "",
    "4. PROMPT PAY. This is a written notice under " + stateLaw + " prompt-payment law: S.C. Code § 38-59-20 (SC — acknowledge within 15 working days, pay undisputed claims within 30 days) and O.C.G.A. §§ 13-11-1 to 13-11-11 (GA Prompt Pay Act — 15 days for undisputed amounts on completed work).",
    "",
    "This is a direction to pay only. It is not an Assignment of Benefits and it does not transfer ownership of the claim; the Insured remains the claimant. Titan Restoration LLC is the general contractor of record and is not acting as a public adjuster.",
  ];

  doc.setFillColor(...OFFWHITE);
  const iLines = doc.splitTextToSize(instrText.join("\n"), 172);
  const iH = iLines.length * 3.8 + 8;
  doc.roundedRect(14, y - 2, 182, iH, 2, 2, "F");
  setFont(doc, "normal", 7.8, DARK);
  doc.text(iLines, 18, y + 3);
  y += iH + 6;

  // ── Signature Block ────────────────────────────────────────────────────────
  if (y > 220) { doc.addPage(); y = 20; }

  setFont(doc, "bold", 9, BLUE);
  doc.text("INSURED SIGNATURE", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  doc.setFillColor(...WHITE);
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.5);
  doc.roundedRect(14, y, 182, 52, 2, 2, "FD");

  setFont(doc, "bold", 8, GRAY);
  doc.text("SIGNED BY (NAMED INSURED)", 20, y + 7);
  setFont(doc, "bold", 11, DARK);
  doc.text(data.signerName, 20, y + 14);
  setFont(doc, "normal", 8, GRAY);
  doc.text(data.relationship, 20, y + 19);

  setFont(doc, "bold", 8, GRAY);
  doc.text("DATE & TIME", 110, y + 7);
  setFont(doc, "normal", 9, DARK);
  doc.text(signedDate, 110, y + 14);

  badge(doc, "✓  ELECTRONICALLY SIGNED", 110, y + 22, [0, 150, 80]);

  try {
    doc.addImage(data.signatureDataUrl, "PNG", 18, y + 24, 80, 22);
  } catch (e) {
    setFont(doc, "italic", 9, GRAY);
    doc.text("[Signature on file]", 20, y + 36);
  }

  doc.setDrawColor(...DARK);
  doc.setLineWidth(0.3);
  doc.line(18, y + 48, 98, y + 48);
  setFont(doc, "normal", 7, GRAY);
  doc.text("Electronic Signature — " + data.signerName, 18, y + 51);

  y += 58;

  // Document ID block
  doc.setFillColor(240, 245, 255);
  doc.roundedRect(14, y, 182, 16, 2, 2, "F");
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("DOCUMENT ID", 18, y + 5);
  setFont(doc, "normal", 8, DARK);
  doc.text(docId, 18, y + 10);
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("GENERATED", 80, y + 5);
  setFont(doc, "normal", 8, DARK);
  doc.text(new Date().toLocaleString(), 80, y + 10);
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("TITAN RESTORATION LLC", 150, y + 5);
  setFont(doc, "normal", 7.5, RED);
  doc.text("706-922-0154  ·  titanaugusta.pro", 150, y + 10);

  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, i, totalPages);
  }

  return finalizePdf(doc);
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM PRICING ACKNOWLEDGMENT PDF (homeowner-signed)
// ─────────────────────────────────────────────────────────────────────────────
export function generateCustomPricingPDF(data: CustomPricingPDFData): string {
  const doc = new jsPDF({ unit: "mm", format: "letter" });

  const signedDate = fmtDate(data.signedAt, {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"
  });

  const docId = `CPA-${data.jobNumber}-${Date.now().toString(36).toUpperCase()}`;
  let y = drawHeader(doc, "CUSTOM PRICING ACKNOWLEDGMENT & CARRIER PRICING NOTICE", `Job File: ${data.jobNumber}`, docId);

  // ── Section 1: Property + claim summary ───────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("1  PROPERTY & CLAIM SUMMARY", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  doc.setFillColor(...OFFWHITE);
  doc.roundedRect(14, y - 2, 182, 26, 2, 2, "F");
  y += 2;

  let l = y, r = y;
  l = field(doc, "Property Owner / Insured", data.signerName, 18, l) + 5;
  l = field(doc, "Property Address", data.propertyAddress, 18, l, 82) + 5;

  if (data.insuranceCarrier) r = field(doc, "Insurance Carrier", data.insuranceCarrier, 110, r) + 5;
  if (data.claimNumber) r = field(doc, "Claim Number", data.claimNumber, 110, r) + 5;
  if (data.lossType) r = field(doc, "Loss Type", data.lossType.charAt(0).toUpperCase() + data.lossType.slice(1), 110, r) + 5;

  y = Math.max(l, r) + 6;

  // ── Section 2: Part A — Owner acknowledgment ─────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("2  PART A — PROPERTY OWNER ACKNOWLEDGMENT", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  const partA = [
    "A1. CUSTOM PRICING SCHEDULE. I understand Titan Restoration LLC (\"Titan\") prices work using Titan's published Custom Pricing Schedule for equipment, labor, materials, and services actually performed. Titan does not price work at generic third-party software defaults (including Xactimate baseline rates).",
    "",
    "A2. DIFFERENCE FROM INSURANCE ESTIMATE. I understand my insurance carrier's initial estimate may be lower than Titan's invoice. Titan will work in good faith with the carrier to reconcile pricing using scope documentation, drying/moisture records, IICRC standards, and market-rate references.",
    "",
    "A3. PRIMARY PAYMENT OBLIGATION. I remain primarily responsible for full payment of Titan's invoice regardless of what the carrier ultimately pays. I will pay any deductible, non-covered items, betterment/upgrades, depreciation holdback withheld until completion, and any shortfall between Titan's invoice and insurance proceeds.",
    "",
    "A4. DIRECTION TO PAY / CO-OPERATION. I have executed (or will execute) Titan's Direction to Pay Notice directing my carrier to name Titan as co-payee on all loss-payment drafts. I will promptly endorse those drafts and forward Titan's portion within 5 business days of receipt.",
    "",
    "A5. NO PUBLIC-ADJUSTER ROLE. I understand Titan is my general contractor, not my public adjuster. Titan may discuss scope and pricing with the carrier but is not negotiating my coverage or claim on my behalf.",
  ];

  doc.setFillColor(...OFFWHITE);
  const aLines = doc.splitTextToSize(partA.join("\n"), 172);
  const aH = aLines.length * 3.6 + 8;
  doc.roundedRect(14, y - 2, 182, aH, 2, 2, "F");
  setFont(doc, "normal", 7.6, DARK);
  doc.text(aLines, 18, y + 3);
  y += aH + 6;

  // ── Section 3: Part B — Carrier notice ────────────────────────────────────
  if (y > 200) { doc.addPage(); y = 20; }

  setFont(doc, "bold", 9, BLUE);
  doc.text("3  PART B — NOTICE TO INSURANCE CARRIER", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  const partB = [
    "To the Carrier: this is a written notice of Titan's pricing basis on this claim. Please review it before finalizing the estimate.",
    "",
    "B1. POLICY LANGUAGE. Standard homeowner and commercial property policies obligate the carrier to pay the reasonable and necessary cost to repair or replace with materials of like kind and quality. They do not require pricing at any specific third-party software default. Please identify the specific policy provision, if any, that mandates Xactimate baseline pricing on this claim.",
    "",
    "B2. XACTIMATE IS A TOOL, NOT A CEILING. Xactimate itself publishes market-conditions modifiers and acknowledges that published unit costs are averages that may require adjustment for local labor markets, material availability, emergency-response conditions, and post-loss demand surges. Titan's pricing reflects these documented conditions.",
    "",
    "B3. IICRC AND RSMEANS BASIS. Titan's scope follows IICRC S500 (water), S520 (mold), and S700 (fire) protocols. Line items are supported by IICRC standards of care, RSMeans construction cost data, and manufacturer specifications where applicable — objective references the carrier can independently verify.",
    "",
    "B4. DOCUMENTATION AVAILABLE. On request, Titan will provide (a) daily drying logs with moisture readings, (b) equipment run-time records, (c) time-stamped job photos, (d) IICRC-referenced scope narrative, and (e) supporting invoices for materials and subcontracted labor.",
    "",
    "B5. APPRAISAL CLAUSE. If pricing cannot be reconciled through good-faith review, the Insured reserves the right to invoke the appraisal provision of the policy.",
    "",
    "B6. UNFAIR CLAIMS PRACTICES. The Insured further reserves all rights under S.C. Code § 38-59-20 and O.C.G.A. § 33-6-34 regarding claim-handling practices, and under S.C. Code § 38-59-20 and O.C.G.A. §§ 13-11-1 to 13-11-11 regarding prompt payment of undisputed amounts.",
  ];

  doc.setFillColor(...OFFWHITE);
  const bLines = doc.splitTextToSize(partB.join("\n"), 172);
  const bH = bLines.length * 3.6 + 8;
  doc.roundedRect(14, y - 2, 182, bH, 2, 2, "F");
  setFont(doc, "normal", 7.6, DARK);
  doc.text(bLines, 18, y + 3);
  y += bH + 6;

  // ── Signature Block ────────────────────────────────────────────────────────
  if (y > 220) { doc.addPage(); y = 20; }

  setFont(doc, "bold", 9, BLUE);
  doc.text("PROPERTY OWNER SIGNATURE", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  doc.setFillColor(...WHITE);
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.5);
  doc.roundedRect(14, y, 182, 52, 2, 2, "FD");

  setFont(doc, "bold", 8, GRAY);
  doc.text("SIGNED BY", 20, y + 7);
  setFont(doc, "bold", 11, DARK);
  doc.text(data.signerName, 20, y + 14);
  setFont(doc, "normal", 8, GRAY);
  doc.text(data.relationship, 20, y + 19);

  setFont(doc, "bold", 8, GRAY);
  doc.text("DATE & TIME", 110, y + 7);
  setFont(doc, "normal", 9, DARK);
  doc.text(signedDate, 110, y + 14);

  badge(doc, "✓  ELECTRONICALLY SIGNED", 110, y + 22, [0, 150, 80]);

  try {
    doc.addImage(data.signatureDataUrl, "PNG", 18, y + 24, 80, 22);
  } catch (e) {
    setFont(doc, "italic", 9, GRAY);
    doc.text("[Signature on file]", 20, y + 36);
  }

  doc.setDrawColor(...DARK);
  doc.setLineWidth(0.3);
  doc.line(18, y + 48, 98, y + 48);
  setFont(doc, "normal", 7, GRAY);
  doc.text("Electronic Signature — " + data.signerName, 18, y + 51);

  y += 58;

  // Doc ID block
  doc.setFillColor(240, 245, 255);
  doc.roundedRect(14, y, 182, 16, 2, 2, "F");
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("DOCUMENT ID", 18, y + 5);
  setFont(doc, "normal", 8, DARK);
  doc.text(docId, 18, y + 10);
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("GENERATED", 80, y + 5);
  setFont(doc, "normal", 8, DARK);
  doc.text(new Date().toLocaleString(), 80, y + 10);
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("TITAN RESTORATION LLC", 150, y + 5);
  setFont(doc, "normal", 7.5, RED);
  doc.text("706-922-0154  ·  titanaugusta.pro", 150, y + 10);

  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, i, totalPages);
  }

  return finalizePdf(doc);
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVIATION OF STANDARD PDF
// ─────────────────────────────────────────────────────────────────────────────
export function generateDeviationPDF(data: DeviationPDFData): string {
  const doc = new jsPDF({ unit: "mm", format: "letter" });

  const signedDate = fmtDate(data.signedAt, {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"
  });

  const docId = `DOS-${data.jobNumber}-${Date.now().toString(36).toUpperCase()}`;
  const approvalLabels: Record<string, string> = {
    pending: "Pending Carrier Review",
    approved: "Approved by Carrier",
    not_applicable: "Not Applicable",
    owner_only: "Owner Authorization Only",
  };

  let y = drawHeader(doc, "DEVIATION FROM IICRC STANDARDS — WRITTEN AUTHORIZATION", `Job File: ${data.jobNumber}`, docId);

  // Warning banner
  doc.setFillColor(255, 248, 220);
  doc.setDrawColor(200, 160, 0);
  doc.setLineWidth(0.5);
  doc.roundedRect(14, y, 182, 12, 2, 2, "FD");
  setFont(doc, "bold", 8, [150, 100, 0]);
  doc.text("⚠  IMPORTANT: This document records a deviation from IICRC industry standards. Any deviation must be", 18, y + 5);
  doc.text("    documented in writing and signed by all parties per IICRC protocol.", 18, y + 9.5);
  y += 17;

  // ── Section 1: Parties ──────────────────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("1  PARTIES & JOB INFORMATION", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  doc.setFillColor(...OFFWHITE);
  doc.roundedRect(14, y - 2, 182, 22, 2, 2, "F");
  y += 2;

  const col1 = 18, col2 = 110;
  let r1 = y, r2 = y;
  r1 = field(doc, "Property Owner / Insured", data.signerName, col1, r1) + 5;
  r1 = field(doc, "Property Address", data.propertyAddress, col1, r1, 85) + 5;
  r2 = field(doc, "Job Number", data.jobNumber, col2, r2) + 5;
  r2 = field(doc, "Technician", data.techName, col2, r2) + 5;
  y = Math.max(r1, r2) + 6;

  // ── Section 2: Standard Being Deviated ─────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("2  APPLICABLE IICRC STANDARD", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  doc.setFillColor(...OFFWHITE);
  doc.roundedRect(14, y - 2, 182, 10, 2, 2, "F");
  setFont(doc, "bold", 10, RED);
  doc.text(data.iicrcStandard, 18, y + 5);
  badge(doc, data.deviationCategory.split("(")[0].trim(), 14, y + 12, [180, 100, 0]);
  y += 18;

  // ── Sections 3-6: Deviation Details ────────────────────────────────────────
  const sections = [
    { num: "3", title: "IICRC STANDARD REQUIREMENT BEING DEVIATED FROM", text: data.standardRequirement },
    { num: "4", title: "PROPOSED DEVIATION / MODIFIED APPROACH", text: data.proposedDeviation },
    { num: "5", title: "REASON FOR DEVIATION", text: data.reasonForDeviation },
    { num: "6", title: "ALTERNATIVE / COMPENSATING MEASURES", text: data.alternativeMethod },
  ];

  for (const s of sections) {
    if (!s.text) continue;
    setFont(doc, "bold", 9, BLUE);
    doc.text(`${s.num}  ${s.title}`, 14, y);
    hRule(doc, y + 2, BLUE, 0.5);
    y += 8;

    const lines = doc.splitTextToSize(s.text, 172);
    const boxH = lines.length * 4.2 + 8;
    doc.setFillColor(...OFFWHITE);
    doc.roundedRect(14, y - 2, 182, boxH, 2, 2, "F");
    setFont(doc, "normal", 9, DARK);
    doc.text(lines, 18, y + 3);
    y += boxH + 6;

    if (y > 230) {
      doc.addPage();
      y = 20;
    }
  }

  // ── Section 7: Insurance ────────────────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("7  INSURANCE CARRIER APPROVAL", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  doc.setFillColor(...OFFWHITE);
  doc.roundedRect(14, y - 2, 182, 14, 2, 2, "F");
  field(doc, "Approval Status", approvalLabels[data.insuranceCarrierApproval] || data.insuranceCarrierApproval, 18, y + 2);
  if (data.carrierRepName) field(doc, "Carrier Representative", data.carrierRepName, 110, y + 2);
  if (data.claimNumber) field(doc, "Claim Number", data.claimNumber, 18, y + 10);
  y += 20;

  // ── Risk Acknowledgment ─────────────────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("8  RISK & LIABILITY ACKNOWLEDGMENT", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  const riskText = "By signing below, the Property Owner/Insured acknowledges that: (1) they have been fully informed of the applicable IICRC industry standard and the specific risks associated with the deviation described herein; (2) they are voluntarily requesting or consenting to this deviation from standard protocol; (3) Titan Restoration LLC has documented this deviation as required by IICRC standards and bears no additional liability for outcomes directly resulting from the approved deviation; (4) this documentation will be permanently maintained in the job file and made available to all parties including insurance carriers and adjusters.";

  const riskLines = doc.splitTextToSize(riskText, 172);
  doc.setFillColor(255, 248, 220);
  doc.setDrawColor(200, 160, 0);
  doc.setLineWidth(0.4);
  doc.roundedRect(14, y - 2, 182, riskLines.length * 4 + 8, 2, 2, "FD");
  setFont(doc, "normal", 8, DARK);
  doc.text(riskLines, 18, y + 3);
  y += riskLines.length * 4 + 14;

  if (y > 200) { doc.addPage(); y = 20; }

  // ── Signatures ──────────────────────────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("9  SIGNATURES", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 8;

  // Two signature blocks side by side
  const sigBoxW = 86;
  // Block A — homeowner
  doc.setFillColor(...WHITE);
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.5);
  doc.roundedRect(14, y, sigBoxW, 54, 2, 2, "FD");

  setFont(doc, "bold", 7.5, GRAY);
  doc.text("PROPERTY OWNER / INSURED", 18, y + 6);
  setFont(doc, "bold", 10, DARK);
  doc.text(data.signerName, 18, y + 12);
  setFont(doc, "normal", 7.5, GRAY);
  doc.text(signedDate, 18, y + 17);
  badge(doc, "✓ SIGNED", 18, y + 24, [0, 150, 80]);

  try {
    doc.addImage(data.signatureDataUrl, "PNG", 18, y + 27, 78, 20);
  } catch {
    setFont(doc, "italic", 8, GRAY);
    doc.text("[Signature on file]", 20, y + 38);
  }
  doc.setDrawColor(...DARK);
  doc.setLineWidth(0.3);
  doc.line(18, y + 49, 96, y + 49);
  setFont(doc, "normal", 7, GRAY);
  doc.text("Property Owner Signature", 18, y + 52);

  // Block B — tech
  doc.setFillColor(...WHITE);
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.5);
  doc.roundedRect(110, y, sigBoxW, 54, 2, 2, "FD");

  setFont(doc, "bold", 7.5, GRAY);
  doc.text("TITAN RESTORATION LLC REPRESENTATIVE", 114, y + 6);
  setFont(doc, "bold", 10, DARK);
  doc.text(data.techName || "Titan Restoration LLC", 114, y + 12);
  setFont(doc, "normal", 7.5, GRAY);
  doc.text(signedDate, 114, y + 17);
  if (data.techSignatureDataUrl) {
    badge(doc, "✓ SIGNED", 114, y + 24, [0, 150, 80]);
    try {
      doc.addImage(data.techSignatureDataUrl, "PNG", 114, y + 27, 78, 20);
    } catch { /* noop */ }
  } else {
    badge(doc, "TITAN PRO — ELECTRONIC RECORD", 114, y + 24, BLUE);
    setFont(doc, "italic", 7.5, GRAY);
    doc.text("Authorized via Titan Pro CRM", 114, y + 36);
  }
  doc.setDrawColor(...DARK);
  doc.setLineWidth(0.3);
  doc.line(114, y + 49, 192, y + 49);
  setFont(doc, "normal", 7, GRAY);
  doc.text("Titan Restoration LLC Representative", 114, y + 52);

  y += 60;

  // Document ID
  doc.setFillColor(240, 245, 255);
  doc.roundedRect(14, y, 182, 14, 2, 2, "F");
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("DOCUMENT ID", 18, y + 5);
  setFont(doc, "normal", 8, DARK);
  doc.text(docId, 18, y + 10);
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("GENERATED", 80, y + 5);
  setFont(doc, "normal", 8, DARK);
  doc.text(new Date().toLocaleString(), 80, y + 10);

  // Footers
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, i, totalPages);
  }

  return finalizePdf(doc);
}

// ─────────────────────────────────────────────────────────────────────────────
// INVOICE PDF
// ─────────────────────────────────────────────────────────────────────────────
export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoicePDFData {
  invoiceNumber: string;
  status: string;
  jobNumber?: string;
  dueDate?: string;
  paidAt?: string;
  createdAt?: string;
  billTo: { name?: string; phone?: string; email?: string; address?: string };
  lineItems: InvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;               // net due (after any reduction)
  originalTotal?: number;      // amount before insurance reduction
  adjustment?: number;         // dollar reduction agreed at settlement
  adjustmentReason?: string;   // why the amount was reduced
  notes?: string;
}

function money(n: number): string {
  return "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Local wrapper so "empty" renders as an em-dash instead of "" in PDFs.
// The heavy lifting (timezone-safe parsing) is in @/lib/dates.
function fmtDateOrDash(v?: string | number | Date | null): string {
  return v ? (fmtDate(v) || "—") : "—";
}

// ─────────────────────────────────────────────────────────────────────────────
// ESTIMATE PDF — same visual language as the invoice, different header wording
// and no due-date / paid-at row. Line-item shape allows an optional `unit`,
// `category`, and `notes` field so estimates can carry richer context than
// the flat invoice line items.
// ─────────────────────────────────────────────────────────────────────────────
export interface EstimateLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  unit?: string;
  category?: string;
  notes?: string;
}

export interface EstimatePDFData {
  estimateNumber: string;           // e.g. "EST-2026-001" or the estimate title
  status: string;                   // draft | sent | approved | rejected
  jobNumber?: string;
  createdAt?: string;
  billTo: { name?: string; phone?: string; email?: string; address?: string };
  lineItems: EstimateLineItem[];
  subtotal: number;
  tax: number;
  total: number;
  notes?: string;                   // estimate-level notes (renders under totals)
  scopeOfWork?: string;             // optional intro paragraph above line items
}

export function generateEstimatePDF(data: EstimatePDFData): string {
  const doc = new jsPDF({ unit: "mm", format: "letter" });

  const statusColors: Record<string, readonly [number, number, number]> = {
    draft: GRAY, sent: BLUE, approved: [0, 150, 80], rejected: RED,
  };

  let y = drawHeader(doc, "ESTIMATE", data.estimateNumber, data.jobNumber ? `Job File: ${data.jobNumber}` : "");

  // ── Estimate number + status badge + date row ────────────────────────────
  setFont(doc, "bold", 11, DARK);
  doc.text(data.estimateNumber, 14, y + 3);
  badge(doc, (data.status || "draft").toUpperCase(), 14, y + 10, statusColors[data.status] || GRAY);
  setFont(doc, "normal", 8, GRAY);
  doc.text(`Estimate Date: ${fmtDateOrDash(data.createdAt)}`, 196, y, { align: "right" });
  if (data.jobNumber) doc.text(`Job File: ${data.jobNumber}`, 196, y + 4.5, { align: "right" });
  y += 18;

  // ── Prepared For ─────────────────────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("PREPARED FOR", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 7;
  setFont(doc, "bold", 10, DARK);
  doc.text(data.billTo.name || "—", 14, y);
  y += 5;
  setFont(doc, "normal", 8.5, GRAY);
  if (data.billTo.address) { doc.text(doc.splitTextToSize(data.billTo.address, 120), 14, y); y += 4.5; }
  if (data.billTo.phone)   { doc.text(data.billTo.phone, 14, y); y += 4.5; }
  if (data.billTo.email)   { doc.text(data.billTo.email, 14, y); y += 4.5; }
  y += 4;

  // ── Optional scope-of-work paragraph ─────────────────────────────────────
  if (data.scopeOfWork && data.scopeOfWork.trim()) {
    setFont(doc, "bold", 9, BLUE);
    doc.text("SCOPE OF WORK", 14, y);
    hRule(doc, y + 2, BLUE, 0.5);
    y += 6;
    setFont(doc, "normal", 8.5, DARK);
    const lines = doc.splitTextToSize(data.scopeOfWork, 178);
    doc.text(lines, 14, y + 3);
    y += lines.length * 4.2 + 6;
  }

  // ── Line items table ─────────────────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("LINE ITEMS", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 6;

  doc.setFillColor(...BLUE);
  doc.rect(14, y, 182, 7, "F");
  setFont(doc, "bold", 8, WHITE);
  doc.text("DESCRIPTION", 17, y + 4.7);
  doc.text("QTY", 124, y + 4.7, { align: "right" });
  doc.text("UNIT", 140, y + 4.7, { align: "right" });
  doc.text("UNIT PRICE", 168, y + 4.7, { align: "right" });
  doc.text("AMOUNT", 193, y + 4.7, { align: "right" });
  y += 7;

  const items = data.lineItems && data.lineItems.length > 0
    ? data.lineItems
    : [{ description: "Restoration services", quantity: 1, unitPrice: data.subtotal || data.total, total: data.subtotal || data.total }];

  items.forEach((it, idx) => {
    const descLines = doc.splitTextToSize(it.description || "Item", 98);
    const noteLines = it.notes ? doc.splitTextToSize(`— ${it.notes}`, 98) : [];
    const rowH = Math.max(7, (descLines.length + noteLines.length) * 4.2 + 3);
    if (y + rowH > 250) { drawFooter(doc, 1, 1); doc.addPage(); y = 20; }
    if (idx % 2 === 1) { doc.setFillColor(...OFFWHITE); doc.rect(14, y, 182, rowH, "F"); }
    setFont(doc, "normal", 8.5, DARK);
    doc.text(descLines, 17, y + 4.7);
    if (noteLines.length) {
      setFont(doc, "italic", 7.5, GRAY);
      doc.text(noteLines, 17, y + 4.7 + descLines.length * 4.2);
    }
    setFont(doc, "normal", 8.5, DARK);
    doc.text(String(it.quantity ?? 1), 124, y + 4.7, { align: "right" });
    doc.text(it.unit || "—", 140, y + 4.7, { align: "right" });
    doc.text(money(it.unitPrice ?? 0), 168, y + 4.7, { align: "right" });
    doc.text(money(it.total ?? 0), 193, y + 4.7, { align: "right" });
    y += rowH;
    hRule(doc, y, LGRAY, 0.2);
  });
  y += 6;

  // ── Totals ───────────────────────────────────────────────────────────────
  const totalsX = 130, valX = 193;
  const rowLine = (label: string, value: string, color = DARK, bold = false) => {
    setFont(doc, bold ? "bold" : "normal", bold ? 9.5 : 8.5, color);
    doc.text(label, totalsX, y);
    doc.text(value, valX, y, { align: "right" });
    y += 5.5;
  };
  rowLine("Subtotal", money(data.subtotal), GRAY);
  if (Number(data.tax) > 0) rowLine("Tax", money(data.tax), GRAY);
  hRule(doc, y - 1, DARK, 0.4);
  y += 2;
  rowLine("ESTIMATE TOTAL", money(data.total), BLUE, true);
  y += 4;

  // ── Notes ────────────────────────────────────────────────────────────────
  if (data.notes && data.notes.trim()) {
    if (y > 235) { doc.addPage(); y = 20; }
    setFont(doc, "bold", 9, BLUE);
    doc.text("NOTES", 14, y);
    hRule(doc, y + 2, BLUE, 0.5);
    y += 6;
    const nlines = doc.splitTextToSize(data.notes, 178);
    doc.setFillColor(...OFFWHITE);
    doc.roundedRect(14, y - 2, 182, nlines.length * 4.2 + 6, 2, 2, "F");
    setFont(doc, "normal", 8.5, DARK);
    doc.text(nlines, 18, y + 3);
    y += nlines.length * 4.2 + 10;
  }

  // ── Terms box ────────────────────────────────────────────────────────────
  if (y > 245) { doc.addPage(); y = 20; }
  doc.setFillColor(240, 245, 255);
  doc.roundedRect(14, y, 182, 20, 2, 2, "F");
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("TERMS", 18, y + 5);
  setFont(doc, "normal", 7.5, DARK);
  doc.text("Estimate valid for 30 days from date above. Prices reflect current materials and labor costs", 18, y + 9.5);
  doc.text("and may adjust with insurance-approved scope. Actual work billed on invoice at completion.", 18, y + 13);
  setFont(doc, "normal", 7.5, RED);
  doc.text("Questions? Call 706-922-0154 or email cody@titanaugusta.com", 18, y + 17);

  // Footer on all pages
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, i, totalPages);
  }

  return finalizePdf(doc);
}

export function generateInvoicePDF(data: InvoicePDFData): string {
  const doc = new jsPDF({ unit: "mm", format: "letter" });

  const statusColors: Record<string, readonly [number, number, number]> = {
    draft: GRAY, sent: BLUE, paid: [0, 150, 80], overdue: RED,
  };

  let y = drawHeader(doc, "INVOICE", `${data.invoiceNumber}`, data.jobNumber ? `Job File: ${data.jobNumber}` : "");

  // ── Invoice number + status badge + dates row ────────────────────────────
  setFont(doc, "bold", 11, DARK);
  doc.text(data.invoiceNumber, 14, y + 3);
  badge(doc, (data.status || "draft").toUpperCase(), 14, y + 10, statusColors[data.status] || GRAY);
  setFont(doc, "normal", 8, GRAY);
  doc.text(`Invoice Date: ${fmtDateOrDash(data.createdAt)}`, 196, y, { align: "right" });
  doc.text(`Due Date: ${fmtDateOrDash(data.dueDate)}`, 196, y + 4.5, { align: "right" });
  if (data.jobNumber) doc.text(`Job File: ${data.jobNumber}`, 196, y + 9, { align: "right" });
  if (data.paidAt) {
    setFont(doc, "bold", 8, [0, 150, 80]);
    doc.text(`Paid: ${fmtDateOrDash(data.paidAt)}`, 196, y + 13.5, { align: "right" });
  }
  y += 18;

  // ── Bill To ────────────────────────────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("BILL TO", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 7;
  setFont(doc, "bold", 10, DARK);
  doc.text(data.billTo.name || "—", 14, y);
  y += 5;
  setFont(doc, "normal", 8.5, GRAY);
  if (data.billTo.address) { doc.text(doc.splitTextToSize(data.billTo.address, 120), 14, y); y += 4.5; }
  if (data.billTo.phone) { doc.text(data.billTo.phone, 14, y); y += 4.5; }
  if (data.billTo.email) { doc.text(data.billTo.email, 14, y); y += 4.5; }
  y += 4;

  // ── Line items table ─────────────────────────────────────────────────────
  setFont(doc, "bold", 9, BLUE);
  doc.text("DESCRIPTION OF SERVICES", 14, y);
  hRule(doc, y + 2, BLUE, 0.5);
  y += 6;

  // Table header
  doc.setFillColor(...BLUE);
  doc.rect(14, y, 182, 7, "F");
  setFont(doc, "bold", 8, WHITE);
  doc.text("DESCRIPTION", 17, y + 4.7);
  doc.text("QTY", 132, y + 4.7, { align: "right" });
  doc.text("UNIT PRICE", 162, y + 4.7, { align: "right" });
  doc.text("AMOUNT", 193, y + 4.7, { align: "right" });
  y += 7;

  const items = data.lineItems && data.lineItems.length > 0
    ? data.lineItems
    : [{ description: "Restoration services (flat amount)", quantity: 1, unitPrice: data.subtotal || data.total, total: data.subtotal || data.total }];

  items.forEach((it, idx) => {
    const descLines = doc.splitTextToSize(it.description || "Item", 108);
    const rowH = Math.max(7, descLines.length * 4.2 + 3);
    if (y + rowH > 250) { drawFooter(doc, 1, 1); doc.addPage(); y = 20; }
    if (idx % 2 === 1) { doc.setFillColor(...OFFWHITE); doc.rect(14, y, 182, rowH, "F"); }
    setFont(doc, "normal", 8.5, DARK);
    doc.text(descLines, 17, y + 4.7);
    doc.text(String(it.quantity ?? 1), 132, y + 4.7, { align: "right" });
    doc.text(money(it.unitPrice ?? 0), 162, y + 4.7, { align: "right" });
    doc.text(money(it.total ?? 0), 193, y + 4.7, { align: "right" });
    y += rowH;
    hRule(doc, y, LGRAY, 0.2);
  });
  y += 6;

  // ── Totals ────────────────────────────────────────────────────────────────
  const adj = Number(data.adjustment) || 0;
  const orig = data.originalTotal != null ? Number(data.originalTotal) : data.total;
  const totalsX = 130, valX = 193;
  const rowLine = (label: string, value: string, color = DARK, bold = false) => {
    setFont(doc, bold ? "bold" : "normal", bold ? 9.5 : 8.5, color);
    doc.text(label, totalsX, y);
    doc.text(value, valX, y, { align: "right" });
    y += 5.5;
  };

  rowLine("Subtotal", money(data.subtotal), GRAY);
  if (Number(data.tax) > 0) rowLine("Tax", money(data.tax), GRAY);
  if (adj > 0) {
    rowLine("Original invoiced", money(orig), GRAY);
    rowLine("Insurance reduction", "-" + money(adj), RED);
    if (data.adjustmentReason) {
      setFont(doc, "italic", 7, GRAY);
      const rlines = doc.splitTextToSize(data.adjustmentReason, 62);
      doc.text(rlines, totalsX, y);
      y += rlines.length * 3.5 + 1;
    }
  }
  hRule(doc, y - 1, DARK, 0.4);
  y += 2;
  rowLine(adj > 0 ? "NET DUE" : "TOTAL DUE", money(data.total), adj > 0 ? RED : BLUE, true);
  y += 4;

  // ── Notes ────────────────────────────────────────────────────────────────
  if (data.notes) {
    if (y > 235) { doc.addPage(); y = 20; }
    setFont(doc, "bold", 9, BLUE);
    doc.text("NOTES", 14, y);
    hRule(doc, y + 2, BLUE, 0.5);
    y += 6;
    const nlines = doc.splitTextToSize(data.notes, 178);
    doc.setFillColor(...OFFWHITE);
    doc.roundedRect(14, y - 2, 182, nlines.length * 4.2 + 6, 2, 2, "F");
    setFont(doc, "normal", 8.5, DARK);
    doc.text(nlines, 18, y + 3);
    y += nlines.length * 4.2 + 10;
  }

  // ── Payment terms ────────────────────────────────────────────────────────
  if (y > 245) { doc.addPage(); y = 20; }
  doc.setFillColor(240, 245, 255);
  doc.roundedRect(14, y, 182, 16, 2, 2, "F");
  setFont(doc, "bold", 7.5, GRAY);
  doc.text("PAYMENT TERMS", 18, y + 5);
  setFont(doc, "normal", 8, DARK);
  doc.text("Please remit payment by the due date. Make checks payable to Titan Restoration LLC.", 18, y + 10);
  setFont(doc, "normal", 7.5, RED);
  doc.text("Questions? Call 706-922-0154 or email cody@titanaugusta.com", 18, y + 14);

  // Footer on all pages
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, i, totalPages);
  }

  return finalizePdf(doc);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: open PDF in new tab
// ─────────────────────────────────────────────────────────────────────────────
// Convert a base64 data URI (or raw base64) into a Blob. Blob URLs work inside
// sandboxed iframes and avoid the browser restrictions that block large
// data: URI navigations and downloads.
function dataUriToBlob(dataUri: string): Blob {
  let mime = "application/pdf";
  let b64 = dataUri;
  // Tolerant of extra media-type parameters (jsPDF sneaks in
  // `;filename=generated.pdf` before `;base64,`). New PDFs go through
  // finalizePdf() and no longer have this, but legacy rows in the DB do.
  const match = /^data:([^;,]+)(?:;[^;,]+=[^;,]+)*;base64,(.*)$/s.exec(dataUri);
  if (match) {
    mime = match[1] || mime;
    b64 = match[2];
  } else if (dataUri.startsWith("data:")) {
    // data URI without base64 marker — fall back to comma split
    b64 = dataUri.slice(dataUri.indexOf(",") + 1);
  }
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function previewPDF(dataUri: string) {
  // Accept three shapes:
  //   • data: URI  (legacy / just-generated PDFs)
  //   • https:// signed URL (S3-hydrated bucket read URL)
  //   • plain base64 (very old rows) — handled by dataUriToBlob's fallback
  // For remote URLs we just open them directly so the browser streams from S3.
  let url: string;
  let revoke = false;
  if (/^https?:\/\//i.test(dataUri)) {
    url = dataUri;
  } else {
    try {
      url = URL.createObjectURL(dataUriToBlob(dataUri));
      revoke = true;
    } catch (e) {
      console.error("previewPDF: failed to build blob", e);
      return;
    }
  }
  const win = window.open(url, "_blank");
  if (!win) {
    // Popup blocked (or sandboxed): fall back to same-tab navigation via a
    // temporary anchor so the PDF still opens for the user.
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  // Revoke after a delay so the browser has time to load the document.
  if (revoke) setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: trigger browser download
// ─────────────────────────────────────────────────────────────────────────────
export function downloadPDF(dataUri: string, filename: string) {
  const name = filename.endsWith(".pdf") ? filename : filename + ".pdf";
  // Handle both inline data URIs and remote https URLs (S3-hydrated).
  // For remote URLs we still trigger the <a download> attribute; browsers will
  // honor it as long as the URL is same-origin OR the server sends the right
  // Content-Disposition (S3 signed URLs do).
  let url: string;
  let isBlob = false;
  if (/^https?:\/\//i.test(dataUri)) {
    url = dataUri;
  } else {
    try {
      url = URL.createObjectURL(dataUriToBlob(dataUri));
      isBlob = true;
    } catch (e) {
      console.error("downloadPDF: blob build failed, falling back to data URI", e);
      url = dataUri;
    }
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  if (isBlob) setTimeout(() => URL.revokeObjectURL(url), 60000);
}
