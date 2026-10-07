import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";

const NAVY = rgb(0.098, 0.102, 0.208);
const CREAM = rgb(0.965, 0.953, 0.918);
const INK = rgb(0.098, 0.102, 0.208);
const MUTED = rgb(0.25, 0.26, 0.36);
const LIME = rgb(0.82, 0.957, 0.353);
const RULE = rgb(0.82, 0.78, 0.72);

function wrap(text, font, size, width) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length === 0) lines.push("");
  return lines.flatMap((line) => breakLong(line, font, size, width));
}

function breakLong(line, font, size, width) {
  if (font.widthOfTextAtSize(line, size) <= width) return [line];
  const parts = [];
  let rest = line;
  while (rest) {
    let take = rest.length;
    while (take > 1 && font.widthOfTextAtSize(rest.slice(0, take), size) > width) take -= 1;
    parts.push(rest.slice(0, take));
    rest = rest.slice(take);
  }
  return parts;
}

export async function buildReceiptPdf(receipt) {
  const pdf = await PDFDocument.create();
  const pageSize = [595, 842];
  let page = pdf.addPage(pageSize);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 48;
  const width = page.getWidth() - margin * 2;
  let y = 800;

  const nextPage = () => {
    page = pdf.addPage(pageSize);
    page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(1, 1, 1) });
    y = 800;
  };
  page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(1, 1, 1) });

  const draw = (text, options) => {
    const size = options.size ?? 11;
    const used = options.font ?? font;
    const lines = wrap(text, used, size, options.width ?? width);
    for (const line of lines) {
      if (y < 64) nextPage();
      page.drawText(line, { x: options.x ?? margin, y, size, font: used, color: options.color ?? INK });
      y -= (options.leading ?? size + 4);
    }
  };

  page.drawRectangle({ x: margin, y: y - 28, width: 22, height: 28, color: NAVY });
  page.drawRectangle({ x: margin + 14, y: y - 4, width: 12, height: 12, color: LIME });
  page.drawText("ProofPay", { x: margin + 34, y: y - 16, size: 18, font: bold, color: NAVY });
  y -= 48;

  page.drawRectangle({ x: margin, y: y - 28, width, height: 36, color: CREAM });
  page.drawText("TESTNET PAYMENT — NO REAL MONETARY VALUE.", {
    x: margin + 10,
    y: y - 16,
    size: 11,
    font: bold,
    color: NAVY,
  });
  y -= 52;

  if (receipt.sample) {
    draw("SIMULATED RECEIPT. These details are fictional. This file is not a confirmed Monad transaction and it has no explorer link.", {
      size: 10,
      font: bold,
      leading: 14,
    });
    y -= 8;
  }

  draw(receipt.heading, { size: 20, font: bold, leading: 26 });
  draw(receipt.status, { size: 12, font: bold, leading: 18, color: MUTED });
  y -= 8;
  draw(receipt.amountLabel, { size: 22, font: bold, leading: 28 });
  y -= 6;

  const rows = [
    ["Receipt reference", receipt.reference],
    ["Agreement", receipt.agreementTitle],
    ["Agreement reference", receipt.agreementRef],
    ["Milestone", receipt.milestoneTitle],
    ["From", `${receipt.fromName}`],
    ["From wallet", receipt.fromWallet],
    ["To", `${receipt.toName}`],
    ["To wallet", receipt.toWallet],
    ["Token", receipt.token],
    ["Network", receipt.network],
    ["Confirmed", receipt.confirmedAt],
    ["Transaction", receipt.txHash],
    ["Explorer", receipt.explorerUrl || "Not available until the payment is confirmed on the configured network."],
    ["What this is", receipt.note],
  ];

  for (const [label, value] of rows) {
    if (y < 90) nextPage();
    page.drawText(label, { x: margin, y, size: 9, font: bold, color: MUTED });
    y -= 14;
    const valueTop = y;
    const valuePage = page;
    draw(value, { size: 11, leading: 15 });
    if (label === "Explorer" && String(value).startsWith("https://")) {
      const textWidth = Math.min(font.widthOfTextAtSize(String(value), 11), width);
      const annot = pdf.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [margin, valueTop - 3, margin + textWidth, valueTop + 11],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(String(value)) },
      });
      const ref = pdf.context.register(annot);
      valuePage.node.set(PDFName.of("Annots"), pdf.context.obj([ref]));
    }
    y -= 6;
    page.drawLine({ start: { x: margin, y: y + 8 }, end: { x: margin + width, y: y + 8 }, thickness: 0.5, color: RULE });
  }

  y -= 8;
  draw("This document is a payment record for a test token. It is not a tax invoice and it is not a legal or tax certification.", {
    size: 9,
    color: MUTED,
    leading: 12,
  });

  return pdf.save();
}
