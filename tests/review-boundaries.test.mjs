import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {stripTypeScriptTypes} from "node:module";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const backend=stripTypeScriptTypes(fs.readFileSync(new URL("../supabase/functions/watchlog-reminders/index.ts",import.meta.url),"utf8"));
const suite=fs.readFileSync(new URL("./app-behavior.test.mjs",import.meta.url),"utf8");
const helper=suite.slice(suite.indexOf("function extractFunction"),suite.indexOf('test("Current'));
const {extractFunction}=new Function("html","assert","vm",helper+"\nreturn {extractFunction};")(html,assert,vm);
const copy=value=>JSON.parse(JSON.stringify(value));
const baseShow=()=>({id:"show",title:"Example",type:"Series",status:"Watching",tvmazeShowId:"1",totalSeasons:1,curSeason:1,curEp:5,watchedSeasons:0,watchedEpisodes:{1:[1,2,3,4,5]},airedEpisodeCounts:{1:6},episodeCounts:{1:8},episodeScheduleVerified:true,verifiedCompletedSeasons:0});
function frontend(extra={}){
  const names=["canonicalRecordJSON","sameSyncValue","mergeEpisodeSetChanges","mergeEpisodeHistory","mergeRecordChanges","replayLocalChanges","toMillis","toLocalInput","storedDateFromInput","episodeReleaseTimestamp","normalizeReleasedEpisodeMap","positiveEpisodeMap","isEpisodeTrackable","releasedEpisodeMap","normalizeWatchedEpisodeMap","progressWatchedEpisodeMap","highestWatchedEpisode","migratePlannedStatuses","knownSeasonTotal","isWeakFilmRecord"];
  const context=vm.createContext({console,nowISO:()=>"2026-09-06T12:00:00Z",localISODate:()=>"2026-09-06",...extra});
  vm.runInContext(names.map(name=>extractFunction(html,name)).join("\n"),context);
  return context;
}

test("Metadata-only sync preserves remote ticks and merged progress follows both devices",()=>{
  const app=frontend(),base=baseShow();
  const remote={...base,curEp:6,watchedEpisodes:{1:[1,2,3,4,5,6]}};
  const local={...base,nextEpisodeNum:7};
  const merged=app.replayLocalChanges([base],[local],[remote])[0];
  assert.deepEqual(copy(merged.watchedEpisodes),remote.watchedEpisodes);
  assert.equal(merged.curEp,6);
  const edited={...base,curEp:4,watchedEpisodes:{1:[1,2,3,4]}};
  const combined=app.replayLocalChanges([base],[edited],[remote])[0];
  assert.deepEqual(copy(combined.watchedEpisodes),{1:[1,2,3,4,6]});
  assert.equal(combined.curEp,6);
  assert.deepEqual(copy(app.replayLocalChanges([base],[edited],[])),[]);
});

test("Actual editor save keeps legacy ticks and stored UTC while updating progress",async()=>{
  const previous={...baseShow(),nextEpisodeDate:"2026-09-10T12:00:00.000Z",nextEpisodeNum:7};
  const values={"item-id":"show",title:"Example",type:"Series",status:"Watching","tvmaze-id":"1","cur-season":"1","cur-ep":"6","watched-seasons":"0","total-seasons":"1","next-episode-num":"7"};
  const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:values[id]??""});return nodes.get(id);};
  const app=frontend({currentUser:{id:"test"},mediaForm:{},saveBtn:{},$,mediaItems:[previous],
    freshEditorVerification:()=>null,pendingEditorVerification:()=>null,scheduleMetadataRefresh(){},
    findTrackedDuplicate:()=>null,normalizeTitle:value=>value.toLowerCase(),sameRecordWithoutUpdateTime:()=>false,
    render(){},closeEditor(){},showAppToast(){},persistLibrary:async()=>{},alert:message=>{throw Error(message);}});
  $("next-episode-date").value=app.toLocalInput(previous.nextEpisodeDate);
  vm.runInContext(html.slice(html.indexOf("mediaForm.onsubmit=async e=>{"),html.indexOf("  deleteBtn.onclick=")),app);
  await app.mediaForm.onsubmit({preventDefault(){}});
  assert.deepEqual(copy(app.mediaItems[0].watchedEpisodes),{1:[1,2,3,4,5,6]});
  assert.equal(app.mediaItems[0].nextEpisodeDate,previous.nextEpisodeDate);
  $("cur-ep").value="3";
  await app.mediaForm.onsubmit({preventDefault(){}});
  assert.deepEqual(copy(app.mediaItems[0].watchedEpisodes),{1:[1,2,3]});
  assert.equal(app.mediaItems[0].lastWatchedEpisode,3);
  assert.equal(app.storedDateFromInput("2026-09-10T12:00","2026-09-10"),"2026-09-10");
});

