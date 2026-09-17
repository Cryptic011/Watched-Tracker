import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const rows=execFileSync('git',['log','--topo-order','--format=%H%x09%cs%x09%s'],{encoding:'utf8'}).trim().split('\n');
const notes=JSON.parse(readFileSync('release-notes.json','utf8'));
const commits=rows.map((row,index)=>{const [commit,date,...subject]=row.split('\t');const title=subject.join('\t');return {push:rows.length-index,commit,date,title,changes:[title],...notes[commit]};});
const script='window.WATCHLOG_BUILD='+JSON.stringify({count:commits.length,sha:commits[0].commit,commits}).replaceAll('<','\\u003c')+';\n';
writeFileSync('build-info.js',script);
// Embed metadata so the page and changelog cannot cache different revisions.
const html=readFileSync('index.html','utf8');
const marker='<script src="build-info.js"></script>';
if(!html.includes(marker))throw new Error('Build metadata script marker missing');
writeFileSync('index.html',html.replace(marker,()=>'<script>'+script+'</script>'));
