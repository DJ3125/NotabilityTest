import bplist from "bplist-parser";
import {
  writeFile,
  readFile
} from "node:fs/promises";
import {
  PDFDocument,
  rgb,
  moveTo,
  lineTo,
  stroke,
  setLineWidth,
  setStrokingRgbColor,
} from "pdf-lib";

async function run() {
  const newObj = await extract("./data/Session.plist");

  const writingData = {} || (await bplist.parseFile("./data/index.plist"))[0].pages;

  const drawing = newObj["NoteTakingSession"]["richText"]["Handwriting Overlay"]["SpatialHash"];

  const pointSegmentsRaw = drawing["curvesnumpoints"];
  const pointsRaw = drawing["curvespoints"];

  const segments = [];

  const pdfDoc = await PDFDocument.load(await readFile("./data/input.pdf"));
  const pageHeight = pdfDoc.getPage(0).getHeight();
  const pageCorrection = 3.85;

  // --- Text Rendering ---
  const textBoxes = newObj["NoteTakingSession"]["richText"]["mediaObjects"]["NS.objects"].map(
    (i) => {
      const locString = i["unscaledContentSize"].substring(1, i["unscaledContentSize"].length - 1);
      const locString2 = i["documentContentOrigin"].substring(1, i["documentContentOrigin"].length - 1);
      return {
        text: i["textStore"]["attributedString"]["NS.objects"][0],
        x: parseFloat(locString2.substring(0, locString2.indexOf(","))),
        y: parseFloat(locString2.substring(locString2.indexOf(",") + 1)),
        width: parseFloat(locString.substring(0, locString.indexOf(","))),
        height: parseFloat(locString.substring(locString.indexOf(",") + 1)),
      };
    }
  );

  for (const i of textBoxes) {
    i.page = Math.floor(i.y / pageHeight);
    i.y %= pageHeight;

    pdfDoc.getPage(i.page).drawText(i.text, {
      x: i.x + 17,
      y: pageHeight - i.y,
      size: 12,
      maxWidth: i.width,
    });
  }

  // --- Compute min/max for offsets ---
  const vals = new Array(pdfDoc.getPages().length).fill(null).map(() => ({
    minx: null,
    miny: null,
    maxx: null,
    maxy: null,
  }));

  let index = 0;
  for (let i = 0; i < pointSegmentsRaw.length; i += 4) {
    const tmp = [];
    for (let j = 0; j < pointSegmentsRaw.readUint32LE(i); j++) {
      const x = pointsRaw.readFloatLE(index) + 16;

      const page = Math.floor(pointsRaw.readFloatLE(index + 4) / (pageHeight - pageCorrection));
      const y = pointsRaw.readFloatLE(index + 4) + (1 - page) * pageCorrection / 2 - 2;

      tmp.push({
        x,
        y,
        page
      });

      vals[page].minx = vals[page].minx === null ? x : Math.min(x, vals[page].minx);
      vals[page].maxx = vals[page].maxx === null ? x : Math.max(x, vals[page].maxx);
      vals[page].miny = vals[page].miny === null ? y : Math.min(y, vals[page].miny);
      vals[page].maxy = vals[page].maxy === null ? y : Math.max(y, vals[page].maxy);

      index += 8;
    }
    segments.push(tmp);
  }

  const rawWidths = drawing["curveswidth"];
  const rawColors = drawing["curvescolors"];

  // --- Draw segments as single paths ---
  for (let j = 0; j < segments.length; j++) {
    const segment = segments[j];

    const startPage = segment[0].page;
    const page = pdfDoc.getPage(startPage);

    const offsetY = (startPage) * (pageHeight - pageCorrection);

    const width = rawWidths.readFloatLE(j * 4);

    const r = rawColors.readUint8(j * 4) / 255;
    const g = rawColors.readUint8(j * 4 + 1) / 255;
    const b = rawColors.readUint8(j * 4 + 2) / 255;
    const a = rawColors.readUint8(j * 4 + 3) / 255;

    const ops = [];
    ops.push(setLineWidth(width));
    ops.push(setStrokingRgbColor(r, g, b));

    const first = segment[0];
    ops.push(moveTo(first.x, pageHeight - first.y + offsetY));

    for (let i = 1; i < segment.length; i++) {
      const p = segment[i];
      ops.push(lineTo(p.x, pageHeight - p.y + offsetY));
    }

    ops.push(stroke());

    page.pushOperators(...ops);
  }

  // --- Draw shapes using same offset logic as segments ---
  const shapesPList = (await bplist.parseFile(drawing["shapes"]))[0]; // Replace with your shapes data if available
  //console.log(shapesPList)

  if (shapesPList.shapes) {
    for (let i = 0; i < shapesPList.shapes.length; i++) {
      const shape = shapesPList.shapes[i];

      if (shapesPList.kinds[i] === "circle") {
        const circle = shape;
        const pageNum = Math.floor(circle.rect[0][1] / pageHeight);
        const offsetY = (1 - pageNum) * pageCorrection / 2 - 2;
        const page = pdfDoc.getPage(pageNum);

        const x = (circle.rect[0][0] + circle.rect[1][0] / 2) + 16;
        const y = (circle.rect[0][1]) % (pageHeight - pageCorrection); // simple offset
        page.drawEllipse({
          x,
          y: pageHeight - y + offsetY,
          xScale: circle.rect[1][0] / 2,
          yScale: circle.rect[1][1] / 2,
          borderWidth: circle.appearance.strokeWidth,
          borderColor: rgb(
            circle.appearance.strokeColor.rgba[0],
            circle.appearance.strokeColor.rgba[1],
            circle.appearance.strokeColor.rgba[2]
          ),
          borderOpacity: circle.appearance.strokeColor.rgba[3],
          color: undefined,
        });

        continue;
      }

      const corners = shape.points;

      if (!corners || corners.length === 0) continue;

      const firstCorner = corners[0];
      const pageNum = Math.floor(firstCorner[1] / pageHeight);
      const offsetY = -(1 - pageNum) * pageCorrection / 2 + 2;

      const page = pdfDoc.getPage(pageNum);

      const ops = [];
      ops.push(setLineWidth(shape.appearance.strokeWidth));
      const r = shape.appearance.strokeColor.rgba[0];
      const g = shape.appearance.strokeColor.rgba[1];
      const b = shape.appearance.strokeColor.rgba[2];
      ops.push(setStrokingRgbColor(r, g, b));

      let firstPoint = true;

      for (let j = 0; j < corners.length; j++) {
        const [xRaw, yRaw] = corners[j];

        const x = xRaw + 16;
        const y = yRaw % (pageHeight - pageCorrection);
        if (firstPoint) {
          ops.push(moveTo(x, pageHeight - y + offsetY));
          firstPoint = false;
        } else {
          ops.push(lineTo(x, pageHeight - y + offsetY));
        }
      }

      if (shape.isClosed) {
        const [xRaw, yRaw] = corners[0];
        const x = xRaw + 16;
        const y = yRaw % (pageHeight - pageCorrection);
        ops.push(lineTo(x, pageHeight - y + offsetY));
      }

      ops.push(stroke());
      page.pushOperators(...ops);
    }
  }

  // --- Save PDF ---
  const pdfBytes2 = await pdfDoc.save();
  await writeFile("output_strokes.pdf", pdfBytes2);
  console.log("PDF saved with strokes!");
}

