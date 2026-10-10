import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../scripts/notify-deployment.mjs',import.meta.url),'utf8').replace(/^import [^\\n]+\\n/,'');
const sha='a'.repeat(40);
function run(fetch,env={GITHUB_SHA:sha,WATCHLOG_PAGE_URL:'',WATCHLOG_STATUS:'success',WATCHLOG_DEPLOYMENT_NOTIFY_SECRET:'test-secret',GITHUB_RUN_NUMBER:'197',GITHUB_SERVER_URL:'https://github.com',GITHUB_REPOSITORY:'Cryptic011/Watched-Tracker',GITHUB_RUN_ID:'1',GITHUB_EVENT_NAME:'push'}){
 return vm.runInNewContext('(async()=>{'+source+'})()', {WatchLogDeployment:{config:{url:'https://backend.test',key:'public-key',topic:'watchlog-deployments',event:'deployed'}},process:{env},URL,AbortSignal,fetch,setTimeout:fn=>fn(),console:{log(){}}});
}
test('Push status is sent privately to the reminder function with the push number, commit and outcome',async()=>{
 let request;
 await run(async(url,options)=>{request={url:String(url),options};return {ok:true,json:async()=>({ok:true,delivered:1,failed:0})};});
 assert.equal(request.url,'https://backend.test/functions/v1/watchlog-reminders');
 assert.equal(request.options.headers['x-watchlog-deployment-secret'],'test-secret');
 assert.deepEqual(JSON.parse(request.options.body),{action:'deployment_status',pushNumber:'197',sha,status:'success',commitUrl:`https://github.com/Cryptic011/Watched-Tracker/commit/${sha}`});
});
test('Missing private notification secret is rejected instead of broadcasting status publicly',async()=>{
 await assert.rejects(run(async()=>({ok:true}),{GITHUB_SHA:sha,WATCHLOG_PAGE_URL:'',WATCHLOG_STATUS:'failure',GITHUB_RUN_NUMBER:'198',GITHUB_EVENT_NAME:'push'}),/WATCHLOG_DEPLOYMENT_NOTIFY_SECRET is required/);
});
test('Private notification endpoint errors fail the notification step',async()=>{
 await assert.rejects(run(async()=>({ok:false,status:503}),{GITHUB_SHA:sha,WATCHLOG_PAGE_URL:'',WATCHLOG_STATUS:'failure',WATCHLOG_DEPLOYMENT_NOTIFY_SECRET:'test-secret',GITHUB_RUN_NUMBER:'199',GITHUB_EVENT_NAME:'push'}),/returned 503/);
});
