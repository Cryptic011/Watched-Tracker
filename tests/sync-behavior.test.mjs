import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const copy=value=>JSON.parse(JSON.stringify(value));
function declaration(name){
  const start=html.search(new RegExp(`^  (?:async )?function ${name}\\(`,"m"));
  assert.notEqual(start,-1,`Missing ${name}`);
  const remainder=html.slice(start),end=remainder.search(/\n  (?:async )?function /);
  return end<0?remainder:remainder.slice(0,end);
}

// Models IndexedDB's serial read/write transactions, including reads whose
// success handler adds a write before the transaction is allowed to complete.
function memoryDB(initial){
  const records=new Map(Object.entries(initial).map(([key,value])=>[key,copy(value)]));
  const queue=[];
  let running=false;
  const run=()=>{
    if(running||!queue.length)return;
    running=true;
    setImmediate(()=>{
      const tx=queue.shift();
      while(tx.operations.length)tx.operations.shift()();
      tx.oncomplete?.();running=false;run();
    });
  };
  return{
    records,
    transaction(){
      const tx={operations:[],objectStore:()=>({
        get(key){const request={};tx.operations.push(()=>{request.result=records.has(key)?copy(records.get(key)):undefined;request.onsuccess?.();});return request;},
        put(value){const saved=copy(value);tx.operations.push(()=>records.set(saved.key,saved));},
      })};
      queue.push(tx);run();return tx;
    },
  };
}

const persistenceFunctions=["toMillis","canonicalRecordJSON","sameSyncValue","mergeEpisodeSetChanges","mergeEpisodeHistory","mergeRecordChanges","activePersistenceContext","setCloudBaseline","saveCache","cachePut","cacheGet","cloneLibrarySnapshot","createLibrarySnapshot","replayLocalChanges","acknowledgeCloudSnapshot","acknowledgeCachedSnapshot","uploadCloudLibrary","queueLocalLibrarySave","queueCloudLibrarySave","persistLibrary","mergePendingCache"];
function harness(extra={}){
  const pending=new Set();
  const context=vm.createContext({
    console:{warn(){},error(){}},structuredClone,setTimeout,clearTimeout,AbortController,
    currentUser:{id:"account"},cloudSessionToken:"token",persistenceGeneration:1,
    localSaveSequence:0,cloudBaseItems:[],cloudRevision:0,mediaItems:[],
    latestLocalSnapshot:null,queuedLocalSnapshot:null,queuedCloudSnapshot:null,
    localSaveInFlight:null,cloudSaveInFlight:null,lastCloudAccountId:"",lastLocalAccountId:"",
    lastCloudLibraryJSON:"",lastLocalLibraryJSON:"",CLOUD_SAVE_COALESCE_MS:0,
    nowISO:()=>"2026-09-05T10:00:00.000Z",render(){},setSync(){},
    markPending(value,id="account"){if(value)pending.add(id);else pending.delete(id);},
    hasPending:(id="account")=>pending.has(id),
    migratePlannedStatuses:items=>({rows:items}),cleanLibraryRecords:items=>({items}),
    duplicateCleanupMessage:()=>"",showAppToast(){},
    ...extra,
  });
  vm.runInContext(persistenceFunctions.map(declaration).join("\n"),context);
  return context;
}

test("An old acknowledgement preserves newer edits and rebases the next request",async()=>{
  const base=[{id:"a",title:"A"},{id:"b",title:"B"}];
  const first=[{id:"a",title:"A edited"},{id:"b",title:"B"}];
  const newest=[...first,{id:"c",title:"C added locally"}];
  const db=memoryDB({library:{key:"library",userId:"account",items:newest,dirty:true,localSequence:2,cloudItems:base,cloudRevision:0}});
  const app=harness({cacheDB:db,cloudBaseItems:base,mediaItems:newest});
  const sent=app.createLibrarySnapshot(first);
  const waiting=app.createLibrarySnapshot(newest);
  app.latestLocalSnapshot=waiting;app.queuedCloudSnapshot=waiting;
  // The other device deleted B and added D before the first write was merged.
  const accepted=[first[0],{id:"d",title:"D added remotely"}];
  await app.acknowledgeCloudSnapshot(sent,{...sent,items:accepted,json:JSON.stringify(accepted)},{revision:2});
  assert.deepEqual(copy(app.mediaItems).map(row=>row.id).sort(),["a","c","d"]);
  assert.deepEqual(copy(waiting.baseItems),accepted);
  assert.equal(waiting.expectedRevision,2);
  assert.equal(db.records.get("library").dirty,true);
  assert.deepEqual(db.records.get("library").items,copy(app.mediaItems));

  // A further remote edit must survive the queued request's conflict retry.
  const remote=[{id:"a",title:"A changed on other device"},accepted[1]];
  let calls=0;
  app.pinApi=async(action,payload,token,body)=>{
    calls++;
    if(calls===1)throw Object.assign(new Error("Conflict"),{code:"revision_conflict",items:remote,revision:3});
    const outgoing=JSON.parse(body);
    assert.equal(outgoing.expectedRevision,3);
    assert.equal(outgoing.items.find(row=>row.id==="a").title,"A changed on other device");
    assert.equal(outgoing.items.some(row=>row.id==="b"),false);
    return{ok:true,revision:4};
  };
  await app.uploadCloudLibrary(waiting);
  assert.equal(calls,2);
  assert.equal(db.records.get("library").dirty,false);
  assert.equal(app.mediaItems.find(row=>row.id==="a").title,"A changed on other device");
});

