import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const rows=execFileSync('git',['log','--topo-order','--format=%H%x09%cs%x09%s'],{encoding:'utf8'}).trim().split('\n');
const commits=rows.map((row,index)=>{const [commit,date,...subject]=row.split('\t');const title=subject.join('\t');return {push:rows.length-index,commit,date,title,changes:[title]};});
writeFileSync('build-info.js','window.WATCHLOG_BUILD='+JSON.stringify({count:commits.length,sha:commits[0].commit,commits}).replaceAll('<','\\u003c')+';\n');
