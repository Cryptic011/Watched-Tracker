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
