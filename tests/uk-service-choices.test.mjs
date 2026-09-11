import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('  function ukServiceChoices('),end=html.indexOf('  async function loadUKAvailability',start);
const context=vm.createContext({});vm.runInContext(html.slice(start,end),context);
test('UK choices collapse subscription tiers and channel variants into one service',()=>{
  const rows=context.ukServiceChoices(['Paramount Plus','Paramount Plus Premium','Paramount Plus Basic with Ads','Paramount Plus Apple TV channel','Netflix','Netflix Standard with Ads','ITVX Premium','ITVX'].map(name=>({name,types:['Subscription']})));
  assert.deepEqual(Array.from(rows,row=>row.name),['ITVX','Netflix','Paramount+']);
});
test('Subscriptions precede free, rental and purchase, with direct access before add-on channels',()=>{
  const rows=context.ukServiceChoices([{name:'Apple TV Store',types:['Buy']},{name:'BBC iPlayer',types:['Free']},{name:'Amazon Prime Video with Ads',types:['Subscription']},{name:'Prime Video',types:['Subscription']},{name:'Paramount Plus Apple TV channel',types:['Subscription']},{name:'Sky Store',types:['Rent']}]);
  assert.deepEqual(Array.from(rows,row=>row.name),['Prime Video','Paramount+','BBC iPlayer','Sky Store','Apple TV']);
});
