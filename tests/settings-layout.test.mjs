import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('Account & Sync belongs to Settings, never the Library view',()=>{
 const html=read('index.html');
 const library=html.slice(html.indexOf('<div id="library-view"'),html.indexOf('<div id="settings-view"'));
 const settings=html.slice(html.indexOf('<div id="settings-view"'),html.indexOf('<section id="discovery-view"'));
 assert.doesNotMatch(library,/Account & Sync|id="profile-card"|id="sync-now"|id="logout-btn"/);
 assert.match(settings,/Account & Sync/);assert.match(settings,/id="sync-now"/);assert.match(settings,/id="logout-btn"/);
});

test('Settings section order is Account & Sync, Appearance, Background Reminders, Maintenance, then Changelog',()=>{
 const html=read('index.html'),core=read('assets/js/app-core.js');
 const settings=html.slice(html.indexOf('<div id="settings-view"'),html.indexOf('<section id="discovery-view"'));
 const positions=['Account & Sync','Appearance','Background Reminders'].map(label=>settings.indexOf(label));
 assert.ok(positions.every(p=>p>=0),'all static settings sections exist');
 assert.deepEqual([...positions].sort((a,b)=>a-b),positions,'static sections retain requested order');
 assert.match(core,/settingsView\.appendChild\(maintenanceAdminSection\)/);
 assert.match(core,/maintenanceAdminSection\.after\(whatsNewButton\)/);
 assert.doesNotMatch(core,/maintenanceAdminSection\.before\(whatsNewButton\)/);
});

test('Floating Add button is only visible on the Library tab and only under its allowed filters',()=>{
 const library=read('assets/js/library.js');
 assert.match(library,/addBtn\.classList\.toggle\("hidden",!\(currentUser&&currentTab==="library"&&\(!categoryControlsVisible\(\)\|\|activeFilter==="All"\)\)\)/);
 assert.match(library,/button\.addEventListener\("click",\(\)=>\{if\(button\.dataset\.tab!=="library"\)addBtn\.classList\.add\("hidden"\);\}\)/);
 assert.match(library,/libraryView\.classList\.toggle\("hidden",settings\|\|search\);settingsView\.classList\.toggle\("hidden",!settings\)/);
});


test('Verified fixes are committed in source, not injected during deployment',()=>{
 const html=read('index.html'),editor=read('assets/js/editor.js'),sync=read('assets/js/sync.js'),css=read('assets/css/app.css'),workflow=read('.github/workflows/pages.yml');
 assert.doesNotMatch(html,/user-scalable=no/);
 assert.match(editor,/available\.length\?Math\.max\(0,\.\.\.available\.filter\(episode=>episode<=requested\)\):requested/);
 assert.match(sync,/toMillis\(raw\.updatedAt\|\|raw\.date\)>toMillis\(prev\.updatedAt\|\|prev\.date\)/);
 assert.match(css,/max-height:90vh;max-height:90dvh/);
 assert.doesNotMatch(workflow,/apply_fixes\.py/);
});
