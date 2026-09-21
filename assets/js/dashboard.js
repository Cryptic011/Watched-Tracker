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
      if(item.nextEpisodeNum)candidates.push({raw:item.nextEpisodeDate,label:`S${item.airingSeason||item.nextSeasonNum||'?'} E${item.nextEpisodeNum}`,season:Number(item.airingSeason||item.nextSeasonNum),episode:Number(item.nextEpisodeNum)});
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
    const rows=eventsByDay.get(localISODate(date))||[];
    days+=`<div class="calendar-day"><h3>${esc(offset===0?'Today':date.toLocaleDateString(USER_LOCALE,{weekday:'short',day:'numeric',month:'short'}))}</h3>${rows.length?rows.map(event=>`<button type="button" class="dashboard-title" data-dashboard-open="${esc(event.item.id)}"><strong>${esc(event.item.title)}</strong><small>${esc(event.label)} · ${event.dateOnly?'Time TBA':esc(event.date.toLocaleTimeString(USER_LOCALE,{hour:'2-digit',minute:'2-digit'}))}</small><small>${esc(event.item.platform?`Saved platform: ${event.item.platform}`:'UK availability not confirmed')}</small></button>`).join(''):'<p>No listed releases</p>'}</div>`;
  }
  updateDashboardMarkup(root,`<details class="dashboard-section" data-dashboard-section="calendar"><summary>This week’s releases</summary><p class="dashboard-note">Today and the next six days. Times are local; broadcast and listed film dates may differ from UK streaming availability.</p>${days}${unknown.length?`<details data-dashboard-section="unknown"><summary>Dates to be announced (${unknown.length})</summary>${unknown.map(item=>`<button type="button" class="dashboard-title" data-dashboard-open="${esc(item.id)}">${esc(item.title)} · ${esc(item.announcement)} · Date TBA</button>`).join('')}</details>`:''}</details>`);
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
