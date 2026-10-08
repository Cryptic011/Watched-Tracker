/* Library dashboard. Uses the same released/watched episode rules as the tracker. */
function nextWatchEpisode(item){
  if(!isEpisodeTrackable(item))return null;
  const releases=releasedEpisodeMap(item),watched=watchedEpisodeMap(item,releases);
  for(const season of Object.keys(releases).map(Number).sort((a,b)=>a-b)){
    const seen=new Set(watched[season]||[]);
    for(const episode of releases[season]){
      if(!seen.has(episode))return{season,episode};
    }
  }
  return null;
}

function calendarEvents(items,now=new Date()){
  const start=new Date(now);start.setHours(0,0,0,0);
  const end=new Date(start);end.setDate(end.getDate()+7);
  const events=[],unknown=[],seen=new Set();
  for(const item of items){
    let candidates=[];
    if(item.type==='Film')candidates=[{raw:item.filmReleaseDate,label:'Film release'}];
    else if(isEpisodeTrackable(item)){
      candidates=(Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases:[]).map(ep=>({raw:ep.raw,label:`S${ep.season} E${ep.number}`,season:Number(ep.season),episode:Number(ep.number)}));
      if(item.nextEpisodeNum){
        // nextEpisodeNum belongs to nextSeasonNum when a season transition is pending;
        // airingSeason is the season that has already aired and must not label the new episode.
        const scheduled=(Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases:[]).find(ep=>Number(ep.number)===Number(item.nextEpisodeNum)&&String(ep.raw||"")===String(item.nextEpisodeDate||""));
        const nextEpisodeSeason=Number(scheduled?.season||item.nextSeasonNum||item.airingSeason||item.curSeason||0);
        candidates.push({raw:item.nextEpisodeDate,label:`S${nextEpisodeSeason||'?'} E${item.nextEpisodeNum}`,season:nextEpisodeSeason,episode:Number(item.nextEpisodeNum)});
      }
      if(item.nextSeasonNum&&!candidates.some(e=>e.season===Number(item.nextSeasonNum)&&e.episode===1))candidates.push({raw:item.nextSeasonDate,label:`Season ${item.nextSeasonNum}`});
    }
    const undated=[];
    for(const candidate of candidates){
      if(!candidate.raw){undated.push(candidate);continue;}
      const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(candidate.raw);
      const date=new Date(dateOnly?`${candidate.raw}T12:00:00`:candidate.raw);
      if(!Number.isFinite(date.getTime()))continue;
      if(date<start||date>=end)continue;
      const key=`${item.id}:${candidate.label}:${localISODate(date)}`;
      if(seen.has(key))continue;seen.add(key);
      events.push({...candidate,item,date,dateOnly});
    }
    // Watch status describes the user's intent, never release availability.
    // Only an explicit unreleased episode/season or a future release year
    // supports an announcement. Missing metadata alone is not a TBA release.
    const releases=isEpisodeTrackable(item)?releasedEpisodeMap(item):{};
    const announcements=undated.filter(candidate=>{
      if(item.type==='Film')return false;
      if(candidate.episode)return !(releases[candidate.season]||[]).includes(candidate.episode);
      return !Object.keys(releases).some(season=>Number(season)>=Number(item.nextSeasonNum));
    }).map(candidate=>candidate.label);
    if(!announcements.length&&Number(item.releaseYear)>now.getFullYear()&&
      !Object.values(releases).some(episodes=>episodes.length)&&
      !(item.type==='Film'?item.filmReleaseDate:item.seriesReleaseDate)&&
      !candidates.some(candidate=>candidate.raw))announcements.push(item.type==='Film'?'Film release':'Series premiere');
    if(announcements.length)unknown.push({...item,announcement:[...new Set(announcements)].join(' / ')});
  }
  return{start,end,events:events.sort((a,b)=>a.date-b.date||a.item.title.localeCompare(b.item.title)),unknown};
}

