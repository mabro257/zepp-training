// Inoffizielle Zepp/Huami-Cloud-API. Undokumentiert, kann jederzeit brechen.
const HOST = process.env.ZEPP_API_HOST || "https://api-mifit.huami.com";

export class TokenError extends Error {}

export async function zeppGet(path, params = {}) {
  if (!process.env.ZEPP_APP_TOKEN) throw new TokenError("ZEPP_APP_TOKEN fehlt");
  const url = new URL(path, HOST);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: {
      apptoken: process.env.ZEPP_APP_TOKEN,
      appPlatform: "web",
      appname: "com.xiaomi.hm.health",
    },
  });
  if (res.status === 401 || res.status === 403) throw new TokenError(`HTTP ${res.status}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const json = await res.json();
  if (json && json.code !== undefined && json.code !== 1 && !json.data) {
    const msg = String(json.message || json.code);
    if (/token|auth|login/i.test(msg)) throw new TokenError(msg);
    throw new Error(`${path}: ${msg}`);
  }
  return json;
}

// Workout-Liste, neueste zuerst. Blättert, bis bekannte Workouts erreicht sind.
export async function fetchSummaries(knownIds) {
  const out = [];
  const seen = new Set();
  let cursor = null;
  for (let page = 0; page < 60; page++) {
    const params = { limit: 100 };
    if (cursor) params.trackid = cursor;
    const json = await zeppGet("/v1/sport/run/history.json", params);
    const items = json?.data?.summary || [];
    const fresh = items.filter((i) => i?.trackid && !seen.has(String(i.trackid)));
    if (!fresh.length) break;
    for (const i of fresh) { seen.add(String(i.trackid)); out.push(i); }
    if (fresh.every((i) => knownIds.has(String(i.trackid)))) break;
    const next = Number(json?.data?.next);
    if (next === -1) break;
    if (items.length < 100 && !(next > 0)) break;
    cursor = next > 0 ? next : Math.min(...items.map((i) => Number(i.trackid)));
  }
  return out;
}

const num = (x) => { const v = Number(x); return Number.isFinite(v) && v > 0 ? v : null; };

export function normalize(i) {
  const end = num(i.end_time);
  const dur = num(i.run_time);
  const start = num(i.start_time) ?? (end && dur ? end - dur : null);
  const pace = num(i.avg_pace); // Sekunden pro Meter
  return {
    id: String(i.trackid),
    type: String(i.type ?? ""),
    start, end,
    durationSec: dur,
    distanceM: num(i.dis),
    kcal: num(i.calorie),
    avgHr: num(i.avg_heart_rate),
    maxHr: num(i.max_heart_rate),
    paceSecKm: pace ? pace * 1000 : null,
    steps: num(i.total_step),
    minHr: num(i.min_heart_rate),
    ascentM: num(i.altitude_ascend),
    descentM: num(i.altitude_descend),
    cadence: num(i.avg_frequency),
    strideCm: num(i.avg_stride_length),
    vo2max: num(i.VO2_max),
    te: num(i.te),
    anaerobicTe: num(i.anaerobic_te),
    source: i.source || "run.mifit.huami.com",
    raw: i,
  };
}

// Pulsverlauf aus run/detail.json -> Histogramm (Sekunden je 5-bpm-Bin) und
// Zeitreihe in 15-s-Schritten für die Detailansicht.
// Format: "dt,dhr;dt,dhr;..." delta-kodiert. Best effort, bei Unplausibilität null.
export function parseHr(detail) {
  const s = detail?.data?.heart_rate;
  if (typeof s !== "string" || !s.includes(",")) return null;
  let t = 0, hr = 0, prevT = null, prevHr = null, ok = 0, bad = 0;
  const bins = {}, buckets = {};
  for (const part of s.split(";")) {
    if (!part) continue;
    const [a, b] = part.split(",").map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    t += a; hr += b;
    if (prevT !== null) {
      const dt = t - prevT;
      if (dt > 0 && dt <= 60 && prevHr >= 30 && prevHr <= 230) {
        const bin = Math.floor(prevHr / 5) * 5;
        bins[bin] = (bins[bin] || 0) + dt;
        const k = Math.floor(prevT / 15) * 15;
        (buckets[k] ||= [0, 0]); buckets[k][0] += prevHr * dt; buckets[k][1] += dt;
        ok++;
      } else bad++;
    }
    prevT = t; prevHr = hr;
  }
  if (ok < 10 || bad > ok) return null;
  const series = Object.keys(buckets).map(Number).sort((a, b) => a - b)
    .map((k) => [k, Math.round(buckets[k][0] / buckets[k][1])]);
  return { bins, series };
}

// ---------- Tageswerte (Schlaf, Ruhepuls, Schritte) ----------
// band_data.json kappt Antworten bei 500 Zeilen und verwirft dabei die NEUESTEN Tage.
// Deshalb in Fenstern abfragen.
const decode = (v) => {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(Buffer.from(v, "base64").toString("utf8")); } catch { return null; }
};

export async function fetchBandSummary(fromDate, toDate, userId) {
  const params = { query_type: "summary", device_type: "android_phone", from_date: fromDate, to_date: toDate };
  if (userId) params.userid = userId;
  const json = await zeppGet("/v1/data/band_data.json", params);
  let data = json?.data;
  if (typeof data === "string") data = decode(data);
  return Array.isArray(data) ? data : [];
}

const STAGE = { 4: "light", 5: "deep", 7: "awake", 8: "rem" };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

export function dayFromBandItem(item) {
  const date = String(item?.date_time || item?.date || "");
  const s = decode(item?.summary);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !s) return null;
  const slp = s.slp || {};
  const tot = { light: 0, deep: 0, awake: 0, rem: 0 };
  let staged = false;
  for (const st of Array.isArray(slp.stage) ? slp.stage : []) {
    const k = STAGE[int(st?.mode)], a = int(st?.start), b = int(st?.stop ?? st?.end);
    if (!k || a == null || b == null || b < a) continue;
    tot[k] += b - a + 1; staged = true;
  }
  if (!staged) {
    tot.deep = Math.max(0, int(slp.dp) || 0);
    tot.light = Math.max(0, int(slp.lt) || 0);
    tot.rem = Math.max(0, int(slp.dt) || 0);
    tot.awake = Math.max(0, int(slp.wk) || 0);
  }
  const asleep = tot.deep + tot.light + tot.rem;
  const rhr = int(slp.rhr);
  const score = int(slp.ss);
  const steps = int(s.stp?.ttl);
  const day = {
    rhr: rhr >= 30 && rhr <= 110 ? rhr : null,
    sleepMin: asleep > 0 ? asleep : null,
    deepMin: asleep > 0 ? tot.deep : null,
    remMin: asleep > 0 ? tot.rem : null,
    awakeMin: asleep > 0 ? tot.awake : null,
    sleepScore: score > 0 && score <= 100 ? score : null,
    steps: steps > 0 ? steps : null,
  };
  if (Object.values(day).every((v) => v == null)) return null;
  return { date, uid: item?.uid ? String(item.uid) : null, ...day };
}
