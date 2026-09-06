import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import {
  generateVAPIDKeys,
  sendNotification,
  type PushSubscription,
  type VapidDetails,
} from "npm:web-push-neo@0.1.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-watchlog-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const enc = new TextEncoder();
const PRIVATE_TEST_ACCOUNT_HASH = "ea67160ff90d5a1b54a6b7fe8522c1573ec9dea8fb18fff38969f42b09c27f0b";
const VAPID_SUBJECT = "mailto:push@watched-logger.app";
const MAX_PUSH_ATTEMPTS = 5;
const EPISODE_SCHEDULE_REFRESH_MS = 6 * 60 * 60 * 1000;
const ALLOWED_PUSH_HOSTS = new Set([
  "web.push.apple.com",
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
]);

type PushRow = {
  id: string;
  account_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration_time: number | null;
  time_zone: string;
  locale: string;
  enabled: boolean;
};

type PushConfig = {
  vapid_public_key: string | null;
  vapid_private_key: string | null;
  cron_secret: string;
  last_scan_at: string | null;
};

type LibraryRow = {
  account_id: string;
  items: unknown;
  revision: number;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function validTimeZone(value: unknown) {
  const candidate = String(value || "UTC").slice(0, 80);
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

function validPushEndpoint(value: unknown) {
  const endpoint = String(value || "").trim();
  if (!endpoint || endpoint.length > 4096) return "";
  try {
    const url = new URL(endpoint);
    const allowed =
      url.protocol === "https:" &&
      (ALLOWED_PUSH_HOSTS.has(url.hostname) ||
        url.hostname.endsWith(".push.apple.com") ||
        url.hostname.endsWith(".push.services.mozilla.com"));
    return allowed ? endpoint : "";
  } catch {
    return "";
  }
}

async function getSession(req: Request) {
  const bearer = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  const token = req.headers.get("x-watchlog-session")?.trim() || bearer || "";
  if (!token) return null;

  const tokenHash = await sha256(token);
  const { data, error } = await db
    .from("watchlog_pin_sessions")
    .select("account_id,expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  return { accountId: String(data.account_id) };
}

async function readConfig(generateIfMissing = false): Promise<PushConfig> {
  const load = async () => {
    const { data, error } = await db
      .from("watchlog_push_config")
      .select("vapid_public_key,vapid_private_key,cron_secret,last_scan_at")
      .eq("singleton", true)
      .single();
    if (error) throw error;
    return data as PushConfig;
  };

  let config = await load();
  if (
    generateIfMissing &&
    (!config.vapid_public_key || !config.vapid_private_key)
  ) {
    const keys = await generateVAPIDKeys();
    const { error } = await db
      .from("watchlog_push_config")
      .update({
        vapid_public_key: keys.publicKey,
        vapid_private_key: keys.privateKey,
        updated_at: new Date().toISOString(),
      })
      .eq("singleton", true);
    if (error) throw error;
    config = await load();
  }
  return config;
}

function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const requestedAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = requestedAsUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let pass = 0; pass < 3; pass++) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    ) as Record<string, number>;
    const displayedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const correction = displayedAsUtc - requestedAsUtc;
    if (correction === 0) break;
    guess -= correction;
  }
  return guess;
}

function scheduledEventTime(rawValue: unknown, timeZone: string) {
  const raw = String(rawValue || "").trim();
  if (!raw) return Number.NaN;

  if (/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    return new Date(raw).getTime();
  }

  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?$/,
  );
  if (!match) return new Date(raw).getTime();

  const [, year, month, day, hour, minute] = match;
  // A date without a time is treated as noon locally, avoiding midnight alerts.
  return zonedLocalToUtc(
    Number(year),
    Number(month),
    Number(day),
    hour === undefined ? 12 : Number(hour),
    minute === undefined ? 0 : Number(minute),
    timeZone,
  );
}

function episodeUtcValue(episode) {
  const raw = String(episode?.airstamp || "").trim();
  if (raw) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(String(episode?.airdate || ""))
    ? String(episode.airdate)
    : "";
}

