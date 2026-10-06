(function(){
  'use strict';
  const OWNER_HASH='ea67160ff90d5a1b54a6b7fe8522c1573ec9dea8fb18fff38969f42b09c27f0b';
  const SEEN_KEY='watchlog_deployment_status_seen_v1';
  const BASELINE_RUN=161;
  const API='https://api.github.com/repos/Cryptic011/Watched-Tracker/actions/runs?event=push&branch=main&per_page=20';
  const sha256=async value=>{const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value)));return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');};
  const owner=async()=>{const email=String(currentProfile?.email||document.querySelector('#profile-email')?.textContent||'').trim().toLowerCase();return !!email&&await sha256('watchlog-notification-test:'+email)===OWNER_HASH;};
  const seen=()=>{try{return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)||'[]'));}catch(_){return new Set();}};
  const saveSeen=set=>{try{localStorage.setItem(SEEN_KEY,JSON.stringify([...set].slice(-100)));}catch(_){}};
  async function notify(run){
    if(!(await owner()))return;
    const status=String(run.status==='completed'?(run.conclusion||'completed'):run.status||'unknown');
    const number=run.run_number?'Push '+run.run_number:'Push';
    const body=number+': '+status+'. '+String(run.display_title||'Change')+' ('+String(run.head_sha||'').slice(0,7)+').';
    if(typeof showAppToast==='function')showAppToast('Watch Logger: '+body,status==='success'?'success':'warn',9000);
    try{
      if(typeof Notification!=='undefined'&&Notification.permission==='granted'&&navigator.serviceWorker){
        const registration=await navigator.serviceWorker.getRegistration('./')||await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
        await registration.showNotification('Watch Logger Change',{body,tag:'watchlog-deployment-'+String(run.id||run.head_sha),renotify:false});
      }
    }catch(_){}
  }
  async function handle(detail){
    if(!(await owner())||!detail?.sha)return;
    const id=String(detail.runNumber||'')+':'+detail.sha;const s=seen();if(s.has(id))return;s.add(id);saveSeen(s);
    await notify({id,run_number:detail.runNumber,status:detail.status,display_title:detail.title,head_sha:detail.sha});
  }
  async function catchUp(){
    if(!(await owner()))return;
    try{
      const response=await fetch(API,{cache:'no-store',headers:{accept:'application/vnd.github+json'}});if(!response.ok)return;
      const data=await response.json(),runs=Array.isArray(data.workflow_runs)?data.workflow_runs:[],s=seen();
      const eligible=runs.filter(r=>Number(r.run_number)>=BASELINE_RUN&&r.event==='push');
      if(!s.size&&eligible.length)eligible.slice(0,-1).forEach(r=>s.add(String(r.run_number)+':'+r.head_sha));
      for(const run of eligible.slice().reverse()){const id=String(run.run_number)+':'+run.head_sha;if(s.has(id))continue;s.add(id);await notify(run);}
      saveSeen(s);
    }catch(_){}
  }
  window.addEventListener('watchlog:deployment',event=>{void handle(event.detail);});
  let lastEmail='';
  const watch=()=>{const email=String(currentProfile?.email||document.querySelector('#profile-email')?.textContent||'').trim().toLowerCase();if(email&&email!==lastEmail){lastEmail=email;void catchUp();}};
  new MutationObserver(watch).observe(document.body,{subtree:true,childList:true,characterData:true});
  watch();
  if(window.WatchLogDeployment)WatchLogDeployment.start(()=>{});
})();