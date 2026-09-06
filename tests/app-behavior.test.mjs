import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

process.env.TZ = "Europe/London";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Expected ${name} in index.html`);
  const signatureEnd = /\)\s*\{/.exec(source.slice(start));
  assert.ok(signatureEnd, `Expected a body for ${name}`);
  const bodyStart = start + signatureEnd.index + signatureEnd[0].lastIndexOf("{");
  let depth = 0;
  let state = "code";
  for (let index = bodyStart; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line") { if (char === "\n") state = "code"; continue; }
    if (state === "block") { if (char === "*" && next === "/") { state = "code"; index++; } continue; }
    if (state === "single" || state === "double" || state === "template") {
      if (char === "\\") { index++; continue; }
      if ((state === "single" && char === "'") || (state === "double" && char === '"') || (state === "template" && char === "`")) state = "code";
      continue;
    }
    if (char === "/" && next === "/") { state = "line"; index++; continue; }
    if (char === "/" && next === "*") { state = "block"; index++; continue; }
    if (char === "'") { state = "single"; continue; }
    if (char === '"') { state = "double"; continue; }
    if (char === "`") { state = "template"; continue; }
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function loadFunctions(names, setup = "") {
  const context = vm.createContext({ console });
  const declarations = names.map(name => extractFunction(html, name)).join("\n");
  vm.runInContext(`${setup}\n${declarations}\nthis.api={${names.join(",")}};`, context);
  return context.api;
}

test("Current ordering is chronological and keeps TBA below genuinely current titles", () => {
  const api = loadFunctions([
    "toMillis", "addedSortTime", "releaseSortInfo", "compareReleaseRecency",
    "isEpisodeTrackable", "positiveEpisodeMap", "releasedEpisodeCounts",
    "currentSortInfo", "upcomingSortInfo", "compareCurrentOrder",
  ], "const titleCollator=new Intl.Collator('en-GB',{sensitivity:'base',numeric:true});");
  const now = new Date("2026-08-31T16:50:00Z").getTime();
  const rows = [
    { title: "House of the Dragon", type: "Series", nextSeasonNum: 4, nextSeasonDate: "" },
    { title: "Chicago Fire", type: "Series", nextSeasonNum: 15, nextSeasonDate: "2026-10-08T02:00" },
    { title: "CIA", type: "Series", nextSeasonNum: 2, nextSeasonDate: "2026-10-06T02:00" },
    { title: "Unknown", type: "Series", nextEpisodeNum: 6, nextEpisodeDate: "2026-09-06T13:00" },
    { title: "Reacher", type: "Series", nextEpisodeNum: 6, nextEpisodeDate: "2026-09-02T13:00" },
  ];
  rows.sort((a, b) => api.compareCurrentOrder(a, b, now));
  assert.deepEqual(rows.map(row => row.title), ["Reacher", "Unknown", "CIA", "Chicago Fire", "House of the Dragon"]);

  const current = { title: "Aired yesterday", type: "Series", airedEpisodeCounts: { 1: 4 }, latestEpisodeDate: "2026-08-30T20:00:00+01:00" };
  const tba = { title: "Renewed", type: "Series", nextSeasonNum: 2, nextSeasonDate: "" };
  assert.ok(api.compareCurrentOrder(current, tba, now) < 0);

  const yesterday = { title: "Yesterday", type: "Series", latestEpisodeDate: "2026-08-30T20:00:00+01:00" };
  const today = { title: "Today", type: "Series", latestEpisodeDate: "2026-08-31T15:00:00+01:00" };
  const older = { title: "Older", type: "Series", latestEpisodeDate: "2026-07-10T20:00:00+01:00" };
  const upcoming = { title: "Upcoming", type: "Series", nextEpisodeDate: "2026-09-01T20:00:00+01:00" };
  const timeline = [tba, upcoming, yesterday, older, today].sort((a,b) => api.compareCurrentOrder(a,b,now));
  assert.deepEqual(timeline.map(item => item.title), ["Today", "Yesterday", "Upcoming", "Older", "Renewed"]);
});

