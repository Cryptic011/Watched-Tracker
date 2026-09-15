import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('  let globalSwipeX='),html.indexOf('  let searchQuery ='));
function setup(view){
  const calls=[],listeners={};let now=1000;
  const context=vm.createContext({Date:{now:()=>now},document:{querySelector:()=>view==='detail'?{close:()=>calls.push('detail')}:null,addEventListener:(n,f)=>listeners[n]=f},episodeTrackerModal:{classList:{contains:()=>view!=='tracker'}},modal:{classList:{contains:()=>view!=='editor'}},closeEpisodeTrackerSheet:()=>calls.push('tracker'),closeEditor:()=>calls.push('editor'),currentTab:view==='settings'?'settings':'library',switchTab:()=>calls.push('library'),window:{WatchLogGallery:{back:()=>calls.push('category')}}});
  vm.runInContext(source,context);
  const target={closest:()=>null};
  return {calls,swipe:(dx=-100,dy=0)=>{listeners.pointerdown({pointerType:'touch',clientX:200,clientY:100,target});listeners.touchstart({changedTouches:[{clientX:200,clientY:100}],target});now+=100;listeners.pointerup({pointerType:'touch',clientX:200+dx,clientY:100+dy,target});listeners.touchend({changedTouches:[{clientX:200+dx,clientY:100+dy}],target});}};
}
for(const view of ['detail','tracker','editor','settings','category'])test(`One left swipe backs out of ${view} once despite paired events`,()=>{const app=setup(view);app.swipe();assert.deepEqual(app.calls,[view==='settings'?'library':view]);});
test('Vertical scroll and right swipes do not navigate',()=>{for(const [dx,dy] of [[-80,180],[120,0]]){const app=setup('category');app.swipe(dx,dy);assert.deepEqual(app.calls,[]);}});
