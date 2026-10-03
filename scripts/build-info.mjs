import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const rows=execFileSync('git',['log','--topo-order','--format=%H%x09%cs%x09%s'],{encoding:'utf8'}).trim().split('\n');
const notes=JSON.parse(readFileSync('release-notes.json','utf8'));
const commits=rows.map((row,index)=>{const [commit,date,...subject]=row.split('\t');const title=subject.join('\t');const note=notes[commit]||(index===0?notes.__current:null);return {push:rows.length-index,commit,date,title,changes:[title],...note};});
let workflowRunCount=null;
if(process.env.GITHUB_REPOSITORY&&(process.env.WATCHLOG_GITHUB_TOKEN||process.env.GITHUB_TOKEN)){
  const response=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/runs?per_page=1`,{
    headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:`Bearer ${process.env.WATCHLOG_GITHUB_TOKEN||process.env.GITHUB_TOKEN}`}
  });
  if(!response.ok)throw new Error(`GitHub Actions count request failed: ${response.status}`);
  const result=await response.json();
  if(!Number.isInteger(result.total_count))throw new Error('GitHub Actions count was unavailable');
  workflowRunCount=result.total_count;
}
const releaseNumber=workflowRunCount;
if(Number.isInteger(releaseNumber)&&commits[0])commits[0].number=releaseNumber;
const script='window.WATCHLOG_BUILD='+JSON.stringify({count:commits.length,releaseNumber,workflowRunCount,runNumber:process.env.GITHUB_RUN_NUMBER||null,sha:commits[0].commit,commits}).replaceAll('<','\\u003c')+';\n';
writeFileSync('build-info.js',script);
// Embed metadata so the page and changelog cannot cache different revisions.
const html=readFileSync('index.html','utf8');
const marker='<script src="build-info.js"></script>';
if(!html.includes(marker))throw new Error('Build metadata script marker missing');
// Each deployment must request its own scripts/styles, including files whose
// hand-written query version was not changed. Keep external URLs untouched.
const versionedHtml=html.replace(/\b(src|href)="([^"?#]+\.(?:js|css))(?:\?[^"#]*)?"/g,(attribute,name,path)=>
  /^(?:[a-z]+:|\/\/)/i.test(path)?attribute:`${name}="${path}?v=${commits[0].commit}"`);
writeFileSync('index.html',versionedHtml.replace(`<script src="build-info.js?v=${commits[0].commit}"></script>`,()=>'<script>'+script+'</script>'));