function episodeReleaseTime(episode) {
  const value = episodeUtcValue(episode);
  if (!value) return 0;
  const time = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59Z` : value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function buildServerEpisodeSchedule(item, episodesRaw, now = Date.now()) {
  const episodes = (Array.isArray(episodesRaw) ? episodesRaw : [])
    .filter((episode) => Number.isInteger(Number(episode?.season)) && Number(episode.season) > 0 && Number.isInteger(Number(episode?.number)) && Number(episode.number) > 0)
    .map((episode) => ({ ...episode, season: Number(episode.season), number: Number(episode.number) }));
  if (!episodes.length) return item;
  const episodeCounts = {}, airedEpisodeCounts = {}, releasedEpisodes = {};
  for (const episode of episodes) {
    episodeCounts[episode.season] = Math.max(Number(episodeCounts[episode.season] || 0), episode.number);
    const time = episodeReleaseTime(episode);
    if (time > 0 && time <= now) {
      airedEpisodeCounts[episode.season] = Math.max(Number(airedEpisodeCounts[episode.season] || 0), episode.number);
      (releasedEpisodes[episode.season] ||= []).push(episode.number);
    }
  }
  for (const season of Object.keys(releasedEpisodes)) releasedEpisodes[season] = [...new Set(releasedEpisodes[season])].sort((a, b) => a - b);
  const released = episodes.filter((episode) => episodeReleaseTime(episode) > 0 && episodeReleaseTime(episode) <= now).sort((a, b) => episodeReleaseTime(a) - episodeReleaseTime(b));
  const future = episodes.filter((episode) => episodeReleaseTime(episode) > now).sort((a, b) => episodeReleaseTime(a) - episodeReleaseTime(b) || a.season - b.season || a.number - b.number);
  const latest = released.at(-1) || null, next = future[0] || null;
  const latestSeason = Number(latest?.season || 0), nextSeason = Number(next?.season || 0), highest = Math.max(0, ...episodes.map((episode) => episode.season));
  return {
    ...item,
    totalSeasons: Math.max(Number(item?.totalSeasons || 0), highest) || null,
    episodeCounts,
    airedEpisodeCounts,
    releasedEpisodes,
    episodeScheduleVerified: true,
    airingSeason: latestSeason || null,
    latestEpisodeNum: latest?.number ?? null,
    latestEpisodeTitle: String(latest?.name || ""),
    latestEpisodeDate: episodeUtcValue(latest),
    nextEpisodeNum: next?.number ?? null,
    nextEpisodeTitle: String(next?.name || ""),
    nextEpisodeDate: episodeUtcValue(next),
    nextSeasonNum: nextSeason > latestSeason ? nextSeason : "",
    nextSeasonDate: nextSeason > latestSeason ? episodeUtcValue(next) : "",
    metadataUpdatedAt: new Date(now).toISOString(),
  };
}

function serverScheduleRefreshDue(item: Record<string, unknown>, now = Date.now()) {
  if (!["Series", "Anime"].includes(String(item?.type || "")) || !item?.tvmazeShowId) return false;
  const next = scheduledEventTime(item.nextEpisodeDate, "UTC"), refreshed = new Date(String(item.metadataUpdatedAt || "")).getTime();
  return !Number.isFinite(refreshed) || now - refreshed >= EPISODE_SCHEDULE_REFRESH_MS || (Number.isFinite(next) && next <= now);
}

async function refreshServerEpisodeSchedules(libraries: LibraryRow[], now = Date.now()) {
  const requests = new Map<string, Promise<unknown[]>>();
  const load = (showId: unknown) => {
    const key = String(showId);
    if (!requests.has(key)) requests.set(key, fetch(`https://api.tvmaze.com/shows/${encodeURIComponent(key)}/episodes`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) }).then(async (response) => { const data = response.ok ? await response.json() : []; return Array.isArray(data) ? data : []; }).catch(() => []));
    return requests.get(key)!;
  };
  const refreshed = [];
  for (const library of libraries || []) {
    const source = (Array.isArray(library.items) ? library.items : []) as Record<string, unknown>[], items = [...source];
    let changed = false;
    for (let index = 0; index < items.length; index++) {
      if (!serverScheduleRefreshDue(items[index], now)) continue;
      const episodes = await load(items[index].tvmazeShowId);
      const updated = buildServerEpisodeSchedule(items[index], episodes, now);
      if (JSON.stringify(updated) !== JSON.stringify(items[index])) { items[index] = updated; changed = true; }
    }
    if (changed) {
      const revision = Math.max(0, Number(library.revision || 0));
      const { error } = await db.from("watchlog_pin_library").update({ items, revision: revision + 1, updated_at: new Date(now).toISOString() }).eq("account_id", library.account_id).eq("revision", revision);
      if (error) console.error("Server episode schedule save failed", error.code || error.message);
    }
    refreshed.push({ ...library, items });
  }
  return refreshed;
}

