import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../scripts/notify-deployment.mjs',import.meta.url),'utf8').replace(/^import [^\n]+\n/,'');
const sha='a'.repeat(40);
function run(fetch,env={GITHUB_SHA:sha,WATCHLOG_PAGE_URL:'https://example.test/Watched-Tracker/',WATCHLOG_STATUS:'success',GITHUB_RUN_NUMBER:'162',GITHUB_SERVER_URL:'https://github.com',GITHUB_REPOSITORY:'Cryptic011/Watched-Tracker',GITHUB_RUN_ID:'1',GITHUB_EVENT_NAME:'push'}){
  return vm.runInNewContext(`(async()=>{${source}})()`,{
    WatchLogDeployment:{config:{url:'https://backend.test',key:'public-key',topic:'watchlog-deployments',event:'deployed'}},
    process:{env},URL,AbortSignal,fetch,setTimeout:fn=>fn(),console:{log(){}},
  });
}
test('Deployments broadcast only after both page and metadata serve the exact commit',async()=>{
  const calls=[];
  await run(async(url,options)=>{
    calls.push(String(url));
    if(options.method==='POST'){
      assert.equal(calls.length,1);assert.equal(options.headers.apikey,'public-key');
      assert.deepEqual(JSON.parse(options.body),{messages:[{topic:'watchlog-deployments',event:'deployment_status',payload:{sha,status:'success',runNumber:'162',title:'Push',commitUrl:`https://github.com/Cryptic011/Watched-Tracker/commit/${sha}`,runUrl:'https://github.com/Cryptic011/Watched-Tracker/actions/runs/1'},private:false}]});
      return {ok:true};
    }
    return {ok:true,text:async()=>`window.WATCHLOG_BUILD={"sha":"${sha}"};`};
  });
  assert.ok(calls[1].startsWith('https://example.test/Watched-Tracker/?'));
  assert.ok(calls[2].startsWith('https://example.test/Watched-Tracker/build-info.js?'));
  assert.deepEqual(JSON.parse(await (async()=>{return '{}';})()),{});
});
test('Stale HTML never broadcasts even if build-info already contains the new commit',async()=>{
  let broadcasts=0;
  await assert.rejects(run(async(url,options)=>{
    if(options.method==='POST'){broadcasts++;if(broadcasts===1)return {ok:true};
    return {ok:true,text:async()=>String(url).includes('build-info.js')?`"sha":"${sha}"`:'old HTML'};
  }),/did not serve/);
  assert.equal(broadcasts,1);
});
test('A failed broadcast is retried and a persistent failure fails the deployment step',async()=>{
  let broadcasts=0;
  await assert.rejects(run(async(_url,options)=>{
    if(options.method==='POST'){broadcasts++;if(broadcasts===1)return {ok:true};return {ok:false,status:503};}
    return {ok:true,text:async()=>`"sha":"${sha}"`};
  }),/503/);
  assert.equal(broadcasts,4);
});
