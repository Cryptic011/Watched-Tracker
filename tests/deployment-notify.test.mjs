import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../scripts/notify-deployment.mjs',import.meta.url),'utf8').replace(/^import .*;\n/,'');
const sha='a'.repeat(40);
function run(fetch,env={WATCHLOG_SOURCE_SHA:sha,WATCHLOG_SOURCE_RUN_NUMBER:'197',WATCHLOG_SOURCE_RUN_ID:'12345',WATCHLOG_PAGE_URL:'',WATCHLOG_STATUS:'success',GITHUB_SERVER_URL:'https://github.com',GITHUB_REPOSITORY:'Cryptic011/Watched-Tracker',GITHUB_EVENT_NAME:'workflow_run'}){
 return vm.runInNewContext('(async()=>{'+source+'})()', {WatchLogDeployment:{config:{url:'https://backend.test',key:'public-key',topic:'watchlog-deployments',event:'deployed'}},process:{env,exit(code){throw new Error('__PROCESS_EXIT__'+code)}},URL,AbortSignal,fetch,setTimeout:fn=>fn(),console:{log(){},warn(){},error(){}}}).catch(error=>{if(error.message==='__PROCESS_EXIT__0')return;throw error;});
}
test('Completed workflow run status is sent privately with the source run number, ID, commit and outcome',async()=>{
 let request;
 await run(async(url,options)=>{request={url:String(url),options};return {ok:true,json:async()=>({ok:true,delivered:1,failed:0})};});
 assert.equal(request.url,'https://backend.test/functions/v1/watchlog-reminders');
 assert.deepEqual(JSON.parse(request.options.body),{action:'deployment_status',runId:'12345',runNumber:'197',sha,status:'success',commitUrl:`https://github.com/Cryptic011/Watched-Tracker/commit/${sha}`});
});
test('Notification endpoint errors fail the notification step with response status',async()=>{
 await assert.rejects(run(async()=>({ok:false,status:503,text:async()=> 'backend unavailable'})),/returned 503: backend unavailable/);
});
test('Completed workflow-run events use the originating workflow run number and conclusion',async()=>{
 let request;
 await run(async(url,options)=>{request={url:String(url),options};return {ok:true,json:async()=>({ok:true,delivered:1,failed:0})};},{
  WATCHLOG_SOURCE_SHA:sha,WATCHLOG_SOURCE_RUN_ID:'67890',WATCHLOG_SOURCE_RUN_NUMBER:'202',WATCHLOG_PAGE_URL:'',WATCHLOG_STATUS:'cancelled',GITHUB_EVENT_NAME:'workflow_run'
 });
 assert.equal(JSON.parse(request.options.body).runNumber,'202');
 assert.equal(JSON.parse(request.options.body).runId,'67890');
 assert.equal(JSON.parse(request.options.body).status,'cancelled');
});
test('Missing source workflow metadata fails closed before sending a notification',async()=>{
 let requests=0;
 await assert.rejects(run(async()=>{requests++;return {ok:true,json:async()=>({})};},{WATCHLOG_STATUS:'failure'}),/Source deployment SHA is required/);
 assert.equal(requests,0);
});
