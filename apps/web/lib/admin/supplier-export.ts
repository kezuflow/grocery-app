import type { SupplierPurchaseList } from "@freshmarkets/contracts";

type Item = SupplierPurchaseList["items"][number];
function product(item: Item) {
  return item.sizeLabel ? `${item.productName} · ${item.sizeLabel}` : item.productName;
}
function amount(item: Item) {
  return item.unit === "GRAM" && item.quantity >= 1000
    ? { value: item.quantity / 1000, unit: "kg" }
    : {
        value: item.quantity,
        unit:
          item.unit === "GRAM"
            ? "g"
            : item.unit === "MILLILITER"
              ? "mL"
              : item.quantity === 1
                ? "pc"
                : "pcs",
      };
}
function quantity(item: Item) {
  const value = amount(item);
  return `${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(value.value)} ${value.unit}`;
}
function timestamp(list: SupplierPurchaseList) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(list.generatedAt);
}

export async function createSupplierFile(
  list: SupplierPurchaseList,
  format: "pdf" | "xlsx",
): Promise<Uint8Array<ArrayBuffer>> {
  if (format === "xlsx") {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "FreshMarkets";
    const sheet = workbook.addWorksheet("Supplier list", {
      views: [{ state: "frozen", ySplit: 6 }],
      pageSetup: {
        paperSize: 9,
        orientation: "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: "6:6",
      },
    });
    sheet.columns = [{ width: 62 }, { width: 22 }];
    const header = [
      "FreshMarkets | Supplier purchase list",
      list.cycleName,
      list.scopeName,
      `Generated ${timestamp(list)}`,
    ];
    for (const [index, text] of header.entries()) {
      sheet.mergeCells(index + 1, 1, index + 1, 2);
      sheet.getCell(index + 1, 1).value = text;
    }
    sheet.getCell("A1").font = {
      name: "Calibri",
      size: 18,
      bold: true,
      color: { argb: "FF008744" },
    };
    sheet.getRow(1).height = 30;
    sheet.getRow(6).values = ["Product", "Quantity"];
    sheet.getRow(6).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF008744" } };
    sheet.getRow(6).height = 26;
    for (const item of list.items) {
      const value = amount(item);
      const row = sheet.addRow([product(item), value.value]);
      row.getCell(2).numFmt = '#,##0.###" ' + value.unit + '"';
      row.getCell(2).alignment = { horizontal: "right", vertical: "middle" };
      row.getCell(1).alignment = { wrapText: true, vertical: "middle" };
      row.height = Math.max(26, Math.ceil(product(item).length / 58) * 16 + 10);
      if (row.number % 2)
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F7F4" } };
    }
    sheet.autoFilter = `A6:B${sheet.rowCount}`;
    sheet.pageSetup.printArea = `A1:B${sheet.rowCount}`;
    return new Uint8Array(await workbook.xlsx.writeBuffer());
  }
  const [{ PDFDocument, rgb }, { default: fontkit }] = await Promise.all([
    import("pdf-lib"),
    import("@pdf-lib/fontkit"),
  ]);
  const response = await fetch("/fonts/NotoSans-Regular.ttf", { cache: "force-cache" });
  if (!response.ok)
    throw new Error("Could not load the PDF font. Please try again or export Excel.");
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(await response.arrayBuffer(), { subset: true });
  const supported = new Set(font.getCharacterSet());
  const clean = (value: string) =>
    [...value].map((character) => (character.codePointAt(0)! < 32 ? " " : character)).join("");
  const text = (value: string) => {
    const normalized = clean(value);
    if ([...normalized].some((character) => !supported.has(character.codePointAt(0)!)))
      throw new Error(
        "A product contains characters unsupported by the PDF font. Please export Excel instead.",
      );
    return normalized;
  };
  const wrap = (value: string, width: number, size: number) => {
    const lines: string[] = [];
    let line = "";
    for (const word of text(value).split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      for (const character of word) {
        if (line && font.widthOfTextAtSize(line + character, size) > width) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line.trim());
    return lines;
  };
  let page = document.addPage([595.28, 841.89]);
  let y = 0;
  const green = rgb(0, 0.53, 0.27);
  const draw = (value: string, x: number, at: number, size = 10) =>
    page.drawText(text(value), { x, y: at, size, font });
  const startPage = () => {
    page.drawText("FreshMarkets", { x: 42, y: 795, size: 22, font, color: green });
    draw("Supplier purchase list", 42, 770, 15);
    y = 746;
    for (const line of wrap(`${list.cycleName} · ${list.scopeName}`, 505, 10)) {
      draw(line, 42, y);
      y -= 14;
    }
    draw(`Generated ${timestamp(list)}`, 42, y);
    y -= 32;
    page.drawRectangle({ x: 42, y: y - 8, width: 511, height: 26, color: rgb(0.94, 0.97, 0.95) });
    draw("Product", 50, y);
    draw("Quantity", 487, y);
    y -= 30;
  };
  startPage();
  for (const item of list.items) {
    const lines = wrap(product(item), 390, 11);
    for (let offset = 0; offset < lines.length;) {
      if (y < 72) {
        page = document.addPage([595.28, 841.89]);
        startPage();
      }
      const count = Math.min(lines.length - offset, Math.max(1, Math.floor((y - 58) / 16)));
      for (let i = 0; i < count; i++) draw(lines[offset + i]!, 50, y - i * 16, 11);
      if (offset === 0) {
        const label = quantity(item);
        draw(label, 545 - font.widthOfTextAtSize(label, 11), y, 11);
      }
      offset += count;
      y -= count * 16 + 14;
      page.drawLine({
        start: { x: 42, y: y + 14 },
        end: { x: 553, y: y + 14 },
        thickness: 0.5,
        color: rgb(0.88, 0.9, 0.89),
      });
    }
  }
  for (const [index, outputPage] of document.getPages().entries())
    outputPage.drawText(`${index + 1} / ${document.getPageCount()}`, {
      x: 510,
      y: 32,
      font,
      size: 9,
    });
  return new Uint8Array(await document.save());
}
