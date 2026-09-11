import test from 'node:test';
import assert from 'node:assert/strict';
import {getUKAvailability,ukProviders} from '../supabase/functions/watchlog-pin/uk-availability.mjs';

test('UK providers exclude US-only services and distinguish rent from subscription',()=>{
  assert.deepEqual(ukProviders({results:{US:{flatrate:[{provider_id:1,provider_name:'US only'}]},GB:{flatrate:[{provider_id:2,provider_name:'UK service'}],rent:[{provider_id:2,provider_name:'UK service'}]}}}),[{name:'UK service',types:['Subscription','Rent']}]);
});
test('IMDb identity and media format determine the availability lookup',async()=>{
  const calls=[];
  const result=await getUKAvailability({imdbId:'tt1234567',title:'Example',type:'Series'},'test-token',async url=>{
    calls.push(url);return{ok:true,json:async()=>url.includes('/find/')?{movie_results:[{id:9}],tv_results:[{id:7}]}:{results:{GB:{free:[{provider_id:2,provider_name:'BBC iPlayer'}]}}}};
  });
  assert.equal(result.state,'available');assert.ok(calls[1].includes('/tv/7/watch/providers'));
  assert.equal(result.providers[0].name,'BBC iPlayer');
});
test('Successful empty GB results are none, while unmatched and unconfigured are not N/A',async()=>{
  const empty=await getUKAvailability({imdbId:'tt2234567',type:'Film'},'token',async url=>({ok:true,json:async()=>url.includes('/find/')?{movie_results:[{id:8}]}:{results:{US:{flatrate:[]}}}}));
  assert.equal(empty.state,'none');
  assert.equal((await getUKAvailability({title:'Example'},'')).state,'unconfigured');
  const unmatched=await getUKAvailability({title:'Another',type:'Series'},'token',async()=>({ok:true,json:async()=>({results:[{id:1,name:'Another'},{id:2,name:'Another'}]})}));
  assert.equal(unmatched.state,'unmatched');
});
test('Provider outages and incomplete responses are errors, never no availability',async()=>{
  await assert.rejects(getUKAvailability({imdbId:'tt3234567',type:'Film'},'token',async()=>({ok:false})));
  await assert.rejects(getUKAvailability({imdbId:'tt4234567',type:'Film'},'token',async url=>({ok:true,json:async()=>url.includes('/find/')?{movie_results:[{id:10}]}:{}})));
});
