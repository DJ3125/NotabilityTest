import bplist from "bplist-parser";
import {writeFile, readFile} from "node:fs/promises";
import {PDFDocument, rgb} from "pdf-lib";

async function run(){
  const newObj = await extract("./Session.plist");
  
  const writingData = (await bplist.parseFile("./index.plist"))[0].pages;
  
  await writeFile("./write.json", JSON.stringify(writingData, null, 2));
  
  
  const drawing = newObj["NoteTakingSession"]["richText"]["Handwriting Overlay"]["SpatialHash"];
  
  console.log(drawing);

  const pointSegmentsRaw = drawing["curvesnumpoints"];
  const pointsRaw = drawing["curvespoints"];
  
  const segments = [];
  
  
  //const offsetX = 17; // adjust if your coordinates are negative
  //const offsetY = 1;
  
  const pdfDoc = await PDFDocument.load(await readFile("input.pdf"));
  const pageHeight = pdfDoc.getPage(0).getHeight();
  
  const vals = new Array(9);
  for(let i = 0; i < 9; i++){
    vals[i] = {};
    vals[i].minx = null;
    vals[i].miny = null;
    vals[i].maxx = null;
    vals[i].maxy = null;
  }
  
  {
    let index = 0;
    for(let i = 0; i < pointSegmentsRaw.length; i+=4){
      const tmp = [];
      for(let j = 0; j < pointSegmentsRaw.readUint32LE(i); j++){
        const x = pointsRaw.readFloatLE(index);
        const y = (pointsRaw.readFloatLE(index+4)) % pageHeight;
        const page = Math.floor((pointsRaw.readFloatLE(index+4)) / pageHeight);
        tmp.push({x, y, page});
        
        vals[page].minx = vals[page].minx === null ? x : Math.min(x, vals[page].minx);
        vals[page].maxx = vals[page].maxx === null ? x : Math.max(x, vals[page].maxx);
        vals[page].miny = vals[page].miny === null ? y : Math.min(y, vals[page].miny);
        vals[page].maxy = vals[page].maxy === null ? y : Math.max(y, vals[page].maxy);
        
        index += 8;
      }
      segments.push(tmp);
    }
  }
  
  
  
  //await writeFile("./res64.txt", drawing["curvespoints"].toString("base64"));
  //await writeFile("./res2_64.txt", drawing["curvesnumpoints"].toString("base64"));
  
  //const pdfDoc = await PDFDocument.load(await readFile("input.pdf"));
  //const page = pdfDoc.getPage(0);
  
  const rawWidths = drawing["curveswidth"];

  for (let j = 0; j < segments.length; j++) {
    const segment = segments[j];
    for (let i = 0; i < segment.length - 1; i++) {
      const start = segment[i];
      const end = segment[i + 1];
      
      
      
      const offsetX = 17 + writingData["" + (start.page + 1)]["pageContentOrigin"][0] - vals[start.page].minx;
      const offsetY = 2 + writingData["" + (start.page + 1)]["pageContentOrigin"][1] - vals[start.page].miny;

      pdfDoc.getPage(start.page).drawLine({
        start: { x: start.x + offsetX, y: pageHeight - start.y - offsetY}, // flip Y
        end: { x: end.x + offsetX, y: pageHeight - end.y - offsetY},
        thickness: rawWidths.readFloatLE(j * 4),
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

async function extract(file){
  const obj = (await bplist.parseFile(file))[0]["$objects"];
  
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
  return newObj;
}

run();