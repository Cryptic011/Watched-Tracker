  function updateFilmVerifyNote(result){
    if(filmVerifyNote)filmVerifyNote.textContent="Films and series are checked through multiple sources.";
  }

  function editorVerificationKey(type=typeSelect.value,title=titleInput.value){
    return [
      type,
      normalizeTitle(title),
      String($("imdb-id").value||""),
      String($("tvmaze-id").value||""),
      String($("release-year").value||""),
      normalizeTitle($("platform").value||"")
    ].join("|");
  }

  function rememberEditorVerification(type,result){
    editorVerification={key:editorVerificationKey(type),type,result,verifiedAt:Date.now()};
  }

  function freshEditorVerification(type,title){
    if(!editorVerification||editorVerification.type!==type)return null;
    if(Date.now()-editorVerification.verifiedAt>10*60*1000)return null;
    return editorVerification.key===editorVerificationKey(type,title)?editorVerification.result:null;
  }

  function pendingEditorVerification(type,title,{imdbId="",showId="",year="",platform=""}={}){
    const pending=editorVerificationInFlight;
    if(!pending||pending.type!==type||pending.title!==normalizeTitle(title))return null;
    if(String(year||"")!==pending.year||normalizeTitle(platform)!==pending.platform)return null;
    const idMatches=(value,...candidates)=>!value||candidates.filter(Boolean).includes(String(value));
    if(!idMatches(imdbId,pending.imdbId,pending.resolvedImdbId))return null;
    if(type!=="Film"&&!idMatches(showId,pending.showId,pending.resolvedShowId))return null;
    return pending.promise;
  }

  async function fillFilmReleaseData(title,{imdbId="",seedDate="",seedSource="",preserveManual=false,year="",platform="",shouldApply=()=>true}={}){
    const canApply=typeof shouldApply==="function"?shouldApply:()=>true;
    if(preserveManual&&filmReleaseDate.value){
      if(filmVerifyNote)filmVerifyNote.textContent="Films and series are checked through multiple sources.";
      const manual={date:filmReleaseDate.value,source:"Manual",sources:[]};
      if(canApply())rememberEditorVerification("Film",manual);
      return manual;
    }
    if(filmVerifyNote)filmVerifyNote.textContent="Films and series are checked through multiple sources.";
    const promise=verifiedFilmReleaseData(title,{imdbId,seedDate,seedSource});
    const pending={type:"Film",title:normalizeTitle(title),imdbId:String(imdbId||""),showId:"",resolvedImdbId:"",resolvedShowId:"",year:String(year||""),platform:normalizeTitle(platform),promise};
    editorVerificationInFlight=pending;
    try{
      const result=await promise;
      pending.resolvedImdbId=String(result.imdbId||"");
      if(!canApply())return result;
      if(result.imdbId)$("imdb-id").value=result.imdbId;
      filmReleaseDate.value=result.date||"";
      filmReleaseSource.value=result.date?(result.source||"Verified sources"):"";
      updateFilmVerifyNote(result);
      rememberEditorVerification("Film",result);
      return result;
    }finally{
      if(editorVerificationInFlight===pending)editorVerificationInFlight=null;
    }
  }

  function balancedSuggestions(items,limit=60){
    /* Relevance is the primary contract. Source diversity is already supplied
       by the gateway, so never promote a weaker format above a stronger match. */
    return (Array.isArray(items)?items:[]).slice(0,limit);
  }

  function dedupeAndRankSuggestions(results,query){
    const byKey=new Map(),titleIndex=new Map();
    for(const item of results.flat()){
      if(!item?.title)continue;
      const itemImdbId=String(item.imdbId||(item.source==="imdb"?item.externalId:"")||"");
      const titleKey=`${normalizeTitle(item.title)}|${item.format}|${item.year||""}`;
      const imdbKey=itemImdbId?`imdb:${itemImdbId}|${item.format}`:"";
      let key=imdbKey||titleKey;
      const titleMapped=titleIndex.get(titleKey);
      if(!byKey.has(key)&&titleMapped){
        const prior=byKey.get(titleMapped),priorImdbId=String(prior?.imdbId||(prior?.source==="imdb"?prior?.externalId:"")||"");
        if(!itemImdbId||!priorImdbId||itemImdbId===priorImdbId)key=titleMapped;
      }
      const scored={...item,imdbId:itemImdbId||item.imdbId||"",tvmazeId:item.tvmazeId||(item.source==="tvmaze"?item.externalId:""),score:suggestionScore(item,query),sources:[item.source]};
      const existing=byKey.get(key);
      if(!existing){byKey.set(key,scored);if(!titleIndex.has(titleKey))titleIndex.set(titleKey,key);continue;}
      const sources=Array.from(new Set([...(existing.sources||[existing.source]),item.source]));
      const preferNew=(item.format==="Film"&&item.source==="imdb"&&existing.source!=="imdb")||
                      (item.format==="Series"&&item.source==="tvmaze"&&existing.source!=="tvmaze")||
                      scored.score>existing.score;
      const base=preferNew?scored:existing,other=preferNew?existing:scored;
      byKey.set(key,{
        ...base,
        sources,
        imdbId:base.imdbId||other.imdbId||"",
        tvmazeId:base.tvmazeId||other.tvmazeId||"",
        posterUrl:base.posterUrl||other.posterUrl||"",
        description:base.description||other.description||"",
        storeUrl:base.storeUrl||other.storeUrl,
        releaseDate:base.releaseDate||other.releaseDate||"",
        releaseSource:base.releaseDate?(base.releaseSource||base.source):(other.releaseDate?(other.releaseSource||other.source):""),
        platform:base.platform||other.platform||"",
        status:base.status||other.status||"",
        updated:Math.max(Number(base.updated||0),Number(other.updated||0))
      });
    }
    const ranked=Array.from(byKey.values())
      .sort((a,b)=>b.score-a.score||Number(b.year||0)-Number(a.year||0)||a.title.localeCompare(b.title));
    return balancedSuggestions(ranked,60);
  }

  let activeSuggestions=[];

  function nearbyCachedSuggestions(query){
    const normalized=normalizeTitle(query);if(normalized.length<2)return[];
    let best=null,bestLength=0;const now=Date.now();
    for(const [key,entry] of titleSearchCache){
      if(!key.startsWith("all:")||now-entry.time>(entry.ttl||TITLE_SEARCH_CACHE_TTL_MS))continue;
      const cachedQuery=key.slice(4);
      if(normalized.startsWith(cachedQuery)&&cachedQuery.length>bestLength){best=entry.value;bestLength=cachedQuery.length;}
    }
    if(!Array.isArray(best))return[];
    return best.map(item=>({item,normalizedTitle:normalizeTitle(item.title),score:suggestionScore(item,normalized)}))
      .filter(row=>row.normalizedTitle.includes(normalized)||row.score>=900)
      .sort((a,b)=>b.score-a.score)
      .slice(0,36)
      .map(row=>row.item);
  }

  function isStrongCataloguePass(items,query){
    const first=items[0];if(!first)return false;
    const exact=normalizeTitle(first.title)===normalizeTitle(query);
    const crossChecked=new Set(first.sources||[first.source]).size>1;
    return (exact&&first.score>=1400)||(crossChecked&&first.score>=1250)||(items.length>=10&&first.score>=1100);
  }

  async function searchAllTitles(query,{onProgress=null,signal=null,isCurrent=null}={}){
    checkTitleSearchSignal(signal);
    const searchKey=`all:${normalizeTitle(query)}`;
    const cached=cacheGetSearch(searchKey);if(cached)return cached;
    if(normalizeTitle(query).length<2)return[];
    return runSharedTitleSearch(titleSearchInFlight,searchKey,async(requestSignal,publishProgress)=>{
      const corrected=correctedCatalogueQuery(query);
      const q=corrected||query;

      /* One owned Edge Function request fans out to the three catalogues,
         deduplicates identical browser calls, and never executes third-party
         JavaScript inside this page. */
      let merged=await searchCatalogBatch(q,"gb",requestSignal);
      checkTitleSearchSignal(requestSignal);
      let ranked=dedupeAndRankSuggestions(merged,q);
      publishProgress(ranked);
      /* A newer keystroke makes expensive spelling/franchise expansion stale.
         Source results remain cached for reuse, but no more requests are sent. */
      if(isCurrent?!isCurrent():searchKey!==activeTitleSearchKey)return ranked;
      if(isStrongCataloguePass(ranked,q))return cacheSetSearch(searchKey,ranked);

      /* Only weak results make at most two more gateway calls: one alternate
         spelling/franchise phrase and the secondary film region. */
      const variants=movieQueryVariants(q).filter(value=>normalizeTitle(value)!==normalizeTitle(q));
      const alternate=(corrected&&normalizeTitle(query)!==corrected)?query:variants[0];
      const expandedCalls=[searchCatalogBatch(q,"us",requestSignal)];
      if(alternate)expandedCalls.push(searchCatalogBatch(alternate,"gb",requestSignal));
      const expanded=await Promise.allSettled(expandedCalls);
      checkTitleSearchSignal(requestSignal);
      merged=merged.concat(expanded.flatMap(r=>r.status==="fulfilled"?r.value:[]));

      ranked=dedupeAndRankSuggestions(merged,q);
      /* A failed region may contain the missing match. Keep available results
         visible, but let the next attempt retry that region. */
      if(expanded.some(result=>result.status==="rejected"))return ranked;
      return cacheSetSearch(searchKey,ranked,ranked.length?TITLE_SEARCH_CACHE_TTL_MS:TITLE_SEARCH_EMPTY_TTL_MS);
    },signal,onProgress);
  }

  function renderSuggestions(items){
    activeSuggestions=(Array.isArray(items)?items:[]).slice(0,36);
    if(!activeSuggestions.length){
      suggestList.innerHTML=`<div class="suggest-item" style="cursor:default"><div><div class="suggest-name">No matching films or series found</div><div class="suggest-meta">Try fewer words or check the spelling.</div></div></div>`;
      suggestList.classList.remove("hidden");
      return;
    }
    suggestList.innerHTML=activeSuggestions.map((item,index)=>{
      const sourceNames=(item.sources||[item.source]).map(src=>src==="imdb"?"IMDb":src==="apple"?"Apple":src==="tvmaze"?"TVMaze":"Media");
      const sourceLabel=Array.from(new Set(sourceNames)).join(" + ");
      const exactRelease=item.format==="Film"&&item.releaseDate?formatLocalDate(item.releaseDate):"";
      const meta=[exactRelease||item.year,item.format,item.detail&&item.detail!==item.format?item.detail:"",item.platform,String(item.status||"").toLowerCase()==="running"?"Currently running":""] .filter(Boolean).join(" • ");
      return `<div class="suggest-item" data-suggestion-index="${index}"><div><div class="suggest-name">${esc(item.title)}</div><div class="suggest-meta">${esc(meta)}</div></div><span class="suggest-network">${esc(sourceLabel)}</span></div>`;
    }).join("");
    suggestList.classList.remove("hidden");
  }

  function cancelSuggestionProgress(){
    if(suggestionProgressFrame)cancelAnimationFrame(suggestionProgressFrame);
    suggestionProgressFrame=0;queuedSuggestionProgress=null;
  }
  function suggestionRequestActive(requestId,query){
    return titleSuggestionsWanted&&requestId===searchRequestId&&titleInput.value.trim()===query&&!modal.classList.contains("hidden");
  }
  function scheduleSuggestionProgress(items,requestId,query){
    queuedSuggestionProgress={items,requestId,query};
    if(suggestionProgressFrame)return;
    suggestionProgressFrame=requestAnimationFrame(()=>{
      suggestionProgressFrame=0;
      const queued=queuedSuggestionProgress;queuedSuggestionProgress=null;
      if(queued&&suggestionRequestActive(queued.requestId,queued.query))renderSuggestions(queued.items);
    });
  }

  async function selectSuggestion(item){
    if(!item)return;
    clearTimeout(searchTimer);activeCatalogueController?.abort();activeCatalogueController=null;const selectionRequestId=++searchRequestId,selectionApplyRevision=++editorApplyRevision;activeTitleSearchKey="";
    editorVerification=null;editorVerificationInFlight=null;titleSuggestionsWanted=false;cancelSuggestionProgress();
    titleInput.value=item.title;suggestList.classList.add("hidden");$("platform").value=item.platform||"";$("tvmaze-id").value="";
    const shouldApply=()=>selectionRequestId===searchRequestId&&selectionApplyRevision===editorApplyRevision&&titleInput.value===item.title&&!modal.classList.contains("hidden");
    const selectedImdbId=item.imdbId||(item.source==="imdb"?item.externalId:"");
    $("imdb-id").value=selectedImdbId||"";$("release-year").value=item.year||"";typeSelect.value=item.format;
    void loadUKAvailability();
    const film=item.format==="Film";seriesSection.style.display=film?"none":"flex";if(film)clearAiringFields();upcomingSection.style.display=film?"none":"flex";filmSection.style.display=film?"flex":"none";
    if(film){
      $("total-seasons").value="";$("watched-seasons").value="";$("cur-season").value="";$("cur-ep").value="";$("next-season-num").value="";$("next-season-date").value="";filmReleaseDate.value="";filmReleaseSource.value="";
      try{await fillFilmReleaseData(item.title,{imdbId:$("imdb-id").value||"",seedDate:item.releaseDate||"",seedSource:item.releaseSource||item.source||"Film catalogue",year:item.year||"",platform:item.platform||"",shouldApply});}
      catch(e){if(shouldApply()){console.warn("Film release verification failed",e);filmReleaseDate.value=isFutureDateOnly(item.releaseDate)?item.releaseDate:"";filmReleaseSource.value=filmReleaseDate.value?(item.releaseSource||item.source||"Film catalogue"):"";}}
      if(shouldApply())refreshEditorDuplicateWarning();return;
    }
    filmReleaseDate.value="";filmReleaseSource.value="";
    const sid=item.tvmazeId||(item.source==="tvmaze"?item.externalId:"");
    $("tvmaze-id").value=sid||"";
    try{await fillSeasonData(sid||"",item.title,{imdbId:selectedImdbId,year:item.year||"",platform:item.platform||"",shouldApply});}catch(e){console.warn(e);}
    if(shouldApply())refreshEditorDuplicateWarning();
  }
  suggestList.addEventListener("click",event=>{
    const row=event.target.closest("[data-suggestion-index]");if(!row)return;
    void selectSuggestion(activeSuggestions[Number(row.dataset.suggestionIndex)]);
  });

  titleInput.addEventListener("input",()=>{
    resetUKAvailability();
    clearTimeout(searchTimer);cancelSuggestionProgress();activeCatalogueController?.abort();activeCatalogueController=null;
    editorVerification=null;editorVerificationInFlight=null;hideDuplicateWarning();
    $("tvmaze-id").value="";$("imdb-id").value="";$("release-year").value="";
    const requestId=++searchRequestId;
    const q=titleInput.value.trim();
    titleSuggestionsWanted=q.length>=2;
    activeTitleSearchKey=q.length>=2?`all:${normalizeTitle(q)}`:"";
    if(q.length<2){suggestList.classList.add("hidden");return;}
    const cached=cacheGetSearch(`all:${normalizeTitle(q)}`);
    if(cached){renderSuggestions(cached);return;}
    const nearby=nearbyCachedSuggestions(q);
    if(nearby.length)renderSuggestions(nearby);
    else{
      suggestList.innerHTML=`<div class="suggest-item" style="cursor:default"><div><div class="suggest-name">Searching films & series…</div><div class="suggest-meta">Checking IMDb, TVMaze and Apple Movies — recent and currently airing titles are prioritised</div></div></div>`;
      suggestList.classList.remove("hidden");
    }
    searchTimer=setTimeout(async()=>{
      if(!suggestionRequestActive(requestId,q))return;
      const controller=new AbortController();activeCatalogueController=controller;
      try{
        const items=await searchAllTitles(q,{onProgress:partial=>{
          if(suggestionRequestActive(requestId,q))scheduleSuggestionProgress(partial,requestId,q);
        },signal:controller.signal});
        cancelSuggestionProgress();
        if(!suggestionRequestActive(requestId,q))return;
        renderSuggestions(items);
      }catch(e){
        if(controller.signal.aborted||e?.code==="cancelled")return;
        console.warn(e);cancelSuggestionProgress();
        if(suggestionRequestActive(requestId,q))suggestList.classList.add("hidden");
      }finally{if(activeCatalogueController===controller)activeCatalogueController=null;}
    },280);
  });
  document.addEventListener("click",e=>{if(!titleInput.contains(e.target)&&!suggestList.contains(e.target)){clearTimeout(searchTimer);titleSuggestionsWanted=false;activeTitleSearchKey="";activeCatalogueController?.abort();activeCatalogueController=null;cancelSuggestionProgress();suggestList.classList.add("hidden");}});
  typeSelect.onchange=()=>{
    resetUKAvailability();
    clearTimeout(searchTimer);searchRequestId++;activeTitleSearchKey="";titleSuggestionsWanted=false;activeCatalogueController?.abort();activeCatalogueController=null;cancelSuggestionProgress();editorVerification=null;editorVerificationInFlight=null;hideDuplicateWarning();
    const film=typeSelect.value==="Film";
    seriesSection.style.display=film?"none":"flex";
    upcomingSection.style.display=film?"none":"flex";
    filmSection.style.display=film?"flex":"none";
    if(film){clearAiringFields();if(filmVerifyNote)filmVerifyNote.textContent="Films and series are checked through multiple sources.";}
    else{filmReleaseDate.value="";filmReleaseSource.value="";}
  };
  filmReleaseDate.addEventListener("input",()=>{editorVerification=null;if(typeSelect.value==="Film")filmReleaseSource.value="Manual";});

  function loadStoredAiringFields(item){
    if(!item?.airingSeason&&!item?.nextEpisodeNum&&!item?.nextEpisodeDate){clearAiringFields();return;}
    airingSection.style.display="flex";
    $("airing-season").value=item.airingSeason??item.curSeason??"";
    $("latest-episode-num").value=item.latestEpisodeNum??item.curEp??"";
    $("latest-episode-title").value=item.latestEpisodeTitle||"";
    const latest=item.latestEpisodeNum??item.curEp;
    $("latest-episode").value=latest!==null&&latest!==undefined&&latest!==""?`Episode ${latest}${item.latestEpisodeTitle?` • ${item.latestEpisodeTitle}`:""}`:"";
    $("next-episode-num").value=item.nextEpisodeNum??"";
    $("next-episode-title").value=item.nextEpisodeTitle||"";
    $("next-episode").value=item.nextEpisodeNum?`Episode ${item.nextEpisodeNum}${item.nextEpisodeTitle?` • ${item.nextEpisodeTitle}`:""}`:"Date TBA";
    $("next-episode-date").value=item.nextEpisodeDate?toLocalInput(item.nextEpisodeDate):"";
    if(airingNote)airingNote.textContent="Refreshing the current episode schedule…";
  }

  function openAdd(){
    clearTimeout(searchTimer);cancelSuggestionProgress();activeCatalogueController?.abort();activeCatalogueController=null;searchRequestId++;editorApplyRevision++;activeTitleSearchKey="";titleSuggestionsWanted=false;editorVerification=null;editorVerificationInFlight=null;hideDuplicateWarning();
    mediaForm.reset();
    resetUKAvailability();
    $("watched-seasons").value="0";$("status").value="Planned";
    $("item-id").value="";$("tvmaze-id").value="";$("imdb-id").value="";$("release-year").value="";filmReleaseSource.value="";
    clearAiringFields();configureProgressOptions({highest:null,episodeCounts:{},latestAired:null},{season:0,episode:0});
    if(seasonVerifyNote)seasonVerifyNote.textContent="IMDb, TVMaze and Wikipedia are checked for announced seasons.";
    if(filmVerifyNote)filmVerifyNote.textContent="Films and series are checked through multiple sources.";
    $("modal-title").textContent="Log Title";deleteBtn.classList.add("hidden");
    seriesSection.style.display="flex";upcomingSection.style.display="flex";filmSection.style.display="none";modal.classList.remove("hidden");
  }

  async function openEdit(id){
    const item=mediaItems.find(x=>String(x.id)===String(id));if(!item)return;
    clearTimeout(searchTimer);activeCatalogueController?.abort();activeCatalogueController=null;cancelSuggestionProgress();const editRequestId=++searchRequestId,editApplyRevision=++editorApplyRevision;activeTitleSearchKey="";titleSuggestionsWanted=false;editorVerification=null;editorVerificationInFlight=null;hideDuplicateWarning();
    const shouldApply=()=>editRequestId===searchRequestId&&editApplyRevision===editorApplyRevision&&String($("item-id").value)===String(item.id)&&!modal.classList.contains("hidden");
    $("item-id").value=item.id;$("tvmaze-id").value=item.tvmazeShowId||"";$("imdb-id").value=item.imdbId||"";$("release-year").value=item.releaseYear||"";
    $("title").value=item.title||"";$("type").value=item.type||"Series";$("status").value=item.status==="Saved"?"Planned":(item.status||"Planned");
    $("total-seasons").value=item.totalSeasons??"";$("watched-seasons").value=item.watchedSeasons??"";$("cur-season").value=item.curSeason??"";$("cur-ep").value=item.curEp??"";
    $("next-season-num").value=item.nextSeasonNum??"";$("next-season-date").value=item.nextSeasonDate?toLocalInput(item.nextSeasonDate):"";
    filmReleaseDate.value=item.filmReleaseDate||"";filmReleaseSource.value=item.filmReleaseSource||"";$("platform").value=item.platform||"";
    void loadUKAvailability();
    configureProgressOptions({highest:item.totalSeasons,episodeCounts:item.episodeCounts||{},airedEpisodeCounts:item.airedEpisodeCounts||{[item.curSeason]:item.currentSeasonEpisodeCount||0},releasedEpisodes:item.releasedEpisodes||{},latestAired:item.curSeason,currentEpisode:item.curEp,completedSeasons:item.verifiedCompletedSeasons,episodeScheduleAvailable:item.episodeScheduleVerified===true||Boolean(Object.keys(item.airedEpisodeCounts||{}).length)},{season:item.curSeason,episode:item.curEp});
    loadStoredAiringFields(item);
    const film=item.type==="Film";seriesSection.style.display=film?"none":"flex";upcomingSection.style.display=film?"none":"flex";filmSection.style.display=film?"flex":"none";if(film)clearAiringFields();
    $("modal-title").textContent="Edit Title";deleteBtn.classList.remove("hidden");modal.classList.remove("hidden");
    const metadataAge=Date.now()-toMillis(item.metadataUpdatedAt);
    const metadataFresh=toMillis(item.metadataUpdatedAt)>0&&metadataAge<SERIES_METADATA_STALE_MS;
    if((film&&(item.filmReleaseSource==="Manual"||metadataFresh))||(!film&&(item.tvmazeShowId||item.imdbId)&&!seriesMetadataRefreshCandidate(item,Date.now(),{ignoreRetry:true})))return;
    if(film){
      try{await fillFilmReleaseData(item.title,{imdbId:item.imdbId||"",seedDate:item.filmReleaseDate||"",seedSource:item.filmReleaseSource||"",preserveManual:item.filmReleaseSource==="Manual",year:item.releaseYear||"",platform:item.platform||"",shouldApply});}
      catch(e){console.warn("Film release re-check failed",e);}
    }else{
      const options={imdbId:item.imdbId||"",year:item.releaseYear||"",platform:item.platform||""};
      const sid=item.tvmazeShowId||"";
      $("tvmaze-id").value=sid||"";
      try{await fillSeasonData(sid||"",item.title,{preserveProgress:true,...options,shouldApply});}catch(e){console.warn(e);}
    }
  }
  function closeEditor(){
    resetUKAvailability();
    hideDuplicateWarning();clearTimeout(searchTimer);activeCatalogueController?.abort();activeCatalogueController=null;cancelSuggestionProgress();searchRequestId++;
    editorApplyRevision++;editorVerificationInFlight=null;titleSuggestionsWanted=false;
    activeTitleSearchKey="";suggestList.classList.add("hidden");modal.classList.add("hidden");
    // Let the submit handler enqueue its save before considering a reload.
    setTimeout(()=>applyPendingAppUpdate(),0);
  }
  addBtn.onclick=()=>openTitleSearch();closeModal.onclick=closeEditor;modal.addEventListener("click",e=>{if(e.target===modal)closeEditor();});

  mediaForm.onsubmit=async e=>{
    e.preventDefault();if(!currentUser)return;saveBtn.disabled=true;saveBtn.textContent="Saving…";
    try{
      const existingId=$("item-id").value,id=existingId||uuid(),title=$("title").value.trim(),type=$("type").value;
      if(!title)throw new Error("Enter a title.");
      const ukChoice=typeof ukPlatform!=="undefined"?ukPlatform.value:"";
      const platform=((typeof selectedUKPlatform!=="undefined"&&selectedUKPlatform)||$("platform").value||ukChoice||"").trim(),releaseYear=$("release-year").value||"",requestedImdbId=$("imdb-id").value||"";
      let sid=$("tvmaze-id").value,verified=null;
      const recentVerification=freshEditorVerification(type,title);
      const pendingVerification=recentVerification?null:pendingEditorVerification(type,title,{imdbId:requestedImdbId,showId:sid,year:releaseYear,platform});
      if(type!=="Film"){
        if(recentVerification){verified=recentVerification;sid=verified.resolvedShowId||sid;}
      }
      const previous=mediaItems.find(x=>String(x.id)===String(id));
      const episodeHistory=Array.isArray(previous?.episodeHistory)?previous.episodeHistory:[];
      const numOrNull=x=>$(x).value===""?null:Number.parseInt($(x).value,10);
      const total=type==="Film"?null:($("total-seasons").value?Number($("total-seasons").value):null);
      const episodeCounts=type==="Film"?{}:(verified?.episodeCounts||previous?.episodeCounts||{});
      const airedEpisodeCounts=type==="Film"?{}:(verified?.airedEpisodeCounts||previous?.airedEpisodeCounts||episodeCountsForForm||{});
      const curSeason=type==="Film"?null:numOrNull("cur-season");
      const status=$("status").value;
      const watchedDate=status==="Watched"&&previous?.status!=="Watched"?localISODate():(previous?.date||localISODate());
      let item={
        ...previous,
        id,title,type,status,tvmazeShowId:type==="Film"?"":(sid||""),imdbId:$("imdb-id").value||requestedImdbId,releaseYear,
        totalSeasons:total,watchedSeasons:type==="Film"?null:numOrNull("watched-seasons"),curSeason,curEp:type==="Film"?null:numOrNull("cur-ep"),
        currentSeasonEpisodeCount:type==="Film"?null:Number(airedEpisodeCounts?.[curSeason]||0)||null,currentSeasonTotalEpisodes:type==="Film"?null:Number(episodeCounts?.[curSeason]||0)||null,episodeCounts:type==="Film"?{}:episodeCounts,airedEpisodeCounts:type==="Film"?{}:airedEpisodeCounts,releasedEpisodes:type==="Film"?{}:(verified?.releasedEpisodes||previous?.releasedEpisodes||releasedEpisodeMap({type,airedEpisodeCounts,episodeScheduleVerified:true})),
        scheduledEpisodeReleases:type==="Film"?[]:(verified?.scheduledEpisodeReleases||previous?.scheduledEpisodeReleases||[]),
        episodeScheduleVerified:type==="Film"?false:(verified?.episodeScheduleAvailable===true||previous?.episodeScheduleVerified===true),
        airingSeason:type==="Film"?null:numOrNull("airing-season"),latestEpisodeNum:type==="Film"?null:numOrNull("latest-episode-num"),latestEpisodeTitle:type==="Film"?"":$("latest-episode-title").value||"",
        latestEpisodeDate:type==="Film"?"":(verified?.latestEpisodeDate||previous?.latestEpisodeDate||""),seriesReleaseDate:type==="Film"?"":(verified?.seriesReleaseDate||previous?.seriesReleaseDate||""),
        nextEpisodeNum:type==="Film"?null:numOrNull("next-episode-num"),nextEpisodeTitle:type==="Film"?"":$("next-episode-title").value||"",nextEpisodeDate:type==="Film"?"":storedDateFromInput($("next-episode-date").value,verified?.nextEpisode?episodeReleaseTimestamp(verified.nextEpisode):(previous?.nextEpisodeDate||"")),
        nextSeasonNum:type==="Film"?"":($("next-season-num").value?Number($("next-season-num").value):""),nextSeasonDate:type==="Film"?"":storedDateFromInput($("next-season-date").value,verified?.upcoming?(verified.nextEpisode&&Number(verified.nextEpisode.season)===Number(verified.upcoming.number)?episodeReleaseTimestamp(verified.nextEpisode):(verified.upcoming.premiereDate||"")):(previous?.nextSeasonDate||"")),
        filmReleaseDate:type==="Film"?(filmReleaseDate.value||""):"",filmReleaseSource:type==="Film"?(filmReleaseDate.value?(filmReleaseSource.value||"Manual"):""):"",
        verifiedCompletedSeasons:type==="Film"?null:(Number.isFinite(Number(verified?.completedSeasons))?Number(verified.completedSeasons):Number(previous?.verifiedCompletedSeasons||0)),
        episodeHistory:type==="Film"?[]:episodeHistory,...(type==="Film"?{watchedEpisodes:{}}:(Object.prototype.hasOwnProperty.call(previous||{},"watchedEpisodes")?{watchedEpisodes:normalizeWatchedEpisodeMap(previous.watchedEpisodes,airedEpisodeCounts)}:{})),lastEpisodeWatchedAt:type==="Film"?"":(previous?.lastEpisodeWatchedAt||""),
        lastWatchedSeason:type==="Film"?null:(previous?.lastWatchedSeason??null),lastWatchedEpisode:type==="Film"?null:(previous?.lastWatchedEpisode??null),
        platform,date:watchedDate,createdAt:previous?.createdAt||nowISO(),updatedAt:previous?.updatedAt||nowISO()
      };
      if(type!=="Film"&&item.episodeScheduleVerified===true){
        const releases=releasedEpisodeMap(item),progressChanged=!previous||Number(previous.watchedSeasons||0)!==Number(item.watchedSeasons||0)||Number(previous.curSeason||0)!==Number(item.curSeason||0)||Number(previous.curEp||0)!==Number(item.curEp||0);
        if(progressChanged){
          const available=releases[Number(item.curSeason||0)]||[],requested=Number(item.curEp||0),validEpisode=Math.max(0,...available.filter(episode=>episode<=requested));
          item.curEp=validEpisode||null;item.watchedEpisodes=progressWatchedEpisodeMap(releases,Number(item.watchedSeasons||0),Number(item.curSeason||0),validEpisode);
          const highest=highestWatchedEpisode(item.watchedEpisodes);item.curSeason=highest?.season||null;item.curEp=highest?.episode||null;item.lastWatchedSeason=highest?.season||null;item.lastWatchedEpisode=highest?.episode||null;item.lastEpisodeWatchedAt=highest?nowISO():"";
        }else if(Object.prototype.hasOwnProperty.call(previous||{},"watchedEpisodes"))item.watchedEpisodes=normalizeWatchedEpisodeMap(previous.watchedEpisodes,releases);
      }
      item=migratePlannedStatuses([item]).rows[0];
      const duplicate=findTrackedDuplicate(item,mediaItems,id);
      if(duplicate){
        showDuplicateWarning(duplicate);showAppToast(`“${duplicate.title}” is already tracked.`,"warn");
        const duplicateError=new Error(`“${duplicate.title}” is already tracked.`);duplicateError.code="duplicate";throw duplicateError;
      }
      const sameTitleSeries=mediaItems.find(x=>String(x.id)!==String(id)&&x.type!=="Film"&&normalizeTitle(x.title)===normalizeTitle(title));
      if(isWeakFilmRecord(item)&&sameTitleSeries)throw new Error(`“${title}” is already saved as a verified series. Choose a verified film result with a year or release date if you mean a separate film.`);
      if(previous&&sameRecordWithoutUpdateTime(item,previous)){
        closeEditor();showAppToast("No changes to save.","success");return;
      }
      item={...item,updatedAt:nowISO()};
      const idx=mediaItems.findIndex(x=>String(x.id)===String(id));if(idx>=0)mediaItems[idx]=item;else mediaItems.unshift(item);
      /* Display the edit immediately, save it on this device, then sync it.
         Metadata checks run after the editor closes. */
      render();closeEditor();
      void persistLibrary(mediaItems,{background:true,precleaned:true});
      if(!recentVerification)void scheduleMetadataRefresh(item,{verificationPromise:pendingVerification});
    }catch(err){if(err?.code!=="duplicate"){console.error(err);alert(err.message||"Save failed.");}}
    finally{saveBtn.disabled=false;saveBtn.textContent="Save";}
  };
  deleteBtn.onclick=async()=>{
    const id=$("item-id").value,index=mediaItems.findIndex(x=>String(x.id)===String(id)),item=mediaItems[index];if(!item)return;
    const generation=persistenceGeneration;
    mediaItems=mediaItems.filter(x=>String(x.id)!==String(id));render();closeEditor();
    try{
      await persistLibrary(mediaItems,{background:true,precleaned:true});
      showAppToast(`${item.title} removed`,"success",6000,async()=>{
        if(generation!==persistenceGeneration||mediaItems.some(row=>String(row.id)===String(id)))return;
        if(findTrackedDuplicate(item,mediaItems,id)){showAppToast("This title is already in your library.","warn");return;}
        mediaItems.splice(Math.min(index,mediaItems.length),0,item);render();
        await persistLibrary(mediaItems,{background:true,precleaned:true});showAppToast("Title restored.");
      });
    }catch(error){showAppToast("Deletion could not be saved. Tap Sync Now to retry.","warn");}
  };

  async function start(){
    applyAppearance();
    activeSort=savedSortMode();sortMode.value=activeSort;
    updateAuthMode();
    await refreshPublicMaintenance();
    if(!await restorePinSession()){
      showAuth();
      if(!publicMaintenance.enabled)await prefillLegacyAccount();
    }
  }
  start().catch(err=>{console.error(err);showAuth();showMessage(`Watched Logger could not start: ${err.message||err}`);});
