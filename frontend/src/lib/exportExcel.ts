import * as XLSX from "xlsx";

interface SheetData {
  name: string;
  data: Record<string, unknown>[];
  /** Optional column widths in characters */
  colWidths?: number[];
}

/**
 * Export data to Excel (.xlsx) file with one or multiple sheets.
 * @param filename - Name of the file (without extension)
 * @param sheets - Array of sheets with name and data
 */
export function exportToExcel(filename: string, sheets: SheetData[]) {
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    if (sheet.data.length === 0) continue;
    const ws = XLSX.utils.json_to_sheet(sheet.data);

    // Auto-width columns
    if (sheet.colWidths) {
      ws["!cols"] = sheet.colWidths.map((w) => ({ wch: w }));
    } else {
      // Auto-detect widths from headers and first rows
      const headers = Object.keys(sheet.data[0]);
      ws["!cols"] = headers.map((h) => {
        const maxLen = Math.max(
          h.length,
          ...sheet.data.slice(0, 50).map((row) => String(row[h] ?? "").length)
        );
        return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
      });
    }

    XLSX.utils.book_append_sheet(wb, ws, sheet.name.substring(0, 31));
  }

  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * Simple single-sheet export.
 */
export function exportSimple(filename: string, data: Record<string, unknown>[]) {
  exportToExcel(filename, [{ name: "Datos", data }]);
}
