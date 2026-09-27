import { getStore } from "@netlify/blobs";
import { TokenError, zeppGet, fetchSummaries, normalize, parseHr, fetchBandSummary, dayFromBandItem } from "./zepp.mjs";

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

// Scheduled Functions haben 30 s Laufzeit. Details (≈2 MB je Workout) werden
// inkrementell geholt; ein großer Backfill verteilt sich über mehrere Läufe.
export async function runSync({ budgetMs = 22000 } = {}) {
  const t0 = Date.now();
  const store = getStore("zepp");
  const db = (await store.get("workouts", { type: "json" })) || {};
  const days = (await store.get("days", { type: "json" })) || {};
  const prevMeta = (await store.get("meta", { type: "json" })) || {};
  const meta = { lastRun: new Date().toISOString(), ok: false, userId: prevMeta.userId || process.env.ZEPP_USER_ID || null };

  try {
    // 1) Workout-Liste
    const known = new Set(Object.keys(db));
    const items = await fetchSummaries(known);
    let added = 0;
    for (const i of items) {
      const w = normalize(i);
      const prev = db[w.id];
      db[w.id] = { ...w, hrBins: prev?.hrBins ?? null, hrSeries: prev?.hrSeries ?? null, detailVersion: prev?.detailVersion ?? 0, tries2: prev?.tries2 ?? 0 };
      if (!prev) added++;
    }

    // 2) Tageswerte: Erstimport bis 2 Jahre zurück, danach die letzten 14 Tage (späte Uhr-Syncs)
    const today = iso(new Date());
    const hasDays = Object.keys(days).length > 0;
    const firstWorkout = Object.values(db).reduce((m, w) => (w.start && (!m || w.start < m) ? w.start : m), null);
    let from = hasDays ? addDays(today, -14) : addDays(today, -730);
    if (!hasDays && firstWorkout) from = [from, addDays(iso(new Date(firstWorkout * 1000)), -45)].sort()[1];
    let daysUpdated = 0;
    try {
    for (let a = from; a <= today; a = addDays(a, 180)) {
      const b = [addDays(a, 179), today].sort()[0];
      const rows = await fetchBandSummary(a, b, meta.userId);
      for (const r of rows) {
        const d = dayFromBandItem(r);
        if (!d) continue;
        if (!meta.userId && d.uid) meta.userId = d.uid;
        const { date, uid, ...vals } = d;
        days[date] = vals;
        daysUpdated++;
      }
    }
    } catch (e) {
      if (e instanceof TokenError) throw e;
      meta.daysError = String(e?.message || e); // Workouts trotzdem weiter synchronisieren
    }

    // 3) Pulsverläufe je Workout, solange Zeit bleibt
    const pending = Object.values(db)
      .filter((w) => (w.detailVersion || 0) < 2 && (w.tries2 || 0) < 3)
      .sort((a, b) => (b.start || 0) - (a.start || 0));
    let fetched = 0;
    for (const w of pending) {
      if (Date.now() - t0 > budgetMs) break;
      try {
        const d = await zeppGet("/v1/sport/run/detail.json", { trackid: w.id, source: w.source });
        const hr = parseHr(d);
        w.hrBins = hr?.bins ?? null;
        w.hrSeries = hr?.series ?? null;
        w.detailVersion = 2; // auch ohne verwertbaren Pulsverlauf nicht erneut laden
      } catch (e) {
        if (e instanceof TokenError) throw e;
        w.tries2 = (w.tries2 || 0) + 1;
      }
      fetched++;
    }

    await store.setJSON("workouts", db);
    await store.setJSON("days", days);
    Object.assign(meta, {
      ok: true,
      added,
      total: Object.keys(db).length,
      days: Object.keys(days).length,
      daysUpdated,
      detailsFetched: fetched,
      detailsPending: Math.max(0, pending.length - fetched),
    });
  } catch (e) {
    meta.error = e instanceof TokenError ? "token" : String(e?.message || e);
  }

  meta.lastSuccess = meta.ok ? meta.lastRun : prevMeta.lastSuccess || null;
  await store.setJSON("meta", meta);
  return meta;
}