function plannedEvent(item: Record<string, unknown>) {
  const nextEpisodeDate = String(item.nextEpisodeDate || "");
  const nextSeasonDate = String(item.nextSeasonDate || "");
  const filmReleaseDate =
    String(item.type || "") === "Film" ? String(item.filmReleaseDate || "") : "";

  if (nextEpisodeDate) {
    return {
      kind: "episode",
      raw: nextEpisodeDate,
      number: item.nextEpisodeNum,
    };
  }
  if (nextSeasonDate) {
    return {
      kind: "season",
      raw: nextSeasonDate,
      number: item.nextSeasonNum,
    };
  }
  if (filmReleaseDate) {
    return { kind: "film", raw: filmReleaseDate, number: null };
  }
  return null;
}

function reminderCopy(
  item: Record<string, unknown>,
  event: { kind: string; number: unknown },
  leadHours: number,
) {
  const name = String(item.title || "Tracked title");
  const timing = leadHours === 24 ? "tomorrow" : leadHours === 6 ? "in 6 hours" : "now";
  const title = "Watched log reminder";
  let body = `${name} is due ${timing}.`;
  if (event.kind === "episode" && event.number) {
    body = leadHours === 0
      ? `${name} episode ${event.number} is out now.`
      : `${name} episode ${event.number} airs ${timing}.`;
  } else if (event.kind === "season" && event.number) {
    body = `Season ${event.number} premieres ${timing}.`;
  } else if (event.kind === "film") {
    body = `The film releases ${timing}.`;
  }
  return { title, body };
}

function toPushSubscription(row: PushRow): PushSubscription {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  };
}

function statusCodeFor(error: unknown) {
  const candidate = error as { statusCode?: unknown; status?: unknown };
  const value = Number(candidate?.statusCode ?? candidate?.status ?? 0);
  return Number.isFinite(value) ? value : 0;
}

async function sendPush(
  row: PushRow,
  config: PushConfig,
  payload: Record<string, unknown>,
) {
  if (!config.vapid_public_key || !config.vapid_private_key) {
    throw new Error("VAPID keys are not configured");
  }

  const vapidDetails: VapidDetails = {
    subject: VAPID_SUBJECT,
    publicKey: config.vapid_public_key,
    privateKey: config.vapid_private_key,
  };

  await sendNotification(
    toPushSubscription(row),
    JSON.stringify(payload),
    {
      vapidDetails,
      TTL: 86400,
      urgency: "high",
      signal: AbortSignal.timeout(12000),
    },
  );
}

