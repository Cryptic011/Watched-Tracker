import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const core=fs.readFileSync(new URL('../assets/js/app-core.js',import.meta.url),'utf8');
const editor=fs.readFileSync(new URL('../assets/js/editor.js',import.meta.url),'utf8');
function harness(){
  const timers=[];let reloads=0,hidden=false;
  const c=vm.createContext({
    localSaveInFlight:null,cloudSaveInFlight:null,queuedLocalSnapshot:null,queuedCloudSnapshot:null,
    latestLocalSnapshot:null,lastLocalLibraryJSON:'',lastCloudLibraryJSON:'',activePersistenceContext:()=>true,
    pendingAppUpdate:true,document:{getElementById:id=>id==='modal'?{classList:{contains:()=>hidden}}:{disabled:false}},
    window:{location:{reload:()=>reloads++}},setTimeout:fn=>timers.push(fn),clearTimeout(){},
    resetUKAvailability(){},hideDuplicateWarning(){},cancelSuggestionProgress(){},searchTimer:null,
    activeCatalogueController:null,searchRequestId:0,editorApplyRevision:0,editorVerificationInFlight:null,
    titleSuggestionsWanted:false,activeTitleSearchKey:'',suggestList:{classList:{add(){}}},
    modal:{classList:{add:()=>hidden=true}},
  });
  vm.runInContext(core.slice(core.indexOf('  function appHasUnsavedWork('),core.indexOf('  async function checkForAppUpdate(')),c);
  vm.runInContext(editor.slice(editor.indexOf('  function closeEditor('),editor.indexOf('  addBtn.onclick=')),c);
  return {c,reloads:()=>reloads,flush:()=>{while(timers.length)timers.shift()();}};
}
test('Closing an editor retries a deferred refresh without waiting for focus',()=>{
  const {c,flush,reloads}=harness();
  assert.equal(c.applyPendingAppUpdate(),false);
  c.closeEditor();assert.equal(reloads(),0);
  flush();assert.equal(reloads(),1);assert.equal(c.pendingAppUpdate,false);
});
test('Closing an editor waits for a save started later in the same handler',()=>{
  const {c,flush,reloads}=harness();
  c.closeEditor();c.localSaveInFlight=Promise.resolve();flush();
  assert.equal(reloads(),0);assert.equal(c.pendingAppUpdate,true);
});
test('A failed device save keeps unsaved data protected even after its queue clears',()=>{
  const {c,flush,reloads}=harness();
  c.latestLocalSnapshot={json:'new unsaved data'};
  c.closeEditor();flush();assert.equal(reloads(),0);
  c.lastLocalLibraryJSON=c.latestLocalSnapshot.json;
  assert.equal(c.applyPendingAppUpdate(),true);assert.equal(reloads(),1);
});

test('An episode sheet defers refresh until it closes, with saves still protected',()=>{
  const {c,flush,reloads}=harness();let trackerHidden=false;
  c.document.getElementById=id=>({classList:{contains:()=>id==='episode-tracker-modal'?trackerHidden:true},disabled:false});
  c.episodeTrackerModal={classList:{add:()=>trackerHidden=true}};
  c.activeEpisodeTrackerId='show';c.activeEpisodeTrackerSeason=1;
  const library=fs.readFileSync(new URL('../assets/js/library.js',import.meta.url),'utf8');
  vm.runInContext(library.slice(library.indexOf('  function closeEpisodeTrackerSheet('),library.indexOf('  function openEpisodeTracker(')),c);
  assert.equal(c.applyPendingAppUpdate(),false);
  c.closeEpisodeTrackerSheet();assert.equal(reloads(),0);flush();assert.equal(reloads(),1);
});

test('Hidden apps hold a pending refresh until foregrounded',()=>{
  const {c,flush,reloads}=harness();c.document.visibilityState='hidden';c.closeEditor();flush();
  assert.equal(reloads(),0);c.document.visibilityState='visible';c.applyPendingAppUpdate();assert.equal(reloads(),1);
});

test('A public signal cannot reload the app unless same-origin metadata changes',async()=>{
  const {c,flush,reloads}=harness();c.pendingAppUpdate=false;c.closeEditor();flush();
  Object.assign(c,{navigator:{onLine:true},AbortSignal,currentDeploymentSha:'a'.repeat(40),appUpdateCheckInFlight:null,console});
  vm.runInContext(core.slice(core.indexOf('  async function checkForAppUpdate('),core.indexOf('  document.addEventListener("visibilitychange"')),c);
  c.fetch=async(url,options)=>{assert.ok(url.startsWith('./build-info.js?'));assert.equal(options.cache,'no-store');return {ok:true,text:async()=>`window.WATCHLOG_BUILD={"sha":"${'a'.repeat(40)}"};`};};
  await c.checkForAppUpdate();assert.equal(reloads(),0);
  c.fetch=async()=>({ok:true,text:async()=>`window.WATCHLOG_BUILD={"sha":"${'b'.repeat(40)}"};`});
  await c.checkForAppUpdate();assert.equal(reloads(),1);
});
