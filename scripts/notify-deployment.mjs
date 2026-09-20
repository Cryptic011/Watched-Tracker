import '../assets/js/deployment-channel.js';
const {config}=globalThis.WatchLogDeployment;
const sha=process.env.GITHUB_SHA;
const page=process.env.WATCHLOG_PAGE_URL;
if(!/^[a-f0-9]{40}$/.test(sha||'')||!page)throw Error('Deployment SHA and page URL are required');
const site=new URL(page);
if(site.protocol!=='https:')throw Error('Expected HTTPS deployment URL');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Wait for Pages to actually serve both the page and its metadata before
// notifying open apps. These bounded CI retries are not app-side polling.
let ready=false;
for(let attempt=0;attempt<12;attempt++){
  try{
    const urls=[new URL(site),new URL('build-info.js',site)];
    const sources=await Promise.all(urls.map(async url=>{
      url.searchParams.set('deployment',`${sha}-${attempt}`);
      const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error(`Pages returned ${response.status}`);
      return response.text();
    }));
    ready=sources.every(source=>source.includes(`"sha":"${sha}"`));
    if(ready)break;
  }catch(error){console.log(`Waiting for deployed content: ${error.message}`);}
  await sleep(5000);
}
if(!ready)throw Error('Pages did not serve this deployment; update signal was not sent');
for(let attempt=0;attempt<3;attempt++){
  try{
    const response=await fetch(`${config.url}/realtime/v1/api/broadcast`,{
      method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},
      body:JSON.stringify({messages:[{topic:config.topic,event:config.event,payload:{sha},private:false}]}),
      signal:AbortSignal.timeout(10000),
    });
    if(!response.ok)throw Error(`Broadcast returned ${response.status}`);
    console.log(`Deployment signal sent for ${sha}`);break;
  }catch(error){if(attempt===2)throw error;await sleep(2000);}
}