test("Current airing shows use next release, independent of status and watched date", () => {
  const api=loadFunctions(["isEpisodeTrackable","currentSortInfo","compareCurrentOrder"], "const titleCollator=new Intl.Collator('en-GB');");
  const now=new Date("2026-09-05T17:22:00+01:00").getTime();
  const reacher={title:"Reacher",type:"Series",latestEpisodeDate:"2026-09-02T13:00",nextEpisodeDate:"2026-09-09T13:00",nextEpisodeNum:7,date:"2026-09-04"};
  const lioness={title:"Lioness",type:"Series",latestEpisodeDate:"2026-08-30T13:00",nextEpisodeDate:"2026-09-06T13:00",nextEpisodeNum:6,date:"2026-08-30"};
  const premiere={title:"Premiere",type:"Series",nextSeasonDate:"2026-09-26T02:00"};
  for(const status of ["Planned","Watching","Watched"]){
    const rows=[{...reacher,status},{...lioness,status},premiere].sort((a,b)=>api.compareCurrentOrder(a,b,now));
    assert.deepEqual(rows.map(row=>row.title),["Lioness","Reacher","Premiere"]);
  }
  assert.equal(api.currentSortInfo({...lioness,nextEpisodeDate:"2026-09-04T13:00"},now).kind,"aired");
});

test("Date-only releases remain upcoming all day and never become midnight", () => {
  const api = loadFunctions(["upcomingSortInfo", "dateOnlyInput"]);
  const item = { type: "Series", nextSeasonNum: 3, nextSeasonDate: api.dateOnlyInput("2026-09-02") };
  const evening = new Date("2026-09-02T20:00:00+01:00").getTime();
  const nextDay = new Date("2026-09-03T00:01:00+01:00").getTime();
  assert.equal(item.nextSeasonDate, "2026-09-02T12:00");
  assert.equal(api.upcomingSortInfo(item, evening).rank, 2);
  assert.equal(api.upcomingSortInfo(item, evening).dateOnly, true);
  assert.equal(api.upcomingSortInfo(item, nextDay).rank, 0);
  const timeline = loadFunctions(["currentSortInfo", "isEpisodeTrackable"]);
  assert.equal(timeline.currentSortInfo(item, evening).phase, 2);
  assert.equal(timeline.currentSortInfo(item, nextDay).phase, 0);
});

test("Announced episode totals do not become released episodes", () => {
  const api = loadFunctions(["isEpisodeTrackable", "positiveEpisodeMap", "toMillis", "normalizeReleasedEpisodeMap", "releasedEpisodeMap", "releasedEpisodeCounts", "normalizeWatchedEpisodeMap"]);
  const unreleased = { type:"Series", episodeCounts:{1:8}, nextSeasonNum:1, nextSeasonDate:"2099-01-01" };
  assert.equal(Object.keys(api.releasedEpisodeCounts(unreleased)).length, 0);
  const partial = { type:"Series", episodeCounts:{1:8}, airingSeason:1, latestEpisodeNum:3, latestEpisodeDate:"2026-01-01T20:00:00Z" };
  const counts = api.releasedEpisodeCounts(partial);
  assert.equal(counts[1],3);
  assert.equal(JSON.stringify(api.normalizeWatchedEpisodeMap({1:[1,3,4],2:[1]}, counts)), '{"1":[1,3]}');
});

test("Browser scripts parse and notification links stay within the site", () => {
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0);
  for(const [,source] of scripts)new vm.Script(source);
  const worker=fs.readFileSync(path.join(root,"sw.js"),"utf8");
  new vm.Script(worker);
  const context=vm.createContext({URL,self:{registration:{scope:"https://example.test/Watched-Tracker/"}}});
  vm.runInContext(extractFunction(worker,"notificationUrlWithinScope"),context);
  assert.equal(context.notificationUrlWithinScope("https://evil.example/"),"https://example.test/Watched-Tracker/");
  assert.equal(context.notificationUrlWithinScope("../other/"),"https://example.test/Watched-Tracker/");
  assert.equal(context.notificationUrlWithinScope("./?item=123"),"https://example.test/Watched-Tracker/?item=123");
});

