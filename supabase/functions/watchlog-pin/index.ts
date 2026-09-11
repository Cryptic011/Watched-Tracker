import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { getUKAvailability } from "./uk-availability.mjs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-watchlog-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const PIN_ITERATIONS = 350000;
const SESSION_DAYS = 30;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const MAINTENANCE_ADMIN_HASH = "a9db2ce561a8b3d65766ef4d26ee235e58c269407104d13865546c5d5299420b";
const DEFAULT_MAINTENANCE_MESSAGE = "Watched Logger is currently under maintenance. Please try again shortly.";
const MAINTENANCE_CACHE_MS = 2_000;
const CATALOG_CACHE_MS = 5 * 60 * 1000;
const CATALOG_TIMEOUT_MS = 6_000;
const MAX_CATALOG_RESULTS_PER_SOURCE = 40;

let maintenanceCache: {
  value: { enabled: boolean; message: string; updatedAt: string };
  expiresAt: number;
} | null = null;
const catalogCache = new Map<string, { value: unknown[]; expiresAt: number }>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function normalizeEmail(v: unknown) { return String(v ?? "").trim().toLowerCase(); }
function validEmail(v: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function validPin(v: unknown) { return /^\d{4}$/.test(String(v ?? "")); }
function b64(bytes: Uint8Array) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function unb64(value: string) { const s = atob(value); const out = new Uint8Array(s.length); for (let i=0;i<s.length;i++) out[i] = s.charCodeAt(i); return out; }
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,"0")).join("");
}
async function derivePin(pin: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = Uint8Array.from(salt).buffer;
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBuffer, iterations: PIN_ITERATIONS, hash: "SHA-256" }, material, 256);
  return b64(new Uint8Array(bits));
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0;
}
function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2,"0")).join(""); }

function catalogText(value: unknown, maximum = 160) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

