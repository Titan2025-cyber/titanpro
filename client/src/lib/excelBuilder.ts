/**
 * excelBuilder.ts — Titan branded .xlsx export via SheetJS.
 *
 * Builds a workbook from a DocConfig: a title/summary sheet plus a sheet per
 * table block. Downloads directly, fully client-side.
 */

import * as XLSX from "xlsx";
import type { DocConfig } from "./documentBuilder";

export function buildBrandedExcel(cfg: DocConfig): void {
  const wb = XLSX.utils.book_new();

  // ── Summary sheet ──
  const summaryRows: any[][] = [];
  summaryRows.push(["TITAN RESTORATION LLC"]);
  summaryRows.push(["Recover - Restore - Rebuild  |  706-922-0154  |  titanrestorationllc.com"]);
  summaryRows.push([]);
  summaryRows.push([cfg.title]);
  if (cfg.subtitle) summaryRows.push([cfg.subtitle]);
  if (cfg.docId) summaryRows.push([cfg.docId]);
  summaryRows.push(["Generated", new Date().toLocaleString()]);
  summaryRows.push([]);

  for (const block of cfg.blocks) {
    if (block.type === "heading") { summaryRows.push([]); summaryRows.push([block.text]); }
    else if (block.type === "paragraph") { summaryRows.push([block.text]); }
    else if (block.type === "kpis") {
      summaryRows.push([]);
      for (const it of block.items) if (it.label || it.value) summaryRows.push([it.label, it.value]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(summaryRows);
  ws["!cols"] = [{ wch: 32 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws, "Summary");

  // ── Table sheets ──
  let tIdx = 0;
  for (const block of cfg.blocks) {
    if (block.type !== "table") continue;
    tIdx++;
    const aoa = [block.columns, ...block.rows];
    const tws = XLSX.utils.aoa_to_sheet(aoa);
    tws["!cols"] = block.columns.map(c => ({ wch: Math.max(12, c.length + 4) }));
    const name = `Table ${tIdx}`.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, tws, name);
  }

  const safeTitle = cfg.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || "Titan_Document";
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${safeTitle}_${date}.xlsx`);
}
