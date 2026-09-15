import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(process.env.GALLERY_SOURCE||new URL('../library-gallery.js',import.meta.url),'utf8');
function gallery({observer=true,results=[]}={}){
  const observed=[],lookups=[];
  const img={hidden:true,dataset:{art:'Film:tt1877830'},set src(url){this.url=url;this.onload?.();}};
  const box={querySelector:()=>img};img.parentElement=box;
  const host={classList:{add(){}},addEventListener(){},querySelectorAll:()=>[img]};
  const context={window:{},URL,AbortSignal,document:{querySelectorAll:()=>[img]},fetch:()=>{throw Error('A film must use the server catalogue');}};
  if(observer)context.IntersectionObserver=class{constructor(callback){this.callback=callback;}disconnect(){}unobserve(){}observe(target){observed.push(target);if(target!==img)queueMicrotask(()=>this.callback([{isIntersecting:true,target}]));}};
  vm.runInNewContext(source,context);
  context.window.WatchLogGallery.mount(host,[{id:'film',type:'Film',title:'The Batman',releaseYear:2022,imdbId:'tt1877830'}],{artwork:async item=>{lookups.push(item.imdbId);return results;}});
  return {img,box,observed,lookups};
}
const poster='https://m.media-amazon.com/images/M/batman.jpg';
test('Hidden images load when their visible poster cards enter the viewport',async()=>{
  const app=gallery({results:[{imdbId:'tt1877830',posterUrl:poster}]});
  await new Promise(setImmediate);
  assert.equal(app.observed[0],app.box);
  assert.deepEqual(app.lookups,['tt1877830']);
  assert.equal(app.img.url,poster);assert.equal(app.img.hidden,false);
});
test('Posters also load when IntersectionObserver is unavailable',async()=>{
  const app=gallery({observer:false,results:[{imdbId:'tt1877830',posterUrl:poster}]});
  await new Promise(setImmediate);assert.equal(app.img.url,poster);
});
test('Ambiguous same-name series do not borrow another show poster',async()=>{
  const app=gallery({results:[]});
  await new Promise(setImmediate);
  assert.equal(app.img.url,undefined);
});
test('A different IMDb identity cannot supply a films poster',async()=>{
  const app=gallery({results:[{imdbId:'tt0000000',title:'The Batman',posterUrl:poster}]});
  await new Promise(setImmediate);assert.equal(app.img.url,undefined);
});
test('Server catalogue retains the official IMDb poster and rejects arbitrary hosts',()=>{
  const server=fs.readFileSync(new URL('../supabase/functions/watchlog-pin/index.ts',import.meta.url),'utf8');
  const fn=server.slice(server.indexOf('function imdbSuggestion('),server.indexOf('async function searchCatalog(')).replace('row: any','row');
  const ctx={catalogText:(v,n=200)=>String(v||'').slice(0,n)};vm.createContext(ctx);vm.runInContext(fn,ctx);
  assert.equal(ctx.imdbSuggestion({id:'tt1877830',l:'The Batman',i:{imageUrl:poster}}).posterUrl,poster);
  assert.equal(ctx.imdbSuggestion({id:'tt1877830',i:{imageUrl:'https://example.com/a.jpg'}}).posterUrl,'');
});
