import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { createSupplierFile } from "./supplier-export";

const list = {
  cycleName: "October delivery week",
  scopeName: "All fulfillment locations",
  generatedAt: 1791504000000,
  items: [
    { productName: "Sayote (Chayote)", sizeLabel: "Medium", unit: "PIECE" as const, quantity: 1 },
    { productName: "Repolyo (Cabbage)", sizeLabel: "Small", unit: "PIECE" as const, quantity: 3 },
    { productName: "Piña", sizeLabel: null, unit: "GRAM" as const, quantity: 1500 },
    { productName: '=HYPERLINK("private")', sizeLabel: null, unit: "PIECE" as const, quantity: 2 },
  ],
};

describe("supplier documents", () => {
  it("writes only product and numeric quantity columns with size/unit and literal product text", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await createSupplierFile(list, "xlsx")).buffer);
    expect(workbook.worksheets).toHaveLength(1);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.columnCount).toBe(2);
    expect(sheet.getCell("A7").value).toBe("Sayote (Chayote) · Medium");
    expect(sheet.getCell("B7").value).toBe(1);
    expect(sheet.getCell("A8").value).toBe("Repolyo (Cabbage) · Small");
    expect(sheet.getCell("B8").value).toBe(3);
    expect(sheet.getCell("B8").numFmt).toContain("pcs");
    expect(sheet.getCell("B9").value).toBe(1.5);
    expect(sheet.getCell("B9").numFmt).toContain("kg");
    expect(sheet.getCell("A10").value).toBe('=HYPERLINK("private")');
    expect(sheet.getCell("A10").type).toBe(ExcelJS.ValueType.String);
  });

  it("creates readable multipage PDFs with Unicode names and long wrapped products", async () => {
    const font = await readFile(
      fileURLToPath(new URL("../../public/fonts/NotoSans-Regular.ttf", import.meta.url)),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(font)));
    try {
      const bytes = await createSupplierFile(
        {
          ...list,
          items: [
            ...list.items,
            ...Array.from({ length: 70 }, () => ({
              ...list.items[2]!,
              productName: "Piña " + "Long supplier product name ".repeat(4),
            })),
          ],
        },
        "pdf",
      );
      const document = await PDFDocument.load(bytes);
      expect(document.getPageCount()).toBeGreaterThan(2);
      expect(
        document.getPages().every((page) => page.getWidth() > 590 && page.getHeight() > 840),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
