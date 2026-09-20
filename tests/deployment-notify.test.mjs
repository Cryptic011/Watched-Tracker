import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../scripts/notify-deployment.mjs',import.meta.url),'utf8').replace(/^import [^\n]+\n/,'');
const sha='a'.repeat(40);
function run(fetch,env={GITHUB_SHA:sha,WATCHLOG_PAGE_URL:'https://example.test/Watched-Tracker/'}){
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
      assert.equal(calls.length,3);assert.equal(options.headers.apikey,'public-key');
      assert.deepEqual(JSON.parse(options.body),{messages:[{topic:'watchlog-deployments',event:'deployed',payload:{sha},private:false}]});
      return {ok:true};
    }
    return {ok:true,text:async()=>`window.WATCHLOG_BUILD={"sha":"${sha}"};`};
  });
  assert.ok(calls[0].startsWith('https://example.test/Watched-Tracker/?'));
  assert.ok(calls[1].startsWith('https://example.test/Watched-Tracker/build-info.js?'));
});
test('Stale HTML never broadcasts even if build-info already contains the new commit',async()=>{
  let broadcasts=0;
  await assert.rejects(run(async(url,options)=>{
    if(options.method==='POST')broadcasts++;
    return {ok:true,text:async()=>String(url).includes('build-info.js')?`"sha":"${sha}"`:'old HTML'};
  }),/did not serve/);
  assert.equal(broadcasts,0);
});
test('A failed broadcast is retried and a persistent failure fails the deployment step',async()=>{
  let broadcasts=0;
  await assert.rejects(run(async(_url,options)=>{
    if(options.method==='POST'){broadcasts++;return {ok:false,status:503};}
    return {ok:true,text:async()=>`"sha":"${sha}"`};
  }),/503/);
  assert.equal(broadcasts,3);
});
