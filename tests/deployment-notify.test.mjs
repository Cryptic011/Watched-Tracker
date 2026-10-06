import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../scripts/notify-deployment.mjs',import.meta.url),'utf8').replace(/^import [^\n]+\n/,'');
const sha='a'.repeat(40);
function run(fetch,env={GITHUB_SHA:sha,WATCHLOG_PAGE_URL:'https://example.test/Watched-Tracker/',WATCHLOG_STATUS:'success',GITHUB_RUN_NUMBER:'162',GITHUB_SERVER_URL:'https://github.com',GITHUB_REPOSITORY:'Cryptic011/Watched-Tracker',GITHUB_RUN_ID:'1',GITHUB_EVENT_NAME:'push'}){
  return vm.runInNewContext('(async()=>{'+source+'})()',{
    WatchLogDeployment:{config:{url:'https://backend.test',key:'public-key',topic:'watchlog-deployments',event:'deployed'}},
    process:{env},URL,AbortSignal,fetch,setTimeout:fn=>fn(),console:{log(){}},
  });
}
test('Deployments broadcast status first, then broadcast the successful deployment only after Pages serves the exact commit',async()=>{
  const calls=[],posts=[];
  await run(async(url,options)=>{
    calls.push(String(url));
    if(options.method==='POST'){
      posts.push(JSON.parse(options.body));
      return {ok:true};
    }
    return {ok:true,text:async()=>`window.WATCHLOG_BUILD={"sha":"${sha}"};`};
  });
  assert.equal(posts.length,2);
  assert.equal(posts[0].messages[0].event,'deployment_status');
  assert.equal(posts[0].messages[0].payload.sha,sha);
  assert.equal(posts[0].messages[0].payload.status,'success');
  assert.equal(posts[1].messages[0].event,'deployed');
  assert.deepEqual(posts[1].messages[0].payload,{sha});
  assert.ok(calls[1].startsWith('https://example.test/Watched-Tracker/?'));
  assert.ok(calls[2].startsWith('https://example.test/Watched-Tracker/build-info.js?'));
});
test('Stale HTML never sends the successful deployment signal, but still sends status',async()=>{
  let posts=0;
  await assert.rejects(run(async(url,options)=>{
    if(options.method==='POST'){posts++;return {ok:true};}
    return {ok:true,text:async()=>String(url).includes('build-info.js')?`"sha":"${sha}"`:'old HTML'};
  }),/did not serve/);
  assert.equal(posts,1);
});
test('A failed deployment-status broadcast is retried and a persistent failure fails the notification step',async()=>{
  let posts=0;
  await assert.rejects(run(async(_url,options)=>{
    if(options.method==='POST'){posts++;return {ok:false,status:503};}
    return {ok:true,text:async()=>`"sha":"${sha}"`};
  }),/503/);
  assert.equal(posts,3);
});
test('A successful status broadcast is not retried when the later deployed broadcast fails',async()=>{
  let posts=0;
  await assert.rejects(run(async(_url,options)=>{
    if(options.method==='POST'){posts++;return posts===1?{ok:true}:{ok:false,status:503};}
    return {ok:true,text:async()=>`"sha":"${sha}"`};
  }),/503/);
  assert.equal(posts,4);
});
