import bplist from "bplist-parser";
import { writeFile, readFile } from "node:fs/promises";
import {
  PDFDocument,
  rgb,
  moveTo,
  lineTo,
  stroke,
  setLineWidth,
  setStrokingRgbColor,
  PDFName,
  PDFNumber,
  PDFOperator,
} from "pdf-lib";

/* =========================
   OPACITY SYSTEM
========================= */

const opacityCache = new Map();

function getOpacityExtGState(doc, opacity) {
  const key = opacity.toFixed(3);

  if (opacityCache.has(key)) return opacityCache.get(key);

  const gs = doc.context.obj({
    Type: "ExtGState",
    CA: PDFNumber.of(opacity),
    ca: PDFNumber.of(opacity),
  });

  const ref = doc.context.register(gs);
  opacityCache.set(key, ref);

  return ref;
}

function applyOpacity(page, doc, opacity, name) {
  const resources = page.node.Resources();

  let ext = resources.lookup(PDFName.of("ExtGState"));
  if (!ext) {
    ext = doc.context.obj({});
    resources.set(PDFName.of("ExtGState"), ext);
  }

  const ref = getOpacityExtGState(doc, opacity);
  ext.set(PDFName.of(name), ref);

  return PDFOperator.of("gs", [PDFName.of(name)]);
}

/* =========================
   PAGE SAFETY (FIX)
========================= */

function getOrCreatePage(pdfDoc, pageIndex, width, height) {
  while (pdfDoc.getPageCount() <= pageIndex) {
    pdfDoc.addPage([width, height]);
  }
  return pdfDoc.getPage(pageIndex);
}

/* =========================
   MAIN
========================= */

async function run() {
  const newObj = await extract("./data/Session.plist");

  const pdfDoc = await PDFDocument.load(
    await readFile("./data/input.pdf")
  );

  const pageHeight = pdfDoc.getPage(0).getHeight();
  const pageWidth = pdfDoc.getPage(0).getWidth();
  const pageCorrection = 3.85;

  /* =========================
     TEXT
  ========================= */

  const textBoxes =
    newObj?.NoteTakingSession?.richText?.mediaObjects?.["NS.objects"] ?? [];

  for (const i of textBoxes) {
    const sizeStr = i.unscaledContentSize.slice(1, -1).split(",");
    const originStr = i.documentContentOrigin.slice(1, -1).split(",");

    const x = parseFloat(originStr[0]);
    const y = parseFloat(originStr[1]);

    const pageIndex = Math.floor(y / pageHeight);
    const localY = y % pageHeight;

    const page = getOrCreatePage(
      pdfDoc,
      pageIndex,
      pageWidth,
      pageHeight
    );

    page.drawText(i.textStore.attributedString["NS.objects"][0], {
      x: x + 17,
      y: pageHeight - localY,
      size: 12,
      maxWidth: parseFloat(sizeStr[0]),
    });
  }

  /* =========================
     STROKES
  ========================= */

  const drawing =
    newObj.NoteTakingSession.richText["Handwriting Overlay"].SpatialHash;

  const pointSegmentsRaw = drawing.curvesnumpoints;
  const pointsRaw = drawing.curvespoints;
  const widthsRaw = drawing.curveswidth;
  const colorsRaw = drawing.curvescolors;

  const segments = [];
  let idx = 0;

  for (let i = 0; i < pointSegmentsRaw.length; i += 4) {
    const count = pointSegmentsRaw.readUInt32LE(i);
    const segment = [];

    for (let j = 0; j < count; j++) {
      const x = pointsRaw.readFloatLE(idx) + 16;
      const yRaw = pointsRaw.readFloatLE(idx + 4);

      const pageIndex = Math.floor(yRaw / (pageHeight - pageCorrection));
      const y = yRaw + (1 - pageIndex) * pageCorrection / 2 - 2;

      segment.push({ x, y, pageIndex });

      idx += 8;
    }

    segments.push(segment);
  }

  /* =========================
     DRAW STROKES
  ========================= */

  for (let s = 0; s < segments.length; s++) {
    const segment = segments[s];
    if (!segment.length) continue;

    const pageIndex = segment[0].pageIndex;

    const page = getOrCreatePage(
      pdfDoc,
      pageIndex,
      pageWidth,
      pageHeight
    );

    const offsetY = pageIndex * (pageHeight - pageCorrection);

    const width = widthsRaw.readFloatLE(s * 4);

    const r = colorsRaw.readUInt8(s * 4) / 255;
    const g = colorsRaw.readUInt8(s * 4 + 1) / 255;
    const b = colorsRaw.readUInt8(s * 4 + 2) / 255;
    const a = colorsRaw.readUInt8(s * 4 + 3) / 255;

    const ops = [];

    ops.push(PDFOperator.of("q"));

    if (a < 1) {
      const gsName = `GS_${s}`;
      ops.push(applyOpacity(page, pdfDoc, a, gsName));
    }

    ops.push(setLineWidth(width));
    ops.push(setStrokingRgbColor(r, g, b));

    const first = segment[0];
    ops.push(moveTo(first.x, pageHeight - first.y + offsetY));

    for (let i = 1; i < segment.length; i++) {
      const p = segment[i];
      ops.push(lineTo(p.x, pageHeight - p.y + offsetY));
    }

    ops.push(stroke());
    ops.push(PDFOperator.of("Q"));

    page.pushOperators(...ops);
  }

  /* =========================
     SAVE
  ========================= */

  const out = await pdfDoc.save();
  await writeFile("output.pdf", out);

  console.log("✅ PDF saved successfully with opacity + pages fixed!");
}

/* =========================
   EXTRACT (unchanged)
========================= */

async function extract(file) {
  const obj = (await bplist.parseFile(file))[0]["$objects"];

  let stack = [obj];

  while (stack.length) {
    const next = [];

    for (const item of stack) {
      if (Array.isArray(item)) {
        for (let i = 0; i < item.length; i++) {
          const v = item[i];
          if (v?.UID !== undefined) item[i] = obj[v.UID];
          else if (typeof v === "object") next.push(v);
        }
      } else if (typeof item === "object") {
        for (const k in item) {
          const v = item[k];
          if (v?.UID !== undefined) item[k] = obj[v.UID];
          else if (typeof v === "object") next.push(v);
        }
      }
    }

    stack = next;
  }

  const out = {};
  for (const i of obj) {
    if (i?.$class?.$classname) {
      out[i.$class.$classname] = i;
    }
  }

  return out;
}

run();