function updateDashboardMarkup(root,markup){
  // Keep focus and expanded sections when a save/metadata refresh changes nothing.
  if(root._dashboardMarkup===markup)return;
  const expanded=new Set([...root.querySelectorAll('details[data-dashboard-section][open]')].map(node=>node.dataset.dashboardSection));
  root.innerHTML=markup;root._dashboardMarkup=markup;
  for(const node of root.querySelectorAll('details[data-dashboard-section]'))node.open=expanded.has(node.dataset.dashboardSection);
}

function renderDashboard(){
  const root=document.getElementById('library-dashboard');if(!root)return;
  const visible=Boolean(currentUser&&currentTab==='library'&&!categoryControlsVisible()&&!searchQuery.trim());
  root.classList.toggle('hidden',!visible);if(!visible){root.replaceChildren();root._dashboardMarkup=null;return;}
  const {start,events,unknown}=calendarEvents(mediaItems);
  const eventsByDay=new Map();
  for(const event of events){const key=localISODate(event.date);if(!eventsByDay.has(key))eventsByDay.set(key,[]);eventsByDay.get(key).push(event);}
  let days='';
  for(let offset=0;offset<7;offset++){
    const date=new Date(start);date.setDate(date.getDate()+offset);
    const key=localISODate(date),rows=eventsByDay.get(key)||[];
    const dayLabel=offset===0?'Today':offset===1?'Tomorrow':date.toLocaleDateString(USER_LOCALE,{weekday:'long'});
    const dateLabel=date.toLocaleDateString(USER_LOCALE,{day:'numeric',month:'short'});
    // Group episodes of the same title airing at the same time into one compact card.
    const grouped=[];
    for(const event of rows){
      const time=event.dateOnly?'Time TBA':event.date.toLocaleTimeString(USER_LOCALE,{hour:'2-digit',minute:'2-digit'});
      const groupKey=[event.item.id,time,event.item.platform||'',event.dateOnly?'date':'time'].join('|');
      let group=grouped.find(row=>row.key===groupKey);
      if(!group){group={key:groupKey,item:event.item,time,dateOnly:event.dateOnly,events:[]};grouped.push(group);}
      if(!group.events.some(existing=>existing.label===event.label))group.events.push(event);
    }
    days+=`<section class="release-day${rows.length?' has-releases':' is-empty'}" aria-label="${esc(dayLabel)}, ${esc(dateLabel)}">
      <header class="release-day-heading"><div><span class="release-day-name">${esc(dayLabel)}</span><span class="release-day-date">${esc(dateLabel)}</span></div><span class="release-day-count">${rows.length} ${rows.length===1?'release':'releases'}</span></header>
      ${grouped.length?grouped.map(group=>{
        const labels=group.events.map(event=>event.label);
        const episodeLabel=labels.length>1&&labels.every(label=>/^S\d+ E\d+$/.test(label))
          ?labels[0].match(/^S(\d+) E/)[0].replace(' E','')+' E'+labels.map(label=>Number(label.match(/E(\d+)/)[1])).join(', ')
          :labels.join(' · ');
        const platform=group.item.platform?esc(group.item.platform):'Platform not saved';
        return `<button type="button" class="release-card" data-dashboard-open="${esc(group.item.id)}">
          <span class="release-time">${esc(group.time)}</span>
          <span class="release-card-copy"><strong>${esc(group.item.title)}</strong><span class="release-episode">${esc(episodeLabel)}</span><span class="release-platform"><span class="release-platform-dot" aria-hidden="true"></span>${platform}</span></span>
          <span class="release-chevron" aria-hidden="true">›</span>
        </button>`;
      }).join(''):'<p class="release-empty">Nothing listed for this day</p>'}
    </section>`;
  }
  updateDashboardMarkup(root,`<section class="dashboard-section weekly-releases" aria-labelledby="weekly-releases-title">
    <header class="weekly-releases-heading"><div><span class="weekly-eyebrow">YOUR SCHEDULE</span><h2 id="weekly-releases-title">This week’s releases</h2><p class="dashboard-note">Today and the next six days · local times</p></div><span class="weekly-total">${events.length}<small>releases</small></span></header>
    <div class="release-week-list">${days}</div>
    ${unknown.length?`<details class="release-tba" data-dashboard-section="unknown"><summary><span>Dates to be announced</span><span class="release-tba-count">${unknown.length}</span></summary><div class="release-tba-list">${unknown.map(item=>`<button type="button" class="release-tba-item" data-dashboard-open="${esc(item.id)}"><strong>${esc(item.title)}</strong><span>${esc(item.announcement)} · Date TBA</span><span class="release-chevron" aria-hidden="true">›</span></button>`).join('')}</div></details>`:''}
    <p class="weekly-footnote">Broadcast and listed film dates may differ from UK streaming availability.</p>
  </section>`);
}
document.getElementById('library-dashboard').addEventListener('click',event=>{
  const watch=event.target.closest('[data-dashboard-watch]');
  if(watch){
    const item=mediaItems.find(row=>String(row.id)===watch.dataset.dashboardWatch),next=item&&nextWatchEpisode(item);
    if(next&&next.season===Number(watch.dataset.season)&&next.episode===Number(watch.dataset.episode))void toggleEpisodeWatched(item.id,next.season,next.episode);
    return;
  }
  const open=event.target.closest('[data-dashboard-open]');if(open)openMediaRow(open.dataset.dashboardOpen);
});

