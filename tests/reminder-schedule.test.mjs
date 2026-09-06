import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const source=fs.readFileSync(path.join(root,"supabase/functions/watchlog-reminders/index.ts"),"utf8");
function extract(name){
  const start=source.indexOf(`function ${name}(`);assert.notEqual(start,-1,`Missing ${name}`);
  const bodyStart=source.indexOf("{",start);let depth=0;
  for(let i=bodyStart;i<source.length;i++){if(source[i]==="{")depth++;else if(source[i]==="}"&&--depth===0)return source.slice(start,i+1);}
  throw new Error(`Could not extract ${name}`);
}

test("server refresh advances to the next true episode and keeps UTC timestamps",()=>{
  const context=vm.createContext({Date,Number,Array,Set,String,Object});
  vm.runInContext(["episodeUtcValue","episodeReleaseTime","buildServerEpisodeSchedule"].map(extract).join("\n")+"\nthis.build=buildServerEpisodeSchedule;",context);
  const item={id:"show",type:"Series",watchedEpisodes:{1:[1]},tvmazeShowId:"1"};
  const episodes=[
    {season:1,number:1,name:"One",airstamp:"2026-09-01T20:00:00+01:00"},
    {season:1,number:2,name:"Two",airstamp:"2026-09-10T20:00:00+01:00"},
    {season:1,number:3,name:"Three",airstamp:"2026-09-03T20:00:00+01:00"},
  ];
  const result=context.build(item,episodes,new Date("2026-09-06T12:00:00Z").getTime());
  assert.deepEqual(JSON.parse(JSON.stringify(result.releasedEpisodes)),{1:[1,3]});
  assert.equal(result.latestEpisodeNum,3);
  assert.equal(result.latestEpisodeDate,"2026-09-03T19:00:00.000Z");
  assert.equal(result.nextEpisodeNum,2);
  assert.equal(result.nextEpisodeDate,"2026-09-10T19:00:00.000Z");
  assert.deepEqual(result.watchedEpisodes,{1:[1]});
});
