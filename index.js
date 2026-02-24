import bplist from "bplist-parser";
import {writeFile} from "node:fs/promises";

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
  console.log(drawing);
  const pointSegments = new Uint32Array(drawing["curvesnumpoints"]);
  
  //let val = 0;
  //for(const i of pointSegments){
  //  val += i;
  //}
  //console.log(drawing["curvespoints"].length/val);
  
  
  //console.log(drawing["curvespoints"].toString("base64"));
  
  await writeFile("./res64.txt", drawing["curvespoints"].toString("base64"));
  await writeFile("./res2_64.txt", drawing["curvesnumpoints"].toString("base64"));
  
  await writeFile("./res.json", JSON.stringify(newObj, null, 2));
  console.log("done");

}

run();