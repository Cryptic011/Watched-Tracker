  function isStandaloneWebApp(){
    return window.matchMedia?.("(display-mode: standalone)")?.matches||navigator.standalone===true;
  }
  function setBackgroundReminderStatus(message,state=""){
    if(!backgroundReminderStatus)return;
    backgroundReminderStatus.textContent=message;
    backgroundReminderStatus.style.color=state==="error"?"#fca5a5":state==="ok"?"var(--green)":"var(--muted)";
  }
  function setNotificationTestStatus(message,state=""){
    if(!notificationTestStatus)return;
    notificationTestStatus.textContent=message;
    notificationTestStatus.style.color=state==="error"?"#fca5a5":state==="ok"?"var(--green)":"var(--muted)";
  }
  function pushSupportError(){
    if(!("Notification" in window)||!("serviceWorker" in navigator)||!("PushManager" in window))return"Background notifications are not supported in this browser.";
    if(/iPhone|iPad|iPod/i.test(navigator.userAgent)&&!isStandaloneWebApp())return"Add Watched Logger to your Home Screen, then open it from the icon to enable iPhone background reminders.";
    if(Notification.permission==="denied")return"Notifications are blocked. Enable Watched Logger in iPhone Settings → Notifications.";
    return"";
  }
  function urlBase64ToUint8Array(value){
    const padding="=".repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/");
    const raw=atob(base64);return Uint8Array.from(raw,char=>char.charCodeAt(0));
  }
  async function reminderApi(action,payload={},token=cloudSessionToken){
    const headers={"Content-Type":"application/json"};
    if(token)headers["X-WatchLog-Session"]=token;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),CLOUD_REQUEST_TIMEOUT_MS);
    try{
      const response=await fetch(REMINDER_API,{method:"POST",headers,body:JSON.stringify({action,...payload}),signal:controller.signal});
      let data={};try{data=await response.json();}catch(error){if(response.ok||controller.signal.aborted)throw error;}
      if(!response.ok){const error=new Error(data.error||`Reminder service error (${response.status})`);error.code=data.code||"reminder_error";error.status=response.status;throw error;}
      return data;
    }catch(error){
      if(error?.code)throw error;
      const wrapped=new Error(error?.name==="AbortError"?"The reminder service took too long to respond.":"Could not reach the Watched Logger reminder service.");wrapped.code=error?.name==="AbortError"?"timeout":"network";throw wrapped;
    }finally{clearTimeout(timeout);}
  }
  async function notificationWorker(){
    await navigator.serviceWorker.register("./sw.js",{scope:"./",updateViaCache:"none"});
    return navigator.serviceWorker.ready;
  }
  async function currentPushSubscription(){
    if(pushSupportError()&&Notification.permission!=="granted")return null;
    try{return(await notificationWorker()).pushManager.getSubscription();}catch(_){return null;}
  }
  async function ensureBackgroundPush({askPermission=false}={}){
    const supportError=pushSupportError();
    if(supportError)throw new Error(supportError);
    if(Notification.permission!=="granted"){
      if(!askPermission)throw new Error("Background reminders are not enabled on this device.");
      const permission=await Notification.requestPermission();
      if(permission!=="granted")throw new Error("Notification permission was not allowed.");
    }
    const registration=await notificationWorker();
    const keyResult=await reminderApi("public_key",{},"");
    if(!keyResult.publicKey)throw new Error("The reminder service did not return a push key.");
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription){
      subscription=await registration.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:urlBase64ToUint8Array(keyResult.publicKey)
      });
    }
    await reminderApi("subscribe",{
      subscription:subscription.toJSON(),
      timeZone:DEVICE_TIME_ZONE||"UTC",
      locale:USER_LOCALE
    });
    return subscription;
  }
  async function refreshBackgroundReminderStatus(){
    const supportError=pushSupportError();
    if(supportError){
      setBackgroundReminderStatus(supportError,"error");
      enableBackgroundReminders?.classList.remove("hidden");disableBackgroundReminders?.classList.add("hidden");
      return false;
    }
    if(Notification.permission!=="granted"){
      setBackgroundReminderStatus("Not enabled on this device. Planned alerts will not arrive while the app is closed.");
      enableBackgroundReminders?.classList.remove("hidden");disableBackgroundReminders?.classList.add("hidden");
      return false;
    }
    const subscription=await currentPushSubscription();
    if(!subscription){
      setBackgroundReminderStatus("Permission is allowed, but background reminders are not connected on this device.");
      enableBackgroundReminders?.classList.remove("hidden");disableBackgroundReminders?.classList.add("hidden");
      return false;
    }
    try{
      const result=await reminderApi("status",{endpoint:subscription.endpoint});
      if(!result.enabled){
        setBackgroundReminderStatus("Background reminders are off on this device.");
        enableBackgroundReminders?.classList.remove("hidden");disableBackgroundReminders?.classList.add("hidden");
        return false;
      }
    }catch(error){
      if(error.status===401)return false;
      setBackgroundReminderStatus("This device has notification permission, but the server connection needs refreshing.");
      enableBackgroundReminders?.classList.remove("hidden");disableBackgroundReminders?.classList.add("hidden");
      return false;
    }
    setBackgroundReminderStatus("Enabled — alerts can arrive when Watched Logger is closed.","ok");
    enableBackgroundReminders?.classList.add("hidden");disableBackgroundReminders?.classList.remove("hidden");
    return true;
  }
  async function syncExistingBackgroundPush(){
    if(!cloudSessionToken||Notification.permission!=="granted")return refreshBackgroundReminderStatus();
    const subscription=await currentPushSubscription();
    if(subscription){
      await reminderApi("subscribe",{
        subscription:subscription.toJSON(),
        timeZone:DEVICE_TIME_ZONE||"UTC",
        locale:USER_LOCALE
      });
    }
    return refreshBackgroundReminderStatus();
  }
  async function removeBackgroundPush(){
    const subscription=await currentPushSubscription();
    if(subscription){
      try{if(cloudSessionToken)await reminderApi("unsubscribe",{endpoint:subscription.endpoint});}catch(error){console.warn(error);}
      try{await subscription.unsubscribe();}catch(error){console.warn(error);}
    }
    setBackgroundReminderStatus("Background reminders are off on this device.");
    enableBackgroundReminders?.classList.remove("hidden");disableBackgroundReminders?.classList.add("hidden");
  }
  enableBackgroundReminders.onclick=async()=>{
    enableBackgroundReminders.disabled=true;
    try{
      setBackgroundReminderStatus("Connecting this device…");
      await ensureBackgroundPush({askPermission:true});
      await refreshBackgroundReminderStatus();
      if(!notificationTestSettings?.classList.contains("hidden"))setNotificationTestStatus("Background push is ready. You can queue the private test.","ok");
    }catch(error){setBackgroundReminderStatus(error.message||"Could not enable background reminders.","error");}
    finally{enableBackgroundReminders.disabled=false;}
  };
  disableBackgroundReminders.onclick=async()=>{
    disableBackgroundReminders.disabled=true;
    try{await removeBackgroundPush();}
    finally{disableBackgroundReminders.disabled=false;}
  };
  function refreshNotificationTestStatus(){
    if(pushSupportError()){setNotificationTestStatus(pushSupportError(),"error");return;}
    if(Notification.permission!=="granted"){setNotificationTestStatus("Enable Background Reminders above before using the private test.");return;}
    setNotificationTestStatus("The private server-push test is ready.","ok");
  }
  async function updateNotificationTestVisibility(){
    notificationTestSettings?.classList.add("hidden");
    const email=normalizeEmail(currentProfile?.email||"");
    if(!email)return false;
    const accountHash=await sha256(`watchlog-notification-test:${email}`);
    const allowed=accountHash===NOTIFICATION_TEST_ACCOUNT_HASH&&email===normalizeEmail(currentProfile?.email||"");
    notificationTestSettings?.classList.toggle("hidden",!allowed);
    if(allowed){refreshNotificationTestStatus();void refreshPrivateReminderHistory();}
    return allowed;
  }
  sendPlannedTest.onclick=async()=>{
    sendPlannedTest.disabled=true;
    try{
      await ensureBackgroundPush({askPermission:true});
      const result=await reminderApi("schedule_private_test");
      setNotificationTestStatus(result.message||"Background test queued. Close Watched Logger now; it should arrive within about one minute.","ok");
    }catch(error){setNotificationTestStatus(error.message||"Could not queue the background test.","error");}
    finally{sendPlannedTest.disabled=false;}
  };

  async function pinApi(action,payload={},token=cloudSessionToken,preparedBody="",externalSignal=null){
    const headers={"Content-Type":"application/json"};
    if(token)headers["X-WatchLog-Session"]=token;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),action==="uk_availability"?20000:CLOUD_REQUEST_TIMEOUT_MS);
    const abortFromExternal=()=>controller.abort();
    if(externalSignal){if(externalSignal.aborted)controller.abort();else externalSignal.addEventListener("abort",abortFromExternal,{once:true});}
    try{
      const response=await fetch(PIN_API,{method:"POST",headers,body:preparedBody||JSON.stringify({action,...payload}),signal:controller.signal});
      let data={};
      try{data=await response.json();}
      catch(error){
        if(error?.name==="AbortError"||response.ok)throw error;
      }
      if(!data||typeof data!=="object"||Array.isArray(data))throw new Error("Invalid cloud response.");
      if(!response.ok){
        const err=new Error(data.error||`Watched Logger cloud error (${response.status})`);err.code=data.code||"api_error";err.status=response.status;err.retryAfter=data.retryAfter;err.maintenance=data.maintenance===true;
        Object.assign(err,{items:data.items,revision:data.revision,updatedAt:data.updatedAt});
        if(err.maintenance){
          publicMaintenance={enabled:true,message:err.message||publicMaintenance.message};maintenanceOwnerAccess=false;
          updateAuthMode();showAuth();
        }
        throw err;
      }
      if(data.ok!==true||(["load","login"].includes(action)&&(!Array.isArray(data.items)||!data.account?.id))||(["save","load","login","register"].includes(action)&&(!Number.isSafeInteger(data.revision)||data.revision<0))){
        const error=new Error("The cloud returned an incomplete response. Your local changes are still available.");error.code="invalid_response";throw error;
      }
      return data;
    }catch(e){
      if(e?.code)throw e;
      const externalAbort=externalSignal?.aborted===true;
      const err=new Error(externalAbort?"Search cancelled.":e?.name==="AbortError"?"Watched Logger cloud took too long to respond. Your change remains saved on this device.":"Could not reach Watched Logger cloud. Check your connection.");err.code=externalAbort?"cancelled":e?.name==="AbortError"?"timeout":"network";throw err;
    }finally{
      clearTimeout(timeout);
      externalSignal?.removeEventListener?.("abort",abortFromExternal);
    }
  }

  async function fetchJSONWithTimeout(url,options={},timeoutMs=EXTERNAL_REQUEST_TIMEOUT_MS){
    const controller=new AbortController(),externalSignal=options.signal||null;
    const abortFromExternal=()=>controller.abort();
    if(externalSignal){if(externalSignal.aborted)controller.abort();else externalSignal.addEventListener("abort",abortFromExternal,{once:true});}
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(url,{...options,signal:controller.signal});
      const data=await response.json();
      if(!response.ok){const error=new Error(`Request failed (${response.status})`);error.status=response.status;throw error;}
      return data;
    }finally{
      clearTimeout(timeout);
      externalSignal?.removeEventListener?.("abort",abortFromExternal);
    }
  }

  function renderAuthMaintenance(){
    renderLibraryMaintenance();
    const enabled=publicMaintenance.enabled===true;
    if(!enabled)maintenanceOwnerAccess=false;
    maintenanceBanner.classList.toggle("hidden",!enabled);
    maintenanceBannerMessage.textContent=enabled?publicMaintenance.message:"";
    maintenanceOwnerAccessButton.classList.toggle("hidden",!enabled||maintenanceOwnerAccess);
    authForm.classList.toggle("hidden",enabled&&!maintenanceOwnerAccess);
    authToggle.classList.toggle("hidden",enabled);
    if(enabled){authTitle.textContent="Under Maintenance";authSub.textContent=maintenanceOwnerAccess?"Owner sign-in remains available.":"Watched Logger will be back shortly.";}
  }
  maintenanceOwnerAccessButton.onclick=()=>{maintenanceOwnerAccess=true;isSignUp=false;authPin.value="";updateAuthMode();authEmail.focus();};
  async function refreshPublicMaintenance(){
    try{
      const result=await pinApi("app_status",{},"");
      publicMaintenance={enabled:result.maintenance===true,message:String(result.message||publicMaintenance.message)};
      updateAuthMode();
      return publicMaintenance;
    }catch(error){
      console.warn("Maintenance status check skipped",error);
      return publicMaintenance;
    }
  }
  async function refreshMaintenanceAdmin(){
    maintenanceAdminSection.classList.add("hidden");
    if(!cloudSessionToken)return false;
    try{
      const result=await pinApi("maintenance_admin_status");
      if(result.canManage!==true)return false;
      maintenanceEnabled.checked=result.maintenance===true;
      maintenanceMessage.value=String(result.message||publicMaintenance.message);
      publicMaintenance={enabled:result.maintenance===true,message:maintenanceMessage.value};
      renderLibraryMaintenance();
      maintenanceAdminStatus.textContent=result.maintenance?"Maintenance is ON. New logins are blocked.":"Maintenance is OFF. Logins are open.";
      maintenanceAdminSection.classList.remove("hidden");
      return true;
    }catch(error){
      if(error.status!==403)console.warn("Maintenance controls unavailable",error);
      return false;
    }
  }
  saveMaintenance.onclick=async()=>{
    const message=maintenanceMessage.value.trim();
    if(message.length<8){maintenanceAdminStatus.textContent="Enter a maintenance message of at least 8 characters.";return;}
    saveMaintenance.disabled=true;maintenanceAdminStatus.textContent="Saving…";
    try{
      const result=await pinApi("set_maintenance",{enabled:maintenanceEnabled.checked,message});
      publicMaintenance={enabled:result.maintenance===true,message:String(result.message||message)};
      renderLibraryMaintenance();
      maintenanceEnabled.checked=publicMaintenance.enabled;maintenanceMessage.value=publicMaintenance.message;
      maintenanceAdminStatus.textContent=publicMaintenance.enabled?"Maintenance is ON. New logins are blocked.":"Maintenance is OFF. Logins are open.";
      showAppToast(publicMaintenance.enabled?"Maintenance mode enabled.":"Maintenance mode disabled.",publicMaintenance.enabled?"warn":"success");
    }catch(error){maintenanceAdminStatus.textContent=error.message||"Could not update maintenance mode.";}
    finally{saveMaintenance.disabled=false;}
  };

  let latestLocalSnapshot=null;
  function cacheName(userIdHash){return `WatchLogLocal_${userIdHash.slice(0,48)}`;}
  async function openCache(userId){
    if(cacheDB){try{cacheDB.close();}catch(_){}}
    const h=await sha256(`watchlog-local:${userId}`);
    return new Promise((resolve,reject)=>{
      const r=indexedDB.open(cacheName(h),1);
      r.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains("data"))db.createObjectStore("data",{keyPath:"key"});};
      r.onsuccess=()=>{cacheDB=r.result;resolve(cacheDB);};
      r.onerror=()=>reject(r.error);
    });
  }
  function cachePut(value,db=cacheDB){return new Promise((resolve,reject)=>{if(!db)return resolve(false);const tx=db.transaction("data","readwrite");tx.objectStore("data").put(value);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("On-device save was interrupted."));});}
  function cacheGet(key,db=cacheDB){return new Promise((resolve,reject)=>{if(!db)return resolve(null);const tx=db.transaction("data","readonly");const r=tx.objectStore("data").get(key);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);tx.onabort=()=>reject(tx.error||new Error("On-device read was interrupted."));});}
  function activePersistenceContext(snapshot){return Boolean(snapshot&&String(currentUser?.id||"")===snapshot.accountId&&cloudSessionToken===snapshot.token&&persistenceGeneration===snapshot.generation);}
  function setCloudBaseline(items,revision,accountId=String(currentUser?.id||"")){
    if(!accountId||String(currentUser?.id||"")!==accountId)return;
    cloudBaseItems=cloneLibrarySnapshot(items);
    cloudRevision=Math.max(0,Number(revision)||0);
    lastCloudLibraryJSON=JSON.stringify(cloudBaseItems);
    lastCloudAccountId=accountId;
  }
  async function saveCache(items,serialized="",{dirty=false,baseItems=cloudBaseItems,baseRevision=cloudRevision,sequence=localSaveSequence,accountId=String(currentUser?.id||""),db=cacheDB}={}){
    if(!accountId||!db)return false;
    const json=serialized||JSON.stringify(items);
    await cachePut({key:"library",userId:accountId,items,json,dirty,cloudItems:baseItems,cloudRevision:Math.max(0,Number(baseRevision)||0),localSequence:sequence,updatedAt:nowISO()},db);
    if(String(currentUser?.id||"")===accountId&&cacheDB===db){lastLocalLibraryJSON=json;lastLocalAccountId=accountId;}
    return true;
  }
  async function loadCacheRecord(){if(!currentUser)return null;const r=await cacheGet("library");return r?.userId===currentUser.id?r:null;}
  async function loadCache(){const r=await loadCacheRecord();return Array.isArray(r?.items)?r.items:[];}
  async function saveProfile(profile){if(!currentUser)return;await cachePut({key:"profile",userId:currentUser.id,profile,updatedAt:nowISO()});}
  async function loadProfile(){if(!currentUser)return null;const r=await cacheGet("profile");return r?.userId===currentUser.id?r.profile||null:null;}
  function pendingKey(accountId=String(currentUser?.id||"")){return accountId?`watchlog_pin_pending_${accountId}`:"";}
  function markPending(value,accountId=String(currentUser?.id||"")){const key=pendingKey(accountId);if(!key)return;if(value)localStorage.setItem(key,"1");else localStorage.removeItem(key);}
  function hasPending(accountId=String(currentUser?.id||"")){const key=pendingKey(accountId);return !!key&&localStorage.getItem(key)==="1";}