async function fetchCatalogJSON(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "WatchedLogger/1.0" },
    });
    if (!response.ok) throw new Error(`Catalogue request failed (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function imdbSuggestion(row: any) {
  const id = catalogText(row?.id, 24);
  if (!/^tt\d{5,12}$/.test(id)) return null;
  const kind = catalogText(row?.qid || row?.q, 48).toLowerCase();
  let format = "Film";
  if (/tvseries|tvminiseries|series|mini-series|television series|tv series/.test(kind)) format = "Series";
  else if (/video game|videogame|game/.test(kind)) format = "Game";
  return {
    source: "imdb", externalId: id, imdbId: id,
    title: catalogText(row?.l || row?.title), format,
    year: Number.isFinite(Number(row?.y)) ? String(row.y).slice(0, 4) : "",
    releaseDate: "", platform: "", detail: catalogText(row?.q || row?.qid || format, 64).replace(/_/g, " "),
  };
}

async function searchCatalog(query: string, country: string) {
  const normalized = query.normalize("NFKC").toLocaleLowerCase("en");
  const key = `${country}:${normalized}`;
  const cached = catalogCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) catalogCache.delete(key);

  const imdbURL = `https://v3.sg.media-imdb.com/suggestion/titles/x/${encodeURIComponent(query.toLowerCase())}.json`;
  const appleURL = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=${country}&media=movie&entity=movie&limit=${MAX_CATALOG_RESULTS_PER_SOURCE}&lang=en_gb&explicit=Yes`;
  const tvMazeURL = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`;
  const [imdbResult, appleResult, tvMazeResult] = await Promise.allSettled([
    fetchCatalogJSON(imdbURL), fetchCatalogJSON(appleURL), fetchCatalogJSON(tvMazeURL),
  ]);
  if ([imdbResult, appleResult, tvMazeResult].every(result => result.status === "rejected")) {
    catalogCache.delete(key);
    const unavailable = new Error("Catalogue providers are temporarily unavailable.");
    (unavailable as Error & { code?: string }).code = "catalog_unavailable";
    throw unavailable;
  }
  const results: unknown[] = [];

  if (imdbResult.status === "fulfilled") {
    for (const row of (Array.isArray(imdbResult.value?.d) ? imdbResult.value.d : []).slice(0, MAX_CATALOG_RESULTS_PER_SOURCE)) {
      const item = imdbSuggestion(row);
      if (item?.title) results.push(item);
    }
  }
  if (appleResult.status === "fulfilled") {
    for (const row of (Array.isArray(appleResult.value?.results) ? appleResult.value.results : []).slice(0, MAX_CATALOG_RESULTS_PER_SOURCE)) {
      const title = catalogText(row?.trackName || row?.collectionName);
      if (!title) continue;
      const releaseDate = /^\d{4}-\d{2}-\d{2}/.test(String(row?.releaseDate || "")) ? String(row.releaseDate).slice(0, 10) : "";
      results.push({
        source: "apple", externalId: catalogText(row?.trackId || row?.collectionId, 32), title, format: "Film",
        year: releaseDate.slice(0, 4), releaseDate, platform: "", detail: catalogText(row?.primaryGenreName || "Film", 64),
        country: country.toUpperCase(), storeUrl: /^https:\/\//.test(String(row?.trackViewUrl || row?.collectionViewUrl || "")) ? String(row.trackViewUrl || row.collectionViewUrl).slice(0, 500) : "",
      });
    }
  }
  if (tvMazeResult.status === "fulfilled") {
    for (const row of (Array.isArray(tvMazeResult.value) ? tvMazeResult.value : []).slice(0, MAX_CATALOG_RESULTS_PER_SOURCE)) {
      const show = row?.show || {};
      const title = catalogText(show.name);
      if (!title) continue;
      results.push({
        source: "tvmaze", externalId: catalogText(show.id, 32), tvmazeId: catalogText(show.id, 32),
        imdbId: catalogText(show?.externals?.imdb, 24), title, format: "Series",
        year: /^\d{4}/.test(String(show?.premiered || "")) ? String(show.premiered).slice(0, 4) : "",
        releaseDate: "", platform: catalogText(show?.network?.name || show?.webChannel?.name, 100),
        detail: catalogText(show?.type || "Series", 64), status: catalogText(show?.status, 32),
        updated: Number.isFinite(Number(show?.updated)) ? Number(show.updated) : 0,
      });
    }
  }

  catalogCache.delete(key);
  catalogCache.set(key, { value: results, expiresAt: Date.now() + CATALOG_CACHE_MS });
  while (catalogCache.size > 100) catalogCache.delete(catalogCache.keys().next().value!);
  return results;
}

async function readMaintenance(fresh = false) {
  if (!fresh && maintenanceCache && maintenanceCache.expiresAt > Date.now()) {
    return maintenanceCache.value;
  }
  const { data, error } = await db
    .from("watchlog_app_config")
    .select("maintenance_enabled,maintenance_message,updated_at")
    .eq("singleton", true)
    .single();
  if (error) throw error;
  const value = {
    enabled: data.maintenance_enabled === true,
    message: String(data.maintenance_message || DEFAULT_MAINTENANCE_MESSAGE),
    updatedAt: String(data.updated_at),
  };
  maintenanceCache = { value, expiresAt: Date.now() + MAINTENANCE_CACHE_MS };
  return value;
}

async function isMaintenanceAdmin(accountId: string) {
  const { data, error } = await db
    .from("watchlog_pin_accounts")
    .select("email")
    .eq("id", accountId)
    .single();
  if (error || !data) return false;
  const candidate = await sha256(`watchlog-maintenance-admin:${normalizeEmail(data.email)}`);
  return safeEqual(candidate, MAINTENANCE_ADMIN_HASH);
}

async function createSession(accountId: string) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  const { error } = await db.from("watchlog_pin_sessions").insert({ token_hash: tokenHash, account_id: accountId, expires_at: expires });
  if (error) throw error;
  return { token, expiresAt: expires };
}

