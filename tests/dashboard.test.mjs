import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {readAppSource} from './app-source.mjs';
const html=readAppSource();
const suite=fs.readFileSync(new URL('./app-behavior.test.mjs',import.meta.url),'utf8');
const helper=suite.slice(suite.indexOf('function extractFunction'),suite.indexOf('test("Current'));
const {extractFunction}=new Function('html','assert','vm',helper+'\nreturn {extractFunction};')(html,assert,vm);
function app(){
 const c=vm.createContext({Date,console});
 vm.runInContext(['isEpisodeTrackable','normalizeReleasedEpisodeMap','positiveEpisodeMap','releasedEpisodeMap','normalizeWatchedEpisodeMap','legacyWatchedEpisodeMap','watchedEpisodeMap','nextWatchEpisode','calendarEvents','localISODate'].map(n=>extractFunction(html,n)).join('\n'),c);return c;
}
test('Next to watch selects released gaps before later seasons and ignores announced totals',()=>{
 const c=app(),item={type:'Series',episodeScheduleVerified:true,releasedEpisodes:{1:[1,2,4],2:[1]},watchedEpisodes:{1:[1,4]},episodeCounts:{1:20}};
 assert.equal(JSON.stringify(c.nextWatchEpisode(item)),JSON.stringify({season:1,episode:2}));
 item.watchedEpisodes={1:[1,2,4],2:[1]};assert.equal(c.nextWatchEpisode(item),null);
 assert.equal(c.nextWatchEpisode({type:'Film'}),null);
});
test('Calendar includes every batch episode, deduplicates next episode, preserves date-only and excludes eighth day',()=>{
 const c=app(),now=new Date(2026,8,20,18),items=[{id:'s',title:'Show',type:'Series',airingSeason:1,nextEpisodeNum:2,nextEpisodeDate:'2026-09-21T20:00:00',scheduledEpisodeReleases:[{season:1,number:2,raw:'2026-09-21T20:00:00'},{season:1,number:3,raw:'2026-09-21T20:00:00'}]},{id:'f',title:'Film',type:'Film',filmReleaseDate:'2026-09-20'},{id:'out',title:'Outside',type:'Film',filmReleaseDate:'2026-09-27'},{id:'tba',title:'Unknown',type:'Film',status:'Planned'}];
 const result=c.calendarEvents(items,now);assert.equal(result.events.length,3);assert.equal(result.events[0].dateOnly,true);assert.equal(result.unknown.length,1);
});
test('Library save indicator uses the persistence status and hides for signed-out users',()=>{
 const element={classList:{toggle(name,value){this.hidden=value}},dataset:{}},c=vm.createContext({document:{getElementById:()=>element},syncStatus:{},syncDot:{},currentUser:{id:'me'}});
 vm.runInContext(extractFunction(html,'setSync'),c);c.setSync('Saved on this device · Syncing to cloud…','warn');assert.equal(element.dataset.state,'warn');assert.match(element.textContent,/Syncing/);
 c.setSync('Synced','ok');assert.equal(element.dataset.state,'ok');c.currentUser=null;c.setSync('');assert.equal(element.classList.hidden,true);
});
const backend=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/watchlog-reminders/index.ts',import.meta.url),'utf8').replace(/^import[\s\S]*?;\n/gm,''));
async function requestHistory({session=true,owner=false}={}){
 const reads=[],filters=[];let handler;
 const db={from(table){reads.push(table);const q={select(){return q},eq(k,v){filters.push([table,k,v]);return q},order(){return q},limit(){return q},single(){return Promise.resolve({data:{email:'owner@example.test'}})},maybeSingle(){return Promise.resolve({data:{items:[]}})},then(resolve){resolve({data:[]})}};return q}};
 const c=vm.createContext({TextEncoder,Response,Request,console,Date,createClient:()=>db,Deno:{env:{get:()=>''},serve:fn=>handler=fn}});vm.runInContext(backend,c);
 vm.runInContext(`getSession=async()=>${session?"({accountId:'session-owner'})":"null"};sha256=async()=>${owner?'PRIVATE_TEST_ACCOUNT_HASH':"'other-account'"};`,c);
 const response=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify({action:'private_history',accountId:'victim'})}));return {response,reads,filters};
}
test('Private reminder history rejects signed-out and other accounts before reading activity',async()=>{
 const anon=await requestHistory({session:false});assert.equal(anon.response.status,401);assert.equal(anon.reads.length,0);
 const other=await requestHistory();assert.equal(other.response.status,403);assert.deepEqual(other.reads,['watchlog_pin_accounts']);
});
test('Private reminder history scopes every data query to the verified session, ignoring supplied account ID',async()=>{
 const result=await requestHistory({owner:true});assert.equal(result.response.status,200);
 for(const table of ['watchlog_push_deliveries','watchlog_push_tests','watchlog_pin_library','watchlog_push_subscriptions'])assert.ok(result.filters.some(([t,k,v])=>t===table&&k==='account_id'&&v==='session-owner'));
 assert.equal((await result.response.json()).enabledDevices,0);
});
