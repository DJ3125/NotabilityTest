import bplist from "bplist-parser";
import {writeFile, readFile} from "node:fs/promises";
import {PDFDocument, rgb} from "pdf-lib";

async function run(){
  const newObj = await extract("./Session.plist");
  //const writingData = (await bplist.parseFile("./index.plist"))[0].pages;
  
  let minY = 100000000;
  const textBoxes = newObj["NoteTakingSession"]["richText"]["mediaObjects"]["NS.objects"].map(i=>{
    const locString = i["unscaledContentSize"].substring(1, i["unscaledContentSize"].length - 1);
    const locString2 = i["documentContentOrigin"].substring(1, i["documentContentOrigin"].length - 1);
    minY = Math.min(minY, parseFloat(locString2.substring(locString2.indexOf(",") + 1)));
    return {
      text: i["textStore"]["attributedString"]["NS.objects"][0],
      x:parseFloat(locString2.substring(0, locString2.indexOf(","))),
      y: parseFloat(locString2.substring(locString2.indexOf(",") + 1)),
      width: parseFloat(locString.substring(0, locString.indexOf(","))),
      height: parseFloat(locString.substring(locString.indexOf(",") + 1))
    };
  });
  
  //await writeFile("./textbox.json", JSON.stringify(newObj, null, 2));
  
  //return;
  
  const drawing = newObj["NoteTakingSession"]["richText"]["Handwriting Overlay"]["SpatialHash"];
  //const shapesPList = (await bplist.parseFile(drawing["shapes"]))[0];

  const pointSegmentsRaw = drawing["curvesnumpoints"];
  const pointsRaw = drawing["curvespoints"];
  
  const segments = [];
  
  const pdfDoc = await PDFDocument.load(await readFile("input.pdf"));
  const pageHeight = pdfDoc.getPage(0).getHeight();
  
  for(const i of textBoxes){
    i.page = Math.floor(i.y/pageHeight);
    i.y %= pageHeight;
    
    pdfDoc.getPage(i.page).drawText(i.text, {
      x: i.x + 17,
      y: pageHeight - i.y,
      size: 12,
      maxWidth: i.width,
    
    });
  }
  
  const pdfBytes2 = await pdfDoc.save();
  await writeFile("output_strokes.pdf", pdfBytes2);
  console.log("PDF saved with strokes!");
  
  return;
  
  const vals = new Array(9);
  for(let i = 0; i < 9; i++){
    vals[i] = {};
    vals[i].minx = null;
    vals[i].miny = null;
    vals[i].maxx = null;
    vals[i].maxy = null;
  }
  console.log("getting mins and max");
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
  
  const rawWidths = drawing["curveswidth"];
  const rawColors = drawing["curvescolors"];

  console.log("drawing segments");

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
        color: rgb(rawColors.readUint8(j * 4)/255, rawColors.readUint8(j * 4 + 1)/255, rawColors.readUint8(j * 4 + 2)/255),
        opacity: rawColors.readUint8(j * 4 + 3)/255,
      });
    }
  }

  console.log("drawing shapes");

  for(let i = 0; i < shapesPList.shapes.length; i++){
    if(shapesPList.kinds[i] === "circle"){
      const circle = shapesPList.shapes[i];
      const page = Math.floor(circle.rect[0][1] / pageHeight);
      const y = (circle.rect[0][1] % pageHeight) + 2 + writingData["" + (page + 1)]["pageContentOrigin"][1] - vals[page].miny + circle.rect[1][1]/2;
      const x = circle.rect[0][0] + 17 + writingData["" + (page + 1)]["pageContentOrigin"][0] - vals[page].minx + circle.rect[1][0]/2;
      pdfDoc.getPage(page).drawEllipse({
        x,
        y: pageHeight - y,
        xScale: circle.rect[1][0]/2,
        yScale: circle.rect[1][1]/2,
        borderWidth: circle.appearance.strokeWidth,
        borderColor: rgb(circle.appearance.strokeColor.rgba[0], circle.appearance.strokeColor.rgba[1], circle.appearance.strokeColor.rgba[2]),
        borderOpacity: circle.appearance.strokeColor.rgba[3],
        color: undefined,
      });
      continue;
    }
    
    
    const corners = shapesPList.shapes[i].points;
    const shape = shapesPList.shapes[i];
    for(let j = 0; j < corners.length + (shape.isClosed ? 0 : -1); j++){
      let [x1, y1] = corners[j];
      let [x2, y2] = corners[(j + 1) % corners.length];
      
      const page = Math.floor(y1 / pageHeight);
      y1 %= pageHeight;
      y2 %= pageHeight;
      
      const offsetX = 17 + writingData["" + (page + 1)]["pageContentOrigin"][0] - vals[page].minx;
      const offsetY = 2 + writingData["" + (page + 1)]["pageContentOrigin"][1] - vals[page].miny;
      
      pdfDoc.getPage(page).drawLine({
        start: { x: x1 + offsetX, y: pageHeight - y1 - offsetY}, // flip Y
        end: { x: x2 + offsetX, y: pageHeight - y2 - offsetY},
        thickness: shape.appearance.strokeWidth,
        opacity: shape.appearance.strokeColor.rgba[3],
        color: rgb(shape.appearance.strokeColor.rgba[0], shape.appearance.strokeColor.rgba[1], shape.appearance.strokeColor.rgba[2]),
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
  
  await writeFile("./textboxRaw.json", JSON.stringify(obj, null, 2));
  
  
  //Replaces all UID with the correct data
  //const newObj = {};
  
  let objsForReplacement = [obj];
  
  

  //for(const i of obj){
  //  if(!((typeof i === "object") || (typeof i === "array"))){continue;}
  //  objsForReplacement.push(i);
  //}
  
  while(objsForReplacement.length > 0){
    const tmp = [];
    for(const i of objsForReplacement){
      if(typeof i === "array"){
        for(let k = 0; k < i.length; k++){
          const j = i[k];
          if(typeof j !== "object" && typeof j !== "array"){continue;}
          if(typeof j === "object" && j.UID !== undefined){i[k] = obj[j.UID]; continue;}
          objsForReplacement.push(j);
        }
      }else if(typeof i === "object"){
        for(const j in i){
          if((typeof i[j] === "object" && i[j].UID === undefined) || typeof i[j] === "array"){objsForReplacement.push(i[j]);}
          if(typeof i[j] === "array"){continue;}
          if(i[j].UID === undefined){continue;}
          i[j] = obj[i[j].UID];
        }
      
      }
    }
    objsForReplacement = tmp;
  }
  
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