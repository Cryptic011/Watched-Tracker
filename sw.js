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

  event.waitUntil((async()=>{
    await self.registration.showNotification("Watch Logger Reminder",{
      body:payload.body||"A reminder is ready.",
      tag:payload.tag||"watchlog-reminder",
      renotify:true,
      data:payload.data||{url:"./"}
    });
    // Only real release reminders set a badge. Tests and deployment events do not.
    if(!payload.data?.test&&(payload.data?.kind==="reminder"||payload.data?.eventKey)){
      try{
        const windows=await self.clients.matchAll({type:"window"});
        if(!windows.some(client=>client.visibilityState==="visible"))await self.navigator?.setAppBadge?.();
      }catch(_){} // Badge support must never prevent notification delivery.
    }
  })());
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
