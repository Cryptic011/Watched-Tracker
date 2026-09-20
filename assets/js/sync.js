  function setSync(text,state="ok"){
    syncStatus.textContent=text;syncDot.className=`sync-dot ${state==="ok"?"ok":state==="warn"?"warn":""}`;
    const visible=document.getElementById("library-save-status");
    if(visible){visible.textContent=text;visible.dataset.state=state;visible.classList.toggle("hidden",!currentUser);}
  }

  async function readLegacyLocalSnapshotById(id){
    if(!id)return null;
    const h=await sha256(`watchlog-local:${id}`),dbName=cacheName(h);
    return new Promise(resolve=>{
      let req,created=false;
      try{req=indexedDB.open(dbName);}catch(_){resolve(null);return;}
      req.onupgradeneeded=()=>{created=true;try{req.transaction.abort();}catch(_){}};
      req.onerror=()=>resolve(null);
      req.onsuccess=()=>{
        const db=req.result;
        if(created||!db.objectStoreNames.contains("data")){try{db.close();}catch(_){}resolve(null);return;}
        const tx=db.transaction("data","readonly"),store=tx.objectStore("data"),pr=store.get("profile"),lr=store.get("library");
        tx.oncomplete=()=>{const profile=pr.result?.profile||null,items=Array.isArray(lr.result?.items)?lr.result.items:[];db.close();resolve({profile,items});};
        tx.onerror=()=>{db.close();resolve(null);};
      };
    });
  }

  async function readOldSupabaseCache(userId){
    if(!userId)return[];
    const h=await sha256(`watchlog:${userId}`),dbName=`WatchLogCache_${h.slice(0,48)}`;
    return new Promise(resolve=>{
      let req,created=false;try{req=indexedDB.open(dbName);}catch(_){resolve([]);return;}
      req.onupgradeneeded=()=>{created=true;try{req.transaction.abort();}catch(_){}};
      req.onerror=()=>resolve([]);
      req.onsuccess=()=>{const db=req.result;if(created||!db.objectStoreNames.contains("data")){db.close();resolve([]);return;}const tx=db.transaction("data","readonly"),r=tx.objectStore("data").get("library");r.onsuccess=()=>{const rec=r.result;db.close();resolve(rec?.userId===userId&&Array.isArray(rec.items)?rec.items:[]);};r.onerror=()=>{db.close();resolve([]);};};
    });
  }

  function mergeLibraries(...lists){
    const map=new Map();
    for(const list of lists){for(const raw of (Array.isArray(list)?list:[])){if(!raw?.title)continue;const id=String(raw.id||uuid()),prev=map.get(id);if(!prev||toMillis(raw.updatedAt||raw.date)>=toMillis(prev.updatedAt||prev.date))map.set(id,{...raw,id,updatedAt:raw.updatedAt||nowISO()});}}
    return Array.from(map.values()).sort((a,b)=>toMillis(b.updatedAt)-toMillis(a.updatedAt));
  }

  async function collectPreviousLocalItems(email){
    const normalized=normalizeEmail(email),collections=[];
    const direct=safeReadJSON(`watchlog_records_${normalized}`,[]);if(Array.isArray(direct))collections.push(direct);

    const legacyAccounts=safeReadJSON(LEGACY_LOCAL_ACCOUNTS_KEY,[]);
    if(Array.isArray(legacyAccounts)){
      const lookup=await sha256(`watchlog-email:${normalized}`);
      for(const acct of legacyAccounts){if(acct?.id&&acct.emailHash===lookup){const snap=await readLegacyLocalSnapshotById(acct.id);if(snap&&normalizeEmail(snap.profile?.email)===normalized&&Array.isArray(snap.items))collections.push(snap.items);}}
    }

    const oldUsers=safeReadJSON("watchlog_auth_users",[]);
    if(Array.isArray(oldUsers))for(const u of oldUsers){if(normalizeEmail(u?.email)===normalized&&u?.id){const rows=safeReadJSON(`watchlog_records_user_${u.id}`,[]);if(Array.isArray(rows))collections.push(rows);}}

    try{
      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);if(!key||!key.startsWith("sb-")||!key.includes("auth-token"))continue;
        const value=safeReadJSON(key,null),candidates=[value,value?.currentSession,value?.session,Array.isArray(value)?value[0]:null];
        for(const candidate of candidates){const user=candidate?.user;if(user?.id&&normalizeEmail(user?.email)===normalized)collections.push(await readOldSupabaseCache(String(user.id)));}
      }
    }catch(e){console.warn("Old cloud cache scan skipped",e);}

    return mergeLibraries(...collections);
  }

  async function prefillLegacyAccount(){
    const saved=safeReadJSON(LEGACY_LOCAL_SESSION_KEY,null),id=saved?.userId;if(!id)return;
    const snap=await readLegacyLocalSnapshotById(id);if(!snap?.profile)return;
    if(!authEmail.value&&snap.profile.email)authEmail.value=snap.profile.email;
    if(!authName.value&&snap.profile.display_name)authName.value=snap.profile.display_name;
    if(Array.isArray(snap.items)&&snap.items.length)showMessage(`Found ${snap.items.length} title(s) from the previous on-device Watched Logger account. Creating a PIN account with this email will carry them into cloud sync.`,"info");
  }

  function cloneLibrarySnapshot(items){
    try{if(typeof structuredClone==="function")return structuredClone(Array.isArray(items)?items:[]);}catch(_){}
    return JSON.parse(JSON.stringify(Array.isArray(items)?items:[]));
  }

  function createLibrarySnapshot(items,overrides={}){
    const cloned=cloneLibrarySnapshot(items);
    return{
      items:cloned,
      json:JSON.stringify(cloned),
      accountId:String(overrides.accountId??currentUser?.id??""),
      token:String(overrides.token??cloudSessionToken??""),
      generation:Number(overrides.generation??persistenceGeneration),
      db:overrides.db??cacheDB,
      sequence:Number(overrides.sequence??++localSaveSequence),
      baseItems:Array.isArray(overrides.baseItems)?overrides.baseItems:cloudBaseItems,
      expectedRevision:Math.max(0,Number(overrides.expectedRevision??cloudRevision)||0)
    };
  }

  function sameSyncValue(a,b){return canonicalRecordJSON(a)===canonicalRecordJSON(b);}
  function mergeEpisodeSetChanges(baseValue,localValue,remoteValue){
    const toSets=value=>{
      const result={};
      for(const [season,episodes] of Object.entries(value||{}))result[season]=new Set((Array.isArray(episodes)?episodes:[]).map(Number).filter(Number.isInteger));
      return result;
    };
    const base=toSets(baseValue),local=toSets(localValue),remote=toSets(remoteValue),result={...remote};
    for(const season of new Set([...Object.keys(base),...Object.keys(local)])){
      const before=base[season]||new Set(),after=local[season]||new Set(),merged=new Set(result[season]||[]);
      for(const episode of before)if(!after.has(episode))merged.delete(episode);
      for(const episode of after)if(!before.has(episode))merged.add(episode);
      if(merged.size)result[season]=merged;else delete result[season];
    }
    return Object.fromEntries(Object.entries(result).map(([season,episodes])=>[season,[...episodes].sort((a,b)=>a-b)]));
  }
  function mergeEpisodeHistory(baseValue,localValue,remoteValue){
    const baseKeys=new Set((Array.isArray(baseValue)?baseValue:[]).map(event=>String(event?.id||canonicalRecordJSON(event))));
    const local=Array.isArray(localValue)?localValue:[],remote=Array.isArray(remoteValue)?remoteValue:[],byKey=new Map(remote.map(event=>[String(event?.id||canonicalRecordJSON(event)),event]));
    for(const event of local){const key=String(event?.id||canonicalRecordJSON(event));if(!baseKeys.has(key))byKey.set(key,event);}
    return [...byKey.values()].sort((a,b)=>toMillis(a?.watchedAt)-toMillis(b?.watchedAt)).slice(-500);
  }
  function mergeRecordChanges(baseItem,localItem,remoteItem){
    if(!remoteItem)return localItem;
    const merged={...remoteItem};
    for(const key of new Set([...Object.keys(baseItem||{}),...Object.keys(localItem||{})])){
      if(key==="id")continue;
      const before=baseItem?.[key],local=localItem?.[key],remote=remoteItem?.[key];
      if(sameSyncValue(local,before))continue;
      if(key==="watchedEpisodes"&&!sameSyncValue(remote,before))merged[key]=mergeEpisodeSetChanges(before,local,remote);
      else if(key==="episodeHistory"&&!sameSyncValue(remote,before))merged[key]=mergeEpisodeHistory(before,local,remote);
      else if(local===undefined)delete merged[key];
      else merged[key]=local;
    }
    merged.updatedAt=[localItem?.updatedAt,remoteItem?.updatedAt].filter(Boolean).sort((a,b)=>toMillis(b)-toMillis(a))[0]||merged.updatedAt;
    if(merged.watchedEpisodes&&(!sameSyncValue(baseItem?.watchedEpisodes,localItem?.watchedEpisodes)||!sameSyncValue(baseItem?.watchedEpisodes,remoteItem?.watchedEpisodes))){
      const highest=Object.entries(merged.watchedEpisodes).flatMap(([season,episodes])=>episodes.map(episode=>[Number(season),Number(episode)])).sort((a,b)=>b[0]-a[0]||b[1]-a[1])[0];
      merged.curSeason=highest?.[0]||null;merged.curEp=highest?.[1]||null;
      merged.lastWatchedSeason=merged.curSeason;merged.lastWatchedEpisode=merged.curEp;
      merged.watchedSeasons=Object.entries(merged.watchedEpisodes).filter(([season,episodes])=>{
        const count=Number(merged.episodeCounts?.[season]||0);
        return Number(season)<=Number(merged.verifiedCompletedSeasons||0)&&count>0&&Array.from({length:count},(_,i)=>i+1).every(episode=>episodes.includes(episode));
      }).length;
    }
    return merged;
  }

  function replayLocalChanges(baseItems,localItems,remoteItems){
    const base=new Map((Array.isArray(baseItems)?baseItems:[]).filter(item=>item?.id).map(item=>[String(item.id),item]));
    const local=new Map((Array.isArray(localItems)?localItems:[]).filter(item=>item?.id).map(item=>[String(item.id),item]));
    const remote=new Map((Array.isArray(remoteItems)?remoteItems:[]).filter(item=>item?.id).map(item=>[String(item.id),item]));
    for(const [id,baseItem] of base){
      if(!local.has(id)){remote.delete(id);continue;}
      const localItem=local.get(id);
      if(remote.has(id)&&!sameSyncValue(localItem,baseItem))remote.set(id,mergeRecordChanges(baseItem,localItem,remote.get(id)));
    }
    for(const [id,localItem] of local)if(!base.has(id))remote.set(id,localItem);
    return Array.from(remote.values());
  }

  async function acknowledgeCloudSnapshot(originalSnapshot,savedSnapshot,result){
    let revision=Math.max(0,Number(result?.revision)||0);
    if(activePersistenceContext(originalSnapshot)&&cloudRevision>revision){
      revision=cloudRevision;
      savedSnapshot=createLibrarySnapshot(cloudBaseItems,{...savedSnapshot,expectedRevision:revision});
    }
    if(activePersistenceContext(originalSnapshot)){
      /* A reply may include another device's changes. Rebase only edits made
         after this request, so the next request cannot repeat an old edit or
         resurrect a title removed remotely. Do this before yielding to IDB. */
      for(const pending of new Set([latestLocalSnapshot,queuedLocalSnapshot,queuedCloudSnapshot])){
        if(!pending||!activePersistenceContext(pending)||pending.sequence<=originalSnapshot.sequence)continue;
        pending.items=replayLocalChanges(originalSnapshot.items,pending.items,savedSnapshot.items);
        pending.json=JSON.stringify(pending.items);
        pending.baseItems=savedSnapshot.items;pending.expectedRevision=revision;
      }
      mediaItems=localSaveSequence>originalSnapshot.sequence
        ? replayLocalChanges(originalSnapshot.items,mediaItems,savedSnapshot.items)
        : cloneLibrarySnapshot(savedSnapshot.items);
      setCloudBaseline(savedSnapshot.items,revision,originalSnapshot.accountId);
      render();
    }
    await acknowledgeCachedSnapshot(originalSnapshot,savedSnapshot,revision);
    /* A delayed callback can enqueue this same snapshot again. Its accepted
       baseline must now describe the accepted revision, including remote edits. */
    originalSnapshot.items=cloneLibrarySnapshot(savedSnapshot.items);
    originalSnapshot.json=JSON.stringify(originalSnapshot.items);
    originalSnapshot.baseItems=originalSnapshot.items;originalSnapshot.expectedRevision=revision;
  }

  function acknowledgeCachedSnapshot(originalSnapshot,savedSnapshot,revision){
    const db=originalSnapshot.db;if(!db)return Promise.resolve(false);
    return new Promise((resolve,reject)=>{
      /* Read and update in one transaction: a newer device save cannot land
         between the sequence check and the acknowledgement. */
      const tx=db.transaction("data","readwrite"),store=tx.objectStore("data"),request=store.get("library");
      let acknowledged=null;
      request.onsuccess=()=>{
        const record=request.result;
        if(record?.userId!==originalSnapshot.accountId||Number(record.cloudRevision||0)>revision)return;
        const sequence=Math.max(Number(record.localSequence)||0,originalSnapshot.sequence);
        const items=Number(record.localSequence||0)>originalSnapshot.sequence
          ? replayLocalChanges(originalSnapshot.items,record.items,savedSnapshot.items)
          : savedSnapshot.items;
        const json=JSON.stringify(items);
        acknowledged={...record,items,json,dirty:json!==savedSnapshot.json,cloudItems:savedSnapshot.items,cloudRevision:revision,localSequence:sequence,updatedAt:nowISO()};
        store.put(acknowledged);
      };
      tx.oncomplete=()=>{
        if(acknowledged&&activePersistenceContext(originalSnapshot)){
          lastLocalLibraryJSON=acknowledged.json;lastLocalAccountId=originalSnapshot.accountId;
        }
        resolve(Boolean(acknowledged));
      };
      tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("On-device sync acknowledgement was interrupted."));
    });
  }

  async function uploadCloudLibrary(snapshot){
    let outgoing=snapshot;
    for(let attempt=0;attempt<3;attempt++){
      const requestBody=`{"action":"save","expectedRevision":${outgoing.expectedRevision},"items":${outgoing.json}}`;
      try{
        const result=await pinApi("save",{},outgoing.token,requestBody);
        await acknowledgeCloudSnapshot(snapshot,outgoing,result);
        return result;
      }catch(error){
        if(error?.code!=="revision_conflict"||!Array.isArray(error.items)||!Number.isSafeInteger(Number(error.revision))||attempt===2)throw error;
        const merged=replayLocalChanges(outgoing.baseItems,outgoing.items,error.items);
        outgoing=createLibrarySnapshot(merged,{...outgoing,sequence:snapshot.sequence,baseItems:error.items,expectedRevision:Number(error.revision)});
      }
    }
  }

  function queueLocalLibrarySave(snapshot){
    if(!snapshot.accountId||!snapshot.db)return Promise.resolve(true);
    if(activePersistenceContext(snapshot)&&latestLocalSnapshot?.sequence>snapshot.sequence)snapshot=latestLocalSnapshot;
    if(activePersistenceContext(snapshot)&&(!latestLocalSnapshot||snapshot.sequence>=latestLocalSnapshot.sequence))latestLocalSnapshot=snapshot;
    /* IndexedDB writes are serialized and coalesced. If five episode ticks or
       edits happen quickly, only the newest waiting snapshot is written. */
    if(!queuedLocalSnapshot||queuedLocalSnapshot.accountId!==snapshot.accountId||snapshot.sequence>=queuedLocalSnapshot.sequence)queuedLocalSnapshot=snapshot;
    if(localSaveInFlight)return localSaveInFlight;
    localSaveInFlight=(async()=>{
      while(queuedLocalSnapshot){
        const snapshot=queuedLocalSnapshot;
        queuedLocalSnapshot=null;
        if(snapshot.accountId===lastLocalAccountId&&snapshot.json===lastLocalLibraryJSON)continue;
        await saveCache(snapshot.items,snapshot.json,{dirty:true,baseItems:snapshot.baseItems,baseRevision:snapshot.expectedRevision,sequence:snapshot.sequence,accountId:snapshot.accountId,db:snapshot.db});
      }
      return true;
    })().finally(()=>{
      localSaveInFlight=null;
      if(queuedLocalSnapshot)queueLocalLibrarySave(queuedLocalSnapshot).catch(error=>console.error("Queued local save failed",error));
    });
    return localSaveInFlight;
  }

  function queueCloudLibrarySave(snapshot){
    if(!snapshot.token||!snapshot.accountId)return Promise.resolve(true);
    if(activePersistenceContext(snapshot)&&latestLocalSnapshot?.sequence>snapshot.sequence)snapshot=latestLocalSnapshot;

    /* Keep only the newest snapshot when several edits are saved quickly. This
       prevents an older, slower request from overwriting a newer library. */
    if(!queuedCloudSnapshot||queuedCloudSnapshot.accountId!==snapshot.accountId||snapshot.sequence>=queuedCloudSnapshot.sequence)queuedCloudSnapshot=snapshot;
    markPending(true,snapshot.accountId);if(activePersistenceContext(snapshot))setSync("Saved on this device · Syncing to cloud…","warn");
    if(cloudSaveInFlight)return cloudSaveInFlight;

    let saveFailed=false,processedAccountId=snapshot.accountId;
    cloudSaveInFlight=(async()=>{
      while(queuedCloudSnapshot){
        /* Briefly wait for rapid episode ticks or edits so they share one
           full-library cloud request. IndexedDB still saves immediately. */
        await new Promise(resolve=>setTimeout(resolve,CLOUD_SAVE_COALESCE_MS));
        if(localSaveInFlight)await localSaveInFlight;
        const snapshot=queuedCloudSnapshot;
        queuedCloudSnapshot=null;
        if(!snapshot)continue;
        processedAccountId=snapshot.accountId;
        try{
          if(snapshot.accountId===lastCloudAccountId&&snapshot.json===lastCloudLibraryJSON)await acknowledgeCloudSnapshot(snapshot,snapshot,{revision:cloudRevision});
          else await uploadCloudLibrary(snapshot);
        }
        catch(e){
          console.warn(e);
          if(!queuedCloudSnapshot)queuedCloudSnapshot=snapshot;
          saveFailed=true;
          if(activePersistenceContext(snapshot))setSync("Saved on this device, but cloud sync is pending. Tap Sync Now when online.","warn");
          return false;
        }
      }
      markPending(false,processedAccountId);if(String(currentUser?.id||"")===processedAccountId)setSync("Synced. This library is available on your other devices.","ok");
      return true;
    })().finally(()=>{
      cloudSaveInFlight=null;
      if(queuedCloudSnapshot&&!saveFailed)void queueCloudLibrarySave(queuedCloudSnapshot);
      setTimeout(()=>applyPendingAppUpdate(),0);
    });
    return cloudSaveInFlight;
  }

  function persistLibrary(items,{background=false,precleaned=false}={}){
    const source=Array.isArray(items)?items:[];
    const migration=migratePlannedStatuses(source);
    const cleanup=precleaned
      ? {items:migration.rows,removedCount:0,repairedCount:0,titles:[]}
      : cleanLibraryRecords(migration.rows);
    if(items===mediaItems)mediaItems=cleanup.items;
    items=cleanup.items;
    const cleanupMessage=duplicateCleanupMessage(cleanup);if(cleanupMessage)showAppToast(cleanupMessage,"success",6000);
    /* Start the on-device and cloud writes together. The UI can close
       immediately, while both queues retain only the newest safe snapshot.
       Clone once: IndexedDB and fetch both treat this snapshot as read-only. */
    const snapshot=createLibrarySnapshot(items);
    if(activePersistenceContext(snapshot))setSync("Saving on this device…","warn");
    const localSave=queueLocalLibrarySave(snapshot);
    const cloudSave=localSave.then(()=>queueCloudLibrarySave(snapshot));
    const completion=Promise.all([localSave,cloudSave]);
    if(background){
      completion.catch(error=>{
        console.error("Background library save failed",error);
        markPending(true,snapshot.accountId);
        setSync("Your change is still open, but saving needs attention. Tap Sync Now.","warn");
      });
      /* Report success once the on-device copy is durable. Cloud sync keeps
         running independently and retains its pending retry marker. */
      return localSave;
    }
    return completion.then(([local,cloud])=>local!==false&&cloud!==false);
  }

  async function retryPendingCloudSave(){
    if(!currentUser||!cloudSessionToken||!hasPending()||cloudSaveInFlight)return;
    try{
      if(localSaveInFlight)await localSaveInFlight;
      const cached=await loadCacheRecord();
      if(cached?.items)await queueCloudLibrarySave(createLibrarySnapshot(cached.items,{baseItems:Array.isArray(cached.cloudItems)?cached.cloudItems:cloudBaseItems,expectedRevision:Number(cached.cloudRevision??cloudRevision),sequence:Number(cached.localSequence||++localSaveSequence)}));
    }catch(error){console.warn("Automatic cloud retry postponed",error);}
  }
  window.addEventListener("online",()=>{void retryPendingCloudSave();void refreshLibraryEpisodeMetadata({force:true});});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){void refreshPublicMaintenance();void retryPendingCloudSave();void refreshLibraryEpisodeMetadata();}});

  function commitRefreshedLibrary(){
    const cleanup=cleanLibraryRecords(mediaItems);mediaItems=cleanup.items;
    render();
    const cleanupMessage=duplicateCleanupMessage(cleanup);if(cleanupMessage)showAppToast(cleanupMessage,"success",6000);
    void persistLibrary(mediaItems,{background:true,precleaned:true});
  }

  function mediaVerificationIdentity(item){
    return [
      String(item?.type||"Series"),normalizeTitle(item?.title||""),String(item?.tvmazeShowId||""),
      String(item?.imdbId||""),String(item?.releaseYear||""),normalizeTitle(item?.platform||"")
    ].join("|");
  }

  function scheduleMetadataRefresh(savedItem,{deferCommit=false,verificationPromise=null}={}){
    const id=String(savedItem?.id||"");
    if(!id||metadataRefreshInFlight.has(id))return metadataRefreshInFlight.get(id)||Promise.resolve(false);
    metadataRefreshAttemptAt.set(id,Date.now());
    const seed=cloneLibrarySnapshot([savedItem])[0];
    const seedIdentity=mediaVerificationIdentity(seed);
    const task=(async()=>{
      let result=null;
      if(seed.type==="Film"){
        if(seed.filmReleaseSource==="Manual")return false;
        if(verificationPromise){try{result=await verificationPromise;}catch(_){}}
        if(!result)result=await verifiedFilmReleaseData(seed.title,{imdbId:seed.imdbId||"",seedDate:seed.filmReleaseDate||"",seedSource:seed.filmReleaseSource||""});
      }else{
        if(verificationPromise){
          try{result=await verificationPromise;}catch(_){}
        }
        if(!result)result=await verifiedSeasonData(seed.tvmazeShowId||"",seed.title,{imdbId:seed.imdbId||"",year:seed.releaseYear||"",platform:seed.platform||""});
      }

      const index=mediaItems.findIndex(item=>String(item.id)===id),current=mediaItems[index];
      if(index<0||!current||mediaVerificationIdentity(current)!==seedIdentity)return false;
      let refreshed;
      if(seed.type==="Film"){
        refreshed={
          ...current,
          imdbId:result?.imdbId||current.imdbId||"",
          releaseYear:result?.year||current.releaseYear||"",
          filmReleaseDate:result?.date||current.filmReleaseDate||"",
          filmReleaseSource:result?.date?(result.source||"Verified sources"):(current.filmReleaseSource||""),
          metadataUpdatedAt:nowISO()
        };
      }else{
        const scheduleVerified=result?.episodeScheduleAvailable===true;
        const episodeCounts=positiveEpisodeMap(scheduleVerified?result.episodeCounts:(current.episodeCounts||{}));
        const airedEpisodeCounts=positiveEpisodeMap(scheduleVerified?result.airedEpisodeCounts:(current.airedEpisodeCounts||{}));
        const releasedEpisodes=scheduleVerified?normalizeReleasedEpisodeMap(result.releasedEpisodes||{}):normalizeReleasedEpisodeMap(current.releasedEpisodes||{});
        let watchedSeasons=Math.max(0,Number(current.watchedSeasons||0));
        let curSeason=Math.max(0,Number(current.curSeason||0));
        let curEp=Math.max(0,Number(current.curEp||0));
        if(scheduleVerified){
          const completedMax=Math.max(0,Number(result.completedSeasons||0)),latestMax=Math.max(0,Number(result.latestAired||0));
          watchedSeasons=Math.min(watchedSeasons,completedMax);
          if(curSeason>latestMax){curSeason=Math.min(latestMax,watchedSeasons);curEp=curSeason?Math.max(0,...(releasedEpisodes[curSeason]||[])):0;}
          else{const available=releasedEpisodes[curSeason]||[];curEp=Math.max(0,...available.filter(episode=>episode<=curEp));}
        }
        const airing=scheduleVerified?(result?.airing||null):null,next=airing?.nextEpisode||null,upcoming=result?.upcoming||null;
        refreshed={
          ...current,
          tvmazeShowId:result?.resolvedShowId||current.tvmazeShowId||"",
          imdbId:result?.imdbId||current.imdbId||"",
          totalSeasons:result?.highest!==null&&result?.highest!==undefined&&result?.highest!==""&&Number.isFinite(Number(result.highest))?Number(result.highest):current.totalSeasons,
          watchedSeasons,curSeason:curSeason||null,curEp:curEp||null,
          currentSeasonEpisodeCount:curSeason?Number(airedEpisodeCounts[curSeason]||0)||null:null,
          currentSeasonTotalEpisodes:curSeason?Number(episodeCounts[curSeason]||0)||null:null,
          episodeCounts,airedEpisodeCounts,releasedEpisodes,episodeScheduleVerified:scheduleVerified,
          scheduledEpisodeReleases:scheduleVerified?(result.scheduledEpisodeReleases||[]):(current.scheduledEpisodeReleases||[]),
          airingSeason:scheduleVerified?(airing?.season??null):current.airingSeason,
          latestEpisodeNum:scheduleVerified?(airing?.latestEpisode??null):current.latestEpisodeNum,
          latestEpisodeTitle:scheduleVerified?(airing?.latestEpisodeTitle||""):(current.latestEpisodeTitle||""),
          latestEpisodeDate:scheduleVerified?(result?.latestEpisodeDate||""):(current.latestEpisodeDate||""),
          seriesReleaseDate:result?.seriesReleaseDate||current.seriesReleaseDate||"",
          nextEpisodeNum:scheduleVerified?(next?.number??null):current.nextEpisodeNum,
          nextEpisodeTitle:scheduleVerified?(next?.name||""):(current.nextEpisodeTitle||""),
          nextEpisodeDate:scheduleVerified?episodeReleaseTimestamp(next):(current.nextEpisodeDate||""),
          nextSeasonNum:upcoming?.number??(scheduleVerified?"":current.nextSeasonNum),
          nextSeasonDate:upcoming?(result?.nextEpisode&&Number(result.nextEpisode.season)===Number(upcoming.number)?episodeReleaseTimestamp(result.nextEpisode):(upcoming.premiereDate||"")):(scheduleVerified?"":(current.nextSeasonDate||"")),
          verifiedCompletedSeasons:scheduleVerified&&Number.isFinite(Number(result?.completedSeasons))?Number(result.completedSeasons):current.verifiedCompletedSeasons,
          ...(Object.prototype.hasOwnProperty.call(current,"watchedEpisodes")?{watchedEpisodes:normalizeWatchedEpisodeMap(current.watchedEpisodes,releasedEpisodes)}:{}),
          metadataUpdatedAt:scheduleVerified?nowISO():(current.metadataUpdatedAt||"")
        };
      }
      mediaItems[index]=migratePlannedStatuses([refreshed]).rows[0];
      if(!deferCommit)commitRefreshedLibrary();
      return true;
    })().catch(error=>{console.warn("Background title refresh postponed",error);return false;}).finally(()=>{
      metadataRefreshInFlight.delete(id);
      if(activeEpisodeTrackerId===id)updateEpisodeTracker();
    });
    metadataRefreshInFlight.set(id,task);
    return task;
  }

  function seriesMetadataRefreshCandidate(item,now=Date.now(),{ignoreRetry=false}={}){
    if(!isEpisodeTrackable(item)||!item?.title||(!item.tvmazeShowId&&!item.imdbId))return null;
    const id=String(item.id||""),lastAttempt=metadataRefreshAttemptAt.get(id)||0;
    if(!ignoreRetry&&lastAttempt&&now-lastAttempt<SERIES_REFRESH_RETRY_MS)return null;
    const nextEpisodeTime=toMillis(item.nextEpisodeDate),nextSeasonTime=toMillis(item.nextSeasonDate);
    const dueTimes=[nextEpisodeTime,nextSeasonTime].filter(time=>time>0&&time<=now);
    const due=dueTimes.length>0;
    const refreshedAt=toMillis(item.metadataUpdatedAt),missingReleaseDate=!item.latestEpisodeDate&&!item.seriesReleaseDate,stale=!Object.prototype.hasOwnProperty.call(item,"releasedEpisodes")||missingReleaseDate||!refreshedAt||now-refreshedAt>=SERIES_METADATA_STALE_MS;
    if(!due&&!stale)return null;
    const statusScore=item.status==="Watching"?30:item.status==="Planned"?20:10;
    const dueTime=due?Math.min(...dueTimes):Number.POSITIVE_INFINITY;
    return{item,due,dueTime,score:(due?1000:0)+statusScore+(refreshedAt?Math.min(20,Math.floor((now-refreshedAt)/SERIES_METADATA_STALE_MS)):25)};
  }

  function episodeMetadataNeedsRefresh(item,now=Date.now()){return Boolean(seriesMetadataRefreshCandidate(item,now));}

  function refreshLibraryEpisodeMetadata({force=false}={}){
    if(!currentUser||!navigator.onLine||document.visibilityState==="hidden")return Promise.resolve(false);
    if(libraryMetadataSweepInFlight)return libraryMetadataSweepInFlight;
    const now=Date.now();
    if(!force&&now-lastLibraryMetadataSweepAt<SERIES_RELEASE_CHECK_MS)return Promise.resolve(false);
    lastLibraryMetadataSweepAt=now;
    const candidates=mediaItems.map(item=>seriesMetadataRefreshCandidate(item,now,{ignoreRetry:force})).filter(Boolean);
    const due=candidates.filter(row=>row.due).sort((a,b)=>a.dueTime-b.dueTime||b.score-a.score);
    const stale=candidates.filter(row=>!row.due).sort((a,b)=>b.score-a.score).slice(0,MAX_STALE_SERIES_PER_SWEEP);
    const queue=[...due,...stale].map(row=>row.item);
    if(!queue.length)return Promise.resolve(false);
    const task=(async()=>{
      let cursor=0,updated=0;
      const worker=async()=>{
        while(cursor<queue.length){
          const item=queue[cursor++];
          if(await scheduleMetadataRefresh(item,{deferCommit:true}))updated++;
        }
      };
      await Promise.all(Array.from({length:Math.min(MAX_METADATA_REFRESH_WORKERS,queue.length)},worker));
      if(updated>0)commitRefreshedLibrary();
      return updated>0;
    })().finally(()=>{libraryMetadataSweepInFlight=null;});
    libraryMetadataSweepInFlight=task;
    return task;
  }

  setInterval(()=>{if(document.visibilityState==="visible"){void refreshPublicMaintenance();void refreshLibraryEpisodeMetadata();}},SERIES_RELEASE_CHECK_MS);

  function storePinSession(account,token,expiresAt,revision=cloudRevision){safeWriteJSON(PIN_SESSION_KEY,{token,expiresAt,account,revision});}
  function applyAccount(account){
    if(String(currentUser?.id||"")!==String(account.id)){
      persistenceGeneration++;localSaveSequence=0;
      lastLocalLibraryJSON="";lastCloudLibraryJSON="";lastLocalAccountId="";lastCloudAccountId="";cloudBaseItems=[];cloudRevision=0;queuedLocalSnapshot=null;queuedCloudSnapshot=null;latestLocalSnapshot=null;
    }
    currentUser={id:account.id,email:normalizeEmail(account.email)};
    currentProfile={display_name:account.displayName||account.display_name||"User",email:normalizeEmail(account.email)};
    profileName.textContent=currentProfile.display_name;profileEmail.textContent=currentProfile.email;navName.textContent=currentProfile.display_name||currentProfile.email;avatar.textContent=String(currentProfile.display_name||currentProfile.email||"U").charAt(0).toUpperCase();
  }
  async function enterAccount(items,{syncText="Synced. This library is available on your other devices.",syncState="ok"}={}){
    hideMessage();authScreen.classList.add("hidden");
    const original=Array.isArray(items)?items:[],migration=migratePlannedStatuses(original),cleanup=cleanLibraryRecords(migration.rows),cleaned=cleanup.items;
    mediaItems=cleaned;render();setSync(syncText,syncState);
    const cleanupMessage=duplicateCleanupMessage(cleanup);if(cleanupMessage)showAppToast(cleanupMessage,"success",6000);
    if(migration.changed||cleanup.removedCount||cleanup.repairedCount||cleaned.length!==original.length)await persistLibrary(cleaned,{background:true,precleaned:true});
    setTimeout(()=>{void refreshLibraryEpisodeMetadata({force:true});},0);
    try{await syncExistingBackgroundPush();}catch(error){console.warn("Background reminder sync skipped",error);}
    await updateNotificationTestVisibility();
    await refreshMaintenanceAdmin();
  }

  function mergePendingCache(cached,remoteItems,accountId=String(currentUser?.id||"")){
    if(cached?.userId!==accountId||!Array.isArray(cached.items)||!(cached.dirty===true||hasPending(accountId)))return remoteItems;
    return Array.isArray(cached.cloudItems)
      ? replayLocalChanges(cached.cloudItems,cached.items,remoteItems)
      : mergeLibraries(remoteItems,cached.items);
  }

  async function establishCloudSession(result,items,cloudItems=items){
    cloudSessionToken=result.sessionToken||cloudSessionToken;
    applyAccount(result.account);
    setCloudBaseline(Array.isArray(cloudItems)?cloudItems:[],result.revision,currentUser.id);
    await openCache(currentUser.id);
    const cached=await loadCacheRecord();
    localSaveSequence=Math.max(localSaveSequence,Number(cached?.localSequence)||0);
    mediaItems=mergePendingCache(cached,Array.isArray(items)?items:[]);
    await saveProfile(currentProfile);
    const pending=JSON.stringify(mediaItems)!==lastCloudLibraryJSON;
    if(pending){
      const snapshot=createLibrarySnapshot(mediaItems);
      markPending(true,snapshot.accountId);
      await queueLocalLibrarySave(snapshot);
      void queueCloudLibrarySave(snapshot).catch(error=>console.warn("Cloud sync postponed",error));
    }else{
      await saveCache(mediaItems,"",{dirty:false,baseItems:cloudBaseItems,baseRevision:cloudRevision});
      markPending(false);
    }
    storePinSession({id:currentUser.id,email:currentProfile.email,displayName:currentProfile.display_name},cloudSessionToken,result.expiresAt||null,cloudRevision);
    await enterAccount(mediaItems,{syncText:pending?"Saved on this device. Syncing your latest changes…":"Synced. This library is available on your other devices.",syncState:pending?"warn":"ok"});
  }

  async function registerPinAccount(name,email,pin){
    const localItems=await collectPreviousLocalItems(email);
    const result=await pinApi("register",{displayName:name||"User",email,pin,items:localItems},"");
    await establishCloudSession(result,localItems);
  }

  async function loginPinAccount(email,pin){
    const result=await pinApi("login",{email,pin},"");
    const legacy=await collectPreviousLocalItems(email);
    const merged=mergeLibraries(result.items||[],legacy);
    await establishCloudSession(result,merged,result.items||[]);
  }

  async function restorePinSession(){
    const saved=safeReadJSON(PIN_SESSION_KEY,null);if(!saved?.token||!saved?.account?.id)return false;
    cloudSessionToken=saved.token;applyAccount(saved.account);await openCache(currentUser.id);currentProfile=await loadProfile()||currentProfile;
    const cached=await loadCacheRecord();
    localSaveSequence=Math.max(localSaveSequence,Number(cached?.localSequence)||0);
    if(cached?.items)setCloudBaseline(Array.isArray(cached.cloudItems)?cached.cloudItems:cached.items,Number(cached.cloudRevision??saved.revision??0),currentUser.id);
    try{
      const result=await pinApi("load"),remoteItems=Array.isArray(result.items)?result.items:[];
      applyAccount(result.account);await saveProfile(currentProfile);setCloudBaseline(remoteItems,result.revision,currentUser.id);
      /* Rebase any on-device edits against the latest cloud snapshot.  This
         keeps deletions and edits made while offline instead of letting a
         later session silently replace them with the remote library. */
      mediaItems=mergePendingCache(cached,remoteItems,currentUser.id);
      const pending=JSON.stringify(mediaItems)!==JSON.stringify(remoteItems);
      if(pending){
        const snapshot=createLibrarySnapshot(mediaItems,{baseItems:remoteItems,expectedRevision:cloudRevision});
        await queueLocalLibrarySave(snapshot);await queueCloudLibrarySave(snapshot);
      }else await saveCache(mediaItems,"",{dirty:false,baseItems:remoteItems,baseRevision:cloudRevision});
      storePinSession({id:currentUser.id,email:currentProfile.email,displayName:currentProfile.display_name},cloudSessionToken,saved.expiresAt||null,cloudRevision);await enterAccount(mediaItems);return true;
    }catch(e){
      if(e.status===401){localStorage.removeItem(PIN_SESSION_KEY);cloudSessionToken="";currentUser=null;currentProfile=null;return false;}
      if(e.code==="maintenance"||e.maintenance){publicMaintenance={enabled:true,message:e.message||publicMaintenance.message};maintenanceOwnerAccess=false;updateAuthMode();return false;}
      if(cached?.items){mediaItems=cached.items;await enterAccount(mediaItems,{syncText:"Offline: showing the last library saved on this device. Cloud sync will resume when available.",syncState:"warn"});return true;}
      throw e;
    }
  }

  async function clearUserState(){persistenceGeneration++;mediaItems=[];currentProfile=null;currentUser=null;cloudSessionToken="";queuedLocalSnapshot=null;queuedCloudSnapshot=null;latestLocalSnapshot=null;lastLocalLibraryJSON="";lastCloudLibraryJSON="";lastLocalAccountId="";lastCloudAccountId="";cloudBaseItems=[];cloudRevision=0;localSaveSequence=0;notificationTestSettings?.classList.add("hidden");document.getElementById("private-reminder-history")?.classList.add("hidden");document.getElementById("reminder-history-body")?.replaceChildren();document.getElementById("library-save-status")?.classList.add("hidden");setBackgroundReminderStatus("Sign in to manage background reminders.");if(cacheDB){try{cacheDB.close();}catch(_){}}cacheDB=null;render();}
  function showAuth(){authScreen.classList.remove("hidden");}
  function updateAuthMode(){
    hideMessage();authNameGroup.classList.toggle("hidden",!isSignUp);
    authTitle.textContent=isSignUp?"Create PIN Account":"Welcome Back";
    authSub.textContent=isSignUp?"Create one email + 4-digit PIN account. Your existing on-device titles can be carried into cloud sync.":"Use the same email and 4-digit PIN to load your library on any device.";
    authSubmit.textContent=isSignUp?"Create PIN Account":"Log In";
    authToggle.textContent=isSignUp?"Already have a PIN account? Log In":"Don't have an account? Create PIN Account";
    renderAuthMaintenance();
  }
  authToggle.onclick=()=>{isSignUp=!isSignUp;authPin.value="";updateAuthMode();if(isSignUp)prefillLegacyAccount().catch(console.warn);};

  authForm.onsubmit=async e=>{
    e.preventDefault();hideMessage();
    if(publicMaintenance.enabled&&!maintenanceOwnerAccess){renderAuthMaintenance();return;}
    const email=normalizeEmail(authEmail.value),pin=authPin.value;
    if(!isEmail(email)){showMessage("Enter a valid email address.");return;}
    if(!validPin(pin)){showMessage("PIN must be exactly 4 digits.");return;}
    authSubmit.disabled=true;authSubmit.textContent=isSignUp?"Creating…":"Logging In…";
    try{if(isSignUp)await registerPinAccount(authName.value.trim()||"User",email,pin);else await loginPinAccount(email,pin);}
    catch(err){console.error(err);if(err.code==="maintenance"||err.maintenance){maintenanceOwnerAccess=false;publicMaintenance={enabled:true,message:err.message||publicMaintenance.message};updateAuthMode();}else showMessage(err.message||"PIN account operation failed.","error");}
    finally{authSubmit.disabled=false;authSubmit.textContent=isSignUp?"Create PIN Account":"Log In";}
  };

  logoutBtn.onclick=async()=>{
    logoutBtn.disabled=true;
    try{if(localSaveInFlight)await localSaveInFlight;if(cloudSaveInFlight)await cloudSaveInFlight;}catch(_){}
    try{await removeBackgroundPush();}catch(_){}
    try{if(cloudSessionToken)await pinApi("logout");}catch(_){}
    localStorage.removeItem(PIN_SESSION_KEY);await clearUserState();authPin.value="";isSignUp=false;updateAuthMode();showAuth();
    logoutBtn.disabled=false;
  };

  syncNowBtn.onclick=async()=>{
    if(!currentUser||!cloudSessionToken)return;syncNowBtn.disabled=true;setSync("Syncing…","warn");
    const context={accountId:String(currentUser.id),token:cloudSessionToken,generation:persistenceGeneration};
    try{
      /* Finish any edit already being saved before choosing the snapshot to
         upload or loading cloud state over it. */
      if(localSaveInFlight)await localSaveInFlight;
      if(cloudSaveInFlight)await cloudSaveInFlight;
      const result=await pinApi("load",{},context.token);
      if(!activePersistenceContext(context))return;
      /* Editing stays available during the request. Merge the current in-memory
         edits at response time, and ignore a load older than an acknowledged save. */
      const revision=Math.max(cloudRevision,Number(result.revision)||0);
      const original=Number(result.revision)>=cloudRevision?result.items:cloudBaseItems;
      const merged=replayLocalChanges(cloudBaseItems,mediaItems,original);
      const migration=migratePlannedStatuses(merged),cleanup=cleanLibraryRecords(migration.rows);
      applyAccount(result.account);setCloudBaseline(original,revision,currentUser.id);
      mediaItems=cleanup.items;render();
      const saved=await persistLibrary(mediaItems,{precleaned:true});
      if(!activePersistenceContext(context))return;
      await saveProfile(currentProfile);
      setSync(saved?"Synced. This library is available on your other devices.":"Saved on this device. Cloud sync is still pending.",saved?"ok":"warn");
      const cleanupMessage=duplicateCleanupMessage(cleanup);if(cleanupMessage)showAppToast(cleanupMessage,"success",6000);
      void refreshLibraryEpisodeMetadata({force:true});
    }catch(e){console.error(e);setSync(e.message||"Sync failed.","warn");}
    finally{syncNowBtn.disabled=false;}
  };

  changePinBtn.onclick=async()=>{
    const pin=newPinInput.value;if(!validPin(pin)){setSync("New PIN must be exactly 4 digits.","warn");return;}
    changePinBtn.disabled=true;
    try{await pinApi("change_pin",{pin});newPinInput.value="";setSync("PIN changed. Use the new PIN when signing in on other devices.","ok");}
    catch(e){console.error(e);setSync(e.message||"Could not change PIN.","warn");}
    finally{changePinBtn.disabled=false;}
  };

  userPill.onclick=()=>switchTab("settings");
  $("appearance-mode").onchange=e=>{const mode=e.target.value;safeWriteJSON(APPEARANCE_KEY,mode);applyAppearance(mode);};

  const SORT_KEY="watched_logger_sort_v1";
  const titleCollator=new Intl.Collator(undefined,{sensitivity:"base",numeric:true});
  function savedSortMode(){const value=safeReadJSON(SORT_KEY,"current");return value==="release"?"current":(["current","recent","title","platform","watched"].includes(value)?value:"current");}
  function originalTitlePrefix(title,wordCount){
    return String(title||"").replace(/\s*[:–—]\s.*$/,"").trim().split(/\s+/).slice(0,wordCount).join(" ");
  }
  function createShowGroupContext(items){
    const shows=(items||[]).filter(item=>item?.type!=="Film"&&item?.title);
    const normalizedShows=shows.map(item=>({item,key:normalizeTitle(item.title)})),firstCounts=new Map();
    for(const entry of normalizedShows){const first=entry.key.split(" ")[0];if(first)firstCounts.set(first,(firstCounts.get(first)||0)+1);}
    return{normalizedShows,firstCounts};
  }
  function showGroupInfo(item,context){
    const title=String(item?.title||"").trim(),normalized=normalizeTitle(title);
    if(!title||item?.type==="Film")return{key:`film:${normalized}`,label:title};
    const normalizedShows=context.normalizedShows;let exactBase=null;
    for(const candidate of normalizedShows)if(candidate.key&&candidate.key!==normalized&&normalized.startsWith(`${candidate.key} `)&&(!exactBase||candidate.key.length<exactBase.key.length))exactBase=candidate;
    if(exactBase)return{key:exactBase.key,label:String(exactBase.item.title)};

    const punctuationBase=title.split(/\s+(?:[-–—])\s+|\s*:\s*/)[0].trim();
    if(punctuationBase&&normalizeTitle(punctuationBase)!==normalized)return{key:normalizeTitle(punctuationBase),label:punctuationBase};

    const firstOriginal=(title.match(/^[A-Za-z0-9]+/)||[""])[0];
    const firstKey=normalizeTitle(firstOriginal);
    if(firstKey&&firstOriginal===firstOriginal.toUpperCase()&&firstOriginal.length>=2&&firstOriginal.length<=8){
      const familyCount=context.firstCounts.get(firstKey)||0;
      if(familyCount>1)return{key:firstKey,label:firstOriginal};
    }

    const ownTokens=normalized.split(" "),ownWords=title.split(/\s+/);
    let best=[];
    for(const candidate of normalizedShows){
      if(String(candidate.item.id)===String(item.id))continue;
      const other=candidate.key.split(" ");let length=0;
      while(length<ownTokens.length&&length<other.length&&ownTokens[length]===other[length])length++;
      if(length>=2&&length>best.length)best=ownTokens.slice(0,length);
    }
    if(best.length)return{key:best.join(" "),label:ownWords.slice(0,best.length).join(" ")};
    return{key:normalized,label:title};
  }
  function watchedSortTime(item){
    const value=item?.date?new Date(`${item.date}T12:00:00`).getTime():0;
    return Number.isFinite(value)?value:0;
  }
  function addedSortTime(item){
    const value=new Date(item?.createdAt||item?.updatedAt||(item?.date?`${item.date}T12:00:00`:0)).getTime();
    return Number.isFinite(value)?value:0;
  }
  function releaseSortInfo(item,now=Date.now()){
    let value="";
    if(item?.type==="Film")value=item.filmReleaseDate||"";
    else value=item?.latestEpisodeDate||item?.seriesReleaseDate||item?.nextEpisodeDate||"";
    if(!value&&item?.releaseYear&&/^\d{4}$/.test(String(item.releaseYear)))value=`${item.releaseYear}-01-01`;
    const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(String(value));
    const time=value?new Date(dateOnly?`${value}T12:00:00`:value).getTime():0;
    if(!Number.isFinite(time)||time<=0)return{bucket:0,time:0};
    return{bucket:time>now?1:2,time};
  }
  function compareReleaseRecency(a,b,now=Date.now()){
    const ar=releaseSortInfo(a,now),br=releaseSortInfo(b,now);
    if(ar.bucket!==br.bucket)return br.bucket-ar.bucket;
    if(ar.bucket===2&&ar.time!==br.time)return br.time-ar.time;
    if(ar.bucket===1&&ar.time!==br.time)return ar.time-br.time;
    return addedSortTime(b)-addedSortTime(a)||titleCollator.compare(a.title||"",b.title||"");
  }
  function currentSortInfo(item,now=Date.now()){
    const day=24*60*60*1000;
    const eventInfo=value=>{
      const raw=String(value||"").trim();
      if(!raw)return{time:0,dateOnly:false,dayStart:0,validThrough:0};
      const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(raw)||/^\d{4}-\d{2}-\d{2}T12:00(?::00)?$/.test(raw);
      const datePart=raw.slice(0,10);
      const time=new Date(dateOnly?`${datePart}T12:00:00`:raw).getTime();
      const dayStart=dateOnly?new Date(`${datePart}T00:00:00`).getTime():time;
      const validThrough=dateOnly?new Date(`${datePart}T23:59:59.999`).getTime():time;
      return{
        time:Number.isFinite(time)?time:0,
        dateOnly,
        dayStart:Number.isFinite(dayStart)?dayStart:0,
        validThrough:Number.isFinite(validThrough)?validThrough:0
      };
    };

    if(isEpisodeTrackable(item)){
      const latestEpisode=eventInfo(item.latestEpisodeDate);
      const nextEpisode=eventInfo(item.nextEpisodeDate);
      const nextSeason=eventInfo(item.nextSeasonDate);
      const latestEpisodeAired=latestEpisode.time>0&&(latestEpisode.dateOnly?latestEpisode.dayStart<=now:latestEpisode.time<=now);

      // An active episode run is ordered by the NEXT release, not the last
      // episode watched or aired. Keep season premieres in the upcoming group.
      const nextEpisodePending=nextEpisode.time>0&&(nextEpisode.dateOnly?nextEpisode.validThrough>=now:nextEpisode.time>now);
      if(latestEpisodeAired&&now-latestEpisode.dayStart<=14*day&&nextEpisodePending&&Number(item.nextEpisodeNum)>1){
        return{current:true,phase:4,time:nextEpisode.time,kind:"airing"};
      }

      // Current is an airing timeline, never a status/added-date sort.
      // Episodes that have just aired are first, newest release first.
      if(latestEpisodeAired&&now-latestEpisode.dayStart<=14*day){
        return{current:true,phase:3,time:latestEpisode.time,kind:"aired"};
      }

      // After recent releases, show the next dated episode/season in true
      // chronological order. Date-only events remain current for their whole
      // local calendar day instead of falling below TBA titles after noon.
      const future=[nextEpisode,nextSeason]
        .filter(event=>event.time>0&&(event.dateOnly?event.validThrough>=now:event.time>now))
        .map(event=>event.time)
        .sort((a,b)=>a-b);
      if(future.length)return{current:true,phase:2,time:future[0],kind:"upcoming"};

      // Older dated shows remain below the active airing timeline. TBA-only
      // entries have no time and therefore naturally fall to the bottom.
      if(latestEpisodeAired)return{current:false,phase:1,time:latestEpisode.time,kind:"older"};
      return{current:false,phase:0,time:0,kind:"tba"};
    }

    if(item?.type==="Film"){
      const release=eventInfo(item.filmReleaseDate);
      const released=release.time>0&&(release.dateOnly?release.dayStart<=now:release.time<=now);
      if(released&&now-release.dayStart<=120*day)return{current:true,phase:3,time:release.time,kind:"aired"};
      if(release.time>now)return{current:true,phase:2,time:release.time,kind:"upcoming"};
      if(release.time>0)return{current:false,phase:1,time:release.time,kind:"older"};
    }

    return{current:false,phase:0,time:0,kind:"tba"};
  }
  function compareCurrentOrder(a,b,now=Date.now()){
    const ai=currentSortInfo(a,now),bi=currentSortInfo(b,now);
    if(ai.phase!==bi.phase)return bi.phase-ai.phase;
    if(ai.phase===4&&ai.time!==bi.time)return ai.time-bi.time;
    if(ai.phase===3&&ai.time!==bi.time)return bi.time-ai.time;
    if(ai.phase===2&&ai.time!==bi.time)return ai.time-bi.time;
    if(ai.phase===1&&ai.time!==bi.time)return bi.time-ai.time;
    return titleCollator.compare(a.title||"",b.title||"");
  }
  function compareRecentOrder(a,b,now=Date.now()){
    const ai=currentSortInfo(a,now),bi=currentSortInfo(b,now);
    if(ai.current!==bi.current)return ai.current?-1:1;
    if(ai.current&&bi.current){
      const added=addedSortTime(b)-addedSortTime(a);
      if(added)return added;
    }
    return compareReleaseRecency(a,b,now)||addedSortTime(b)-addedSortTime(a)||titleCollator.compare(a.title||"",b.title||"");
  }
  function knownSeasonTotal(item){
    if(item?.type==="Film")return 0;
    return Math.max(1,...[item?.totalSeasons,item?.watchedSeasons,item?.curSeason,item?.airingSeason,item?.nextSeasonNum].map(value=>Number(value)||0));
  }
  function upcomingSortInfo(item,now=Date.now()){
    const events=[],announcements=[],graceStart=now-6*60*60*1000;
    const eventTime=value=>{
      const raw=String(value||""),dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(raw)||/^\d{4}-\d{2}-\d{2}T12:00(?::00)?$/.test(raw);
      const day=raw.slice(0,10),time=raw?new Date(dateOnly?`${day}T12:00:00`:raw).getTime():0;
      const validThrough=dateOnly?new Date(`${day}T23:59:59.999`).getTime():time+6*60*60*1000;
      return{time:Number.isFinite(time)?time:0,dateOnly,validThrough:Number.isFinite(validThrough)?validThrough:0};
    };
    if(item?.type==="Film"){
      if(item.filmReleaseDate){
        const value=eventTime(item.filmReleaseDate),today=new Date(now);today.setHours(0,0,0,0);
        if(value.time>=today.getTime())events.push({kind:"film",...value});
      }
    }else{
      const episodeDate=String(item?.nextEpisodeDate||"").trim(),seasonDate=String(item?.nextSeasonDate||"").trim();
      const episodeTime=eventTime(episodeDate),seasonTime=eventTime(seasonDate);
      if(episodeTime.time>0&&(episodeTime.dateOnly?episodeTime.validThrough>=now:episodeTime.time>=graceStart))events.push({kind:"episode",...episodeTime,number:item.nextEpisodeNum||null});
      else if(item?.nextEpisodeNum&&!episodeDate)announcements.push({kind:"episode",number:item.nextEpisodeNum});
      if(seasonTime.time>0&&(seasonTime.dateOnly?seasonTime.validThrough>=now:seasonTime.time>=graceStart))events.push({kind:"season",...seasonTime,number:item.nextSeasonNum||null});
      else if(item?.nextSeasonNum&&!seasonDate)announcements.push({kind:"season",number:item.nextSeasonNum});
    }
    if(events.length){events.sort((a,b)=>a.time-b.time);return{rank:2,...events[0]};}
    if(announcements.length)return{rank:1,time:Number.POSITIVE_INFINITY,...announcements[0]};
    return{rank:0,time:Number.POSITIVE_INFINITY,kind:"",number:null};
  }
