import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={window:{}};
vm.runInNewContext(fs.readFileSync(new URL('../library-gallery.js',import.meta.url),'utf8'),context);
const {sections}=context.window.WatchLogGallery;
const now=Date.parse('2026-09-15T12:00:00Z');
const upcoming=item=>item.event||{rank:0,time:Infinity};
test('A released series also appears in upcoming when its next episode is scheduled',()=>{
  const show={id:'a',type:'Series',seriesReleaseDate:'2022-01-01',event:{rank:2,time:now+100}};
  const result=sections([show],upcoming,now);
  assert.equal(result.future[0],show);assert.equal(result.released[0],show);assert.equal(result.remaining.length,0);
});
test('Upcoming dates sort before TBA independent of watched status',()=>{
  const rows=[{id:'tba',status:'Watching',event:{rank:1,time:Infinity}},{id:'late',status:'Planned',event:{rank:2,time:now+200}},{id:'soon',status:'Watched',event:{rank:2,time:now+100}}];
  assert.equal(sections(rows,upcoming,now).future.map(x=>x.id).join(','),'soon,late,tba');
});
test('Unknown releases stay separate and future films are not marked released',()=>{
  const rows=[{id:'future',type:'Film',filmReleaseDate:'2027-01-01',event:{rank:2,time:now+100}},{id:'old',type:'Film',releaseYear:'2024'},{id:'unknown',type:'Film',status:'Watched'}];
  const result=sections(rows,upcoming,now);
  assert.equal(result.released.map(x=>x.id).join(','),'old');assert.equal(result.remaining.map(x=>x.id).join(','),'unknown');
});
