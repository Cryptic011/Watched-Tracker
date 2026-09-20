import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(process.env.GALLERY_SOURCE||new URL('../library-gallery.js',import.meta.url),'utf8');
function gallery({observer=true,results=[],item={id:'film',type:'Film',title:'The Batman',releaseYear:2022,imdbId:'tt1877830'},fetchImpl=()=>{throw Error('Unexpected direct lookup');}}={}){
  const observed=[],lookups=[];
  const img={hidden:true,dataset:{art:`${item.type}:${item.imdbId||item.tvmazeShowId||item.id}`} ,set src(url){this.url=url;this.onload?.();}};
  const box={querySelector:()=>img};img.parentElement=box;
  const host={classList:{add(){}},addEventListener(){},querySelectorAll:()=>[img]};
  const context={window:{},URL,AbortSignal,document:{querySelectorAll:()=>[img]},fetch:fetchImpl};
  if(observer)context.IntersectionObserver=class{constructor(callback){this.callback=callback;}disconnect(){}unobserve(){}observe(target){observed.push(target);if(target!==img)queueMicrotask(()=>this.callback([{isIntersecting:true,target}]));}};
  vm.runInNewContext(source,context);
  context.window.WatchLogGallery.mount(host,[item],{artwork:async item=>{lookups.push(item.imdbId);return results;}});
  return {img,box,observed,lookups};
}
const poster='https://m.media-amazon.com/images/M/batman.jpg';
test('Saved teaser artwork is replaced by the current poster for the exact IMDb identity',async()=>{
  const app=gallery({item:{id:'film',type:'Film',title:'The Batman',imdbId:'tt1877830',posterUrl:'https://m.media-amazon.com/teaser.jpg'},results:[{imdbId:'tt1877830',posterUrl:poster}]});
  await new Promise(setImmediate);assert.equal(app.img.url,poster);assert.deepEqual(app.lookups,['tt1877830']);
});
test('A saved poster survives a provider failure or a mismatched search result',async()=>{
  const app=gallery({item:{id:'film',type:'Film',title:'The Batman',imdbId:'tt1877830',posterUrl:poster},results:[{imdbId:'tt0000000',posterUrl:'https://m.media-amazon.com/wrong.jpg'}]});
  await new Promise(setImmediate);assert.equal(app.img.url,poster);
});
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
const reboot={id:'reboot',type:'Series',title:'Prison Break',tvmazeShowId:'83211'};
const original={imdbId:'tt0455275',title:'Prison Break',format:'Series',year:'2005',posterUrl:'https://m.media-amazon.com/original.jpg'};
const response=show=>async()=>({ok:true,json:async()=>show});
test('A known TVMaze series without an IMDb identity cannot borrow same-name catalogue artwork',async()=>{
  const app=gallery({item:reboot,fetchImpl:response({id:83211,image:null,externals:{}}),results:[original]});
  await new Promise(setImmediate);assert.equal(app.img.url,undefined);assert.deepEqual(app.lookups,[]);
});
test('The verified TVMaze IMDb ID selects only the reboot poster, even when the original ranks first',async()=>{
  const rebootPoster='https://m.media-amazon.com/reboot.jpg';
  const app=gallery({item:reboot,fetchImpl:response({id:83211,image:null,externals:{imdb:'tt29730749'}}),results:[original,{...original,imdbId:'tt29730749',posterUrl:rebootPoster}]});
  await new Promise(setImmediate);assert.equal(app.img.url,rebootPoster);assert.deepEqual(app.lookups,['tt29730749']);assert.equal(reboot.imdbId,undefined);
});
test('An unavailable TVMaze lookup does not downgrade a known identity to a title search',async()=>{
  const app=gallery({item:reboot,fetchImpl:async()=>{throw Error('offline');},results:[original]});
  await new Promise(setImmediate);assert.equal(app.img.url,undefined);assert.deepEqual(app.lookups,[]);
});
test('Title-only series lookup rejects ambiguous remakes from both providers',async()=>{
  const app=gallery({item:{id:'unknown',title:'Prison Break',type:'Series'},fetchImpl:response([{show:{id:541,name:'Prison Break'}},{show:{id:83211,name:'Prison Break'}}]),results:[original,{...original,imdbId:'tt29730749'}]});
  await new Promise(setImmediate);assert.equal(app.img.url,undefined);
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
