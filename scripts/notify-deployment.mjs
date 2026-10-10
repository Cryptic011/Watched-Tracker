import '../assets/js/deployment-channel.js';
const {config}=globalThis.WatchLogDeployment;
const sha=process.env.GITHUB_SHA;
const page=process.env.WATCHLOG_PAGE_URL||'';
const status=String(process.env.WATCHLOG_STATUS||'success');
const runNumber=String(process.env.GITHUB_RUN_NUMBER||'');
if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Deployment SHA is required');
if(page){const site=new URL(page);if(site.protocol!=='https:')throw Error('Expected HTTPS deployment URL');}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function broadcast(event,payload){
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(`${config.url}/realtime/v1/api/broadcast`,{
        method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},
        body:JSON.stringify({messages:[{topic:config.topic,event,payload,private:false}]}),
        signal:AbortSignal.timeout(10000),
      });
      if(!response.ok)throw Error(`Broadcast returned ${response.status}`);
      return true;
    }catch(error){if(attempt===2)throw error;await sleep(2000);}
  }
}
const notifySecret=process.env.WATCHLOG_DEPLOYMENT_NOTIFY_SECRET||'';
if(!notifySecret){
  console.warn('Private push-status notification skipped: WATCHLOG_DEPLOYMENT_NOTIFY_SECRET is missing. Configure it in GitHub Actions and Supabase.');
}else{
const response=await fetch(`${config.url}/functions/v1/watchlog-reminders`,{
  method:'POST',
  headers:{apikey:config.key,'Content-Type':'application/json','x-watchlog-deployment-secret':notifySecret},
  body:JSON.stringify({action:'deployment_status',pushNumber:runNumber,sha,status,commitUrl:`https://github.com/Cryptic011/Watched-Tracker/commit/${sha}`}),
  signal:AbortSignal.timeout(15000),
});
if(!response.ok)throw Error(`Private push-status notification returned ${response.status}`);
const delivery=await response.json();
console.log(`Private push-status notification processed: ${status}; delivered ${delivery.delivered||0}; failed ${delivery.failed||0}`);
}
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
