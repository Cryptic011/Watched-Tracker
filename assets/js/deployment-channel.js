/* Public deployment hints contain no account data. They only trigger a check of
 * this site's build-info.js; they are never trusted as authority to reload.
 * Supabase Realtime protocol v1: https://supabase.com/docs/guides/realtime/protocol
 */
(function(root){
  'use strict';
  const config=Object.freeze({
    url:'https://okkwteywtgfsnlrjdyhv.supabase.co',
    key:'sb_publishable_m_kQ30ayzPzNYm585knfpg_D5GXMuF-',
    topic:'watchlog-deployments',
    event:'deployed',
  });
  function start(onSignal){
    if(typeof root.WebSocket!=='function')return ()=>{};
    let socket=null,retry=null,heartbeat=null,deadline=null,stopped=false,failures=0,lastSignal=-Infinity;
    const visible=()=>!stopped&&root.navigator.onLine!==false&&root.document.visibilityState!=='hidden';
    const clearTimers=()=>{clearTimeout(retry);clearTimeout(deadline);clearInterval(heartbeat);retry=heartbeat=deadline=null;};
    function disconnect(){
      clearTimers();
      const old=socket;socket=null;
      if(old){old.onclose=old.onerror=old.onmessage=old.onopen=null;old.close();}
    }
    function reconnect(){
      disconnect();
      if(visible())retry=setTimeout(connect,Math.min(30000,1000*2**Math.min(failures++,5)));
    }
    function connect(){
      if(!visible()||socket)return;
      clearTimeout(retry);retry=null;
      let ws;
      try{ws=new root.WebSocket(`${config.url.replace('https:','wss:')}/realtime/v1/websocket?apikey=${encodeURIComponent(config.key)}&vsn=1.0.0`);}
      catch(_){reconnect();return;}
      socket=ws;
      let reference=1,pendingHeartbeat=null;
      const topic=`realtime:${config.topic}`;
      const send=(event,payload={},channel=topic,ref=String(++reference))=>{
        ws.send(JSON.stringify({topic:channel,event,payload,ref,join_ref:channel===topic?'1':undefined}));return ref;
      };
      deadline=setTimeout(reconnect,15000);
      ws.onopen=()=>send('phx_join',{config:{broadcast:{self:false,ack:false},presence:{enabled:false},private:false}},topic,'1');
      ws.onmessage=event=>{
        if(socket!==ws)return;
        let message;try{message=JSON.parse(event.data);}catch(_){return;}
        if(message.event==='phx_reply'&&message.topic===topic&&message.ref==='1'){
          if(message.payload?.status!=='ok'){reconnect();return;}
          clearTimeout(deadline);deadline=null;failures=0;
          // One catch-up check after joining covers deployments missed offline.
          onSignal('');
          clearInterval(heartbeat);
          heartbeat=setInterval(()=>{
            if(pendingHeartbeat){reconnect();return;}
            pendingHeartbeat=send('heartbeat',{},'phoenix');
          },25000); // Transport keepalive only; never checks for deployments.
        }else if(message.event==='phx_reply'&&message.topic==='phoenix'&&message.ref===pendingHeartbeat){
          pendingHeartbeat=null;
        }else if(message.topic===topic&&['phx_error','phx_close'].includes(message.event)){
          reconnect();
        }else if(message.topic===topic&&message.event==='broadcast'&&message.payload?.event===config.event){
          const sha=message.payload?.payload?.sha;
          if(!/^[a-f0-9]{40}$/.test(sha||'')||Date.now()-lastSignal<2000)return;
          lastSignal=Date.now();onSignal(sha);
        }
      };
      ws.onclose=ws.onerror=()=>{if(socket===ws)reconnect();};
    }
    const resume=()=>{if(visible())connect();else disconnect();};
    root.document.addEventListener('visibilitychange',resume);
    root.addEventListener('online',resume);
    root.addEventListener('offline',resume);
    root.addEventListener('pagehide',disconnect);
    root.addEventListener('pageshow',resume);
    connect();
    return ()=>{
      stopped=true;disconnect();
      root.document.removeEventListener('visibilitychange',resume);
      root.removeEventListener('online',resume);root.removeEventListener('offline',resume);
      root.removeEventListener('pagehide',disconnect);root.removeEventListener('pageshow',resume);
    };
  }
  root.WatchLogDeployment=Object.freeze({config,start});
})(globalThis);
