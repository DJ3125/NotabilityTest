import bplist from "bplist-parser";
import {writeFile, readFile} from "node:fs/promises";
import {PDFDocument, rgb} from "pdf-lib";

async function run(){
  const obj = (await bplist.parseFile('./Session.plist'))[0]["$objects"];
  
  //Replaces all UID with the correct data
  //const newObj = {};
  for(const i of obj){
    
    if(typeof i !== "object"){continue;}
    //console.log(i);
    for(const j in i){
      if(i[j].UID === undefined){continue;}
      i[j] = obj[i[j].UID];
    }
  }
  
  const newObj = {};
  for(const i of obj){
    if(!i.$class){
      continue;
    }
    newObj[i.$class.$classname] = i;
  }
  
  const drawing = newObj["NoteTakingSession"]["richText"]["Handwriting Overlay"]["SpatialHash"];
  
  //console.log(drawing["curvesnumpoints"].buffer, drawing["curvesnumpoints"].byteOffset);
  
  const pointSegmentsRaw = drawing["curvesnumpoints"];
  const pointSegments = [];
  for(let i = 0; i < pointSegmentsRaw.length; i+=4){
    pointSegments.push(pointSegmentsRaw.readUint32LE(i));
  }
  
  //console.log(pointSegments);

  const pointsRaw = drawing["curvespoints"];
  
  const points = [];
  for(let i = 0; i < pointsRaw.length; i+=8){
    points.push({x: pointsRaw.readFloatLE(i), y: pointsRaw.readFloatLE(i+4)});
  }
  
  const segments = [];
  for(const i of pointSegments){
    segments.push(points.splice(0, i));
  }
  
  
  
  await writeFile("./res64.txt", drawing["curvespoints"].toString("base64"));
  await writeFile("./res2_64.txt", drawing["curvesnumpoints"].toString("base64"));
  
  const pdfDoc = await PDFDocument.load(await readFile("input.pdf"));
  const page = pdfDoc.getPage(0);
  
  const offsetX = 10; // adjust if your coordinates are negative
  const offsetY = 1;

  for (const segment of segments) {
    for (let i = 0; i < segment.length - 1; i++) {
      const start = segment[i];
      const end = segment[i + 1];

      page.drawLine({
        start: { x: start.x + offsetX, y: page.getHeight() - (start.y + offsetY) }, // flip Y
        end: { x: end.x + offsetX, y: page.getHeight() - (end.y + offsetY) },
        thickness: 1,
        color: rgb(0, 0, 0),
      });
    }
  }

// --- Save new PDF ---
  const pdfBytes = await pdfDoc.save();
  await writeFile("output_strokes.pdf", pdfBytes);
  console.log("PDF saved with strokes!");
  
  
  await writeFile("./res.json", JSON.stringify(newObj, null, 2));
  console.log("done");

}

run();