test("Legacy auto-planning restores the user's status", () => {
  const api = loadFunctions(["toMillis", "isEpisodeTrackable", "positiveEpisodeMap", "releasedEpisodeCounts", "knownSeasonTotal", "upcomingSortInfo", "migratePlannedStatuses"]);
  const [row] = api.migratePlannedStatuses([{
    id: "show-1", title: "Example", type: "Series", status: "Planned",
    statusBeforeUpcoming: "Watching", autoPlanned: true,
    nextSeasonNum: 2, nextSeasonDate: "2099-01-01T12:00",
    totalSeasons: 2, watchedSeasons: 1, curSeason: 1,
  }]).rows;
  assert.equal(row.status, "Watching");
  assert.equal("autoPlanned" in row, false);
  assert.equal("statusBeforeUpcoming" in row, false);
});

test("Local search ranks exact, prefix, and typo matches", () => {
  const api = loadFunctions(["normalizeTitle", "levenshteinNormalized", "mediaSearchInfo", "librarySearchScore"], "const mediaSearchTextCache=new WeakMap();");
  const query = api.normalizeTitle("Reacher");
  const tokens = query.split(" ");
  const exact = api.librarySearchScore({ title: "Reacher", platform: "Prime Video" }, query, tokens);
  const prefix = api.librarySearchScore({ title: "Reacher: Origins", platform: "" }, query, tokens);
  const platform = api.librarySearchScore({ title: "Other", platform: "Reacher" }, query, tokens);
  const typo = api.librarySearchScore({ title: "Reacher", platform: "" }, api.normalizeTitle("Reacer"), ["reacer"]);
  assert.ok(exact > prefix && prefix > platform && typo > 0);
});

test("Conflict replay preserves remote work while applying local edits and deletes", () => {
  const { replayLocalChanges } = loadFunctions(["toMillis","canonicalRecordJSON","sameSyncValue","mergeEpisodeSetChanges","mergeEpisodeHistory","mergeRecordChanges","replayLocalChanges"]);
  const base = [{ id: "a", title: "A", updatedAt: "1" }, { id: "b", title: "B", updatedAt: "1" }];
  const local = [{ id: "a", title: "A edited", updatedAt: "2" }, { id: "c", title: "C", updatedAt: "2" }];
  const remote = [{ id: "a", title: "A", updatedAt: "1" }, { id: "b", title: "B remote", updatedAt: "2" }, { id: "d", title: "D", updatedAt: "2" }];
  const result = replayLocalChanges(base, local, remote);
  const byId = new Map(result.map(row => [row.id, row]));
  assert.equal(byId.get("a").title, "A edited");
  assert.equal(byId.has("b"), false);
  assert.equal(byId.get("c").title, "C");
  assert.equal(byId.get("d").title, "D");
});

test("No-op record comparison ignores only updatedAt", () => {
  const api = loadFunctions(["canonicalRecordJSON", "sameRecordWithoutUpdateTime"]);
  const a = { id: "1", title: "Show", nested: { b: 2, a: 1 }, updatedAt: "old" };
  const b = { nested: { a: 1, b: 2 }, title: "Show", id: "1", updatedAt: "new" };
  assert.equal(api.sameRecordWithoutUpdateTime(a, b), true);
  assert.equal(api.sameRecordWithoutUpdateTime(a, { ...b, title: "Changed" }), false);
});

