import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={window:{}};
vm.runInNewContext(fs.readFileSync(new URL('../library-gallery.js',import.meta.url),'utf8'),context);
const {sections}=context.window.WatchLogGallery;
test('Watched groups use original release years, never added or watched dates',()=>{
  const rows=[{id:'old',type:'Series',seriesReleaseDate:'2003-09-23',date:'2026-09-21',releaseYear:2026},{id:'new',type:'Film',filmReleaseDate:'2024-07-25',date:'2020-01-01'},{id:'year',type:'Series',releaseYear:2022},{id:'unknown',type:'Film',date:'2026-01-01'}];
  const groups=context.window.WatchLogGallery.releaseGroups(rows);
  assert.equal(groups.map(g=>g.year).join(','),'2024,2022,2003,Date unknown');
  assert.equal(groups[2].rows[0].id,'old');assert.equal(rows[0].id,'old');
});
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

test('Gallery calculates upcoming metadata once per title with a consistent clock',()=>{
 const rows=Array.from({length:500},(_,i)=>({id:String(i),type:'Film',event:{rank:2,time:now+500-i}})),calls=[];
 const result=sections(rows,(item,time)=>{calls.push([item.id,time]);return item.event;},now);
 assert.equal(calls.length,rows.length);assert.ok(calls.every(([,time])=>time===now));
 assert.equal(result.future[0].id,'499');assert.equal(result.future.at(-1).id,'0');
 assert.equal(rows[0].id,'0');
});
