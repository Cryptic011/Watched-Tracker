  function isEpisodeTrackable(item){return item?.type==="Series"||item?.type==="Anime";}
  function positiveEpisodeMap(value){
    const counts={};
    for(const [season,count] of Object.entries(value||{})){
      const s=Number(season),n=Math.max(0,Number(count||0));
      if(Number.isInteger(s)&&s>0&&Number.isFinite(n)&&n>0)counts[s]=Math.floor(n);
    }
    return counts;
  }
  function normalizeReleasedEpisodeMap(value){
    const result={};
    for(const [seasonValue,episodeValue] of Object.entries(value||{})){
      const season=Number(seasonValue),episodes=[...new Set((Array.isArray(episodeValue)?episodeValue:[]).map(Number).filter(episode=>Number.isInteger(episode)&&episode>0))].sort((a,b)=>a-b);
      if(Number.isInteger(season)&&season>0&&episodes.length)result[season]=episodes;
    }
    return result;
  }
  function releasedEpisodeMap(item){
    if(!isEpisodeTrackable(item))return{};
    if(item?.episodeScheduleVerified===true&&Object.prototype.hasOwnProperty.call(item,"releasedEpisodes"))return normalizeReleasedEpisodeMap(item.releasedEpisodes);
    const verified=positiveEpisodeMap(item.airedEpisodeCounts);
    if(item?.episodeScheduleVerified===true||Object.keys(verified).length)return Object.fromEntries(Object.entries(verified).map(([season,count])=>[season,Array.from({length:count},(_,index)=>index+1)]));

    // Never treat announced/total episode counts as released episodes. For an
    // unverified schedule, expose only seasons/episodes supported by concrete
    // release evidence already stored on the title.
    const totals=positiveEpisodeMap(item.episodeCounts),counts={};
    const completed=Math.max(0,Number(item.verifiedCompletedSeasons||0));
    for(const [seasonValue,totalValue] of Object.entries(totals)){
      const season=Number(seasonValue);
      if(season<=completed)counts[season]=Number(totalValue);
    }

    const now=Date.now(),activeSeason=Number(item.airingSeason||item.curSeason||0);
    const latest=Number(item.latestEpisodeNum||0),latestTime=toMillis(item.latestEpisodeDate);
    const nextEpisode=Number(item.nextEpisodeNum||0),nextTime=toMillis(item.nextEpisodeDate);
    let activeReleased=0;
    if(activeSeason>0&&latest>0&&latestTime>0&&latestTime<=now)activeReleased=latest;
    if(activeSeason>0&&nextEpisode>1&&nextTime>now)activeReleased=Math.max(activeReleased,nextEpisode-1);
    if(activeSeason>0&&activeReleased>0)counts[activeSeason]=totals[activeSeason]?Math.min(Number(totals[activeSeason]),activeReleased):activeReleased;

    for(const season of Object.keys(counts))if(!Number.isFinite(counts[season])||counts[season]<=0)delete counts[season];
    return Object.fromEntries(Object.entries(counts).map(([season,count])=>[season,Array.from({length:count},(_,index)=>index+1)]));
  }
  function releasedEpisodeCounts(item){
    return Object.fromEntries(Object.entries(releasedEpisodeMap(item)).map(([season,episodes])=>[season,Math.max(0,...episodes)]));
  }
  function normalizeWatchedEpisodeMap(value,counts={}){
    const result={};
    for(const [seasonValue,episodeValue] of Object.entries(value||{})){
      const season=Number(seasonValue);if(!Number.isInteger(season)||season<=0)continue;
      const source=Array.isArray(episodeValue)?episodeValue:Object.entries(episodeValue||{}).filter(([,watched])=>Boolean(watched)).map(([episode])=>episode);
      const allowed=Array.isArray(counts[season])?new Set(counts[season].map(Number)):null,maximum=allowed?0:Math.max(0,Number(counts[season]||0));
      const episodes=[...new Set(source.map(Number).filter(episode=>Number.isInteger(episode)&&episode>0&&(allowed?allowed.has(episode):(maximum>0&&episode<=maximum))))].sort((a,b)=>a-b);
      if(episodes.length)result[season]=episodes;
    }
    return result;
  }
  function legacyWatchedEpisodeMap(item,counts=releasedEpisodeMap(item)){
    const result={},fully=Math.max(0,Number(item?.watchedSeasons||0)),current=Math.max(0,Number(item?.curSeason||0)),currentEpisode=Math.max(0,Number(item?.curEp||0));
    for(const [seasonValue,countValue] of Object.entries(counts)){
      const season=Number(seasonValue),available=Array.isArray(countValue)?countValue:Array.from({length:Math.max(0,Number(countValue||0))},(_,index)=>index+1);
      const episodes=season<=fully?available:season===current?available.filter(episode=>episode<=currentEpisode):[];
      if(episodes.length)result[season]=episodes;
    }
    for(const event of (Array.isArray(item?.episodeHistory)?item.episodeHistory:[])){
      const season=Number(event?.season),episode=Number(event?.episode),available=Array.isArray(counts[season])?counts[season]:[];
      if(!Number.isInteger(season)||season<=0||!Number.isInteger(episode)||episode<=0||!available.includes(episode))continue;
      const episodes=new Set(result[season]||[]);
      if(event.kind==="unmark")episodes.delete(episode);else episodes.add(episode);
      if(episodes.size)result[season]=[...episodes].sort((a,b)=>a-b);else delete result[season];
    }
    return normalizeWatchedEpisodeMap(result,counts);
  }
  function watchedEpisodeMap(item,counts=releasedEpisodeMap(item)){
    if(Object.prototype.hasOwnProperty.call(item||{},"watchedEpisodes"))return normalizeWatchedEpisodeMap(item.watchedEpisodes,counts);
    return legacyWatchedEpisodeMap(item,counts);
  }
  function highestWatchedEpisode(map){
    let highest=null;
    for(const [seasonValue,episodes] of Object.entries(map||{}))for(const episodeValue of episodes||[]){
      const season=Number(seasonValue),episode=Number(episodeValue);
      if(!highest||season>highest.season||(season===highest.season&&episode>highest.episode))highest={season,episode};
    }
    return highest;
  }
  function lastLoggedEpisode(item){
    if(isEpisodeTrackable(item)){
      const highest=highestWatchedEpisode(watchedEpisodeMap(item));
      if(highest)return{...highest,watchedAt:item?.lastEpisodeWatchedAt||""};
    }
    const history=Array.isArray(item?.episodeHistory)?item.episodeHistory:[],recent=[...history].reverse().find(event=>event?.kind!=="unmark");
    const season=Number(item?.lastWatchedSeason??recent?.season??0),episode=Number(item?.lastWatchedEpisode??recent?.episode??0);
    if(!Number.isInteger(season)||season<=0||!Number.isInteger(episode)||episode<=0)return null;
    return{season,episode,watchedAt:item?.lastEpisodeWatchedAt||recent?.watchedAt||""};
  }
  function fullyWatchedSeasonCount(item,map,counts){
    const totals=positiveEpisodeMap(item?.episodeCounts),completedLimit=Math.max(0,Number(item?.verifiedCompletedSeasons||0),Number(item?.watchedSeasons||0));let total=0;
    for(const season of Object.keys(counts).map(Number)){
      if(season>completedLimit)continue;
      const maximum=Math.max(0,Number(totals[season]||counts[season]||0)),watched=new Set(map[season]||[]);
      if(maximum>0&&Array.from({length:maximum},(_,index)=>index+1).every(episode=>watched.has(episode)))total++;
    }
    return total;
  }
  function applyEpisodeToggle(item,season,episode,markWatched,event){
    const releases=releasedEpisodeMap(item),counts=releasedEpisodeCounts(item),map=watchedEpisodeMap(item,releases),episodes=new Set(map[season]||[]);
    if(markWatched)episodes.add(episode);else episodes.delete(episode);
    if(episodes.size)map[season]=[...episodes].sort((a,b)=>a-b);else delete map[season];
    const watchedEpisodes=normalizeWatchedEpisodeMap(map,releases),highest=highestWatchedEpisode(watchedEpisodes);
    let curSeason=Math.max(0,Number(item.curSeason||0)),curEp=Math.max(0,Number(item.curEp||0));
    const currentOrder=curSeason*10000+curEp,targetOrder=season*10000+episode;
    if(markWatched&&targetOrder>currentOrder){curSeason=season;curEp=episode;}
    else if(!markWatched&&targetOrder===currentOrder){curSeason=highest?.season||0;curEp=highest?.episode||0;}
    const status=markWatched&&(item.status==="Planned"||item.status==="Saved")?"Watching":(item.status||"Watching");
    const episodeHistory=[...(Array.isArray(item.episodeHistory)?item.episodeHistory:[]),event].slice(-500);
    const updated={
      ...item,status,curSeason:curSeason||null,curEp:curEp||null,watchedEpisodes,
      watchedSeasons:fullyWatchedSeasonCount(item,watchedEpisodes,counts),
      currentSeasonEpisodeCount:curSeason?Number(counts[curSeason]||0)||null:null,
      episodeHistory,lastEpisodeWatchedAt:highest?event.watchedAt:"",lastWatchedSeason:highest?.season||null,lastWatchedEpisode:highest?.episode||null,
      date:item.date||localISODate(),updatedAt:event.watchedAt
    };
    return updated;
  }
  async function toggleEpisodeWatched(id,season,episode,{offerUndo=true}={}){
    const key=String(id);if(episodeLogBusy.has(key))return;
    const index=mediaItems.findIndex(item=>String(item.id)===key),item=mediaItems[index];if(index<0||!item)return;
    const releases=releasedEpisodeMap(item),available=releases[season]||[];if(!available.includes(episode))return;
    const wasWatched=(watchedEpisodeMap(item,releases)[season]||[]).includes(episode),markWatched=!wasWatched,event={id:uuid(),kind:markWatched?"mark":"unmark",season,episode,watchedAt:nowISO()};
    const generation=persistenceGeneration;
    const original=item;episodeLogBusy.add(key);episodeLogFeedback={itemId:key,eventId:event.id,season,episode,label:`Saving S${season} E${episode}…`,saving:true};
    mediaItems[index]=applyEpisodeToggle(item,season,episode,markWatched,event);render();
    let saved=false;
    try{
      await persistLibrary(mediaItems,{background:true,precleaned:true});
      episodeLogFeedback={itemId:key,eventId:event.id,season,episode,label:markWatched?`✓ S${season} E${episode} marked watched`:`S${season} E${episode} unmarked`,saving:false};saved=true;
    }catch(error){
      console.error(error);const currentIndex=mediaItems.findIndex(row=>String(row.id)===key);if(currentIndex>=0)mediaItems[currentIndex]=original;
      episodeLogFeedback=null;alert("That episode could not be saved. Please try again.");
    }finally{
      episodeLogBusy.delete(key);render();
      if(saved&&offerUndo)showAppToast(markWatched?`S${season} E${episode} watched`:`S${season} E${episode} unwatched`,"success",6000,async()=>{
        if(generation!==persistenceGeneration)return;
        const current=mediaItems.find(row=>String(row.id)===key);
        const latest=current?.episodeHistory?.filter(row=>row.season===season&&row.episode===episode).at(-1);
        if(!current||latest?.id!==event.id){showAppToast("This episode has changed since. Open it to update its progress.","warn");return;}
        await toggleEpisodeWatched(id,season,episode,{offerUndo:false});
        showAppToast("Episode change undone.");
      });
      if(saved)setTimeout(()=>{if(episodeLogFeedback?.eventId===event.id){episodeLogFeedback=null;render();}},1500);
    }
  }
  function closeEpisodeTrackerSheet(){activeEpisodeTrackerId="";activeEpisodeTrackerSeason=0;episodeTrackerModal.classList.add("hidden");setTimeout(applyPendingAppUpdate,0);}
  function openEpisodeTracker(id){
    const item=mediaItems.find(row=>String(row.id)===String(id));if(!isEpisodeTrackable(item))return;
    const releases=releasedEpisodeMap(item),seasons=Object.keys(releases).map(Number).sort((a,b)=>a-b),current=Number(item.curSeason||0);
    activeEpisodeTrackerId=String(id);activeEpisodeTrackerSeason=seasons.includes(current)?current:(seasons[seasons.length-1]||0);episodeTrackerModal.classList.remove("hidden");updateEpisodeTracker();
    if(episodeMetadataNeedsRefresh(item)){
      episodeTrackerRelease.textContent=`${episodeTrackerRelease.textContent} · Checking for new episodes…`;
      void scheduleMetadataRefresh(item);
      updateEpisodeTracker();
    }
    setTimeout(()=>{(activeEpisodeTrackerSeason?episodeTrackerSeason:closeEpisodeTracker).focus();},0);
  }
  function episodeTrackerEmptyState(item){
    if(metadataRefreshInFlight.has(String(item.id)))return {summary:"Checking episode schedule…",message:"Loading episode details. Please wait."};
    if(item.episodeScheduleVerified===true)return {summary:"No released episodes yet",message:"No released episodes are available for this series yet."};
    return {summary:"Episode schedule unavailable",message:"The episode schedule could not be verified. Open Edit show details to check the selected series and refresh its details."};
  }
  function updateEpisodeTracker(){
    if(!activeEpisodeTrackerId||episodeTrackerModal.classList.contains("hidden"))return;
    const item=mediaItems.find(row=>String(row.id)===String(activeEpisodeTrackerId));if(!item){closeEpisodeTrackerSheet();return;}
    const releases=releasedEpisodeMap(item),counts=releasedEpisodeCounts(item),releasedSeasons=Object.keys(releases).map(Number).sort((a,b)=>a-b),latestSeason=releasedSeasons[releasedSeasons.length-1]||0;
    const watchedMap=watchedEpisodeMap(item,releases),highest=highestWatchedEpisode(watchedMap),feedback=episodeLogFeedback?.itemId===String(item.id)?episodeLogFeedback:null;
    if(!releasedSeasons.includes(activeEpisodeTrackerSeason))activeEpisodeTrackerSeason=releasedSeasons.includes(Number(item.curSeason||0))?Number(item.curSeason):latestSeason;
    const emptySchedule=episodeTrackerEmptyState(item);
    episodeTrackerTitle.textContent=item.title||"Show";
    episodeTrackerProgress.textContent=highest?`S${highest.season} E${highest.episode}`:"Not started";
    episodeTrackerRelease.textContent=latestSeason?`Released through S${latestSeason} E${counts[latestSeason]}`:emptySchedule.summary;
    episodeTrackerSeason.innerHTML=releasedSeasons.length?releasedSeasons.map(season=>`<option value="${season}"${season===activeEpisodeTrackerSeason?" selected":""}>Season ${season}</option>`).join(""):'<option value="">No seasons</option>';
    episodeTrackerSeason.disabled=!releasedSeasons.length;
    const available=releases[activeEpisodeTrackerSeason]||[],watched=new Set(watchedMap[activeEpisodeTrackerSeason]||[]),busy=episodeLogBusy.has(String(item.id));
    episodeTrackerSeasonSummary.textContent=available.length?`${watched.size} of ${available.length} released watched`:"";
    const next=nextWatchEpisode(item),nextButton=document.getElementById("episode-watch-next");
    nextButton.hidden=!next;nextButton.disabled=busy;
    nextButton.textContent=next?`Watch next · S${next.season} E${next.episode}`:"All caught up";
    episodeTrackerGrid.innerHTML=available.length?available.map(episode=>{
      const isWatched=watched.has(episode),isSaving=busy&&feedback?.season===activeEpisodeTrackerSeason&&feedback?.episode===episode;
      return`<button class="episode-tick${isWatched?" watched":""}" type="button" data-season="${activeEpisodeTrackerSeason}" data-episode="${episode}" aria-pressed="${isWatched}" aria-label="Season ${activeEpisodeTrackerSeason} episode ${episode}, ${isWatched?"watched":"not watched"}"${busy?" disabled":""}><span>Episode ${episode}</span><span class="episode-state">${isSaving?"Saving…":isWatched?"✓ Watched":"Mark watched"}</span></button>`;
    }).join(""):`<div class="episode-tracker-grid-empty">${esc(emptySchedule.message)}</div>`;
    const watchedTotal=Object.values(watchedMap).reduce((total,episodes)=>total+episodes.length,0);
    episodeTrackerLast.classList.toggle("unmarked",!watchedTotal&&!feedback);
    episodeTrackerLast.textContent=feedback?.label||(watchedTotal?`✓ ${watchedTotal} episode${watchedTotal===1?"":"s"} marked watched`:"No episodes have been marked watched yet.");
  }
  document.getElementById("episode-watch-next").onclick=()=>{
    const item=mediaItems.find(row=>String(row.id)===activeEpisodeTrackerId),next=item&&nextWatchEpisode(item);
    if(next)void toggleEpisodeWatched(item.id,next.season,next.episode);
  };
  closeEpisodeTracker.onclick=closeEpisodeTrackerSheet;
  episodeTrackerModal.addEventListener("click",event=>{if(event.target===episodeTrackerModal)closeEpisodeTrackerSheet();});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!episodeTrackerModal.classList.contains("hidden"))closeEpisodeTrackerSheet();});
  episodeTrackerSeason.onchange=()=>{activeEpisodeTrackerSeason=Number(episodeTrackerSeason.value||0);updateEpisodeTracker();};
  episodeTrackerGrid.addEventListener("click",event=>{const button=event.target.closest("button[data-season][data-episode]");if(!button||!activeEpisodeTrackerId)return;toggleEpisodeWatched(activeEpisodeTrackerId,Number(button.dataset.season),Number(button.dataset.episode));});
  episodeTrackerEdit.onclick=()=>{const id=activeEpisodeTrackerId;closeEpisodeTrackerSheet();if(id)openEdit(id);};
  function sortMediaRows(rows){
    const list=[...rows],groups=new Map(),now=Date.now();
    if(activeSort==="current")list.sort((a,b)=>compareCurrentOrder(a,b,now));
    else if(activeSort==="recent")list.sort((a,b)=>compareRecentOrder(a,b,now));
    else if(activeSort==="release")list.sort((a,b)=>compareReleaseRecency(a,b,now));
    else if(activeSort==="title")list.sort((a,b)=>titleCollator.compare(a.title||"",b.title||""));
    else if(activeSort==="platform")list.sort((a,b)=>{
      const ap=String(a.platform||"").trim(),bp=String(b.platform||"").trim();
      if(!ap&&!bp)return titleCollator.compare(a.title||"",b.title||"");
      if(!ap)return 1;if(!bp)return-1;
      return titleCollator.compare(ap,bp)||titleCollator.compare(a.title||"",b.title||"");
    });
    else if(activeSort==="watched")list.sort((a,b)=>watchedSortTime(b)-watchedSortTime(a)||titleCollator.compare(a.title||"",b.title||""));
    else if(activeSort==="shows"){
      /* Calculate each family once. The old comparator recalculated the whole
         NCIS/FBI family scan for every comparison. */
      const context=createShowGroupContext(list);
      for(const item of list)groups.set(String(item.id),showGroupInfo(item,context));
      list.sort((a,b)=>{
        const ag=groups.get(String(a.id)),bg=groups.get(String(b.id));
        return titleCollator.compare(ag?.key||"",bg?.key||"")||titleCollator.compare(a.title||"",b.title||"");
      });
    }else list.sort((a,b)=>compareCurrentOrder(a,b,now));
    return{rows:list,groups};
  }
  function updateCounts(){
    let planned=0,watching=0,watched=0;
    for(const item of mediaItems){if(item.status==="Planned"||item.status==="Saved")planned++;else if(item.status==="Watching")watching++;else if(item.status==="Watched")watched++;}
    $("count-planned").textContent=planned;$("count-watching").textContent=watching;$("count-watched").textContent=watched;
  }
  function categoryControlsVisible(){return currentTab==="library"&&Boolean(window.WatchLogGallery?.hasCategory?.());}
  function updateFloatingAddVisibility(){renderLibraryMaintenance();addBtn.classList.toggle("hidden",!(currentUser&&currentTab==="library"&&(!categoryControlsVisible()||activeFilter==="All")));}
  function switchTab(tab){
    currentTab=tab;tabBtns.forEach(b=>{b.classList.toggle("active",b.dataset.tab===tab);b.setAttribute("aria-current",b.dataset.tab===tab?"page":"false");});
    const settings=tab==="settings",search=tab==="search";
    libraryView.classList.toggle("hidden",settings||search);settingsView.classList.toggle("hidden",!settings);
    $("discovery-view").classList.toggle("hidden",!search);
    document.querySelector(".top-nav .search-box").classList.toggle("hidden",search);
    document.querySelector(".stats-row").classList.toggle("hidden",search);
    updateFloatingAddVisibility();
    if(search){activateTitleSearch();return;}
    pauseTitleSearch();
    if(settings)void refreshPrivateReminderHistory();
    if(!settings){$("list-label").textContent=tab==="watchlist"?"Upcoming Premieres":tab==="history"?"Watch History":"Titles";render();}
  }
  tabBtns.forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
  pillBtns.forEach(b=>b.onclick=()=>{pillBtns.forEach(x=>x.classList.remove("active"));b.classList.add("active");activeFilter=b.dataset.filter;render();});
  sortMode.onchange=e=>{activeSort=e.target.value;safeWriteJSON(SORT_KEY,activeSort);render();};

  const mediaSearchTextCache=new WeakMap();
  let renderFrame=0;
  function mediaSearchInfo(item){
    let value=mediaSearchTextCache.get(item);
    if(value===undefined){const title=normalizeTitle(item?.title),platform=normalizeTitle(item?.platform);value={title,platform,text:`${title} ${platform}`.trim()};mediaSearchTextCache.set(item,value);}
    return value;
  }
  function librarySearchScore(item,query,queryTokens){
    if(!query)return 1;
    const {title,platform,text}=mediaSearchInfo(item);
    if(title===query)return 1200;
    if(title.startsWith(query))return 1000-Math.min(100,title.length-query.length);
    if(title.includes(query))return 820;
    if(queryTokens.length&&queryTokens.every(token=>title.includes(token)))return 700;
    if(platform===query)return 620;
    if(platform.includes(query))return 520;
    if(queryTokens.length&&queryTokens.every(token=>text.includes(token)))return 440;
    const length=Math.max(title.length,query.length);
    if(query.length>=3&&Math.abs(title.length-query.length)<=Math.max(2,Math.floor(length*.25))){
      const similarity=1-levenshteinNormalized(title,query)/length;
      if(similarity>=.72)return 300+Math.round(similarity*100);
    }
    return 0;
  }
  function itemMatchesCurrentView(item,query,queryTokens,now,scoreById=null){
    if(!item?.title)return false;
    if(currentTab==="watchlist"){
      if(upcomingSortInfo(item,now).rank===0)return false;
    }else if(currentTab==="history"&&item.status!=="Watched")return false;
    if(categoryControlsVisible()&&activeFilter!=="All"&&!(activeFilter==="Planned"&&(item.status==="Planned"||item.status==="Saved"))&&item.status!==activeFilter)return false;
    const score=librarySearchScore(item,query,queryTokens);
    if(scoreById)scoreById.set(String(item.id),score);
    return score>0;
  }
  function currentVisibleMediaRows(){
    const query=normalizeTitle(searchQuery),queryTokens=query.split(" ").filter(Boolean),now=Date.now(),rows=[],scoreById=new Map();
    renderedLibrarySearch=query;
    for(const item of mediaItems)if(itemMatchesCurrentView(item,query,queryTokens,now,scoreById))rows.push(item);
    const result=sortMediaRows(rows);
    if(query)result.rows.sort((a,b)=>(scoreById.get(String(b.id))||0)-(scoreById.get(String(a.id))||0));
    return result;
  }
  function reminderMarkup(item,isFilm){
    const upcoming=upcomingSortInfo(item);
    if(upcoming.rank===0)return"";
    const text=upcoming.rank===2?(upcoming.dateOnly?formatLocalWeekdayDate(new Date(upcoming.time)):formatLocalDateTime(new Date(upcoming.time))):"Date TBA";
    if(isFilm&&upcoming.kind==="film")return`<div class="reminder"><span>🎬 Film Release</span><small>${esc(formatLocalWeekdayDate(new Date(upcoming.time)))}</small></div>`;
    if(upcoming.kind==="episode"){
      const season=item.airingSeason||item.curSeason||"",label=`${season?`S${season} `:""}E${upcoming.number||"Next"}`;
      return`<div class="reminder"><span>📺 ${esc(label)} Next Episode</span><small>${esc(text)}</small></div>`;
    }
    if(upcoming.kind==="season")return`<div class="reminder"><span>🔔 Season ${esc(upcoming.number||"Next")} Premiere</span><small>${esc(text)}</small></div>`;
    return"";
  }
  function titleCardMarkup(item){
    const isFilm=item.type==="Film",trackable=isEpisodeTrackable(item),id=esc(item.id),title=esc(item.title);
    const icon=isFilm?`<svg viewBox="0 0 24 24"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>`:`<svg viewBox="0 0 24 24"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>`;
    const release=isFilm&&item.filmReleaseDate?`${new Date(`${item.filmReleaseDate}T12:00:00`).getTime()>Date.now()?"Releases":"Released"} ${formatLocalDate(item.filmReleaseDate)}`:"";
    const progress=!isFilm&&Number(item.curSeason)===0?"Not started":(!isFilm&&item.curSeason?`S${item.curSeason}${item.curEp!==null&&item.curEp!==undefined&&item.curEp!==""?` E${item.curEp}`:""}`:"");
    const known=!isFilm?knownSeasonTotal(item):0,summary=!isFilm?`${item.watchedSeasons??0} of ${known} seasons fully watched`:"",season=isFilm?release:[progress,summary].filter(Boolean).join(" • ");
    const pct=isFilm?100:Math.min(100,Math.max(0,(Number(item.watchedSeasons||0)/known)*100));
    const status=item.status==="Saved"?"Planned":(item.status||"Planned"),last=trackable?lastLoggedEpisode(item):null;
    const tracking=trackable?`<div class="show-track-status${last?" marked":""}">${last?`✓ S${last.season} E${last.episode} watched · Track episodes`:"Track episodes"}</div>`:"";
    const edit=trackable?`<button type="button" class="show-edit-button" data-edit-item="${id}" title="Edit ${title}" aria-label="Edit ${title}">✎</button>`:"";
    return`<div class="title-item" data-item-id="${id}" role="button" tabindex="0" aria-label="${trackable?`Track episodes for ${title}`:`Edit ${title}`}"><div class="item-row"><div class="item-icon">${icon}</div><div class="item-main"><span class="item-name">${title}</span><div class="item-sub"><span class="item-kind">${esc(item.type||"Series")}</span>${season?`<span class="item-progress-copy">${esc(season)}</span>`:""}</div><div class="platform"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><span>${esc(item.platform||item.type||"")}</span></div>${!isFilm?`<div class="progress"><div style="width:${pct}%"></div></div>`:""}${tracking}</div><div class="item-right"><div class="badge ${esc(status.toLowerCase())}">${esc(status)}</div><span class="item-date">${esc(formatLocalDate(item.date))}</span>${edit}</div><span class="chevron">›</span></div>${reminderMarkup(item,isFilm)}</div>`;
  }
  function render(){
    if(renderFrame){cancelAnimationFrame(renderFrame);renderFrame=0;}
    if(typeof refreshTitleSearchBadges==="function")refreshTitleSearchBadges();
    $("list-toolbar").classList.toggle("hidden",!currentUser||!categoryControlsVisible());
    updateCounts();updateFloatingAddVisibility();renderDashboard();
    if(!currentUser){mediaList.replaceChildren();emptyState.classList.add("hidden");return;}
    const {rows,groups}=currentVisibleMediaRows();emptyState.classList.toggle("hidden",rows.length>0);
    if(currentTab==="library"&&window.WatchLogGallery){
      $("list-label").textContent="Library";
      window.WatchLogGallery.mount(mediaList,rows,{upcoming:upcomingSortInfo,last:item=>isEpisodeTrackable(item)?lastLoggedEpisode(item):null,date:formatLocalDate,dateTime:formatLocalDateTime,reminder:reminderMarkup,edit:openEdit,track:openEpisodeTracker,render,back:()=>{if(currentTab!=="library"){currentTab="library";render();}},artwork:async item=>(await pinApi("catalog_search",{query:item.imdbId||item.title,country:"gb"})).results,items:()=>mediaItems});
      updateEpisodeTracker();return;
    }
    mediaList.classList.remove("gallery-active");
    const groupCounts=new Map();
    if(activeSort==="shows")for(const group of groups.values())groupCounts.set(group.key,(groupCounts.get(group.key)||0)+1);
    let html="",lastGroup="";
    for(const item of rows){
      if(activeSort==="shows"){
        const group=groups.get(String(item.id));
        if(group&&group.key!==lastGroup&&groupCounts.get(group.key)>1)html+=`<div class="show-group-heading">${esc(group.label)}</div>`;
        lastGroup=group?.key||"";
      }
      html+=titleCardMarkup(item);
    }
    mediaList.innerHTML=html;updateEpisodeTracker();
  }
  function scheduleRender(){if(renderFrame)return;renderFrame=requestAnimationFrame(()=>{renderFrame=0;render();});}
  searchInput.oninput=e=>{
    searchQuery=e.target.value;clearTimeout(librarySearchTimer);
    if(normalizeTitle(searchQuery)===renderedLibrarySearch)return;
    librarySearchTimer=setTimeout(()=>{if(normalizeTitle(searchQuery)!==renderedLibrarySearch)scheduleRender();},70);
  };
  function openMediaRow(id){const item=mediaItems.find(row=>String(row.id)===String(id));if(!item)return;if(isEpisodeTrackable(item))openEpisodeTracker(item.id);else openEdit(item.id);}
  mediaList.addEventListener("click",event=>{
    const edit=event.target.closest("[data-edit-item]");if(edit){event.stopPropagation();openEdit(edit.dataset.editItem);return;}
    const row=event.target.closest(".title-item[data-item-id]");if(row)openMediaRow(row.dataset.itemId);
  });
  mediaList.addEventListener("keydown",event=>{
    if(event.target.closest("[data-edit-item]"))return;
    const row=event.target.closest(".title-item[data-item-id]");
    if(row&&(event.key==="Enter"||event.key===" ")){event.preventDefault();openMediaRow(row.dataset.itemId);}
  });
