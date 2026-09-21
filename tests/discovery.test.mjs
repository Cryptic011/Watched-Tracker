import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync(new URL('../assets/js/discovery.js',import.meta.url),'utf8');
function harness(){
  const nodes=new Map(),calls=[];
  const element=()=>({value:'',textContent:'',innerHTML:'',dataset:{},attributes:{},open:false,
    classList:{hidden:false,add(){this.hidden=true;},toggle(_name,value){this.hidden=value;}},
    listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(name,value){this.attributes[name]=value;},
    querySelectorAll:()=>[],replaceChildren(){this.innerHTML='';},focus(){this.focused=true;},showModal(){this.open=true;},close(){this.open=false;}});
  const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const filters=['All','Film','Series'].map(type=>Object.assign(element(),{dataset:{discoveryFilter:type}}));
  const c=vm.createContext({URL,AbortController,setTimeout,clearTimeout,console,$,currentUser:{id:'a'},currentTab:'search',
    document:{querySelectorAll:()=>filters},esc:value=>String(value).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),
    findTrackedDuplicate:()=>null,searchAllTitles:async()=>[],openAdd:()=>calls.push('new'),selectSuggestion:item=>calls.push(item.title),openEdit:id=>calls.push(id),
    switchTab:tab=>calls.push(tab),titleInput:element()});
  vm.runInContext(source,c);c.activateTitleSearch();
  return {c,$,calls,filters};
}
test('Newer queries win even when the cancelled provider replies late',async()=>{
  const {c,$}=harness(),requests=[];
  c.searchAllTitles=(query,options)=>new Promise(resolve=>requests.push({query,options,resolve}));
  $('discovery-query').value='Old';const old=c.runTitleSearch();
  $('discovery-query').value='New';const next=c.runTitleSearch();
  assert.equal(requests[0].options.signal.aborted,true);
  requests[1].resolve([{title:'New result',format:'Series'}]);await next;
  requests[0].resolve([{title:'Old result',format:'Series'}]);await old;
  assert.match($('discovery-results').innerHTML,/New result/);assert.doesNotMatch($('discovery-results').innerHTML,/Old result/);
});
test('Filters retain the query and full descriptions expand using native details',async()=>{
  const {c,$,filters}=harness();$('discovery-query').value='Title';
  c.searchAllTitles=async()=>[{title:'Series title',format:'Series',description:'Full description &amp; more.'},{title:'Film title',format:'Film'}];
  await c.runTitleSearch();assert.match($('discovery-results').innerHTML,/<details/);
  filters[1].onclick();assert.match($('discovery-results').innerHTML,/Film title/);assert.doesNotMatch($('discovery-results').innerHTML,/Series title/);
  assert.equal($('discovery-query').value,'Title');assert.equal(c.discoveryDescription({description:'A &amp; B'}),'A & B');
});
test('Provider text is escaped and only allowed HTTPS artwork is rendered',()=>{
  const {c}=harness();const html=c.discoveryCard({title:'<img onerror=evil()>',format:'Film',description:'&lt;script&gt;evil()&lt;/script&gt;',posterUrl:'javascript:evil()'},0);
  assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);
  assert.equal(c.discoveryImage('https://static.tvmaze.com.evil.test/poster.jpg'),'');
  assert.equal(c.discoveryImage('https://is1-ssl.mzstatic.com/poster.jpg'),'https://is1-ssl.mzstatic.com/poster.jpg');
});
test('Adding opens the existing editor; duplicates open their saved record instead',()=>{
  const {c,calls}=harness();c.addDiscoveryTitle({title:'Reacher',format:'Series'});assert.deepEqual(calls,['new','Reacher']);
  calls.length=0;c.findTrackedDuplicate=()=>({id:'existing'});c.addDiscoveryTitle({title:'Reacher',format:'Series'});assert.deepEqual(calls,['existing']);
  assert.match(c.discoveryCard({title:'Reacher',format:'Series'},0),/Already added/);
});
test('Leaving search cancels pending results and changing account clears the previous query',async()=>{
  const {c,$}=harness();let resolve;
  c.searchAllTitles=()=>new Promise(r=>resolve=r);$('discovery-query').value='Reacher';const request=c.runTitleSearch();
  c.pauseTitleSearch();resolve([{title:'Late result',format:'Series'}]);await request;
  assert.doesNotMatch($('discovery-results').innerHTML,/Late result/);
  c.currentUser={id:'other'};c.refreshTitleSearchBadges();assert.equal($('discovery-query').value,'');assert.equal($('discovery-results').innerHTML,'');
});
test('Search errors expose a retry and clearing input removes results',async()=>{
  const {c,$}=harness();$('discovery-query').value='Reacher';c.searchAllTitles=async()=>{throw Error('Offline');};
  await c.runTitleSearch();assert.equal($('discovery-retry').classList.hidden,false);assert.match($('discovery-status').textContent,/unavailable/);
  $('discovery-query').value='';await c.runTitleSearch();assert.equal($('discovery-retry').classList.hidden,true);assert.equal($('discovery-results').innerHTML,'');
});
test('Search is immediately after Library and artwork/update connections are allowed by CSP',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.deepEqual([...html.matchAll(/class="tab-btn[^"]*" data-tab="([^"]+)"/g)].map(m=>m[1]),['library','search','history','watchlist','settings']);
  assert.match(html,/connect-src[^;]*wss:\/\/okkwteywtgfsnlrjdyhv\.supabase\.co/);
  assert.match(html,/img-src[^;]*https:\/\/\*\.mzstatic\.com/);
});
test('Film descriptions use the exact IMDb identity and reject same-name remakes',async()=>{
  for(const match of [true,false]){
    const {c}=harness();c.AbortSignal=AbortSignal;const calls=[];
    c.fetch=async url=>{calls.push(String(url));return {ok:true,json:async()=>url.searchParams.get('action')==='wbsearchentities'?{search:[{id:'Q1'}]}:url.searchParams.get('action')==='wbgetentities'?{entities:{Q1:{claims:{P345:[{mainsnak:{datavalue:{value:match?'tt1234567':'tt9999999'}}}]},sitelinks:{enwiki:{title:'Example (film)'}}}}}:{query:{pages:{1:{extract:'A mystery unfolds in a coastal town.'}}}}};};
    const item={title:'Example',format:'Film',imdbId:'tt1234567'};
    const description=await c.fetchDiscoveryDescription(item,new AbortController().signal);
    assert.equal(description,match?'A mystery unfolds in a coastal town.':'');assert.equal(calls.length,match?3:2);
    if(match)assert.match(c.discoveryAttribution(item),/en.wikipedia.org\/wiki\/Example/);
  }
});
test('Catalogue gateway returns series summaries and film descriptions with safe posters',async()=>{
  const backend=fs.readFileSync(new URL('../supabase/functions/watchlog-pin/index.ts',import.meta.url),'utf8');
  const part=stripTypeScriptTypes(backend.slice(backend.indexOf('function catalogText('),backend.indexOf('async function readMaintenance(')));
  const c=vm.createContext({URL,AbortController,setTimeout,clearTimeout,catalogCache:new Map(),CATALOG_TIMEOUT_MS:1000,CATALOG_CACHE_MS:60000,MAX_CATALOG_RESULTS_PER_SOURCE:30,
    fetch:async url=>({ok:true,json:async()=>url.includes('tvmaze')?[{show:{id:1,name:'Reacher',summary:'<p>Jack <b>Reacher</b> investigates.</p>',image:{medium:'https://static.tvmaze.com/poster.jpg'}}}]:url.includes('itunes')?{results:[{trackName:'Film',longDescription:'Full film plot',artworkUrl100:'https://is1-ssl.mzstatic.com/image/100x100bb.jpg'}]}:{d:[]}})});
  vm.runInContext(part,c);const rows=await c.searchCatalog('Reacher','gb');
  assert.equal(rows.find(r=>r.format==='Series').description,'Jack Reacher investigates.');
  assert.equal(rows.find(r=>r.format==='Film').description,'Full film plot');
  assert.match(rows.find(r=>r.format==='Film').posterUrl,/400x600bb.jpg$/);
});
