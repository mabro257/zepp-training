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
    // Zepp liefert den Trainingseffekt ×10 (38 = 3,8)
    te: num(i.te) ? (num(i.te) > 5 ? num(i.te) / 10 : num(i.te)) : null,
    anaerobicTe: num(i.anaerobic_te) ? (num(i.anaerobic_te) > 5 ? num(i.anaerobic_te) / 10 : num(i.anaerobic_te)) : null,
    source: i.source || "run.mifit.huami.com",
    raw: i,
  };
}

// Zeitreihen aus run/detail.json. Format je Eintrag "dt,wert", getrennt durch ";".
// dt = Sekunden seit dem vorherigen Eintrag, leer bedeutet 1.
// heart_rate: Wert delta-kodiert (erster absolut, danach Differenzen).
// speed: Wert absolut in m/s.
function parsePairs(str, deltaValue) {
  if (typeof str !== "string" || !str.includes(",")) return [];
  const out = [];
  let t = 0, v = 0;
  for (const part of str.split(";")) {
    if (!part) continue;
    const i = part.indexOf(",");
    if (i < 0) continue;
    const a = part.slice(0, i), b = part.slice(i + 1);
    const dt = a === "" ? 1 : Number(a);
    const dv = b === "" ? (deltaValue ? 0 : NaN) : Number(b);
    if (!Number.isFinite(dt)) continue;
    t += dt;
    if (deltaValue) v += Number.isFinite(dv) ? dv : 0;
    else if (Number.isFinite(dv)) v = dv;
    else continue;
    out.push([t, v]);
  }
  return out;
}

// Mittelwerte je 15-s-Fenster, zeitgewichtet
function bucket(points, lo, hi, size = 15) {
  const acc = {};
  for (let i = 0; i < points.length - 1; i++) {
    const [t, v] = points[i], dt = points[i + 1][0] - t;
    if (!(dt > 0 && dt <= 60) || v < lo || v > hi) continue;
    const k = Math.floor(t / size) * size;
    (acc[k] ||= [0, 0]); acc[k][0] += v * dt; acc[k][1] += dt;
  }
  return Object.keys(acc).map(Number).sort((x, y) => x - y).map((k) => [k, acc[k][0] / acc[k][1]]);
}

export function parseDetail(detail) {
  const d = detail?.data || {};
  // Puls
  const hr = parsePairs(d.heart_rate, true);
  const bins = {};
  let ok = 0;
  for (let i = 0; i < hr.length - 1; i++) {
    const [t, h] = hr[i], dt = hr[i + 1][0] - t;
    if (dt > 0 && dt <= 60 && h >= 30 && h <= 230) { const bin = Math.floor(h / 5) * 5; bins[bin] = (bins[bin] || 0) + dt; ok++; }
  }
  const hrSeries = ok >= 10 ? bucket(hr, 30, 230).map(([t, v]) => [t, Math.round(v)]) : null;
  // Geschwindigkeit (m/s)
  const sp = parsePairs(d.speed, false);
  const speedSeries = sp.length >= 10 ? bucket(sp, 0.3, 30).map(([t, v]) => [t, Math.round(v * 100) / 100]) : null;
  // Kilometer-Splits: Index, Pace (s), [Ortskennung ausgelassen], Ø Puls, kumulierte Zeit, Kadenz
  const splits = [];
  if (typeof d.kilo_pace === "string") {
    for (const row of d.kilo_pace.split(";")) {
      const f = row.split(",");
      if (f.length < 6) continue;
      const km = Number(f[0]) + 1, pace = Number(f[1]), h = Number(f[4]), cum = Number(f[5]), cad = Number(f[13]);
      if (!(pace > 0)) continue;
      splits.push({ km, paceSec: pace, hr: h >= 30 && h <= 230 ? h : null, cumSec: cum > 0 ? cum : null, cadence: cad > 0 && cad < 260 ? cad : null });
    }
  }
  return { bins: ok >= 10 ? bins : null, hrSeries, speedSeries, splits: splits.length ? splits : null };
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