test("Only explicitly released episode numbers are trackable", () => {
  const api=loadFunctions(["isEpisodeTrackable","positiveEpisodeMap","toMillis","normalizeReleasedEpisodeMap","releasedEpisodeMap","releasedEpisodeCounts","normalizeWatchedEpisodeMap","progressWatchedEpisodeMap"]);
  const item={type:"Series",episodeScheduleVerified:true,releasedEpisodes:{1:[1,3]},airedEpisodeCounts:{1:3}};
  assert.deepEqual(JSON.parse(JSON.stringify(api.releasedEpisodeMap(item))),{1:[1,3]});
  assert.deepEqual(JSON.parse(JSON.stringify(api.normalizeWatchedEpisodeMap({1:[1,2,3]},api.releasedEpisodeMap(item)))),{1:[1,3]});
  assert.deepEqual(JSON.parse(JSON.stringify(api.progressWatchedEpisodeMap(api.releasedEpisodeMap(item),0,1,3))),{1:[1,3]});
});

test("Schedule analysis records released episode identities instead of filling gaps", () => {
  const api=loadFunctions(["episodeAirTime","analyzeTVSchedule"]);
  const episodes=[
    {season:1,number:1,airstamp:"2026-09-01T19:00:00Z"},
    {season:1,number:2,airstamp:"2026-09-10T19:00:00Z"},
    {season:1,number:3,airstamp:"2026-09-03T19:00:00Z"},
  ];
  const result=api.analyzeTVSchedule([],episodes,{},new Date("2026-09-06T12:00:00Z").getTime());
  assert.deepEqual(JSON.parse(JSON.stringify(result.releasedEpisodes)),{1:[1,3]});
  assert.equal(result.nextEpisode.number,2);
});

test("TVMaze release timestamps are stored in UTC", () => {
  const api=loadFunctions(["episodeReleaseTimestamp"]);
  assert.equal(api.episodeReleaseTimestamp({airstamp:"2026-09-06T20:00:00+01:00"}),"2026-09-06T19:00:00.000Z");
  assert.equal(api.episodeReleaseTimestamp({airdate:"2026-09-06"}),"2026-09-06");
});

test("Reminder backend refreshes schedules before scanning and uses revision checks", () => {
  const source=fs.readFileSync(path.join(root,"supabase/functions/watchlog-reminders/index.ts"),"utf8");
  assert.match(source,/refreshServerEpisodeSchedules\(libraryRows \|\| \[\], Date\.now\(\)\)/);
  assert.match(source,/\.eq\("revision", revision\)/);
  assert.match(source,/nextEpisodeDate: episodeUtcValue\(next\)/);
  assert.match(source,/releasedEpisodes,/);
});

test("Production surface contains no executable third-party catalogue scripts", () => {
  assert.doesNotMatch(html, /document\.createElement\(["']script["']\)/);
  assert.doesNotMatch(html, /sg\.media-imdb\.com|itunes\.apple\.com/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /pinApi\("catalog_search"/);
});

test("HTML ids are unique and Pages uploads only runtime files", () => {
  const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/pages.yml"), "utf8");
  assert.match(workflow, /uses: actions\/checkout@v6/);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|configure-pages|upload-pages-artifact|deploy-pages)@v[1-4](?:\b|\.)/);
  assert.match(workflow, /uses: actions\/configure-pages@v6/);
  assert.match(workflow, /uses: actions\/upload-pages-artifact@v5/);
  assert.match(workflow, /uses: actions\/deploy-pages@v5/);
  assert.match(workflow, /path: _site/);
  assert.match(workflow, /cp index\.html manifest\.webmanifest sw\.js _site\//);
});

test("Backend requires revisions and provides an owned catalogue gateway", () => {
  const source = fs.readFileSync(path.join(root, "supabase/functions/watchlog-pin/index.ts"), "utf8");
  assert.match(source, /action === "catalog_search"/);
  assert.match(source, /code: "revision_conflict"/);
  assert.match(source, /\.eq\("revision", expectedRevision\)/);
  assert.match(source, /watchlog_record_pin_failure/);
  const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260904000200_harden_watchlog_sync.sql"), "utf8");
  assert.match(migration, /add column if not exists revision bigint/);
  assert.match(migration, /create or replace function public\.watchlog_record_pin_failure/);
});
