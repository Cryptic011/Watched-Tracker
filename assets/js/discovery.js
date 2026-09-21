  // Catalogue discovery shares the existing search and editor; it never writes
  // a library record until the user saves through the normal editor.
  let discoveryRows=[],discoveryFilter="All",discoveryQuery="",discoveryOwner="";
  let discoveryRequest=0,discoveryController=null,discoveryTimer=null,discoveryLoading=false,discoveryError=false;
  let discoveryDetailItem=null,discoveryReturnFocus=null;
  const discoveryDescriptionCache=new Map();
  const discoveryInput=$("discovery-query"),discoveryResults=$("discovery-results"),discoveryStatus=$("discovery-status"),discoveryDialog=$("discovery-detail");

  function discoveryImage(value){
    try{const url=new URL(value);return url.protocol==="https:"&&(/^(?:static\.tvmaze\.com|m\.media-amazon\.com|images-na\.ssl-images-amazon\.com)$/.test(url.hostname)||/^[a-z0-9.-]+\.mzstatic\.com$/.test(url.hostname))?url.href:"";}catch(_){return"";}
  }
  function discoveryDescription(item){
    const entities={amp:"&",quot:'"',apos:"'",lt:"<",gt:">",nbsp:" "};
    return String(item.description||"").replace(/<[^>]*>/g," ").replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|quot|apos|lt|gt|nbsp));/gi,(whole,decimal,hex,name)=>{
      if(name)return entities[name.toLowerCase()];
      const code=parseInt(decimal||hex,decimal?10:16);return code>0&&code<=0x10ffff?String.fromCodePoint(code):whole;
    }).replace(/\s+/g," ").trim();
  }
  function discoveryDuplicate(item){
    return findTrackedDuplicate({title:item.title,type:item.format,imdbId:item.imdbId||(item.source==="imdb"?item.externalId:""),tvmazeShowId:item.tvmazeId||(item.source==="tvmaze"?item.externalId:""),releaseYear:item.year});
  }
  function discoveryAttribution(item){
    return /^https:\/\/en\.wikipedia\.org\/wiki\//.test(item.descriptionUrl||"")?`<a class="discovery-source" href="${esc(item.descriptionUrl)}" target="_blank" rel="noopener noreferrer">Description from Wikipedia</a>`:"";
  }
  function discoveryPoster(item){
    const image=discoveryImage(item.posterUrl),initials=String(item.title||"?").split(/\s+/).slice(0,2).map(word=>word[0]).join("");
    return `<span class="discovery-poster"><span aria-hidden="true">${esc(initials)}</span>${image?`<img src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:""}</span>`;
  }
  function discoveryCard(item,index){
    const description=discoveryDescription(item),duplicate=discoveryDuplicate(item),meta=[item.year,item.format,item.detail&&!/^(?:film|series|tv series|tvseries)$/i.test(item.detail)?item.detail:""].filter(Boolean).join(" · ");
    return `<article class="discovery-card" data-discovery-row="${index}"><button type="button" class="discovery-poster-button" data-discovery-open="${index}" aria-label="Details for ${esc(item.title)}">${discoveryPoster(item)}</button><div class="discovery-copy"><button type="button" class="discovery-title" data-discovery-open="${index}">${esc(item.title)}</button><p class="discovery-meta">${esc(meta)}</p>${description?`<details class="discovery-description"><summary aria-label="Description of ${esc(item.title)}"><span class="discovery-preview">${esc(description)}</span><span class="discovery-more" aria-hidden="true"></span></summary><p>${esc(description)}</p>${discoveryAttribution(item)}</details>`:'<p class="discovery-unavailable">Description unavailable.</p>'}<div class="discovery-actions"><span class="discovery-added${duplicate?"":" hidden"}" data-discovery-badge="${index}">✓ Already added</span><button type="button" data-discovery-add="${index}">${duplicate?"View in library":"+ Add"}</button></div></div></article>`;
  }
  function wireDiscoveryImages(root){
    root.querySelectorAll(".discovery-poster img").forEach(img=>img.addEventListener("error",()=>{img.hidden=true;},{once:true}));
  }
  function renderTitleSearch(){
    $("discovery-browse")?.classList.toggle("hidden",discoveryQuery.length>=2);
    const expanded=new Set([...discoveryResults.querySelectorAll("[data-discovery-row]")].filter(row=>row.querySelector("details")?.open).map(row=>row.dataset.discoveryRow));
    const visible=discoveryRows.map((item,index)=>({item,index})).filter(({item})=>["Film","Series"].includes(item.format)&&(discoveryFilter==="All"||item.format===discoveryFilter));
    discoveryResults.innerHTML=visible.map(({item,index})=>discoveryCard(item,index)).join("");
    discoveryResults.querySelectorAll("[data-discovery-row]").forEach(row=>{if(expanded.has(row.dataset.discoveryRow)&&row.querySelector("details"))row.querySelector("details").open=true;});
    discoveryResults.setAttribute("aria-busy",String(discoveryLoading));wireDiscoveryImages(discoveryResults);
    $("discovery-retry").classList.toggle("hidden",!discoveryError);
    document.querySelectorAll("[data-discovery-filter]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.discoveryFilter===discoveryFilter)));
    discoveryStatus.textContent=discoveryLoading?"Searching shows and films…":discoveryError?"Search is unavailable right now. Please try again.":discoveryQuery.length<2?"Enter at least two characters to search.":visible.length?`${visible.length} result${visible.length===1?"":"s"} for “${discoveryQuery}”`:"No matching titles. Try another spelling or choose All.";
  }
  function pauseTitleSearch(){
    clearTimeout(discoveryTimer);discoveryTimer=null;discoveryController?.abort();discoveryController=null;discoveryRequest++;discoveryLoading=false;
    if(discoveryDialog.open)discoveryDialog.close();
  }
  function resetTitleSearch(){
    pauseTitleSearch();discoveryRows=[];discoveryQuery="";discoveryOwner=String(currentUser?.id||"");discoveryInput.value="";discoveryFilter="All";discoveryError=false;discoveryDetailItem=null;
    discoveryResults.replaceChildren();$("discovery-detail-body").replaceChildren();
  }
  function activateTitleSearch(){
    if(discoveryOwner!==String(currentUser?.id||""))resetTitleSearch();
    renderTitleSearch();
    if(discoveryInput.value.trim().length>=2&&!discoveryRows.length)void runTitleSearch();
  }
  function openTitleSearch(){
    switchTab("search");discoveryInput.focus();
  }
  async function runTitleSearch(){
    clearTimeout(discoveryTimer);discoveryController?.abort();
    const query=discoveryInput.value.trim(),request=++discoveryRequest,owner=String(currentUser?.id||"");
    discoveryQuery=query;discoveryError=false;
    if(!currentUser||query.length<2){discoveryRows=[];discoveryLoading=false;renderTitleSearch();return;}
    const controller=new AbortController();discoveryController=controller;discoveryLoading=true;renderTitleSearch();
    const isCurrent=()=>request===discoveryRequest&&currentTab==="search"&&String(currentUser?.id||"")===owner&&discoveryInput.value.trim()===query;
    try{
      const rows=await searchAllTitles(query,{signal:controller.signal,isCurrent,onProgress:partial=>{
        if(isCurrent()){discoveryRows=partial;renderTitleSearch();}
      }});
      if(isCurrent()){
        discoveryRows=rows;discoveryLoading=false;renderTitleSearch();
        await enrichDiscoveryDescriptions(controller.signal,isCurrent);
      }
    }catch(error){
      if(isCurrent()&&!controller.signal.aborted){discoveryLoading=false;discoveryError=true;renderTitleSearch();}
    }finally{if(discoveryController===controller)discoveryController=null;}
  }
  async function fetchDiscoveryDescription(item,signal){
    const imdbId=String(item.imdbId||(item.source==="imdb"?item.externalId:"")||"");
    if(item.format!=="Film"||!/^tt\d+$/.test(imdbId))return"";
    if(discoveryDescriptionCache.has(imdbId)){const cached=discoveryDescriptionCache.get(imdbId);item.descriptionUrl=cached.url;return cached.description;}
    const request=async(base,params)=>{
      const url=new URL(base);Object.entries({...params,format:"json",origin:"*"}).forEach(([key,value])=>url.searchParams.set(key,String(value)));
      const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(6000)])});
      if(!response.ok)throw Error("Description unavailable");return response.json();
    };
    const search=await request("https://www.wikidata.org/w/api.php",{action:"wbsearchentities",search:item.title,language:"en",type:"item",limit:6});
    const ids=(search.search||[]).map(row=>row.id).filter(id=>/^Q\d+$/.test(id));if(!ids.length)return"";
    const data=await request("https://www.wikidata.org/w/api.php",{action:"wbgetentities",ids:ids.join("|"),props:"claims|sitelinks",sitefilter:"enwiki"});
    // Never borrow a synopsis from a same-name remake. Require the exact IMDb
    // identity before following that entity's English Wikipedia article.
    const entity=Object.values(data.entities||{}).find(row=>(row.claims?.P345||[]).some(claim=>claim.rank!=="deprecated"&&claim.mainsnak?.datavalue?.value===imdbId));
    const title=entity?.sitelinks?.enwiki?.title;if(!title)return"";
    const article=await request("https://en.wikipedia.org/w/api.php",{action:"query",prop:"extracts",exintro:1,explaintext:1,titles:title,redirects:1});
    const description=String(Object.values(article.query?.pages||{}).find(page=>page.missing===undefined)?.extract||"").slice(0,8000);
    if(description){item.descriptionUrl="https://en.wikipedia.org/wiki/"+encodeURIComponent(title.replace(/ /g,"_"));discoveryDescriptionCache.set(imdbId,{description,url:item.descriptionUrl});if(discoveryDescriptionCache.size>80)discoveryDescriptionCache.delete(discoveryDescriptionCache.keys().next().value);}
    return description;
  }
  async function enrichDiscoveryDescriptions(signal,isCurrent){
    const queue=discoveryRows.filter(item=>item.format==="Film"&&!discoveryDescription(item)).slice(0,6);
    await Promise.all([0,1].map(async()=>{
      while(queue.length&&isCurrent()&&!signal.aborted){
        const item=queue.shift();
        try{
          const description=await fetchDiscoveryDescription(item,signal);
          if(description&&isCurrent()){
            item.description=description;item.descriptionSource="Wikipedia";renderTitleSearch();
            if(discoveryDialog.open&&discoveryDetailItem===item){
              const paragraph=$("discovery-detail-body").querySelector(".discovery-full-description");if(paragraph){paragraph.textContent=description;const citation=document.createElement("p");citation.innerHTML=discoveryAttribution(item);paragraph.after(citation);}
            }
          }
        }catch(_){} // Missing metadata must not prevent selecting or adding.
      }
    }));
  }
  function refreshTitleSearchBadges(){
    if(discoveryOwner!==String(currentUser?.id||"")){resetTitleSearch();return;}
    if(currentTab!=="search")return;
    discoveryResults.querySelectorAll("[data-discovery-row]").forEach(row=>{
      const item=discoveryRows[Number(row.dataset.discoveryRow)];if(!item)return;
      const duplicate=discoveryDuplicate(item);
      row.querySelector("[data-discovery-badge]").classList.toggle("hidden",!duplicate);
      row.querySelector("[data-discovery-add]").textContent=duplicate?"View in library":"+ Add";
    });
  }
  function addDiscoveryTitle(item){
    if(!item||!currentUser)return;
    if(discoveryDialog.open)discoveryDialog.close();
    const duplicate=discoveryDuplicate(item);
    if(duplicate){void openEdit(duplicate.id);return;}
    openAdd();void selectSuggestion(item);
  }
  function showDiscoveryDetail(item,trigger){
    if(!item)return;discoveryDetailItem=item;discoveryReturnFocus=trigger;
    $("discovery-detail-title").textContent=item.title;
    $("discovery-detail-body").innerHTML=`<div class="discovery-detail-intro">${discoveryPoster(item)}<div><p class="discovery-meta">${esc([item.year,item.format,item.detail].filter(Boolean).join(" · "))}</p>${discoveryDuplicate(item)?'<p class="discovery-added">✓ Already added</p>':""}</div></div><p class="discovery-full-description">${esc(discoveryDescription(item)||"A description isn’t available for this title yet.")}</p>${discoveryAttribution(item)}<button type="button" class="btn btn-primary btn-full" id="discovery-detail-add">${discoveryDuplicate(item)?"View in library":"Add to library"}</button>`;
    wireDiscoveryImages($("discovery-detail-body"));
    $("discovery-detail-add").onclick=()=>addDiscoveryTitle(discoveryDetailItem);
    discoveryDialog.showModal();
  }
  discoveryInput.addEventListener("input",()=>{
    clearTimeout(discoveryTimer);discoveryController?.abort();discoveryRequest++;discoveryRows=[];discoveryQuery=discoveryInput.value.trim();discoveryError=false;
    discoveryLoading=discoveryQuery.length>=2;renderTitleSearch();
    if(discoveryLoading)discoveryTimer=setTimeout(()=>void runTitleSearch(),280);
  });
  $("discovery-form").addEventListener("submit",event=>{event.preventDefault();void runTitleSearch();});
  $("discovery-retry").onclick=()=>void runTitleSearch();
  document.querySelectorAll("[data-browse-format]").forEach(button=>button.onclick=()=>{discoveryFilter=button.dataset.browseFormat;renderTitleSearch();discoveryInput.placeholder=discoveryFilter==="Film"?"Search movies":"Search series";discoveryInput.focus();});
  $("discovery-manual").onclick=()=>{if(!currentUser)return;openAdd();titleInput.value=discoveryInput.value.trim();titleInput.focus();};
  document.querySelectorAll("[data-discovery-filter]").forEach(button=>button.onclick=()=>{discoveryFilter=button.dataset.discoveryFilter;renderTitleSearch();});
  discoveryResults.addEventListener("click",event=>{
    const add=event.target.closest("[data-discovery-add]");if(add){addDiscoveryTitle(discoveryRows[Number(add.dataset.discoveryAdd)]);return;}
    const open=event.target.closest("[data-discovery-open]");if(open)showDiscoveryDetail(discoveryRows[Number(open.dataset.discoveryOpen)],open);
  });
  $("discovery-close").onclick=()=>discoveryDialog.close();
  discoveryDialog.addEventListener("click",event=>{if(event.target===discoveryDialog)discoveryDialog.close();});
  discoveryDialog.addEventListener("close",()=>{if(discoveryReturnFocus?.isConnected)discoveryReturnFocus.focus();discoveryReturnFocus=null;});
