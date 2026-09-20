import { readAppSource } from "./app-source.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = readAppSource();
const suite=fs.readFileSync(new URL('./app-behavior.test.mjs',import.meta.url),'utf8');
const helper=suite.slice(suite.indexOf('function extractFunction'),suite.indexOf('test("Current'));
const {extractFunction}=new Function('html','assert','vm',helper+'\nreturn {extractFunction};')(html,assert,vm);
function harness(){
  const item={id:'reboot',title:'Prison Break',type:'Series',tvmazeShowId:'83211',watchedEpisodes:{},releasedEpisodes:{}};
  let resolve,reject;const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});const displays=[];
  const ctx=vm.createContext({console:{warn(){}},mediaItems:[item],activeEpisodeTrackerId:'reboot',metadataRefreshInFlight:new Map(),metadataRefreshAttemptAt:new Map(),
    cloneLibrarySnapshot:structuredClone,mediaVerificationIdentity:row=>row.tvmazeShowId,verifiedSeasonData:()=>pending,
    episodeReleaseTimestamp:()=>'',positiveEpisodeMap:row=>row||{},normalizeReleasedEpisodeMap:row=>row||{},normalizeWatchedEpisodeMap:row=>row||{},
    migratePlannedStatuses:rows=>({rows}),nowISO:()=>new Date().toISOString(),
    commitRefreshedLibrary:()=>ctx.updateEpisodeTracker(),updateEpisodeTracker:()=>displays.push(ctx.episodeTrackerEmptyState(ctx.mediaItems[0]).summary)});
  vm.runInContext(['episodeTrackerEmptyState','scheduleMetadataRefresh'].map(name=>extractFunction(html,name)).join('\n'),ctx);
  return {ctx,item,resolve,reject,displays};
}
test('An empty verified schedule leaves loading state after a successful refresh',async()=>{
  const app=harness(),task=app.ctx.scheduleMetadataRefresh(app.item);app.ctx.updateEpisodeTracker();
  assert.equal(app.displays.at(-1),'Checking episode schedule…');
  app.resolve({episodeScheduleAvailable:true,releasedEpisodes:{},completedSeasons:0});await task;
  assert.equal(app.displays.at(-1),'No released episodes yet');assert.equal(app.ctx.metadataRefreshInFlight.size,0);
});
test('A failed refresh replaces loading with an unavailable message',async()=>{
  const app=harness(),task=app.ctx.scheduleMetadataRefresh(app.item);app.ctx.updateEpisodeTracker();
  app.reject(Error('Provider unavailable'));assert.equal(await task,false);
  assert.equal(app.displays.at(-1),'Episode schedule unavailable');assert.equal(app.ctx.metadataRefreshInFlight.size,0);
});
test('Finishing a refresh does not update a tracker that has been closed or switched',async()=>{
  const app=harness(),task=app.ctx.scheduleMetadataRefresh(app.item,{deferCommit:true});app.ctx.activeEpisodeTrackerId='another-show';
  app.resolve({episodeScheduleAvailable:true,releasedEpisodes:{}});await task;
  assert.equal(app.displays.length,0);assert.equal(app.ctx.metadataRefreshInFlight.size,0);
});
