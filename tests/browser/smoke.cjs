const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 if(!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const engine of process.env.BROWSER_ENGINES==='all'?[chromium,webkit]:[chromium]){
 const browser=await engine.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];let phase='login';
  page.on('pageerror',error=>{errors.push(error.message);console.error(`${engine.name()} [${phase}] page error: ${error.stack||error.message}`);});
  page.on('requestfailed',request=>console.error(`${engine.name()} [${phase}] request failed: ${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText}`));
  let items=[],revision=0,failSave=false,saves=0,loads=0;
  const account={id:'browser-test',email:'browser@example.test',displayName:'Browser Test'};
  await context.route('**/*',async route=>{
   const req=route.request();
   const requestHeaders=req.headers();
   const headers={'access-control-allow-origin':requestHeaders.origin||base,'access-control-allow-methods':'POST, GET, OPTIONS','access-control-allow-headers':requestHeaders['access-control-request-headers']||'content-type, x-watchlog-session, authorization, apikey','access-control-max-age':'600'};
   // WebKit applies CORS to fulfilled mocks, including failures and preflights.
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
   if(req.url().includes('/functions/v1/watchlog-pin')){
    const body=req.postDataJSON();let data={ok:true};
    if(['login','load'].includes(body.action)){loads++;data={ok:true,account,items,revision,sessionToken:'test-token'};}
    if(body.action==='catalog_search')data={ok:true,results:[
     {title:'Browser Test Film',format:'Film',source:'imdb',imdbId:'tt1234567',year:'2020',posterUrl:'https://m.media-amazon.com/test.jpg',description:'A detective uncovers a mystery in a quiet coastal town. '.repeat(8)},
     {title:'Browser Test Series',format:'Series',source:'tvmaze',tvmazeId:'12',year:'2021',description:'Investigators work together to solve difficult cases.'},
    ]};
    if(body.action==='save'){
     if(failSave)return route.fulfill({status:503,headers,json:{error:'Offline'}});
     items=body.items;revision++;saves++;data={ok:true,revision};
    }
    return route.fulfill({headers,json:data});
   }
   if(req.url().startsWith(base))return route.continue();
   return route.fulfill({headers,json:{ok:true,enabled:false,results:[]}});
  });
  await page.goto(base);
  await page.locator('#auth-email').fill(account.email);await page.locator('#auth-pin').fill('1234');await page.locator('#auth-submit').click();
  await page.waitForFunction(()=>document.querySelector('#auth-screen').classList.contains('hidden'));
  // Add and edit via the real form; external catalogue responses stay mocked.
  phase='search';
  await page.locator('#add-btn').click();
  await page.locator('[data-browse-format="Film"]').click();assert.equal(await page.locator('#discovery-query').inputValue(),'');
  await page.locator('[data-discovery-filter="All"]').click();await page.locator('#discovery-query').fill('Browser Test Film');
  await page.locator('#discovery-results .discovery-title').first().waitFor();
  await page.locator('[data-discovery-filter="Series"]').click();assert.equal(await page.locator('#discovery-results .discovery-title').count(),1);
  await page.locator('[data-discovery-filter="Film"]').click();
  await page.locator('#discovery-results summary').first().click();assert.equal(await page.locator('#discovery-results details').first().getAttribute('open'),'');
  await page.locator('#discovery-results .discovery-title').first().click();await page.locator('#discovery-detail').waitFor({state:'visible'});
  assert.ok((await page.locator('.discovery-full-description').textContent()).length>100);
  await page.locator('#discovery-detail-add').click();await page.locator('#modal').waitFor({state:'visible'});
  assert.equal(await page.locator('#title').inputValue(),'Browser Test Film');assert.equal(await page.locator('#type').inputValue(),'Film');
  await page.locator('#save-btn').click();await page.waitForFunction(()=>!localSaveInFlight&&!cloudSaveInFlight&&mediaItems.length===1);
  assert.equal(items[0].title,'Browser Test Film');
  await page.waitForFunction(()=>document.querySelector('[data-discovery-badge]')?.textContent.includes('Already added'));
  assert.equal(await page.locator('#discovery-results [data-discovery-add]').first().textContent(),'View in library');
  await page.locator('[data-tab="library"]').click();await page.locator('[data-tab="search"]').click();assert.equal(await page.locator('#discovery-query').inputValue(),'Browser Test Film');
  await page.locator('#discovery-manual').click();await page.locator('#modal').waitFor({state:'visible'});await page.locator('#close-modal').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.locator('[data-tab="library"]').click();
  phase='gallery';
  assert.equal(await page.getByRole('heading',{name:'Next to watch',exact:true}).count(),0);
  const categories=await page.locator('.gallery-category').evaluateAll(nodes=>nodes.map(n=>({y:n.getBoundingClientRect().y,height:n.getBoundingClientRect().height})));
  assert.ok(categories[1].y>=categories[0].y+categories[0].height);
  await page.evaluate(()=>{mediaItems[0].status='Watched';mediaItems[0].filmReleaseDate='2020-02-14';mediaItems[0].date='2026-09-21';render();});
  await page.locator('[data-gallery-category="Film"]').click();await page.locator('[data-filter="Watched"]').click();
  assert.match(await page.locator('.gallery-section h3').first().textContent(),/^2020/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.locator('.gallery-tile').first().click();await page.locator('[data-gallery-close]').click();
  await page.locator('[data-filter="All"]').click();await page.locator('[data-gallery-back]').click();
  await page.evaluate(()=>openEdit(mediaItems[0].id));await page.locator('#platform').fill('Cinema');await page.locator('#save-btn').click();
  await page.waitForFunction(()=>!cloudSaveInFlight&&!localSaveInFlight);assert.equal(items[0].platform,'Cinema');
  // Seed a verified schedule through the same persistence code used by imports.
  phase='episode tracking';
  await page.evaluate(async()=>{
   mediaItems.push({id:'show',title:'Test Series',type:'Series',status:'Planned',episodeScheduleVerified:true,releasedEpisodes:{1:[1,2,3]},airedEpisodeCounts:{1:3},episodeCounts:{1:4},watchedEpisodes:{},metadataUpdatedAt:new Date().toISOString(),seriesReleaseDate:'2020-01-01'});
   await persistLibrary(mediaItems);render();openEpisodeTracker('show');
  });
  await page.locator('#episode-watch-next').click();await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.equal(await page.locator('#episode-tracker-grid [data-season="1"][data-episode="1"]').getAttribute('aria-pressed'),'false');
  await page.locator('#episode-tracker-grid [data-season="1"][data-episode="2"]').click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(x=>x.id==='show').watchedEpisodes,{'1':[2]});assert.equal(await page.locator('#episode-tracker-grid [data-episode="4"]').count(),0);
  await page.locator('#close-episode-tracker').click();
  // Delete/Undo restores just the removed title, preserving other progress.
  await page.evaluate(()=>openEdit(mediaItems[0].id));await page.locator('#delete-btn').click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.waitForFunction(()=>!cloudSaveInFlight&&!localSaveInFlight&&mediaItems.length===2);
  assert.equal(items.length,2);
  // Force a pending memory change: refresh must save it before navigation.
  phase='refresh';
  await page.evaluate(()=>{mediaItems[0].platform='Saved before refresh';});
  const before=loads;await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('#refresh-app').click()]);await page.waitForFunction(()=>document.querySelector('#auth-screen').classList.contains('hidden'));
  await page.waitForFunction(()=>mediaItems[0]?.platform==='Saved before refresh');
  assert.equal(items[0].platform,'Saved before refresh');
  await page.waitForTimeout(300);assert.ok(loads>before);
  // A failed cloud save must leave the current page and edit intact.
  phase='failed save';
  failSave=true;const failedLoads=loads;
  await page.evaluate(()=>{mediaItems[0].platform='Keep this change';});await page.locator('#refresh-app').click();
  await page.waitForFunction(()=>document.querySelector('#app-toast').textContent.includes('Refresh paused'));
  assert.equal(loads,failedLoads);assert.equal(await page.evaluate(()=>mediaItems[0].platform),'Keep this change');
  assert.ok(saves>=4);assert.deepEqual(errors,[]);
  console.log(`${engine.name()}: visual search, filters, descriptions, duplicate badges, add/edit, episode mark/undo, unreleased guard and refresh persistence passed`);
 }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
