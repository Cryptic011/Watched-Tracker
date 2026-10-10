import '../assets/js/deployment-channel.js';
const {config}=globalThis.WatchLogDeployment;
const sha=process.env.WATCHLOG_SOURCE_SHA;
const page=process.env.WATCHLOG_PAGE_URL||'';
const status=String(process.env.WATCHLOG_STATUS||'success');
const runNumber=String(process.env.WATCHLOG_SOURCE_RUN_NUMBER||'');
const githubToken=process.env.GITHUB_TOKEN||'';
let overallRunCount=0;
const runId=String(process.env.WATCHLOG_SOURCE_RUN_ID||'');
if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Source deployment SHA is required');
if(!/^\d+$/.test(runId)||!/^\d+$/.test(runNumber)||!githubToken)throw Error('Source run ID, source run number and GitHub token are required');
const countResponse=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/runs?per_page=1`,{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${githubToken}`,'X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(10000)});
if(!countResponse.ok)throw Error(`Could not retrieve overall Actions run count: HTTP ${countResponse.status}`);
overallRunCount=Number((await countResponse.json()).total_count);
if(!Number.isSafeInteger(overallRunCount)||overallRunCount<1)throw Error('GitHub returned an invalid overall Actions run count');
if(page){const site=new URL(page);if(site.protocol!=='https:')throw Error('Expected HTTPS deployment URL');}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function broadcast(event,payload){
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(`${config.url}/realtime/v1/api/broadcast`,{
        method:'POST',headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},
        body:JSON.stringify({messages:[{topic:config.topic,event,payload,private:false}]}),
        signal:AbortSignal.timeout(10000),
      });
      if(!response.ok)throw Error(`Broadcast returned ${response.status}`);
      return true;
    }catch(error){if(attempt===2)throw error;await sleep(2000);}
  }
}
const response=await fetch(`${config.url}/functions/v1/watchlog-reminders`,{
  method:'POST',
  headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},
  body:JSON.stringify({action:'deployment_status',runId,runNumber,overallRunCount,sha,status,commitUrl:`https://github.com/Cryptic011/Watched-Tracker/commit/${sha}`}),
  signal:AbortSignal.timeout(15000),
});
if(!response.ok){
  const detail=(await response.text()).slice(0,1000);
  throw Error(`Private run-status notification returned ${response.status}: ${detail}`);
}
const delivery=await response.json();
const delivered=Number(delivery.delivered||0), failed=Number(delivery.failed||0);
console.log(`Private run-status notification processed: ${status}; delivered ${delivered}; failed ${failed}`);
if(!delivery.ok||(!delivery.duplicate&&delivered<1)||failed>0)throw Error(`Private run-status notification was not fully delivered: ${JSON.stringify({ok:delivery.ok,delivered,failed,reason:delivery.reason||null})}`);

if(status!=='success'||!page){console.log(`Deployment status sent: ${status} for ${sha}`);process.exit(0);}
const site=new URL(page);let ready=false;
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
await broadcast(config.event,{sha});
console.log(`Deployment signal sent for ${sha}`);
