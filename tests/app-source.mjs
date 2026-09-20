import fs from 'node:fs';
export function readAppSource(){
  const root=new URL('../',import.meta.url);
  return fs.readFileSync(new URL('index.html',root),'utf8').replace(/<script src="(assets\/js\/[^"?]+)(?:\?[^" ]*)?"><\/script>/g,(_,path)=>`<script>\n${fs.readFileSync(new URL(path,root),'utf8')}\n</script>`);
}
