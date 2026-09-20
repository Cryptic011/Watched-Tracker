"use strict";

/*
 * Watched Logger notification worker.
 * This worker intentionally has no fetch handler and no cache, so the Home
 * Screen app continues to load the latest GitHub Pages version.
 */
self.addEventListener("install",()=>self.skipWaiting());

self.addEventListener("activate",event=>{
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push",event=>{
  let payload={
    title:"Watched Logger",
    body:"A Watched Logger reminder is ready.",
    tag:"watchlog-reminder",
    data:{url:"./"}
  };
  try{
    if(event.data)payload={...payload,...event.data.json()};
  }catch(_){
    if(event.data)payload.body=event.data.text()||payload.body;
  }

  // Preserve the actual show and episode from the backend. Replacing this
  // with generic text makes simultaneous release reminders indistinguishable.
  const body=String(payload.body||"");
  const episodeReleased=/episode\s+\d+\s+(?:is\s+available\s+now|is\s+out\s+now)\.?/i.test(body);
  if(episodeReleased){
    payload.title="Watched Logger reminder";
  }

  event.waitUntil(
    self.registration.showNotification(payload.title||"Watched Logger",{
      body:payload.body||"",
      tag:payload.tag||"watchlog-reminder",
      renotify:true,
      data:payload.data||{url:"./"}
    })
  );
});

function notificationUrlWithinScope(value){
  const scopeUrl=new URL(self.registration.scope);
  try{
    const requestedUrl=new URL(value||"./",scopeUrl);
    const scopePath=scopeUrl.pathname.endsWith("/")?scopeUrl.pathname:`${scopeUrl.pathname}/`;
    const scopeRoot=scopePath.slice(0,-1);
    const insideScope=requestedUrl.origin===scopeUrl.origin&&(
      scopePath==="/"||requestedUrl.pathname===scopeRoot||requestedUrl.pathname.startsWith(scopePath)
    );
    return insideScope?requestedUrl.href:scopeUrl.href;
  }catch(_){
    return scopeUrl.href;
  }
}

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const appUrl=notificationUrlWithinScope(event.notification.data?.url);
  event.waitUntil(
    (async()=>{
      const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
      const existing=windows.find(client=>client.url.startsWith(self.registration.scope));
      if(existing){
        try{
          const target="navigate" in existing?(await existing.navigate(appUrl)||existing):existing;
          return await target.focus();
        }catch(_){}
      }
      return self.clients.openWindow?self.clients.openWindow(appUrl):undefined;
    })()
  );
});