test("A cache acknowledgement cannot overwrite a later device write",async()=>{
  const items=[{id:"a",title:"A"}];
  const db=memoryDB({library:{key:"library",userId:"account",items,localSequence:1,dirty:true,cloudRevision:0}});
  const app=harness({cacheDB:db,mediaItems:items});
  const snapshot=app.createLibrarySnapshot(items);
  const acknowledgement=app.acknowledgeCachedSnapshot(snapshot,snapshot,1);
  const newer=[{id:"a",title:"New edit"}];
  const write=app.saveCache(newer,"",{dirty:true,sequence:2,baseItems:items,baseRevision:1});
  await Promise.all([acknowledgement,write]);
  assert.equal(db.records.get("library").items[0].title,"New edit");
  assert.equal(db.records.get("library").dirty,true);
  assert.equal(db.records.get("library").localSequence,2);
});

test("An unchanged cloud save clears the durable pending marker without a request",async()=>{
  const items=[{id:"a",title:"A"}];
  const db=memoryDB({library:{key:"library",userId:"account",items,localSequence:1,dirty:true,cloudRevision:4}});
  const app=harness({cacheDB:db,mediaItems:items,pinApi:()=>{throw new Error("Unexpected request");}});
  app.setCloudBaseline(items,4);
  const snapshot=app.createLibrarySnapshot(items);
  await app.queueCloudLibrarySave(snapshot);
  assert.equal(db.records.get("library").dirty,false);
  assert.equal(db.records.get("library").cloudRevision,4);
  assert.equal(app.hasPending(),false);
});

test("Signing in again replays pending edits and deletions from that account's cache",()=>{
  const app=harness();
  const cached={userId:"account",dirty:true,cloudItems:[{id:"a",title:"A"},{id:"b",title:"B"}],items:[{id:"a",title:"A saved offline"}]};
  const remote=[{id:"a",title:"A"},{id:"b",title:"B"},{id:"c",title:"New remote title"}];
  assert.deepEqual(copy(app.mergePendingCache(cached,remote)),[{id:"a",title:"A saved offline"},{id:"c",title:"New remote title"}]);
  assert.deepEqual(copy(app.mergePendingCache({...cached,userId:"other"},remote)),remote);
});

test("Conflict replay merges individual fields and concurrent watched episode changes",()=>{
  const app=harness();
  const base=[{id:"show",title:"Show",platform:"Old",nextEpisodeDate:"2026-09-01T19:00:00.000Z",watchedEpisodes:{1:[1]},episodeHistory:[],updatedAt:"2026-09-01T10:00:00.000Z"}];
  const local=[{...base[0],platform:"New",watchedEpisodes:{1:[1,2]},episodeHistory:[{id:"local",kind:"mark",season:1,episode:2,watchedAt:"2026-09-01T11:00:00.000Z"}],updatedAt:"2026-09-01T11:00:00.000Z"}];
  const remote=[{...base[0],nextEpisodeDate:"2026-09-08T19:00:00.000Z",watchedEpisodes:{1:[1,3]},episodeHistory:[{id:"remote",kind:"mark",season:1,episode:3,watchedAt:"2026-09-01T12:00:00.000Z"}],updatedAt:"2026-09-01T12:00:00.000Z"}];
  const [merged]=app.replayLocalChanges(base,local,remote);
  assert.equal(merged.platform,"New");
  assert.equal(merged.nextEpisodeDate,"2026-09-08T19:00:00.000Z");
  assert.deepEqual(copy(merged.watchedEpisodes),{1:[1,2,3]});
  assert.deepEqual(copy(merged.episodeHistory.map(event=>event.id)),["local","remote"]);
});

test("A timed-out or incomplete successful response cannot acknowledge a save",async()=>{
  for(const response of [
    {ok:true,status:200,json:async()=>{throw Object.assign(new Error("Aborted"),{name:"AbortError"});}},
    {ok:true,status:200,json:async()=>({})},
    {ok:true,status:200,json:async()=>({ok:true})},
  ]){
    const app=harness({PIN_API:"https://example.test",CLOUD_REQUEST_TIMEOUT_MS:1000,fetch:async()=>response});
    vm.runInContext(declaration("pinApi"),app);
    await assert.rejects(app.pinApi("save"),error=>["timeout","invalid_response"].includes(error.code));
  }
});
