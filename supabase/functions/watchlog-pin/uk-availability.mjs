const cache = new Map();
const TTL = 60 * 60 * 1000;
const cleanTitle = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function ukProviders(payload) {
  const region = payload?.results?.GB;
  const providers = new Map();
  for (const [kind, label] of Object.entries({flatrate:'Subscription',free:'Free',ads:'With adverts',rent:'Rent',buy:'Buy'})) {
    for (const provider of region?.[kind] || []) {
      if (!provider?.provider_name || !Number.isSafeInteger(provider.provider_id)) continue;
      const row = providers.get(provider.provider_id) || {name:provider.provider_name,types:[]};
      if (!row.types.includes(label)) row.types.push(label);
      providers.set(provider.provider_id,row);
    }
  }
  return [...providers.values()].sort((a,b)=>a.name.localeCompare(b.name,'en-GB'));
}

export async function getTMDBAvailability(input, token, request = fetch) {
  if (!token) return {state:'unconfigured',providers:[]};
  const type = input.type === 'Film' ? 'movie' : input.type === 'Game' ? null : 'tv';
  if (!type) return {state:'unsupported',providers:[]};
  const title = String(input.title || '').trim().slice(0,160);
  const imdb = /^tt\d{5,12}$/.test(String(input.imdbId || '')) ? input.imdbId : '';
  const year = /^\d{4}$/.test(String(input.year || '')) ? String(input.year) : '';
  if (!title && !imdb) return {state:'unmatched',providers:[]};
  const key = JSON.stringify([type,imdb,cleanTitle(title),year]);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const get = async path => {
    const response = await request('https://api.themoviedb.org/3/'+path, {
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(6000)
    });
    if (!response.ok) throw new Error('Availability provider request failed');
    return response.json();
  };
  let candidates;
  if (imdb) {
    const data = await get('find/'+imdb+'?external_source=imdb_id');
    candidates = data[type+'_results'] || [];
  } else {
    const data = await get('search/'+type+'?language=en-GB&query='+encodeURIComponent(title)+'&include_adult=false');
    candidates = (data.results || []).filter(row=>cleanTitle(row.title || row.name)===cleanTitle(title) && (!year || String(row.release_date || row.first_air_date || '').slice(0,4)===year));
  }
  if (candidates.length!==1 || !Number.isSafeInteger(candidates[0].id)) return {state:'unmatched',providers:[]};
  const data = await get(type+'/'+candidates[0].id+'/watch/providers');
  if (!data.results || typeof data.results!=='object') throw new Error('Incomplete availability response');
  const providers = ukProviders(data);
  const rawLink = data.results.GB?.link || '';
  const link = /^https:\/\/www\.themoviedb\.org\//.test(rawLink) ? rawLink : '';
  const value = {state:providers.length?'available':'none',providers,link,checkedAt:new Date().toISOString()};
  if (cache.size>=300) cache.delete(cache.keys().next().value);
  cache.set(key,{value,expires:Date.now()+TTL});
  return value;
}

export async function getJustWatchAvailability(input, request = fetch) {
  if(input.type==='Game')return {state:'unsupported',providers:[]};
  const title=String(input.title||'').trim().slice(0,160);
  if(!title)return {state:'unmatched',providers:[]};
  let imdb=/^tt\d{5,12}$/.test(String(input.imdbId||''))?String(input.imdbId):'';
  const year=/^\d{4}$/.test(String(input.year||''))?String(input.year):'';
  const type=input.type==='Film'?'MOVIE':'SHOW';
  const key=JSON.stringify(['jw',title,imdb,year,type]);
  const cached=cache.get(key);
  if(cached&&cached.expires>Date.now())return cached.value;
  if(!imdb){
    const response=await request('https://v3.sg.media-imdb.com/suggestion/titles/x/'+encodeURIComponent(title.toLowerCase())+'.json',{signal:AbortSignal.timeout(6000)});
    if(!response.ok)throw new Error('IMDb identity check unavailable');
    const data=await response.json();
    const matches=(data.d||[]).filter(row=>{
      const series=/series|miniseries/i.test(String(row.qid||row.q||''));
      return /^tt\d{5,12}$/.test(row.id||'')&&cleanTitle(row.l)===cleanTitle(title)&&(type==='SHOW'?series:!series)&&(!year||String(row.y)===year);
    });
    if(matches.length!==1)return {state:'unmatched',providers:[]};
    imdb=matches[0].id;
  }
  const query='query($title: String!) { popularTitles(country: GB, first: 20, filter: {searchQuery: $title}) { edges { node { objectType content(country: GB, language: en) { title originalReleaseYear externalIds { imdbId } fullPath } offers(country: GB, platform: WEB) { monetizationType presentationType package { clearName } } } } } }';
  const response=await request('https://apis.justwatch.com/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables:{title}}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('UK availability check unavailable');
  const data=await response.json();
  if(data.errors?.length||!Array.isArray(data.data?.popularTitles?.edges))throw new Error('Incomplete UK availability response');
  const matches=data.data.popularTitles.edges.map(edge=>edge.node).filter(node=>node?.objectType===type&&node.content?.externalIds?.imdbId===imdb);
  if(matches.length!==1)return {state:'unmatched',providers:[]};
  const node=matches[0];
  if(!Array.isArray(node.offers))throw new Error('Incomplete UK offers');
  const providers=new Map();
  for(const offer of node.offers){
    if(!['SD','HD','_4K'].includes(offer.presentationType))continue;
    const kind={FLATRATE:'Subscription',FREE:'Free',ADS:'With adverts',RENT:'Rent',BUY:'Buy'}[offer.monetizationType];
    const raw=offer.package?.clearName;
    if(!kind||typeof raw!=='string'||!raw.trim())continue;
    const name=({'Amazon Prime Video':'Prime Video','Paramount Plus':'Paramount+'})[raw]||raw;
    const row=providers.get(name)||{name,types:[]};if(!row.types.includes(kind))row.types.push(kind);providers.set(name,row);
  }
  const path=node.content?.fullPath||'';
  if(!/^\/uk\/(tv-series|movie)\/[a-zA-Z0-9_-]+$/.test(path))throw new Error('Invalid UK title link');
  const rows=[...providers.values()].sort((a,b)=>Number(b.types.includes('Subscription'))-Number(a.types.includes('Subscription'))||a.name.localeCompare(b.name,'en-GB'));
  const value={state:rows.length?'available':'none',providers:rows,imdbId:imdb,identityMatched:true,source:'JustWatch',link:'https://www.justwatch.com'+path,checkedAt:new Date().toISOString()};
  if(cache.size>=300)cache.delete(cache.keys().next().value);
  cache.set(key,{value,expires:Date.now()+TTL});return value;
}

export async function getUKAvailability(input, token, request = fetch) {
  const checks=await Promise.allSettled([getJustWatchAvailability(input,request),...(token?[getTMDBAvailability(input,token,request)]:[])]);
  const valid=checks.filter(row=>row.status==='fulfilled').map(row=>row.value);
  const available=valid.find(row=>row.state==='available');
  if(available)return available;
  const none=valid.find(row=>row.state==='none');
  if(none)return none;
  if(checks.some(row=>row.status==='rejected'))throw new Error('UK availability could not be checked');
  return valid[0]||{state:'unmatched',providers:[]};
}