// --- Extract helper ---
async function extract(file) {
  const obj = (await bplist.parseFile(file))[0]["$objects"];
  await writeFile("./textboxRaw.json", JSON.stringify(obj, null, 2));

  let objsForReplacement = [obj];

  while (objsForReplacement.length > 0) {
    const tmp = [];
    for (const i of objsForReplacement) {
      if (Array.isArray(i)) {
        for (let k = 0; k < i.length; k++) {
          const j = i[k];
          if (typeof j !== "object") continue;
          if (j.UID !== undefined) {
            i[k] = obj[j.UID];
            continue;
          }
          tmp.push(j);
        }
      } else if (typeof i === "object") {
        for (const j in i) {
          if ((typeof i[j] === "object" && i[j].UID === undefined) || Array.isArray(i[j])) {
            tmp.push(i[j]);
          }
          if (i[j]?.UID !== undefined) {
            i[j] = obj[i[j].UID];
          }
        }
      }
    }
    objsForReplacement = tmp;
  }

  for (const i of obj) {
    if (typeof i !== "object") continue;
    for (const j in i) {
      if (i[j]?.UID !== undefined) i[j] = obj[i[j].UID];
    }
  }

  const newObj = {};
  for (const i of obj) {
    if (!i.$class) continue;
    newObj[i.$class.$classname] = i;
  }

  await writeFile("./newobj.json", JSON.stringify(newObj, null, 2));
  return newObj;
}

run();