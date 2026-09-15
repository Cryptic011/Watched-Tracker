/* Library presentation only. All progress, edits and reminders use the existing app. */
window.WatchLogGallery=(()=>{
  let category='',api=null,host=null,observer=null,dialog=null,active=0;
  const cache=new Map(),pending=new Set(),queue=[];
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isFilm=item=>item.type==='Film';
  const key=item=>`${item.type}:${item.imdbId||item.tvmazeShowId||item.id}`;
  const safeImage=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(/(^|\.)media-amazon\.com$|(^|\.)tvmaze\.com$/.test(u.hostname))?u.href:'';}catch{return '';}};
  function applyImage(img,url){if(!url)return;img.onload=()=>{img.hidden=false;};img.onerror=()=>{img.hidden=true;};img.src=url;}
  async function fetchArt(item){
    const signal=AbortSignal.timeout(6500);
    if(!isFilm(item)&&/^\d+$/.test(String(item.tvmazeShowId||''))){
      try{const response=await fetch(`https://api.tvmaze.com/shows/${item.tvmazeShowId}`,{signal});
        if(response.ok){const show=await response.json();if(!item.imdbId||show.externals?.imdb===item.imdbId)return safeImage(show.image?.original||show.image?.medium);}
      }catch(_){/* Try the IMDb source below. */}
    }
    const query=encodeURIComponent(String(item.title||'').trim());if(!query)return '';
    try{const response=await fetch(`https://v3.sg.media-imdb.com/suggestion/titles/x/${query}.json`,{signal});
      if(response.ok){const data=await response.json(),match=data.d?.find(row=>row.id===item.imdbId)||data.d?.find(row=>String(row.l||'').toLowerCase()===String(item.title||'').toLowerCase());const image=safeImage(match?.i?.imageUrl);if(image)return image;}
    }catch(_){/* Keep a readable local teaser poster. */}
    return '';
  }
  function pump(){while(active<3&&queue.length){const item=queue.shift(),id=key(item);active++;fetchArt(item).catch(()=>'').then(url=>{
    cache.set(id,url);if(cache.size>250)cache.delete(cache.keys().next().value);
    document.querySelectorAll('.gallery-art img').forEach(img=>{if(img.dataset.art===id)applyImage(img,url);});
  }).finally(()=>{active--;pending.delete(id);pump();});}}
  function observe(root,items){
    if(typeof IntersectionObserver==='undefined')return;
    const byKey=new Map(items.map(item=>[key(item),item]));
    if(!observer)observer=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const img=entry.target;observer.unobserve(img);const item=img._galleryItem;if(!item)continue;const id=key(item);if(cache.has(id)){applyImage(img,cache.get(id));continue;}if(!pending.has(id)){pending.add(id);queue.push(item);pump();}}},{rootMargin:'160px'});
    root.querySelectorAll('[data-art]').forEach(img=>{img._galleryItem=byKey.get(img.dataset.art);if(cache.has(img.dataset.art))applyImage(img,cache.get(img.dataset.art));else observer.observe(img);});
  }
  function art(item,badge=''){
    const initials=String(item.title||'?').split(/\s+/).slice(0,2).map(s=>s[0]).join('');
    return `<div class="gallery-art"><span aria-hidden="true">${esc(initials)}</span><div class="gallery-art-title">${esc(item.title||'Untitled')}</div><div class="gallery-art-meta">${esc(isFilm(item)?'FILM':'SERIES')} · ${esc(item.releaseYear||'WATCHED LOGGER')}</div><img hidden alt="" data-art="${esc(key(item))}" decoding="async">${badge}</div>`;
  }
  function releaseTime(item){const value=isFilm(item)?item.filmReleaseDate:item.seriesReleaseDate;const time=Date.parse(value||'');return Number.isFinite(time)?time:0;}
  function releasedByYear(item,now){return /^\d{4}$/.test(String(item.releaseYear||''))&&Number(item.releaseYear)<new Date(now).getFullYear();}
  function sections(items,upcoming,now=Date.now()){
    const future=items.filter(item=>upcoming(item).rank>0).sort((a,b)=>upcoming(a).time-upcoming(b).time);
    const released=items.filter(item=>releaseTime(item)>0?releaseTime(item)<=now:releasedByYear(item,now)||!isFilm(item)&&Object.values(item.releasedEpisodes||{}).some(a=>a.length));
    const used=new Set([...future,...released].map(item=>item.id));
    return {future,released,remaining:items.filter(item=>!used.has(item.id))};
  }
  function tile(item,upcoming=false){
    const last=api.last(item),event=api.upcoming(item);
    const badge=last?`<span class="gallery-state done">✓ S${esc(last.season)} E${esc(last.episode)}</span>`:`<span class="gallery-state">${esc(item.status==='Saved'?'Planned':item.status||'Planned')}</span>`;
    let subtitle=releaseTime(item)?api.date(new Date(releaseTime(item))):item.releaseYear||'Date unknown';
    if(upcoming){const label=event.kind==='episode'?`S${item.airingSeason||item.curSeason||'?'} E${event.number||'?'}`:event.kind==='season'?`Season ${event.number||'?'}`:'Film release';subtitle=`${label} · ${event.rank===2?api.dateTime(new Date(event.time)):'Date TBA'}`;}
    return `<button type="button" class="gallery-tile" data-gallery-item="${esc(item.id)}" aria-label="Open ${esc(item.title)}">${art(item,badge)}<strong>${esc(item.title)}</strong><small>${esc(subtitle)}</small></button>`;
  }
  function section(title,items,carousel=false){return items.length?`<section class="gallery-section"><h3>${title}</h3><div class="${carousel?'gallery-carousel':'gallery-grid'}">${items.map(item=>tile(item,carousel)).join('')}</div></section>`:'';}
  function detail(item){
    if(!dialog){dialog=document.createElement('dialog');dialog.className='gallery-detail';dialog.setAttribute('aria-label','Title details');document.body.append(dialog);dialog.addEventListener('click',event=>{if(event.target===dialog||event.target.closest('[data-gallery-close]'))dialog.close();});dialog.addEventListener('close',()=>{host?.querySelector(`[data-gallery-item="${CSS.escape(dialog.dataset.item||'')}"]`)?.focus();});}
    dialog.dataset.item=String(item.id);
    const show=!isFilm(item),last=api.last(item),progress=show?`<strong>Your progress</strong>${last?`Watched through S${esc(last.season)} E${esc(last.episode)}`:'No episodes marked watched'}<br>${esc(item.watchedSeasons||0)} fully watched seasons`:'';
    dialog.innerHTML=`<header class="gallery-detail-header"><h2>${esc(item.title)}</h2><button type="button" class="gallery-back" data-gallery-close aria-label="Close details">×</button></header><div class="gallery-detail-body">${art(item)}<div class="gallery-detail-copy"><strong>${esc(item.status||'Planned')}</strong>${progress}${item.platform?`<strong>Where you watched it</strong>${esc(item.platform)}`:''}</div>${api.reminder(item,isFilm(item))}<div class="gallery-detail-actions">${show?'<button class="btn btn-primary btn-full" type="button" data-gallery-track>Track episodes</button>':''}<button class="btn btn-secondary btn-full" type="button" data-gallery-edit>Edit details & platforms</button></div></div>`;
    dialog.querySelector('[data-gallery-edit]').onclick=()=>{dialog.close();api.edit(item.id);};
    const track=dialog.querySelector('[data-gallery-track]');if(track)track.onclick=()=>{dialog.close();api.track(item.id);};
    observe(dialog,[item]);dialog.showModal();
  }
  function mount(element,rows,callbacks){
    host=element;api=callbacks;observer?.disconnect();host.classList.add('gallery-active');
    if(!host._galleryEvents){host._galleryEvents=true;host.addEventListener('click',event=>{
      const cat=event.target.closest('[data-gallery-category]');if(cat){category=cat.dataset.galleryCategory;api.render();host.querySelector('.gallery-back')?.focus();return;}
      if(event.target.closest('[data-gallery-back]')){category='';api.render();host.querySelector('.gallery-category')?.focus();return;}
      const target=event.target.closest('[data-gallery-item]');if(target){const item=api.items().find(row=>String(row.id)===target.dataset.galleryItem);if(item)detail(item);}
    });}
    if(!category){host.innerHTML=`<div class="gallery-home">${[['Film','Films','▤'],['Series','Series','▣']].map(([type,label,icon])=>{
      const items=rows.filter(item=>type==='Film'?isFilm(item):!isFilm(item));return `<button type="button" class="gallery-category" data-gallery-category="${type}"><span class="gallery-category-icon" aria-hidden="true">${icon}</span><span><strong>${label}</strong><small>${items.length} title${items.length===1?'':'s'}</small></span><span class="gallery-fan" aria-hidden="true">${items.slice(0,3).map(item=>art(item)).join('')}</span></button>`;
    }).join('')}</div><p class="gallery-caption">${rows.length} titles in this view</p>`;}
    else{const items=rows.filter(item=>category==='Film'?isFilm(item):!isFilm(item)),parts=sections(items,api.upcoming);host.innerHTML=`<div class="gallery-nav"><button type="button" class="gallery-back" data-gallery-back aria-label="Back to Library">‹</button><h2>${category==='Film'?'Films':'Series'}</h2></div>${section('Upcoming',parts.future,true)}${section('Released',parts.released)}${section('Other titles',parts.remaining)}${items.length?'':'<p class="gallery-empty">No titles match your search or filter.</p>'}`;}
    observe(host,rows);
  }
  return {mount,sections};
})();