async function disableExpiredSubscription(row: PushRow) {
  await db
    .from("watchlog_push_subscriptions")
    .update({
      enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
}

async function claimDelivery(
  row: PushRow,
  accountId: string,
  itemId: string,
  eventKey: string,
  scheduledFor: string,
) {
  const nowIso = new Date().toISOString();
  const { data: existing } = await db
    .from("watchlog_push_deliveries")
    .select("id,status,attempts,next_attempt_at")
    .eq("subscription_id", row.id)
    .eq("event_key", eventKey)
    .maybeSingle();

  if (existing) {
    if (existing.status === "sent" || existing.status === "expired") return null;
    if (Number(existing.attempts || 0) >= MAX_PUSH_ATTEMPTS) return null;
    if (
      existing.next_attempt_at &&
      new Date(existing.next_attempt_at).getTime() > Date.now()
    ) {
      return null;
    }
    const attempts = Number(existing.attempts || 0) + 1;
    const { data, error } = await db
      .from("watchlog_push_deliveries")
      .update({
        status: "pending",
        attempts,
        next_attempt_at: null,
        updated_at: nowIso,
      })
      .eq("id", existing.id)
      .select("id,attempts")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await db
    .from("watchlog_push_deliveries")
    .insert({
      subscription_id: row.id,
      account_id: accountId,
      item_id: itemId,
      event_key: eventKey,
      scheduled_for: scheduledFor,
      status: "pending",
      attempts: 1,
    })
    .select("id,attempts")
    .single();

  if (error?.code === "23505") return null;
  if (error) throw error;
  return data;
}

async function finishDelivery(
  delivery: { id: string; attempts: number },
  row: PushRow,
  error?: unknown,
) {
  const now = new Date();
  if (!error) {
    await db
      .from("watchlog_push_deliveries")
      .update({
        status: "sent",
        sent_at: now.toISOString(),
        next_attempt_at: null,
        last_error: null,
        updated_at: now.toISOString(),
      })
      .eq("id", delivery.id);
    return;
  }

  const code = statusCodeFor(error);
  if (code === 404 || code === 410) {
    await disableExpiredSubscription(row);
    await db
      .from("watchlog_push_deliveries")
      .update({
        status: "expired",
        last_error: `Push subscription expired (${code})`,
        updated_at: now.toISOString(),
      })
      .eq("id", delivery.id);
    return;
  }

  const exhausted = Number(delivery.attempts || 0) >= MAX_PUSH_ATTEMPTS;
  const retryMinutes = Math.min(60, Math.max(5, Number(delivery.attempts || 1) * 5));
  await db
    .from("watchlog_push_deliveries")
    .update({
      status: exhausted ? "expired" : "retry",
      next_attempt_at: exhausted
        ? null
        : new Date(now.getTime() + retryMinutes * 60000).toISOString(),
      last_error: String((error as Error)?.message || error || "Push failed").slice(
        0,
        500,
      ),
      updated_at: now.toISOString(),
    })
    .eq("id", delivery.id);
}

async function processPlannedReminders(
  subscriptions: PushRow[],
  config: PushConfig,
) {
  const accountIds = [...new Set(subscriptions.map((row) => row.account_id))];
  if (!accountIds.length) return { sent: 0, failed: 0 };

  const { data: libraryRows, error } = await db
    .from("watchlog_pin_library")
    .select("account_id,items,revision")
    .in("account_id", accountIds);
  if (error) throw error;
  const libraries = await refreshServerEpisodeSchedules(libraryRows || [], Date.now());

  const byAccount = new Map(
    (libraries || []).map((row) => [
      String(row.account_id),
      Array.isArray(row.items) ? row.items : [],
    ]),
  );
  const now = Date.now();
  let sent = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    const items = byAccount.get(subscription.account_id) || [];
    for (const item of items as Record<string, unknown>[]) {
      const status = String(item?.status || "");
      const event = plannedEvent(item);
      if (!event) continue;
      const isPlanned = status === "Planned" || status === "Saved";
      // Every dated episode gets advance and release-time alerts regardless of
      // whether the tracked title is Planned, Watching, or Watched.
      if (!isPlanned && event.kind !== "episode") continue;
      const eventTime = scheduledEventTime(event.raw, subscription.time_zone);
      if (!Number.isFinite(eventTime)) continue;

      const leadTimes = event.kind === "episode" ? [24, 6, 0] : [24, 6];
      for (const leadHours of leadTimes) {
        const reminderTime = eventTime - leadHours * 60 * 60 * 1000;
        // Deliver within 24 hours after a missed scheduled scan, but never early.
        if (reminderTime > now || reminderTime < now - 24 * 60 * 60 * 1000) {
          continue;
        }

        const itemId = String(item.id || (await sha256(String(item.title || ""))));
        const eventKey = `${itemId}:${event.kind}:${event.raw}:lead-${leadHours}h`;
        const delivery = await claimDelivery(
          subscription,
          subscription.account_id,
          itemId,
          eventKey,
          new Date(reminderTime).toISOString(),
        );
        if (!delivery) continue;

        const copy = reminderCopy(item, event, leadHours);
        const payload = {
          title: copy.title,
          body: copy.body,
          tag: `watchlog-${await sha256(eventKey).then((v) => v.slice(0, 24))}`,
          data: { url: "./", itemId, eventKey },
        };

        try {
          await sendPush(subscription, config, payload);
          await finishDelivery(delivery, subscription);
          sent++;
        } catch (pushError) {
          console.error("Planned reminder push failed", statusCodeFor(pushError));
          await finishDelivery(delivery, subscription, pushError);
          failed++;
        }
      }
    }
  }

  return { sent, failed };
}

async function processPrivateTests(
  subscriptions: PushRow[],
  config: PushConfig,
) {
  const nowIso = new Date().toISOString();
  const { data: tests, error } = await db
    .from("watchlog_push_tests")
    .select("id,account_id,title,body,attempts")
    .in("status", ["pending", "retry"])
    .lte("due_at", nowIso)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .limit(20);
  if (error) throw error;

  const subscriptionsByAccount = new Map<string, PushRow[]>();
  for (const row of subscriptions) {
    const list = subscriptionsByAccount.get(row.account_id) || [];
    list.push(row);
    subscriptionsByAccount.set(row.account_id, list);
  }

  let sent = 0;
  let failed = 0;
  for (const test of tests || []) {
    const rows = subscriptionsByAccount.get(String(test.account_id)) || [];
    let successes = 0;
    let lastError = "";
    for (const row of rows) {
      try {
        await sendPush(row, config, {
          title: String(test.title),
          body: String(test.body),
          tag: `watchlog-private-test-${test.id}`,
          data: { url: "./", test: true },
        });
        successes++;
      } catch (pushError) {
        const code = statusCodeFor(pushError);
        if (code === 404 || code === 410) await disableExpiredSubscription(row);
        lastError = String((pushError as Error)?.message || pushError).slice(0, 500);
      }
    }

    const attempts = Number(test.attempts || 0) + 1;
    if (successes > 0) {
      await db
        .from("watchlog_push_tests")
        .update({
          status: "sent",
          attempts,
          sent_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", test.id);
      sent += successes;
    } else {
      const exhausted = attempts >= MAX_PUSH_ATTEMPTS;
      await db
        .from("watchlog_push_tests")
        .update({
          status: exhausted ? "failed" : "retry",
          attempts,
          next_attempt_at: exhausted
            ? null
            : new Date(Date.now() + attempts * 5 * 60000).toISOString(),
          last_error: lastError || "No active push subscription",
          updated_at: new Date().toISOString(),
        })
        .eq("id", test.id);
      failed++;
    }
  }
  return { sent, failed };
}

async function processCron(req: Request) {
  const config = await readConfig(false);
  const supplied = req.headers.get("x-watchlog-cron") || "";
  if (!supplied || !safeEqual(supplied, config.cron_secret)) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!config.vapid_public_key || !config.vapid_private_key) {
    return json({ ok: true, skipped: "push_not_enabled_yet" });
  }

  const previousRun = config.last_scan_at
    ? new Date(config.last_scan_at).getTime()
    : 0;
  if (previousRun && Date.now() - previousRun < 45000) {
    return json({ ok: true, skipped: "scan_already_running" });
  }
  await db
    .from("watchlog_push_config")
    .update({
      last_scan_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("singleton", true);

  const { data, error } = await db
    .from("watchlog_push_subscriptions")
    .select(
      "id,account_id,endpoint,p256dh,auth,expiration_time,time_zone,locale,enabled",
    )
    .eq("enabled", true);
  if (error) throw error;

  const subscriptions = (data || []) as PushRow[];
  const planned = await processPlannedReminders(subscriptions, config);
  const tests = await processPrivateTests(subscriptions, config);
  console.log(
    JSON.stringify({
      activeSubscriptions: subscriptions.length,
      planned,
      tests,
    }),
  );
  return json({
    ok: true,
    activeSubscriptions: subscriptions.length,
    planned,
    tests,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  const action = String(body.action || "");
  try {
    if (action === "public_key") {
      const config = await readConfig(true);
      return json({ ok: true, publicKey: config.vapid_public_key });
    }

    if (action === "process") return await processCron(req);

    const session = await getSession(req);
    if (!session) {
      return json(
        { error: "Session expired. Sign in again.", code: "session_expired" },
        401,
      );
    }

    if (action === "subscribe") {
      const input = (body.subscription || {}) as Record<string, unknown>;
      const keys = (input.keys || {}) as Record<string, unknown>;
      const endpoint = validPushEndpoint(input.endpoint);
      const p256dh = String(keys.p256dh || "");
      const auth = String(keys.auth || "");
      if (
        !endpoint ||
        !p256dh ||
        !auth ||
        p256dh.length > 512 ||
        auth.length > 256
      ) {
        return json({ error: "Invalid push subscription." }, 400);
      }

      const { data, error } = await db
        .from("watchlog_push_subscriptions")
        .upsert(
          {
            account_id: session.accountId,
            endpoint,
            p256dh,
            auth,
            expiration_time:
              input.expirationTime === null ||
              input.expirationTime === undefined
                ? null
                : Number(input.expirationTime),
            time_zone: validTimeZone(body.timeZone),
            locale: String(body.locale || "en").slice(0, 40),
            enabled: true,
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "endpoint" },
        )
        .select("id")
        .single();
      if (error) throw error;
      return json({ ok: true, subscriptionId: data.id });
    }

    if (action === "unsubscribe") {
      const endpoint = String(body.endpoint || "");
      if (endpoint) {
        const { error } = await db
          .from("watchlog_push_subscriptions")
          .delete()
          .eq("account_id", session.accountId)
          .eq("endpoint", endpoint);
        if (error) throw error;
      }
      return json({ ok: true });
    }

    if (action === "status") {
      const endpoint = String(body.endpoint || "");
      const { data } = endpoint
        ? await db
            .from("watchlog_push_subscriptions")
            .select("enabled")
            .eq("account_id", session.accountId)
            .eq("endpoint", endpoint)
            .maybeSingle()
        : { data: null };
      return json({ ok: true, enabled: Boolean(data?.enabled) });
    }

    if (action === "schedule_private_test") {
      const { data: account, error: accountError } = await db
        .from("watchlog_pin_accounts")
        .select("email")
        .eq("id", session.accountId)
        .single();
      if (accountError) throw accountError;
      const accountHash = await sha256(
        `watchlog-notification-test:${normalizeEmail(account.email)}`,
      );
      if (!safeEqual(accountHash, PRIVATE_TEST_ACCOUNT_HASH)) {
        return json({ error: "This test is not enabled for this account." }, 403);
      }

      const { data: library } = await db
        .from("watchlog_pin_library")
        .select("items")
        .eq("account_id", session.accountId)
        .maybeSingle();
      const planned = (Array.isArray(library?.items) ? library.items : []).find(
        (item: Record<string, unknown>) =>
          item?.status === "Planned" || item?.status === "Saved",
      );
      if (!planned) {
        return json(
          { error: "Add a title with Planned status before sending the test." },
          400,
        );
      }

      const dueAt = new Date(Date.now() + 15000).toISOString();
      const { error } = await db.from("watchlog_push_tests").insert({
        account_id: session.accountId,
        title: "Watched log reminder",
        body: `${String(planned.title || "Planned title")} test reminder is out now.`,
        due_at: dueAt,
      });
      if (error) throw error;
      return json({
        ok: true,
        dueAt,
        message: "Background test queued. Close Watched Logger now.",
      });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: "WatchLog reminder service error." }, 500);
  }
});
