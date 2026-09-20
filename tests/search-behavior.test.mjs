import { readAppSource } from "./app-source.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = readAppSource();
const between = (start, end) => {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Expected search source: ${start}`);
  return html.slice(from, to);
};

function searchHarness(pinApi) {
  const context = vm.createContext({ AbortController, console, pinApi });
  vm.runInContext(`
    let cloudSessionToken="test-session", activeTitleSearchKey="";
    ${between("  function normalizeTitle(", "  function canonicalRecordJSON(")}
    ${between("  const TITLE_SEARCH_STOP_WORDS=", "  function isFutureDateOnly(")}
    ${between("  function balancedSuggestions(", "  function renderSuggestions(")}
    this.api={searchAllTitles,searchTVMaze,searchCatalogBatch,normalizeTitle,suggestionScore,
      cacheGetSearch,cacheSetSearch,titleSearchInFlight,titleSourceSearchInFlight,titleSearchCache,
      setActive(query){activeTitleSearchKey="all:"+normalizeTitle(query);}};
  `, context);
  return context.api;
}

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const titleRow = title => ({ title, format: "Series", source: "tvmaze", externalId: "1", status: "Running" });
const isCancelled = error => error?.code === "cancelled";

function controlledCatalogue() {
  const calls = [];
  const api = searchHarness((_action, payload, _token, _body, signal) => new Promise((resolve, reject) => {
    calls.push({ ...payload, signal, resolve, reject });
  }));
  return { api, calls };
}

test("Concurrent searches share one request while cancellation affects only its caller", async () => {
  const { api, calls } = controlledCatalogue();
  api.setActive("Reacher");
  const first = new AbortController(), second = new AbortController();
  const firstProgress = [], secondProgress = [];
  const firstResult = api.searchAllTitles("Reacher", { signal: first.signal, onProgress: rows => firstProgress.push(rows) });
  const firstCancelled = assert.rejects(firstResult, isCancelled);
  const secondResult = api.searchAllTitles("Reacher", { signal: second.signal, onProgress: rows => secondProgress.push(rows) });
  await flush();
  assert.equal(calls.length, 1);
  first.abort();
  await firstCancelled;
  assert.equal(calls[0].signal.aborted, false);
  calls[0].resolve({ results: [titleRow("Reacher")] });
  assert.equal((await secondResult)[0].title, "Reacher");
  assert.equal(firstProgress.length, 0);
  assert.equal(secondProgress.length, 1);
  assert.equal(calls.length, 1, "Strong matches do not expand to other regions");
});

test("A fully cancelled query can be repeated immediately before the old response settles", async () => {
  const { api, calls } = controlledCatalogue();
  api.setActive("Reacher");
  const first = new AbortController();
  const oldResult = api.searchAllTitles("Reacher", { signal: first.signal });
  const oldCancelled = assert.rejects(oldResult, isCancelled);
  await flush();
  first.abort();
  const newResult = api.searchAllTitles("Reacher", { signal: new AbortController().signal });
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, false);
  calls[0].resolve({ results: [] });
  await oldCancelled;
  await flush();
  assert.equal(api.titleSearchInFlight.size, 1, "Old cleanup must not remove the replacement request");
  assert.equal(api.titleSearchCache.size, 0, "Late cancelled responses must not populate caches");
  calls[1].resolve({ results: [titleRow("Reacher")] });
  assert.equal((await newResult)[0].title, "Reacher");
  assert.equal(calls.length, 2, "Cancelled work must not launch regional fallback");
});

test("Cancelled source wrappers never cache an empty result", async () => {
  const { api, calls } = controlledCatalogue();
  const controller = new AbortController();
  const pending = api.searchTVMaze("Reacher", controller.signal);
  const cancelled = assert.rejects(pending, isCancelled);
  await flush();
  controller.abort();
  calls[0].resolve({ results: [] });
  await cancelled;
  await flush();
  assert.equal(api.titleSearchCache.size, 0);
  const retry = api.searchTVMaze("Reacher");
  await flush();
  calls[1].resolve({ results: [titleRow("Reacher")] });
  assert.equal((await retry)[0].title, "Reacher");
});

test("Failed searches remain retryable instead of being cached as no matches", async () => {
  let attempts = 0;
  const api = searchHarness(async () => {
    if (++attempts === 1) throw new Error("Temporary network failure");
    return { results: [titleRow("Reacher")] };
  });
  api.setActive("Reacher");
  await assert.rejects(api.searchAllTitles("Reacher"), /Temporary network failure/);
  assert.equal(api.titleSearchCache.size, 0);
  assert.equal((await api.searchAllTitles("Reacher"))[0].title, "Reacher");
  assert.equal(attempts, 2);
});

test("Weak results make at most one US and one alternate-query fallback", async () => {
  const calls = [];
  const api = searchHarness(async (_action, payload) => { calls.push(payload); return { results: [] }; });
  api.setActive("The Quiet Show");
  assert.equal((await api.searchAllTitles("The Quiet Show")).length, 0);
  assert.deepEqual(calls.map(({ query, country }) => `${country}:${query}`), [
    "gb:the quiet show", "us:the quiet show", "gb:quiet show",
  ]);
  assert.equal((await api.searchAllTitles("The Quiet Show")).length, 0);
  assert.equal(calls.length, 3, "Successful empty queries use their brief cache");
});

test("A failed fallback is retried while successful regional results remain cached", async () => {
  const calls = [];
  let failUS = true;
  const api = searchHarness(async (_action, payload) => {
    calls.push(`${payload.country}:${payload.query}`);
    if (payload.country === "us" && failUS) { failUS = false; throw new Error("US unavailable"); }
    return { results: [] };
  });
  api.setActive("Quiet Show");
  await api.searchAllTitles("Quiet Show");
  assert.equal(api.cacheGetSearch("all:quiet show"), null);
  await api.searchAllTitles("Quiet Show");
  assert.deepEqual(calls, ["gb:quiet show", "us:quiet show", "us:quiet show"]);
});

test("Non-Latin titles retain distinct keys, results and exact-match ranking", async () => {
  const calls = [];
  const api = searchHarness(async (_action, payload) => {
    calls.push(payload.query);
    return { results: [titleRow(payload.query)] };
  });
  for (const query of ["東京物語", "天空の城"]) {
    api.setActive(query);
    assert.equal((await api.searchAllTitles(query))[0].title, query);
  }
  assert.deepEqual(calls, ["東京物語", "天空の城"]);
  assert.ok(api.suggestionScore(titleRow("東京物語"), "東京物語") > api.suggestionScore(titleRow("天空の城"), "東京物語"));
  assert.equal(api.normalizeTitle("Amélie"), "amelie");
});

test("Already cancelled callers cannot receive cached results or start new requests", async () => {
  const api = searchHarness(async () => { throw new Error("Unexpected request"); });
  api.cacheSetSearch("all:reacher", [titleRow("Reacher")]);
  const controller = new AbortController();controller.abort();
  await assert.rejects(api.searchAllTitles("Reacher", { signal: controller.signal }), isCancelled);
  assert.equal(api.titleSearchInFlight.size, 0);
});
