import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../scripts/notify-deployment.mjs',import.meta.url),'utf8').replace(/^import .*;\n/,'');
const sha='a'.repeat(40);
function run(fetch,env={GITHUB_SHA:sha,WATCHLOG_PAGE_URL:'',WATCHLOG_STATUS:'success',WATCHLOG_DEPLOYMENT_NOTIFY_SECRET:'test-secret',GITHUB_RUN_NUMBER:'197',GITHUB_SERVER_URL:'https://github.com',GITHUB_REPOSITORY:'Cryptic011/Watched-Tracker',GITHUB_RUN_ID:'1',GITHUB_EVENT_NAME:'push'}){
 return vm.runInNewContext('(async()=>{'+source+'})()', {WatchLogDeployment:{config:{url:'https://backend.test',key:'public-key',topic:'watchlog-deployments',event:'deployed'}},process:{env,exit(code){throw new Error('__PROCESS_EXIT__'+code)}},URL,AbortSignal,fetch,setTimeout:fn=>fn(),console:{log(){},warn(){},error(){}}}).catch(error=>{if(error.message==='__PROCESS_EXIT__0')return;throw error;});
}
test('Push status is sent privately to the reminder function with the push number, commit and outcome',async()=>{
 let request;
 await run(async(url,options)=>{request={url:String(url),options};return {ok:true,json:async()=>({ok:true,delivered:1,failed:0})};});
 assert.equal(request.url,'https://backend.test/functions/v1/watchlog-reminders');
 assert.equal(request.options.headers['x-watchlog-deployment-secret'],'test-secret');
 assert.deepEqual(JSON.parse(request.options.body),{action:'deployment_status',pushNumber:'197',sha,status:'success',commitUrl:`https://github.com/Cryptic011/Watched-Tracker/commit/${sha}`});
});
test('Missing private notification secret skips private delivery without broadcasting publicly or failing deployment',async()=>{
 let requests=0;
 await run(async()=>{requests++;return {ok:true,json:async()=>({ok:true,delivered:0,failed:0})};},{GITHUB_SHA:sha,WATCHLOG_PAGE_URL:'',WATCHLOG_STATUS:'failure',GITHUB_RUN_NUMBER:'198',GITHUB_EVENT_NAME:'push'});
 assert.equal(requests,0);
});
test('Private notification endpoint errors fail the notification step',async()=>{
 await assert.rejects(run(async()=>({ok:false,status:503}),{GITHUB_SHA:sha,WATCHLOG_PAGE_URL:'',WATCHLOG_STATUS:'failure',WATCHLOG_DEPLOYMENT_NOTIFY_SECRET:'test-secret',GITHUB_RUN_NUMBER:'199',GITHUB_EVENT_NAME:'push'}),/returned 503/);
});

test('Completed workflow-run events use the originating workflow run number and conclusion',async()=>{
 let request;
 await run(async(url,options)=>{request={url:String(url),options};return {ok:true,json:async()=>({ok:true,delivered:1,failed:0})};},{
  GITHUB_SHA:sha,WATCHLOG_PAGE_URL:'',WATCHLOG_STATUS:'cancelled',WATCHLOG_DEPLOYMENT_NOTIFY_SECRET:'test-secret',GITHUB_RUN_NUMBER:'202',GITHUB_EVENT_NAME:'workflow_run'
 });
 assert.equal(JSON.parse(request.options.body).pushNumber,'202');
 assert.equal(JSON.parse(request.options.body).status,'cancelled');
});
test('Missing notification secret skips delivery without making the workflow fail',async()=>{
 let requests=0;
 await run(async()=>{requests++;return {ok:true,json:async()=>({ok:true,delivered:0,failed:0})};},{GITHUB_SHA:sha,WATCHLOG_PAGE_URL:'',WATCHLOG_STATUS:'failure',GITHUB_RUN_NUMBER:'203',GITHUB_EVENT_NAME:'workflow_run'});
 assert.equal(requests,0);
});