async function refreshPrivateReminderHistory(){
  const panel=document.getElementById('private-reminder-history'),body=document.getElementById('reminder-history-body');
  const token=cloudSessionToken,accountId=currentUser?.id;
  if(!token||!accountId){panel.classList.add('hidden');return;}
  const hash=await sha256(`watchlog-notification-test:${normalizeEmail(currentProfile?.email||'')}`);
  if(token!==cloudSessionToken||accountId!==currentUser?.id||hash!==NOTIFICATION_TEST_ACCOUNT_HASH){panel.classList.add('hidden');return;}
  panel.classList.remove('hidden');
  try{
    const result=await reminderApi('private_history',{},token);
    if(token!==cloudSessionToken||accountId!==currentUser?.id)return;
    const status=row=>row.status==='sent'?'Accepted by push service':['retry','expired'].includes(row.status)&&row.attempts>=5?'Failed — retries exhausted':({retry:'Retry pending',pending:'Pending',expired:'Expired',failed:'Failed'}[row.status]||row.status);
    const history=(result.history||[]).map(row=>`<div class="dashboard-row"><div><strong>${esc(row.title||'Removed title')}</strong><small>${esc(row.label||'Reminder')} · ${esc(status(row))}</small><small>${esc(formatLocalDateTime(row.sent_at||row.scheduled_for))} · ${Number(row.attempts)||0} attempt(s)</small>${row.last_error?`<small>${esc(row.last_error)}</small>`:''}</div></div>`).join('');
    const upcoming=(result.upcoming||[]).map(row=>`<div class="dashboard-row"><div><strong>${esc(row.title)}</strong><small>${esc(row.label)} · ${esc(formatLocalDateTime(row.scheduled_for))}</small></div></div>`).join('');
    body.innerHTML=`<p class="dashboard-note">${result.enabledDevices} enabled device(s). A successful send means the push service accepted it; phone delivery is not confirmed.</p><h3>Upcoming reminders</h3>${upcoming||'<p>No scheduled reminders for enabled devices in the next seven days.</p>'}<h3>Recent activity</h3>${history||'<p>No reminder attempts recorded yet.</p>'}`;
  }catch(error){if(token===cloudSessionToken&&accountId===currentUser?.id)body.textContent=error.message||'Could not load reminder history.';}
}
document.getElementById('refresh-reminder-history').onclick=async()=>{const dialog=document.getElementById('reminder-history-dialog'),body=document.getElementById('reminder-history-body');body.textContent='Loading reminder activity…';dialog.showModal();await refreshPrivateReminderHistory();};
document.getElementById('close-reminder-history').onclick=()=>document.getElementById('reminder-history-dialog').close();