async function getSession(req: Request) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const token = req.headers.get("x-watchlog-session")?.trim() || bearer || "";
  if (!token) return null;
  const tokenHash = await sha256(token);
  const { data, error } = await db.from("watchlog_pin_sessions").select("token_hash,account_id,expires_at").eq("token_hash", tokenHash).maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await db.from("watchlog_pin_sessions").delete().eq("token_hash", tokenHash);
    return null;
  }
  return { accountId: data.account_id as string, tokenHash };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const action = String(body?.action || "");

  try {
    if (action === "app_status") {
      const maintenance = await readMaintenance();
      return json({ ok: true, maintenance: maintenance.enabled, message: maintenance.message, updatedAt: maintenance.updatedAt });
    }

    if (action === "register") {
      const maintenance = await readMaintenance();
      if (maintenance.enabled) {
        return json({ error: maintenance.message, code: "maintenance", maintenance: true }, 503);
      }
      const email = normalizeEmail(body.email);
      const pin = String(body.pin ?? "");
      const displayName = String(body.displayName ?? "User").trim().slice(0, 64) || "User";
      if (!validEmail(email)) return json({ error: "Enter a valid email address." }, 400);
      if (!validPin(pin)) return json({ error: "PIN must be exactly 4 digits." }, 400);
      const initialItems = Array.isArray(body.items) ? body.items : [];
      if (JSON.stringify(initialItems).length > 3_000_000) return json({ error: "Library is too large to sync." }, 413);

      const { data: existing } = await db.from("watchlog_pin_accounts").select("id").eq("email", email).maybeSingle();
      if (existing) return json({ error: "An account already exists for that email. Sign in instead.", code: "account_exists" }, 409);

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const pinHash = await derivePin(pin, salt);
      const { data: account, error } = await db.from("watchlog_pin_accounts").insert({ email, display_name: displayName, pin_hash: pinHash, pin_salt: b64(salt) }).select("id,email,display_name").single();
      if (error) throw error;
      try {
        const initialUpdatedAt = new Date().toISOString();
        const { data: library, error: libraryError } = await db.from("watchlog_pin_library")
          .upsert({ account_id: account.id, items: initialItems, updated_at: initialUpdatedAt, revision: 0 })
          .select("updated_at,revision")
          .single();
        if (libraryError) throw libraryError;
        const session = await createSession(account.id);
        return json({ ok: true, account: { id: account.id, email: account.email, displayName: account.display_name }, updatedAt: library.updated_at, revision: Number(library.revision || 0), sessionToken: session.token, expiresAt: session.expiresAt });
      } catch (registrationError) {
        await db.from("watchlog_pin_library").delete().eq("account_id", account.id);
        await db.from("watchlog_pin_accounts").delete().eq("id", account.id);
        throw registrationError;
      }
    }

    if (action === "login") {
      const maintenance = await readMaintenance();
      const email = normalizeEmail(body.email);
      const pin = String(body.pin ?? "");
      if (!validEmail(email) || !validPin(pin)) return json({ error: "Email or PIN is incorrect.", code: "invalid_login" }, 401);

      const { data: account, error } = await db.from("watchlog_pin_accounts").select("id,email,display_name,pin_hash,pin_salt,failed_attempts,locked_until").eq("email", email).maybeSingle();
      if (error || !account) return json({ error: "Email or PIN is incorrect.", code: "invalid_login" }, 401);

      if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
        const retryAfter = Math.max(1, Math.ceil((new Date(account.locked_until).getTime() - Date.now()) / 1000));
        return json({ error: `Too many incorrect PIN attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`, code: "locked", retryAfter }, 429);
      }

      const candidate = await derivePin(pin, unb64(account.pin_salt));
      if (!safeEqual(candidate, account.pin_hash)) {
        const { data: failureRows, error: failureError } = await db.rpc("watchlog_record_pin_failure", {
          p_account_id: account.id,
          p_max_attempts: MAX_FAILED_ATTEMPTS,
          p_lock_minutes: LOCK_MINUTES,
        });
        if (failureError) throw failureError;
        if (failureRows?.[0]?.locked === true) {
          const retryAfter = Math.max(1, Number(failureRows[0].retry_after) || LOCK_MINUTES * 60);
          return json({ error: `Too many incorrect PIN attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`, code: "locked", retryAfter }, 429);
        }
        return json({ error: "Email or PIN is incorrect.", code: "invalid_login" }, 401);
      }

      // Do not reveal which email is allowed through maintenance before the PIN
      // has been verified successfully.
      const ownerCandidate = await sha256(`watchlog-maintenance-admin:${email}`);
      const isOwnerLogin = safeEqual(ownerCandidate, MAINTENANCE_ADMIN_HASH);
      if (maintenance.enabled && !isOwnerLogin) {
        return json({ error: maintenance.message, code: "maintenance", maintenance: true }, 503);
      }

      // PBKDF2 runs outside the database. Recheck the credential and lock while
      // updating so another request cannot have its new lock cleared here.
      const verifiedAt = new Date().toISOString();
      const { data: resetAccount, error: resetError } = await db.from("watchlog_pin_accounts")
        .update({ failed_attempts: 0, locked_until: null, updated_at: verifiedAt })
        .eq("id", account.id)
        .eq("pin_hash", account.pin_hash)
        .eq("pin_salt", account.pin_salt)
        .or(`locked_until.is.null,locked_until.lte.${verifiedAt}`)
        .select("id")
        .maybeSingle();
      if (resetError) throw resetError;
      if (!resetAccount) {
        const { data: latestAccount, error: latestError } = await db.from("watchlog_pin_accounts")
          .select("locked_until")
          .eq("id", account.id)
          .maybeSingle();
        if (latestError) throw latestError;
        const retryAfter = Math.ceil((new Date(latestAccount?.locked_until || 0).getTime() - Date.now()) / 1000);
        if (retryAfter > 0) return json({ error: `Too many incorrect PIN attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`, code: "locked", retryAfter }, 429);
        return json({ error: "Email or PIN is incorrect. Try signing in again.", code: "invalid_login" }, 401);
      }
      const session = await createSession(account.id);
      const { data: library, error: libraryError } = await db.from("watchlog_pin_library").select("items,updated_at,revision").eq("account_id", account.id).maybeSingle();
      if (libraryError) throw libraryError;
      return json({ ok: true, account: { id: account.id, email: account.email, displayName: account.display_name }, items: Array.isArray(library?.items) ? library!.items : [], updatedAt: library?.updated_at || null, revision: Number(library?.revision || 0), sessionToken: session.token, expiresAt: session.expiresAt });
    }

    const session = await getSession(req);
    if (!session) return json({ error: "Session expired. Sign in again.", code: "session_expired" }, 401);

    // Maintenance applies to already-open sessions as well as new sign-ins.
    // Logout remains available, and the owner account retains full access.
    let maintenanceAdmin = false;
    if (action !== "logout") {
      const maintenance = await readMaintenance();
      if (maintenance.enabled) {
        maintenanceAdmin = await isMaintenanceAdmin(session.accountId);
        if (!maintenanceAdmin) {
          return json({ error: maintenance.message, code: "maintenance", maintenance: true }, 503);
        }
      }
    }

    if (action === "maintenance_admin_status" || action === "set_maintenance") {
      if (!maintenanceAdmin && !(await isMaintenanceAdmin(session.accountId))) {
        return json({ error: "This account cannot manage maintenance mode.", code: "forbidden" }, 403);
      }
      if (action === "set_maintenance") {
        const enabled = body.enabled === true;
        const message = String(body.message || DEFAULT_MAINTENANCE_MESSAGE).trim().slice(0, 240);
        if (message.length < 8) return json({ error: "Maintenance message must be at least 8 characters." }, 400);
        const { error } = await db
          .from("watchlog_app_config")
          .update({ maintenance_enabled: enabled, maintenance_message: message, updated_at: new Date().toISOString() })
          .eq("singleton", true);
        if (error) throw error;
        maintenanceCache = null;
      }
      const maintenance = await readMaintenance(true);
      return json({ ok: true, canManage: true, maintenance: maintenance.enabled, message: maintenance.message, updatedAt: maintenance.updatedAt });
    }

    if (action === "uk_availability") {
      try {
        const availability = await getUKAvailability(body, Deno.env.get("TMDB_API_READ_TOKEN"));
        return json({ ok: true, ...availability });
      } catch (_) {
        return json({ error: "UK availability could not be checked. Try again shortly.", code: "availability_unavailable" }, 503);
      }
    }

    if (action === "catalog_search") {
      const query = catalogText(body.query, 100);
      const country = String(body.country || "gb").trim().toLowerCase();
      if (query.length < 2) return json({ error: "Enter at least two characters.", code: "invalid_query" }, 400);
      if (!new Set(["gb", "us"]).has(country)) return json({ error: "Invalid catalogue country.", code: "invalid_country" }, 400);
      const results = await searchCatalog(query, country);
      return json({ ok: true, results });
    }

    if (action === "load") {
      const [{ data: account, error: aerr }, { data: library, error: lerr }] = await Promise.all([
        db.from("watchlog_pin_accounts").select("id,email,display_name").eq("id", session.accountId).single(),
        db.from("watchlog_pin_library").select("items,updated_at,revision").eq("account_id", session.accountId).maybeSingle(),
      ]);
      if (aerr) throw aerr; if (lerr) throw lerr;
      return json({ ok: true, account: { id: account.id, email: account.email, displayName: account.display_name }, items: Array.isArray(library?.items) ? library!.items : [], updatedAt: library?.updated_at || null, revision: Number(library?.revision || 0) });
    }

    if (action === "save") {
      if (!Array.isArray(body.items)) return json({ error: "Invalid library." }, 400);
      const serialized = JSON.stringify(body.items);
      if (serialized.length > 3_000_000) return json({ error: "Library is too large to sync." }, 413);
      const expectedRevision = body.expectedRevision;
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) {
        return json({ error: "Reload the latest library before saving.", code: "revision_required" }, 428);
      }
      const updatedAt = new Date().toISOString();
      const nextRevision = expectedRevision + 1;
      const { data: saved, error } = await db.from("watchlog_pin_library")
        .update({ items: body.items, updated_at: updatedAt, revision: nextRevision })
        .eq("account_id", session.accountId)
        .eq("revision", expectedRevision)
        .select("updated_at,revision")
        .maybeSingle();
      if (error) throw error;
      if (!saved) {
        const { data: latest, error: latestError } = await db.from("watchlog_pin_library")
          .select("items,updated_at,revision")
          .eq("account_id", session.accountId)
          .single();
        if (latestError) throw latestError;
        return json({
          error: "This library changed on another device. Watched Logger kept both changes and will retry.",
          code: "revision_conflict",
          items: Array.isArray(latest.items) ? latest.items : [],
          updatedAt: latest.updated_at,
          revision: Number(latest.revision || 0),
        }, 409);
      }
      return json({ ok: true, updatedAt: saved.updated_at, revision: Number(saved.revision) });
    }

    if (action === "profile") {
      const displayName = String(body.displayName ?? "").trim().slice(0,64);
      if (!displayName) return json({ error: "Name is required." }, 400);
      const { error } = await db.from("watchlog_pin_accounts").update({ display_name: displayName, updated_at: new Date().toISOString() }).eq("id", session.accountId);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "change_pin") {
      const pin = String(body.pin ?? "");
      if (!validPin(pin)) return json({ error: "PIN must be exactly 4 digits." }, 400);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const pinHash = await derivePin(pin, salt);
      const { error } = await db.from("watchlog_pin_accounts").update({ pin_hash: pinHash, pin_salt: b64(salt), failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() }).eq("id", session.accountId);
      if (error) throw error;
      const { error: revokeError } = await db.from("watchlog_pin_sessions").delete().eq("account_id", session.accountId).neq("token_hash", session.tokenHash);
      if (revokeError) throw revokeError;
      return json({ ok: true });
    }

    if (action === "logout") {
      const { error } = await db.from("watchlog_pin_sessions").delete().eq("token_hash", session.tokenHash);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    if ((error as { code?: string })?.code === "catalog_unavailable") {
      return json({ error: "Catalogue providers are temporarily unavailable. Try searching again shortly.", code: "catalog_unavailable" }, 503);
    }
    return json({ error: "WatchLog cloud service error." }, 500);
  }
});
