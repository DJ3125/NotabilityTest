import bplist from "bplist-parser";
import {writeFile} from "node:fs/promises";

async function run(){
  const obj = await bplist.parseFile('./Session.plist');
  await writeFile("./res.json", JSON.stringify(obj, null, 2));
  console.log("done");

}

run();