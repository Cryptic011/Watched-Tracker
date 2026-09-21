import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
test('Closed-app reminders preserve the show and episode instead of generic text',async()=>{
  const listeners={},shown=[];
  const self={addEventListener:(event,fn)=>listeners[event]=fn,registration:{showNotification:async(title,options)=>shown.push({title,...options})}};
  vm.runInNewContext(source,{self,URL});
  for(const [name,episode] of [['NCIS',3],['Reacher',4]]){
    let work;
    listeners.push({data:{json:()=>({title:'Watched log reminder',body:`${name} episode ${episode} is out now.`,tag:name,data:{url:'./'}})},waitUntil:p=>work=p});
    await work;
  }
  assert.equal(shown[0].title,'Watch Logger Reminder');
  assert.equal(shown[0].body,'NCIS episode 3 is out now.');
  assert.equal(shown[1].body,'Reacher episode 4 is out now.');
  assert.notEqual(shown[0].tag,shown[1].tag);
});

test('Only unread real reminders set a badge; tests and visible apps do not',async()=>{
 for(const [data,visible,expected] of [[{kind:'reminder'},false,1],[{eventKey:'release'},false,1],[{kind:'reminder',test:true},false,0],[{kind:'deployment'},false,0],[{kind:'reminder'},true,0]]){
  const listeners={};let badges=0,shown=0,work;
  const self={addEventListener:(event,fn)=>listeners[event]=fn,navigator:{setAppBadge:async()=>badges++},clients:{matchAll:async()=>visible?[{visibilityState:'visible'}]:[]},registration:{showNotification:async()=>shown++}};
  vm.runInNewContext(source,{self,URL});
  listeners.push({data:{json:()=>({body:'NCIS releases in 6 hours.',data})},waitUntil:p=>work=p});await work;
  assert.equal(badges,expected);assert.equal(shown,1);
 }
});
test('Badge failure cannot suppress a notification',async()=>{
 const listeners={};let shown=0,work;
 const self={addEventListener:(event,fn)=>listeners[event]=fn,navigator:{setAppBadge:async()=>{throw Error('Unsupported');}},clients:{matchAll:async()=>[]},registration:{showNotification:async()=>shown++}};
 vm.runInNewContext(source,{self,URL});listeners.push({data:{json:()=>({data:{kind:'reminder'}})},waitUntil:p=>work=p});await work;assert.equal(shown,1);
});
