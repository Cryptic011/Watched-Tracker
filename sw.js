"use strict";

const NAVIGATION_CACHE = "watchlog-navigation-v2";

self.addEventListener("install",event=>self.skipWaiting());

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith("watchlog-navigation-")&&key!==NAVIGATION_CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET"||request.mode!=="navigate")return;
  event.respondWith((async()=>{
    const fallback=new Request(new URL("./index.html",self.registration.scope).href);
    try{
      const response=await fetch(request,{cache:"no-store"});
      if(response.ok){
        const cache=await caches.open(NAVIGATION_CACHE);
        await cache.put(fallback,response.clone());
      }
      return response;
    }catch(_){
      const cache=await caches.open(NAVIGATION_CACHE);
      return (await cache.match(request))||(await cache.match(fallback))||Response.error();
    }
  })());
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
    if(!payload.data?.test&&(payload.data?.kind==="reminder"||payload.data?.eventKey)){
      try{
        const windows=await self.clients.matchAll({type:"window"});
        if(!windows.some(client=>client.visibilityState==="visible"))await self.navigator?.setAppBadge?.();
      }catch(_){}
    }
  })());
});

function notificationUrlWithinScope(value){
  const scopeUrl=new URL(self.registration.scope);
  try{
    const requestedUrl=new URL(value||"./",scopeUrl);
    const scopePath=scopeUrl.pathname.endsWith("/")?scopeUrl.pathname:scopeUrl.pathname+"/";
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
