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
  assert.equal(shown[0].title,'Watched Logger reminder');
  assert.equal(shown[0].body,'NCIS episode 3 is out now.');
  assert.equal(shown[1].body,'Reacher episode 4 is out now.');
  assert.notEqual(shown[0].tag,shown[1].tag);
});
