import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('All browser files execute in HTML order before asynchronous startup',()=>{
 const element=()=>new Proxy({style:{},dataset:{},value:'',classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelector(){return element()},querySelectorAll(){return[]},closest(){return element()},getAttribute(){return''},getBoundingClientRect(){return {width:390}},addEventListener(){},setAttribute(){},appendChild(){},append(){},before(){},after(){},insertBefore(){},replaceChildren(){}},{get:(o,k)=>k in o?o[k]:undefined});
 const elements=new Map(),document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},querySelector:()=>element(),querySelectorAll:()=>[],createElement:element,addEventListener(){},body:element(),documentElement:element()};
 const context=vm.createContext({console,document,navigator:{language:'en-GB',userAgent:'test'},Intl,Date,URL,TextEncoder,AbortController,crypto:globalThis.crypto,localStorage:{getItem:()=>null,setItem(){}},matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},setInterval(){},setTimeout(){},clearTimeout(){},requestAnimationFrame(){},cancelAnimationFrame(){},fetch:()=>new Promise(()=>{})});context.window=context;
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const paths=[...html.matchAll(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g)].map(m=>m[1]).filter(p=>p!=='build-info.js');
 for(const path of paths){const source=fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');assert.doesNotThrow(()=>vm.runInContext(source,context,{filename:path}),path);}
 assert.equal(vm.runInContext('typeof renderDashboard',context),'function');
});
