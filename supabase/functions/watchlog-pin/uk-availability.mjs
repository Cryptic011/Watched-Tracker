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

export async function getUKAvailability(input, token, request = fetch) {
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
