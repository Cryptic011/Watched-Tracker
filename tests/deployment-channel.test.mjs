import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../assets/js/deployment-channel.js',import.meta.url),'utf8');
function harness(){
  const sockets=[],signals=[],timers=new Map(),listeners={};let id=0,now=10000;
  const events={addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:name=>delete listeners[name]};
  class WebSocket{
    constructor(url){this.url=url;this.sent=[];sockets.push(this);}
    send(raw){this.sent.push(JSON.parse(raw));}
    close(){this.closed=true;}
    receive(message){this.onmessage?.({data:JSON.stringify(message)});}
  }
  const context=vm.createContext({WebSocket,navigator:{onLine:true},document:{visibilityState:'visible',...events},...events,
    Date:{now:()=>now},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:key=>timers.delete(key),
    setInterval:(fn,ms)=>{timers.set(++id,{fn,ms,interval:true});return id;},clearInterval:key=>timers.delete(key)});
  vm.runInContext(source,context);
  const stop=context.WatchLogDeployment.start(sha=>signals.push(sha));
  const topic='realtime:watchlog-deployments';
  const join=()=>{const ws=sockets.at(-1);ws.onopen();ws.receive({topic,event:'phx_reply',ref:'1',payload:{status:'ok'}});return ws;};
  const signal=(sha='b'.repeat(40),extra={})=>sockets.at(-1).receive({topic,event:'broadcast',payload:{event:'deployed',payload:{sha}},...extra});
  return {context,sockets,signals,timers,listeners,join,signal,stop,advance:()=>now+=3000};
}
test('Realtime joins a public channel, then checks once; keepalives never poll versions',()=>{
  const h=harness(),ws=h.join();assert.deepEqual(h.signals,['']);
  assert.equal(ws.sent[0].event,'phx_join');assert.equal(ws.sent[0].payload.config.private,false);
  const beat=[...h.timers.values()].find(t=>t.interval);beat.fn();
  assert.equal(ws.sent.at(-1).event,'heartbeat');assert.deepEqual(h.signals,['']);
  ws.receive({topic:'phoenix',event:'phx_reply',ref:ws.sent.at(-1).ref,payload:{status:'ok'}});
  beat.fn();assert.equal(ws.closed,undefined);
});
test('Only deployment hints with a complete SHA are accepted, and bursts are throttled',()=>{
  const h=harness();h.join();h.signal('bad');h.signal('a'.repeat(40),{topic:'other'});
  assert.deepEqual(h.signals,['']);h.signal();h.signal();assert.equal(h.signals.length,2);
  h.advance();h.signal('c'.repeat(40));assert.equal(h.signals.length,3);
});
test('Hidden and offline apps close connections and reconnect once on return',()=>{
  const h=harness(),ws=h.join();h.context.document.visibilityState='hidden';h.listeners.visibilitychange();
  assert.equal(ws.closed,true);assert.equal(h.timers.size,0);
  h.context.document.visibilityState='visible';h.listeners.visibilitychange();h.listeners.pageshow();
  assert.equal(h.sockets.length,2);h.join();assert.equal(h.signals.length,2);
  h.context.navigator.onLine=false;h.listeners.offline();assert.equal(h.sockets[1].closed,true);
  h.context.navigator.onLine=true;h.listeners.online();assert.equal(h.sockets.length,3);
  h.stop();assert.equal(h.timers.size,0);assert.equal(Object.keys(h.listeners).length,0);
});
test('Join failures and silent sockets recover with bounded exponential backoff',()=>{
  const h=harness(),ws=h.sockets[0];ws.onopen();
  ws.receive({topic:'realtime:watchlog-deployments',event:'phx_reply',ref:'1',payload:{status:'error'}});
  assert.deepEqual(h.signals,[]);assert.equal(ws.closed,true);
  const retry=[...h.timers.values()][0];assert.equal(retry.ms,1000);retry.fn();
  const deadline=[...h.timers.values()].find(t=>t.ms===15000);deadline.fn();
  assert.equal(h.sockets[1].closed,true);assert.equal([...h.timers.values()][0].ms,2000);
});
test('Missing heartbeat replies reconnect without accumulating sockets or timers',()=>{
  const h=harness(),ws=h.join(),beat=[...h.timers.values()].find(t=>t.interval);
  beat.fn();beat.fn();assert.equal(ws.closed,true);assert.equal(h.timers.size,1);
  assert.equal([...h.timers.values()][0].interval,undefined);
});
