import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const suite=fs.readFileSync(new URL("./app-behavior.test.mjs",import.meta.url),"utf8");
const helper=suite.slice(suite.indexOf("function extractFunction"),suite.indexOf('test("Current'));
const {extractFunction}=new Function("html","assert","vm",helper+"\nreturn {extractFunction};")(html,assert,vm);
const schedule={highest:4,latestAired:3,currentEpisode:3,completedSeasons:2,episodeScheduleAvailable:true,
  episodeCounts:{1:10,2:6,3:8,4:10},airedEpisodeCounts:{1:10,2:6,3:3},
  releasedEpisodes:{1:[1,2,3,4,5,6,7,8,9,10],2:[1,2,3,4,5,6],3:[1,3]}};
function harness(){
  // Select values must exist in their options, just as in the browser.
  const nodes=new Map();
  const $=id=>{
    if(!nodes.has(id)){
      const node={value:"",innerHTML:"",removeAttribute(key){delete this[key];}};
      if(["cur-season","cur-ep"].includes(id)){
        let value="0",markup='<option value="0">None</option>';
        Object.defineProperties(node,{
          innerHTML:{get:()=>markup,set:next=>{markup=next;value=(next.match(/value="([^"]*)"/)||[])[1]||"";}},
          value:{get:()=>value,set:next=>{value=markup.includes(`value="${next}"`)?String(next):"";}}
        });
      }
      nodes.set(id,node);
    }
    return nodes.get(id);
  };
  const app=vm.createContext({console,$,progressVerifyNote:{},updateSeasonVerifyNote(){},updateAiringFields(){},rememberEditorVerification(){}});
  vm.runInContext("let episodeCountsForForm={},releasedEpisodesForForm={};\n"+["normalizeReleasedEpisodeMap","refreshEpisodeOptions","configureProgressOptions","applySeasonDataResult"].map(name=>extractFunction(html,name)).join("\n"),app);
  return{app,$};
}
test("New show metadata fills the schedule but leaves all watched progress at zero",()=>{
  const {app,$}=harness();
  app.applySeasonDataResult(schedule);
  for(const id of ["cur-season","cur-ep","watched-seasons"])assert.equal($(id).value,"0");
  assert.equal($("cur-ep").disabled,true);
  assert.ok(!$("cur-season").innerHTML.includes('value="4"'));
});
test("Changing seasons offers that season's released episodes and clears the old episode",()=>{
  const {app,$}=harness();app.configureProgressOptions(schedule,{season:1,episode:10});
  assert.equal($("cur-ep").value,"10");
  $("cur-season").value="2";app.refreshEpisodeOptions(0);
  assert.equal($("cur-season").value,"2");assert.equal($("cur-ep").value,"0");
  assert.ok($("cur-ep").innerHTML.includes('value="6"'));
  assert.ok(!$("cur-ep").innerHTML.includes('value="7"'));
  $("cur-ep").value="6";app.applySeasonDataResult(schedule,{preserveProgress:true});
  assert.equal($("cur-season").value,"2");assert.equal($("cur-ep").value,"6");
});
test("Missing and future episodes cannot be selected or move the season to one",()=>{
  const {app,$}=harness();app.configureProgressOptions(schedule,{season:3,episode:3});
  assert.ok(!$("cur-ep").innerHTML.includes('value="2"'));
  assert.ok(!$("cur-ep").innerHTML.includes('value="4"'));
  app.refreshEpisodeOptions(99);
  assert.equal($("cur-season").value,"3");assert.equal($("cur-ep").value,"0");
  app.configureProgressOptions({...schedule,latestAired:0,completedSeasons:0,airedEpisodeCounts:{},releasedEpisodes:{}},{season:0,episode:0});
  assert.equal($("cur-season").value,"0");assert.equal($("cur-ep").disabled,true);
});
test("Opening an existing show populates options before restoring saved progress",()=>{
  const {app,$}=harness();app.configureProgressOptions(schedule,{season:2,episode:5});
  assert.equal($("cur-season").value,"2");assert.equal($("cur-ep").value,"5");
  app.applySeasonDataResult(schedule,{preserveProgress:true});
  assert.equal($("cur-season").value,"2");assert.equal($("cur-ep").value,"5");
});

test("Saving a new show records zero ticks, then only the selected season's episodes",async()=>{
  const {app,$}=harness();
  Object.assign(app,{currentUser:{id:"test"},mediaForm:{},saveBtn:{},mediaItems:[],uuid:()=>"new-show",
    nowISO:()=>"2026-09-08T12:00:00Z",localISODate:()=>"2026-09-08",
    freshEditorVerification:()=>schedule,pendingEditorVerification:()=>null,scheduleMetadataRefresh(){},
    findTrackedDuplicate:()=>null,normalizeTitle:value=>value.toLowerCase(),sameRecordWithoutUpdateTime:()=>false,
    render(){},closeEditor(){},showAppToast(){},persistLibrary:async()=>{},alert:message=>{throw Error(message);}});
  const names=["toMillis","toLocalInput","storedDateFromInput","episodeReleaseTimestamp","positiveEpisodeMap","isEpisodeTrackable","releasedEpisodeMap","normalizeWatchedEpisodeMap","progressWatchedEpisodeMap","highestWatchedEpisode","migratePlannedStatuses","knownSeasonTotal","isWeakFilmRecord"];
  vm.runInContext(names.map(name=>extractFunction(html,name)).join("\n")+"\n"+html.slice(html.indexOf("mediaForm.onsubmit=async e=>{"),html.indexOf("  deleteBtn.onclick=")),app);
  $("title").value="Example";$("type").value="Series";$("status").value="Planned";
  app.applySeasonDataResult(schedule);
  await app.mediaForm.onsubmit({preventDefault(){}});
  assert.equal(app.mediaItems[0].watchedSeasons,0);
  assert.deepEqual(JSON.parse(JSON.stringify(app.mediaItems[0].watchedEpisodes)),{});
  $("item-id").value="new-show";$("cur-season").value="2";app.refreshEpisodeOptions(0);$("cur-ep").value="4";
  await app.mediaForm.onsubmit({preventDefault(){}});
  assert.equal(app.mediaItems[0].curSeason,2);assert.equal(app.mediaItems[0].curEp,4);
  assert.deepEqual(JSON.parse(JSON.stringify(app.mediaItems[0].watchedEpisodes)),{2:[1,2,3,4]});
});
