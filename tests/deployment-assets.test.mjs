import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('Each deployed script and stylesheet uses the current commit URL',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'watchlog-build-'));
  try{
    const original=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8')
      .replace(/<script>window\.WATCHLOG_BUILD=[\s\S]*?<\/script>/,'<script src="build-info.js"></script>');
    const html=original+'\n<script src="https://example.test/external.js?v=1"></script>';
    fs.writeFileSync(path.join(dir,'index.html'),html);
    fs.writeFileSync(path.join(dir,'release-notes.json'),'{}');
    fs.copyFileSync(new URL('../scripts/build-info.mjs',import.meta.url),path.join(dir,'build-info.mjs'));
    const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    git('init');git('add','.');
    git('-c','user.name=Test','-c','user.email=test@example.test','commit','-m','First build');
    const run=()=>{
      fs.writeFileSync(path.join(dir,'index.html'),html);
      execFileSync(process.execPath,['build-info.mjs'],{cwd:dir});
      const built=fs.readFileSync(path.join(dir,'index.html'),'utf8'),sha=git('rev-parse','HEAD');
      const assets=[...built.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))\?v=([^"#]+)"/g)].filter(m=>!m[1].startsWith('https:'));
      assert.equal(assets.length,11);
      for(const asset of assets)assert.equal(asset[2],sha,asset[1]);
      assert.ok(built.includes(`"sha":"${sha}"`));
      assert.ok(built.includes('https://example.test/external.js?v=1'));
      assert.ok(!built.includes('<script src="build-info.js'));
      return assets[0][0];
    };
    const first=run();
    git('-c','user.name=Test','-c','user.email=test@example.test','commit','--allow-empty','-m','Second build');
    assert.notEqual(run(),first);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
