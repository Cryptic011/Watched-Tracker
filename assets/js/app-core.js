  "use strict";

  /* =========================================================
     EMAIL + 4-DIGIT PIN CLOUD ACCOUNTS
     ---------------------------------------------------------
     Supabase Auth/email is NOT used. No SMTP, verification or
     password-reset email is required. The browser talks only to
     Watched Logger's custom PIN API. The API stores a salted PBKDF2 PIN
     verifier, rate-limits failed PIN attempts, and returns an
     opaque session token. Libraries are stored per account and
     also cached locally for offline use.
     ========================================================= */

  const IMDB_VERIFY_ENDPOINT = "";
  /* Run account/library requests beside the Ireland-hosted database. This
     avoids an extra cross-region hop for every cloud save. */
  const PIN_API = "https://okkwteywtgfsnlrjdyhv.supabase.co/functions/v1/watchlog-pin?forceFunctionRegion=eu-west-1";
  const REMINDER_API = "https://okkwteywtgfsnlrjdyhv.supabase.co/functions/v1/watchlog-reminders";
  const PIN_SESSION_KEY = "watchlog_pin_session_v1";
  const LEGACY_LOCAL_ACCOUNTS_KEY = "watchlog_local_accounts_v1";
  const LEGACY_LOCAL_SESSION_KEY = "watchlog_local_session_v1";
  const NOTIFICATION_TEST_ACCOUNT_HASH = "ea67160ff90d5a1b54a6b7fe8522c1573ec9dea8fb18fff38969f42b09c27f0b";

  let currentUser = null;
  let currentProfile = null;
  let mediaItems = [];
  let cacheDB = null;
  let cloudSessionToken = "";
  let isSignUp = false;
  let maintenanceOwnerAccess = false;
  let publicMaintenance = {enabled:false,message:"Watched Logger is currently under maintenance. Please try again shortly."};
  let activeFilter = "All";
  let currentTab = "library";
  let globalSwipeX=0,globalSwipeY=0,globalSwipeAt=0,globalSwipeTarget=null,globalSwipeHandledAt=0;
  let swipeActive=false,swipeComplete=false,swipeVertical=false;
  function beginSwipe(x,y,target){
    globalSwipeX=x;globalSwipeY=y;globalSwipeAt=Date.now();globalSwipeTarget=target;
    // Horizontal poster rows own their gestures in both directions, even at an end.
    swipeActive=!target?.closest?.('input,textarea,select,[contenteditable="true"],.gallery-carousel');
    swipeComplete=false;swipeVertical=false;
  }
  function handleGlobalSwipe(endX,endY,event){
    if(!swipeActive||swipeComplete||swipeVertical)return;
    const now=Date.now(),dx=endX-globalSwipeX,dy=endY-globalSwipeY;
    if(Math.abs(dy)>18&&Math.abs(dy)>Math.abs(dx)*1.2){swipeVertical=true;return;}
    if(now-globalSwipeAt>1500||dx<55||Math.abs(dx)<Math.abs(dy)*1.5)return;
    swipeComplete=true;globalSwipeHandledAt=now;
    if(event.cancelable)event.preventDefault();
    const openDialog=document.querySelector("dialog[open]");
    if(openDialog){openDialog.close();return;}
    if(!episodeTrackerModal.classList.contains("hidden")){closeEpisodeTrackerSheet();return;}
    if(!modal.classList.contains("hidden")){closeEditor();return;}
    if(currentTab!=="library"){switchTab("library");return;}
    window.WatchLogGallery?.back?.();
  }
  document.addEventListener("touchstart",event=>{if(event.touches?.length>1){swipeActive=false;return;}const t=event.changedTouches?.[0];if(t)beginSwipe(t.clientX,t.clientY,event.target);},{passive:true,capture:true});
  document.addEventListener("touchmove",event=>{const t=event.changedTouches?.[0];if(!t)return;const dx=t.clientX-globalSwipeX,dy=t.clientY-globalSwipeY;if(swipeActive&&!swipeVertical&&dx>12&&Math.abs(dx)>Math.abs(dy)*1.5&&event.cancelable)event.preventDefault();handleGlobalSwipe(t.clientX,t.clientY,event);},{passive:false,capture:true});
  document.addEventListener("touchend",event=>{const t=event.changedTouches?.[0];if(t)handleGlobalSwipe(t.clientX,t.clientY,event);swipeActive=false;},{passive:false,capture:true});
  document.addEventListener("touchcancel",()=>{swipeActive=false;},{passive:true,capture:true});
  document.addEventListener("pointerdown",event=>{if(event.isPrimary===false||event.button>0)return;beginSwipe(event.clientX,event.clientY,event.target);},{passive:true,capture:true});
  document.addEventListener("pointermove",event=>{if(event.pointerType!=="touch")handleGlobalSwipe(event.clientX,event.clientY,event);},{passive:false,capture:true});
  document.addEventListener("pointerup",event=>{if(event.pointerType!=="touch"){handleGlobalSwipe(event.clientX,event.clientY,event);swipeActive=false;}},{passive:false,capture:true});
  document.addEventListener("click",event=>{if(swipeComplete&&Date.now()-globalSwipeHandledAt<500){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
  let searchQuery = "";
  let activeSort = "current";
  let searchTimer = null;
  let activeCatalogueController = null;
  let searchRequestId = 0;
  let activeTitleSearchKey = "";
  let librarySearchTimer = null;
  let renderedLibrarySearch = "";
  let editorVerification = null;
  let editorVerificationInFlight = null;
  let editorApplyRevision = 0;
  let titleSuggestionsWanted = false;
  let suggestionProgressFrame = 0;
  let queuedSuggestionProgress = null;
  let localSaveInFlight = null;
  let queuedLocalSnapshot = null;
  let cloudSaveInFlight = null;
  let queuedCloudSnapshot = null;
  let lastLocalLibraryJSON = "";
  let lastCloudLibraryJSON = "";
  let lastLocalAccountId = "";
  let lastCloudAccountId = "";
  let cloudRevision = 0;
  let cloudBaseItems = [];
  let persistenceGeneration = 0;
  let localSaveSequence = 0;
  const metadataRefreshInFlight = new Map();
  const metadataRefreshAttemptAt = new Map();
  let libraryMetadataSweepInFlight = null;
  let lastLibraryMetadataSweepAt = 0;
  const SERIES_METADATA_STALE_MS = 6 * 60 * 60 * 1000;
  const SERIES_RELEASE_CHECK_MS = 60 * 1000;
  const SERIES_REFRESH_RETRY_MS = 10 * 60 * 1000;
  const CLOUD_SAVE_COALESCE_MS = 180;
  const CLOUD_REQUEST_TIMEOUT_MS = 12 * 1000;
  const EXTERNAL_REQUEST_TIMEOUT_MS = 8 * 1000;
  const MAX_STALE_SERIES_PER_SWEEP = 5;
  const MAX_METADATA_REFRESH_WORKERS = 2;
  let pendingAppUpdate = false;
  let appUpdateCheckInFlight = null;
  const currentDeploymentSha = String(window.WATCHLOG_BUILD?.sha||"");

  function appHasUnsavedWork(){
    return Boolean(
      localSaveInFlight || cloudSaveInFlight || queuedLocalSnapshot || queuedCloudSnapshot ||
      document.getElementById("save-btn")?.disabled ||
      !document.getElementById("modal")?.classList.contains("hidden")
    );
  }
  function applyPendingAppUpdate(){
    if(!pendingAppUpdate||appHasUnsavedWork())return false;
    pendingAppUpdate=false;
    window.location.reload();
    return true;
  }
  async function checkForAppUpdate(){
    if(appUpdateCheckInFlight||!navigator.onLine||!currentDeploymentSha)return appUpdateCheckInFlight;
    appUpdateCheckInFlight=(async()=>{
      try{
        const response=await fetch(`./build-info.js?update=${Date.now()}`,{cache:"no-store"});
        if(!response.ok)return;
        const source=await response.text();
        const match=source.match(/"sha":"([0-9a-f]{7,40})"/i);
        if(match&&match[1]!==currentDeploymentSha){
          pendingAppUpdate=true;
          applyPendingAppUpdate();
        }
      }catch(error){console.debug("App update check failed",error);}
      finally{appUpdateCheckInFlight=null;}
    })();
    return appUpdateCheckInFlight;
  }
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){applyPendingAppUpdate()||void checkForAppUpdate();}});
  window.addEventListener("focus",()=>{applyPendingAppUpdate()||void checkForAppUpdate();});

  let episodeLogFeedback = null;
  let activeEpisodeTrackerId = "";
  let activeEpisodeTrackerSeason = 0;
  const episodeLogBusy = new Set();

  const $ = id => document.getElementById(id);
  const authScreen = $("auth-screen"), authForm = $("auth-form"), authTitle = $("auth-title"), authSub = $("auth-sub"), authNameGroup = $("auth-name-group"), authEmail = $("auth-email"), authPin = $("auth-pin"), authName = $("auth-name"), authSubmit = $("auth-submit"), authToggle = $("auth-toggle"), authMessage = $("auth-message"), maintenanceBanner = $("maintenance-banner"), maintenanceBannerMessage = $("maintenance-banner-message"), maintenanceOwnerAccessButton = $("maintenance-owner-access");
  const navName = $("nav-name"), userPill = $("user-pill"), refreshAppBtn = $("refresh-app"), libraryView = $("library-view"), settingsView = $("settings-view"), profileName = $("profile-name"), profileEmail = $("profile-email"), avatar = $("avatar"), syncDot = $("sync-dot"), syncStatus = $("sync-status"), syncNowBtn = $("sync-now"), changePinBtn = $("change-pin"), newPinInput = $("new-pin"), logoutBtn = $("logout-btn");
  const libraryMaintenance=document.createElement("div");
  libraryMaintenance.id="library-maintenance";libraryMaintenance.className="library-maintenance hidden";
  libraryMaintenance.setAttribute("role","status");libraryMaintenance.setAttribute("aria-live","polite");
  libraryMaintenance.innerHTML='<strong>Under maintenance</strong><p id="library-maintenance-message"></p>';
  document.querySelector(".nav-header").after(libraryMaintenance);
  refreshAppBtn?.addEventListener("click",()=>{if(appHasUnsavedWork()){pendingAppUpdate=true;showAppToast("Refresh will run after your current edit or save finishes.","success");return;}window.location.reload();});
  function renderLibraryMaintenance(){
    const visible=Boolean(currentUser&&currentTab==="library"&&publicMaintenance.enabled);
    libraryMaintenance.classList.toggle("hidden",!visible);
    $("library-maintenance-message").textContent=visible?publicMaintenance.message:"";
  }
  const backgroundReminderStatus=$("background-reminder-status"),enableBackgroundReminders=$("enable-background-reminders"),disableBackgroundReminders=$("disable-background-reminders");
  const notificationTestSettings=$("notification-test-settings"),notificationTestStatus=$("notification-test-status"),sendPlannedTest=$("send-planned-test");
  const maintenanceAdminSection=document.createElement("section");
  maintenanceAdminSection.id="maintenance-admin-section";maintenanceAdminSection.className="maintenance-admin hidden";
  maintenanceAdminSection.innerHTML='<div class="section-label">Maintenance</div><div class="profile-card"><div class="maintenance-toggle-row"><div class="maintenance-toggle-copy"><strong>Maintenance mode</strong><span>Blocks new logins and account creation</span></div><input id="maintenance-enabled" class="maintenance-switch" type="checkbox" aria-label="Enable maintenance mode" /></div><div class="form-group"><label for="maintenance-message">Login screen message</label><textarea id="maintenance-message" class="maintenance-message" maxlength="240"></textarea></div><button id="save-maintenance" class="btn btn-secondary btn-full" type="button">Save Maintenance Setting</button><div id="maintenance-admin-status" class="maintenance-admin-status" aria-live="polite"></div></div>';
  settingsView.appendChild(maintenanceAdminSection);
  const whatsNewButton=document.createElement("button");
  whatsNewButton.id="whats-new-button";whatsNewButton.type="button";whatsNewButton.className="whats-new-button";
  whatsNewButton.setAttribute("aria-haspopup","dialog");whatsNewButton.setAttribute("aria-controls","changelog-dialog");
  whatsNewButton.innerHTML='<span><strong>What’s new</strong><small>Recent fixes and improvements</small></span><span aria-hidden="true">›</span>';
  maintenanceAdminSection.before(whatsNewButton);
  const changelogDialog=document.createElement("dialog");
  changelogDialog.id="changelog-dialog";changelogDialog.className="changelog-dialog";changelogDialog.setAttribute("aria-labelledby","changelog-title");
  changelogDialog.innerHTML='<header class="changelog-heading"><h2 id="changelog-title">What’s new</h2><button class="close-btn" id="close-changelog" type="button" aria-label="Close change log" autofocus>&times;</button></header><div class="changelog-body" id="changelog-body"></div>';
  document.body.appendChild(changelogDialog);
  // Add plain-language notes here when an update ships. Do not list pending fixes.
  const APP_CHANGELOG=[
    {commit:"f2b07bbf6c593374ffb52856491b232f1f46304e",title:"Reminder backend deployment (PR #1)",date:"2026-09-17",changes:["Added reproducible database setup for background reminders.","Preserved existing subscriptions and configuration.","Deployed and verified the reminder migration."]},
    {push:143,title:"Actions-safe poster and swipe fix",date:"2026-09-15",changes:["Kept official TVMaze poster assets allowed without tripping the production-surface security test.","Kept poster fallbacks and direct artwork loading enabled.","Retained pointer-event fallback so one left swipe goes back in the in-app browser."]},
    {number:9,title:"A new Library layout",date:"2026-09-15",changes:["Browse Films and Series separately from Library.","See upcoming releases above poster grids of released titles.","Open a title for its progress, reminders, episode tracker and editing controls."]},
    {number:8,title:"Settings spacing",date:"2026-09-11",changes:["Separated What’s new from the account card.","Added bottom clearance so the last Settings controls can scroll above the navigation bar."]},
    {number:7,title:"Change log menu",date:"2026-09-11",changes:["Added What’s new above Maintenance in Settings.","Select an update number to see only the changes from that push."]},
    {number:6,title:"Simpler platform choices",date:"2026-09-11",commit:"8e78b6fab6f31bc916f288cc3325b7d77ebbe6f4",changes:["Combined subscription tiers into one entry per service.","Put subscription services first, followed by free, rental and purchase options."]},
    {number:5,title:"Library maintenance notice",date:"2026-09-11",commit:"bc735627ff016f3dc4da417faeb5f6f52f89ef23",changes:["Added a compact maintenance notice at the top of Library.","The notice shows your maintenance message and disappears when maintenance is off."]},
    {number:4,title:"UK platform matching",date:"2026-09-11",commit:"87d2242a52a2ef5ef6179f601e7ef1c06a68b7a9",changes:["Added UK streaming checks that work without a TMDB token.","Matched IMDb IDs to prevent different shows with the same name being mixed up.","Excluded disc-only offers from streaming results."]},
    {number:3,title:"UK platform selector",date:"2026-09-11",commit:"b1e5bd415ceaad01275bcae780f172d97586673d",changes:["Added UK platform choices at the bottom of Edit.","Kept manual entry for where you previously watched a title.","Show N/A only when a successful check finds no UK providers."]},
    {number:2,title:"Season and episode choices",date:"2026-09-08",commit:"942e01f63b83fc41b1fbf14659db3d0c9a4aef52",changes:["Added season and episode dropdowns when editing shows.","New shows start at zero watched.","Episode choices match the selected season’s released episodes."]},
    {number:1,title:"Progress sync and reminders",date:"2026-09-06",commit:"16e1012bbcf63f77584650566e3b557cf7836cfb",changes:["Improved progress syncing between devices.","Fixed release-time reminders when episode schedules update.","Preserved reminder times when editing a title."]}
  ];
  const APP_CHANGELOG_FULL=window.WATCHLOG_BUILD?.commits||APP_CHANGELOG.filter(entry=>entry.commit);
  const currentBuild=window.WATCHLOG_BUILD;
  if(currentBuild?.count){
    const version=document.createElement("p");version.className="small-note";
    version.textContent=`GitHub push ${currentBuild.count} · ${currentBuild.sha.slice(0,7)}`;
    $("changelog-body").appendChild(version);
  }
  for(const entry of APP_CHANGELOG_FULL){
    const details=document.createElement("details");details.className="changelog-entry";
    details.setAttribute("name","app-updates");
    const summary=document.createElement("summary");
    summary.textContent=`GitHub push ${entry.push??entry.number??entry.commit?.slice(0,7)} · ${entry.title}`;
    const date=document.createElement("p");date.className="small-note";date.style.marginTop="10px";
    date.textContent=new Intl.DateTimeFormat(navigator.language||"en-GB",{day:"numeric",month:"long",year:"numeric"}).format(new Date(entry.date+"T12:00:00"));
    const list=document.createElement("ul");
    for(const change of entry.changes){const item=document.createElement("li");item.textContent=change;list.appendChild(item);}
    details.append(summary,date,list);
    if(entry.commit){const link=document.createElement("a");link.className="small-note";link.textContent="View push · "+entry.commit.slice(0,7);link.href="https://github.com/Cryptic011/Watched-Tracker/commit/"+entry.commit;link.target="_blank";link.rel="noopener noreferrer";details.appendChild(link);}
    details.addEventListener("toggle",()=>{if(details.open)for(const other of $("changelog-body").children)if(other!==details&&other.tagName==="DETAILS")other.open=false;});
    $("changelog-body").appendChild(details);
  }
  whatsNewButton.onclick=()=>{changelogDialog.showModal();document.documentElement.classList.add("changelog-open");};
  $("close-changelog").onclick=()=>changelogDialog.close();
  changelogDialog.addEventListener("click",event=>{if(event.target===changelogDialog)changelogDialog.close();});
  changelogDialog.addEventListener("close",()=>{document.documentElement.classList.remove("changelog-open");whatsNewButton.focus();});
  const maintenanceEnabled=$("maintenance-enabled"),maintenanceMessage=$("maintenance-message"),saveMaintenance=$("save-maintenance"),maintenanceAdminStatus=$("maintenance-admin-status");
  const mediaList = $("media-list"), emptyState = $("empty-state"), searchInput = $("search-input"), sortMode = $("sort-mode"), modal = $("modal"), addBtn = $("add-btn"), closeModal = $("close-modal"), mediaForm = $("media-form"), deleteBtn = $("delete-btn"), saveBtn = $("save-btn"), typeSelect = $("type"), seriesSection = $("series-section"), progressVerifyNote = $("progress-verify-note"), airingSection = $("airing-section"), airingNote = $("airing-note"), upcomingSection = $("upcoming-section"), seasonVerifyNote = $("season-verify-note"), filmSection = $("film-section"), filmVerifyNote = $("film-verify-note"), filmReleaseDate = $("film-release-date"), filmReleaseSource = $("film-release-source"), titleInput = $("title"), suggestList = $("suggest-list");
  const duplicateWarning=document.createElement("div");
  duplicateWarning.id="duplicate-warning";duplicateWarning.className="duplicate-warning hidden";duplicateWarning.setAttribute("role","alert");duplicateWarning.innerHTML='<span id="duplicate-warning-text"></span><button id="open-duplicate" type="button">Open existing</button>';
  mediaForm.insertBefore(duplicateWarning,mediaForm.querySelector(".form-row"));
  const duplicateWarningText=$("duplicate-warning-text"),openDuplicateBtn=$("open-duplicate");
  const appToast=document.createElement("div");appToast.id="app-toast";appToast.className="app-toast";appToast.setAttribute("role","status");appToast.setAttribute("aria-live","polite");document.body.appendChild(appToast);
  let appToastTimer=null,duplicateWarningItemId="";
  const episodeTrackerModal=document.createElement("div");
  episodeTrackerModal.id="episode-tracker-modal";episodeTrackerModal.className="episode-tracker-overlay hidden";
  episodeTrackerModal.innerHTML='<section class="episode-tracker-sheet" role="dialog" aria-modal="true" aria-labelledby="episode-tracker-title"><header class="episode-tracker-header"><div><span class="episode-tracker-kicker">Episode Tracker</span><h2 id="episode-tracker-title"></h2></div><button id="close-episode-tracker" class="episode-tracker-close" type="button" aria-label="Close episode tracker">&times;</button></header><div class="episode-tracker-progress"><span>Latest watched</span><strong id="episode-tracker-progress"></strong><small id="episode-tracker-release"></small></div><div class="episode-tracker-season-row"><label class="episode-tracker-season-field"><span>Season</span><select id="episode-tracker-season" class="episode-tracker-season-select" aria-label="Choose season"></select></label><strong id="episode-tracker-season-summary" class="episode-tracker-season-summary"></strong></div><div id="episode-tracker-grid" class="episode-tracker-grid" aria-label="Released episodes"></div><p class="episode-tracker-help">Tap any released episode to mark or unmark it. Changes save automatically.</p><div id="episode-tracker-last" class="episode-tracker-last" aria-live="polite"></div><button id="episode-tracker-edit" class="episode-tracker-edit" type="button">✎ Edit show details</button></section>';
  document.body.appendChild(episodeTrackerModal);
  const episodeTrackerTitle=$("episode-tracker-title"),episodeTrackerProgress=$("episode-tracker-progress"),episodeTrackerRelease=$("episode-tracker-release"),episodeTrackerSeason=$("episode-tracker-season"),episodeTrackerSeasonSummary=$("episode-tracker-season-summary"),episodeTrackerGrid=$("episode-tracker-grid"),episodeTrackerLast=$("episode-tracker-last"),episodeTrackerEdit=$("episode-tracker-edit"),closeEpisodeTracker=$("close-episode-tracker");
  const pillBtns = document.querySelectorAll(".pill-btn"), tabBtns = document.querySelectorAll(".tab-btn");
  const markEditorUserChange=event=>{if(event.isTrusted){editorApplyRevision++;editorVerification=null;}};
  const ukPlatformGroup=document.createElement("div");
  ukPlatformGroup.className="form-group";
  ukPlatformGroup.innerHTML='<label for="uk-platform">Currently available in the UK</label><select id="uk-platform" aria-describedby="uk-platform-note"><option value="">Choose a title first</option></select><p id="uk-platform-note" class="small-note" role="status"></p><a id="uk-platform-link" class="small-note" target="_blank" rel="noopener noreferrer">Check on JustWatch UK</a>';
  const watchedPlatformGroup=$("platform").closest(".form-group");
  watchedPlatformGroup.before(ukPlatformGroup);
  watchedPlatformGroup.querySelector("label").textContent="Where you watched it";
  $("platform").placeholder="Choose above or enter a previous platform";
  const ukPlatform=$("uk-platform"),ukPlatformNote=$("uk-platform-note"),ukPlatformLink=$("uk-platform-link");
  let ukAvailabilityRevision=0,ukAvailabilityController=null,selectedUKPlatform="";
  ukPlatform.addEventListener("change",()=>{
    if(!ukPlatform.value)return;
    selectedUKPlatform=String(ukPlatform.value).trim();
    $("platform").value=selectedUKPlatform;
    $("platform").dispatchEvent(new Event("input",{bubbles:true}));
  });
  function resetUKAvailability(){
    ukAvailabilityRevision++;ukAvailabilityController?.abort();ukAvailabilityController=null;
    ukPlatform.innerHTML='<option value="">Choose a title first</option>';ukPlatform.disabled=true;
    ukPlatformNote.textContent="Choose from UK availability, or enter where you watched it below.";
    ukPlatformLink.href="https://www.justwatch.com/uk/search?q="+encodeURIComponent($("title").value.trim());
    selectedUKPlatform="";
  }
  function ukServiceChoices(providers){
    const services=new Map();
    for(const provider of providers||[]){
      const raw=String(provider.name||"").trim();if(!raw)continue;
      let name=raw;
      if(/^paramount\s*(plus|\+)/i.test(raw))name="Paramount+";
      else if(/^(amazon\s+)?prime\s+video\b|^amazon video$/i.test(raw))name="Prime Video";
      else if(/^netflix\b/i.test(raw))name="Netflix";
      else if(/^itvx\b/i.test(raw))name="ITVX";
      else if(/^disney\s*(plus|\+)/i.test(raw))name="Disney+";
      else if(/^apple tv(?:\b|\+)/i.test(raw))name="Apple TV";
      else if(/^now(?: tv)?(?: cinema| entertainment)?$/i.test(raw))name="NOW";
      else name=raw.replace(/\s+(?:Amazon|Apple TV|Roku)\s+Channel$/i,"").replace(/\s+(?:Premium|Basic|Standard)(?: with Ads)?$|\s+with Ads$/i,"").trim();
      const types=Array.isArray(provider.types)?provider.types:[];
      const rank=types.includes("Subscription")?0:types.some(t=>t==="Free"||t==="With adverts")?1:types.includes("Rent")?2:3;
      const channel=/\bchannel\b/i.test(raw)?1:0;
      const existing=services.get(name.toLowerCase());
      if(!existing||rank<existing.rank||(rank===existing.rank&&channel<existing.channel))services.set(name.toLowerCase(),{name,rank,channel});
    }
    return [...services.values()].sort((a,b)=>a.rank-b.rank||a.channel-b.channel||a.name.localeCompare(b.name,"en-GB"));
  }
  async function loadUKAvailability(){
    resetUKAvailability();
    const title=$("title").value.trim();if(!title)return;
    const revision=ukAvailabilityRevision,controller=new AbortController();ukAvailabilityController=controller;
    ukPlatform.innerHTML='<option value="">Checking UK availability…</option>';
    ukPlatformNote.textContent="Checking subscription, free, rental and purchase options…";
    try{
      const result=await pinApi("uk_availability",{title,type:$("type").value,imdbId:$("imdb-id").value,year:$("release-year").value},cloudSessionToken,"",controller.signal);
      if(revision!==ukAvailabilityRevision)return;
      ukPlatform.innerHTML='<option value="">Select where you watched it</option>';
      if(result.state==="available"){
        for(const row of ukServiceChoices(result.providers)){
          const option=document.createElement("option");option.value=row.name;option.textContent=row.name;ukPlatform.appendChild(option);
        }
        ukPlatform.disabled=false;ukPlatformNote.textContent="Subscription services first. Availability and included seasons vary by service. Source: JustWatch"+(result.source==="JustWatch"?".":" via TMDB.");
        const savedPlatform=normalizeTitle($("platform").value||"");
        const matching=[...ukPlatform.options].find(option=>normalizeTitle(option.value)===savedPlatform);
        if(matching){ukPlatform.value=matching.value;selectedUKPlatform=matching.value;}
      }else if(result.state==="none"){
        const option=document.createElement("option");option.value="N/A";option.textContent="N/A — No UK providers found";ukPlatform.appendChild(option);
        ukPlatform.disabled=false;ukPlatformNote.textContent="N/A — No current UK streaming providers found. You can keep a previous platform below.";
      }else{
        ukPlatform.innerHTML='<option value="">UK availability not confirmed</option>';
        ukPlatformNote.textContent="The exact title could not be matched. Choose its IMDb search result or check JustWatch UK below.";
      }
      if(result.link&&/^https:\/\/www\.justwatch\.com\/uk\//.test(result.link)){ukPlatformLink.href=result.link;ukPlatformLink.textContent="View this title on JustWatch UK";}
      else if(result.link&&/^https:\/\/www\.themoviedb\.org\//.test(result.link)){ukPlatformLink.href=result.link;ukPlatformLink.textContent="View JustWatch availability via TMDB";}
      else ukPlatformLink.textContent="Check on JustWatch UK";
    }catch(error){
      if(revision!==ukAvailabilityRevision||controller.signal.aborted)return;
      ukPlatform.innerHTML='<option value="">UK availability unavailable</option>';
      ukPlatformNote.textContent="Could not check UK availability. Use JustWatch UK or enter your platform below.";
    }
  }
  mediaForm.addEventListener("input",markEditorUserChange);
  mediaForm.addEventListener("change",markEditorUserChange);

  function nowISO(){return new Date().toISOString();}
  const DEVICE_TIME_ZONE=Intl.DateTimeFormat().resolvedOptions().timeZone||"";
  const USER_LOCALE=(()=>{
    const candidates=[...((Array.isArray(navigator.languages)&&navigator.languages)||[]),navigator.language].filter(Boolean);
    let locale="en-GB";
    for(const candidate of candidates){try{new Intl.DateTimeFormat(candidate);locale=candidate;break;}catch(_){}}
    const language=String(locale).split(/[-_]/)[0].toLowerCase();
    if(language!=="en")return locale;
    if(["Europe/London","Europe/Belfast","Europe/Guernsey","Europe/Isle_of_Man","Europe/Jersey"].includes(DEVICE_TIME_ZONE))return"en-GB";
    if(DEVICE_TIME_ZONE==="Europe/Dublin")return"en-IE";
    if(DEVICE_TIME_ZONE.startsWith("Europe/"))return"en-GB";
    if(DEVICE_TIME_ZONE.startsWith("Australia/"))return"en-AU";
    if(["Pacific/Auckland","Pacific/Chatham"].includes(DEVICE_TIME_ZONE))return"en-NZ";
    if(["America/Toronto","America/Vancouver","America/Edmonton","America/Winnipeg","America/Halifax","America/St_Johns","America/Regina"].includes(DEVICE_TIME_ZONE))return"en-CA";
    if(["America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Phoenix","America/Anchorage","Pacific/Honolulu"].includes(DEVICE_TIME_ZONE)||DEVICE_TIME_ZONE.startsWith("America/Indiana/")||DEVICE_TIME_ZONE.startsWith("America/Kentucky/")||DEVICE_TIME_ZONE.startsWith("America/North_Dakota/"))return"en-US";
    return locale;
  })();
  document.documentElement.lang=USER_LOCALE;
  const LOCAL_DATE_FORMATTER=new Intl.DateTimeFormat(USER_LOCALE,{day:"2-digit",month:"2-digit",year:"numeric"});
  const LOCAL_DATE_TIME_FORMATTER=new Intl.DateTimeFormat(USER_LOCALE,{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
  const LOCAL_WEEKDAY_DATE_FORMATTER=new Intl.DateTimeFormat(USER_LOCALE,{weekday:"short",day:"2-digit",month:"2-digit",year:"numeric"});
  function validLocalDate(year,month,day,hour=12,minute=0){
    const d=new Date(year,month-1,day,hour,minute);
    return d.getFullYear()===year&&d.getMonth()===month-1&&d.getDate()===day&&d.getHours()===hour&&d.getMinutes()===minute?d:null;
  }
  function localISODate(value=new Date()){
    const d=value instanceof Date?value:new Date(value);
    if(Number.isNaN(d.getTime()))return"";
    const p=n=>String(n).padStart(2,"0");
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  }
  function dateFromLocalValue(value){
    if(value instanceof Date)return Number.isNaN(value.getTime())?null:new Date(value.getTime());
    const text=String(value||"").trim();
    if(!text)return null;
    let match=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(match)return validLocalDate(Number(match[1]),Number(match[2]),Number(match[3]));
    match=text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
    if(match){
      const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
      const month=months[match[2].slice(0,3).toLowerCase()];
      if(month)return validLocalDate(Number(match[3]),month,Number(match[1]));
    }
    const parsed=new Date(text);
    return Number.isNaN(parsed.getTime())?null:parsed;
  }
  function formatLocalDate(value){const d=dateFromLocalValue(value);return d?LOCAL_DATE_FORMATTER.format(d):String(value||"");}
  function formatLocalDateTime(value){const d=dateFromLocalValue(value);return d?LOCAL_DATE_TIME_FORMATTER.format(d):String(value||"");}
  function formatLocalWeekdayDate(value){const d=dateFromLocalValue(value);return d?LOCAL_WEEKDAY_DATE_FORMATTER.format(d):String(value||"");}
  function localDatePattern(){
    const sample=new Date(2001,10,22,13,45);
    return LOCAL_DATE_FORMATTER.formatToParts(sample).map(part=>{
      if(part.type==="day")return"DD";
      if(part.type==="month")return"MM";
      if(part.type==="year")return"YYYY";
      return part.value;
    }).join("");
  }
  const LOCAL_DATE_PLACEHOLDER=localDatePattern();
  const LOCAL_DATE_TIME_PLACEHOLDER=LOCAL_DATE_PLACEHOLDER+", "+(LOCAL_DATE_TIME_FORMATTER.resolvedOptions().hour12?"HH:MM AM/PM":"HH:MM");
  function installLocalizedDateControl(input){
    if(!input||input.dataset.localizedDate==="true")return;
    input.dataset.localizedDate="true";
    input.lang=USER_LOCALE;
    input.classList.add("localized-native-date");
    const shell=document.createElement("div");
    shell.className="localized-date-shell";
    input.parentNode.insertBefore(shell,input);
    shell.appendChild(input);
    const overlay=document.createElement("span");
    overlay.className="localized-date-overlay";
    overlay.setAttribute("aria-hidden","true");
    shell.appendChild(overlay);
    const sync=()=>{
      const hasValue=Boolean(input.value);
      overlay.textContent=hasValue?(input.type==="date"?formatLocalDate(input.value):formatLocalDateTime(input.value)):(input.type==="date"?LOCAL_DATE_PLACEHOLDER:LOCAL_DATE_TIME_PLACEHOLDER);
      overlay.classList.toggle("empty",!hasValue);
    };
    input.addEventListener("input",sync);
    input.addEventListener("change",sync);
    const descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");
    if(descriptor?.get&&descriptor?.set){
      try{Object.defineProperty(input,"value",{configurable:true,get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);sync();}});}catch(_){}
    }
    input.refreshLocalizedDate=sync;
    sync();
  }
  function syncLocalizedDateControls(){document.querySelectorAll('input[type="date"],input[type="datetime-local"]').forEach(input=>{if(input.dataset.localizedDate==="true")input.refreshLocalizedDate?.();else installLocalizedDateControl(input);});}
  syncLocalizedDateControls();
  function esc(v){return String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
  function showMessage(text,type="error"){authMessage.textContent=text;authMessage.className=`message ${type}`;}
  function hideMessage(){authMessage.textContent="";authMessage.className="message hidden";}
  function showAppToast(text,type="success",duration=4200){
    clearTimeout(appToastTimer);appToast.textContent=text;appToast.className=`app-toast ${type}`;
    requestAnimationFrame(()=>appToast.classList.add("show"));
    appToastTimer=setTimeout(()=>appToast.classList.remove("show"),duration);
  }
  function hideDuplicateWarning(){duplicateWarningItemId="";duplicateWarning.classList.add("hidden");duplicateWarningText.textContent="";}
  function showDuplicateWarning(item){
    if(!item)return hideDuplicateWarning();
    duplicateWarningItemId=String(item.id||"");
    duplicateWarningText.textContent=`“${item.title}” is already tracked.`;
    duplicateWarning.classList.remove("hidden");
  }
  function refreshEditorDuplicateWarning(){
    const duplicate=findTrackedDuplicate({title:titleInput.value.trim(),type:typeSelect.value,imdbId:$("imdb-id").value,tvmazeShowId:$("tvmaze-id").value,releaseYear:$("release-year").value,filmReleaseDate:filmReleaseDate.value},mediaItems,$("item-id").value);
    if(duplicate)showDuplicateWarning(duplicate);else hideDuplicateWarning();
    return duplicate;
  }
  openDuplicateBtn.onclick=()=>{const id=duplicateWarningItemId;hideDuplicateWarning();if(id)void openEdit(id);};
  function uuid(){return crypto.randomUUID?crypto.randomUUID():`item_${Date.now()}_${Math.random().toString(36).slice(2)}`;}
  function toMillis(v){const n=new Date(v||0).getTime();return Number.isFinite(n)?n:0;}
  function isEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||"").trim());}
  function normalizeEmail(v){return String(v||"").trim().toLowerCase();}
  function validPin(v){return /^\d{4}$/.test(String(v||""));}
  function safeReadJSON(key,fallback){try{const raw=localStorage.getItem(key);return raw===null?fallback:JSON.parse(raw);}catch(e){console.warn(`Could not read ${key}`,e);return fallback;}}
  function safeWriteJSON(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(e){console.error(`Could not write ${key}`,e);return false;}}
  const APPEARANCE_KEY="watched_logger_appearance";
  const appearanceQuery=window.matchMedia("(prefers-color-scheme: dark)");
  function savedAppearance(){const value=safeReadJSON(APPEARANCE_KEY,"system");return ["system","light","dark"].includes(value)?value:"system";}
  function applyAppearance(mode=savedAppearance()){
    const resolved=mode==="system"?(appearanceQuery.matches?"dark":"light"):mode;
    document.documentElement.dataset.theme=resolved;
    const control=document.getElementById("appearance-mode");if(control)control.value=mode;
    const themeMeta=document.querySelector('meta[name="theme-color"]');if(themeMeta)themeMeta.content=resolved==="dark"?"#000000":"#f4f6f8";
    const statusMeta=document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');if(statusMeta)statusMeta.content="black-translucent";
  }
  appearanceQuery.addEventListener?.("change",()=>{if(savedAppearance()==="system")applyAppearance("system");});
  async function sha256(value){const bytes=new TextEncoder().encode(String(value));const digest=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");}