function workerHarness(episodes,options={}){
  let clock=Date.parse("2026-09-06T12:00:00Z"),calls=0;
  let library={account_id:"a",revision:0,items:[{...baseShow(),nextEpisodeNum:6,nextEpisodeDate:"2026-09-06T12:00:00Z"}]};
  const deliveries=[],claimed=new Set();
  function query(payload=null){
    const filters={};
    return{select(){return this;},eq(key,value){filters[key]=value;return this;},
      in:async()=>({data:[copy(library)]}),
      maybeSingle:async()=>{
        if(!payload)return{data:copy(library)};
        if(filters.revision!==library.revision)return{data:null};
        library={...library,...copy(payload)};return{data:{account_id:library.account_id}};
      }};
  }
  const context=vm.createContext({console,AbortSignal,Date:class extends Date{static now(){return clock;}},
    fetch:async()=>{calls++;if(options.fail)throw Error("offline");if(options.conflict)library={...library,revision:library.revision+1,items:[]};return{ok:true,json:async()=>episodes};},
    db:{from:()=>({select:()=>query(),update:payload=>query(payload)})},
    claimDelivery:async(_sub,_account,_id,key)=>{if(claimed.has(key))return null;claimed.add(key);return{id:key};},
    sendPush:async(_sub,_config,payload)=>deliveries.push(payload),finishDelivery:async()=>{},sha256:async value=>value});
  const asyncNames=["refreshServerEpisodeSchedules","processPlannedReminders"];
  const names=["episodeUtcValue","episodeReleaseTime","buildServerEpisodeSchedule","zonedLocalToUtc","scheduledEventTime","serverScheduleRefreshDue",...asyncNames,"plannedEvent","reminderEvents","reminderCopy"];
  vm.runInContext("const EPISODE_SCHEDULE_REFRESH_MS=21600000;\n"+names.map(name=>(asyncNames.includes(name)?"async ":"")+extractFunction(backend,name)).join("\n"),context);
  return{context,deliveries,setTime:value=>clock=Date.parse(value),setStatus:value=>library.items[0].status=value,getLibrary:()=>library,getCalls:()=>calls,
    run:()=>context.processPlannedReminders([{account_id:"a",time_zone:"Europe/London"}],{})};
}

test("Cron keeps release-time alerts after rollover and advances without opening the app",async()=>{
  const episodes=[6,7,8].map((number,index)=>({season:1,number,airstamp:new Date(Date.parse("2026-09-06T12:00:00Z")+index*7*86400000).toISOString()}));
  const worker=workerHarness(episodes);
  for(const [index,status] of ["Planned","Watching","Watched"].entries()){
    worker.setStatus(status);worker.setTime(episodes[index].airstamp);
    assert.ok((await worker.run()).sent>0);
    assert.ok(worker.deliveries.some(payload=>payload.body.includes(`episode ${index+6} is out now`)));
    assert.equal((await worker.run()).sent,0);
  }
  assert.deepEqual(worker.getLibrary().items[0].watchedEpisodes,{1:[1,2,3,4,5]});
});

test("Every episode in a same-time release receives its own reminder",async()=>{
  const worker=workerHarness([{season:1,number:6,airstamp:"2026-09-06T12:00:00Z"},{season:1,number:7,airstamp:"2026-09-06T12:00:00Z"}]);
  await worker.run();
  const release=worker.deliveries.filter(payload=>payload.body.includes("is out now"));
  assert.equal(release.length,2);
  assert.equal(new Set(release.map(row=>row.data.eventKey)).size,2);
});

test("Provider failure preserves saved progress and a concurrent deletion suppresses stale alerts",async()=>{
  const offline=workerHarness([],{fail:true});await offline.run();
  assert.deepEqual(offline.getLibrary().items[0].watchedEpisodes,{1:[1,2,3,4,5]});
  assert.equal(offline.getLibrary().revision,0);
  const conflict=workerHarness([{season:1,number:6,airstamp:"2026-09-06T12:00:00Z"}],{conflict:true});
  assert.equal((await conflict.run()).sent,0);
  assert.deepEqual(conflict.getLibrary().items,[]);
});

test("UTC instants schedule identically across subscription time zones",()=>{
  const app=frontend(),worker=workerHarness([]).context;
  const raw=app.episodeReleaseTimestamp({airstamp:"2026-09-06T13:00:00+01:00"});
  for(const zone of ["Europe/London","America/New_York","Asia/Tokyo"]){
    assert.equal(worker.scheduledEventTime(raw,zone),Date.parse("2026-09-06T12:00:00Z"));
  }
});
