import test from 'node:test';
import assert from 'node:assert/strict';
import {getUKAvailability,getJustWatchAvailability} from '../supabase/functions/watchlog-pin/uk-availability.mjs';
const node=(imdbId,name,offers=[],objectType='SHOW')=>({objectType,content:{title:name,externalIds:{imdbId},fullPath:'/uk/tv-series/example'},offers});
const offer=(clearName,presentationType='HD')=>({monetizationType:'FLATRATE',presentationType,package:{clearName}});
const response=nodes=>({ok:true,json:async()=>({data:{popularTitles:{edges:nodes.map(node=>({node}))}}})});

test('UK lookup works without a token and rejects the same-name wrong IMDb identity',async()=>{
  let query;
  const result=await getUKAvailability({title:'Lioness fixture',type:'Series',imdbId:'tt9000001'},'',async(_url,options)=>{
    query=JSON.parse(options.body);
    return response([node('tt9000002','Lioness fixture',[offer('Wrong service')]),node('tt9000001','Lioness fixture',[offer('Paramount Plus'),offer('Paramount Plus')])]);
  });
  assert.equal(result.identityMatched,true);assert.equal(result.state,'available');
  assert.deepEqual(result.providers,[{name:'Paramount+',types:['Subscription']}]);
  assert.ok(query.query.includes('country: GB'));assert.equal(query.variables.title,'Lioness fixture');
});
test('Disc-only offers are not streaming and a wrong-format match is not accepted',async()=>{
  const result=await getJustWatchAvailability({title:'Disc fixture',type:'Series',imdbId:'tt9000003'},async()=>response([node('tt9000003','Disc fixture',[offer('Zavvi','BLURAY')])]));
  assert.equal(result.state,'none');
  const mismatch=await getJustWatchAvailability({title:'Mismatch',type:'Film',imdbId:'tt9000004'},async()=>response([node('tt9000004','Mismatch',[offer('Netflix')])]));
  assert.equal(mismatch.state,'unmatched');
});
test('A missing IMDb ID is resolved through IMDb using title, year and format',async()=>{
  const calls=[];
  const result=await getJustWatchAvailability({title:'Identity fixture',year:'2023',type:'Series'},async(url)=>{
    calls.push(url);
    if(url.includes('media-imdb'))return{ok:true,json:async()=>({d:[{id:'tt9000005',l:'Identity fixture',y:2023,qid:'tvSeries'},{id:'tt9000006',l:'Identity fixture',y:2021,qid:'tvSeries'}]})};
    return response([node('tt9000005','Identity fixture',[offer('Amazon Prime Video')])]);
  });
  assert.equal(calls.length,2);assert.equal(result.imdbId,'tt9000005');assert.equal(result.providers[0].name,'Prime Video');
});
test('Malformed upstream responses remain errors instead of reporting N/A',async()=>{
  await assert.rejects(getUKAvailability({title:'Failure fixture',type:'Series',imdbId:'tt9000007'},'',async()=>({ok:true,json:async()=>({errors:[{message:'unavailable'}]})})));
});
