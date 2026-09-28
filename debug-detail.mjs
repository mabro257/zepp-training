import { getStore } from "@netlify/blobs";
import { zeppGet } from "../../lib/zepp.mjs";

// Diagnose: Struktur von run/detail.json für die neueste Einheit.
// Aufruf: /api/debug-detail?key=<SYNC_KEY>  (optional &id=<trackid>)
// GPS-Felder werden nicht ausgegeben, nur ihre Länge.
const GPS = /longitude|latitude|lat_lon|location|gps/i;

function describe(v, key = "", depth = 0) {
  if (v == null) return v;
  if (typeof v === "string") {
    if (GPS.test(key)) return `<${v.length} Zeichen ausgeblendet>`;
    return v.length > 400 ? { length: v.length, head: v.slice(0, 400) } : v;
  }
  if (Array.isArray(v)) return { array: v.length, first: depth < 3 ? describe(v[0], key, depth + 1) : "…" };
  if (typeof v === "object") {
    if (depth > 3) return "{…}";
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, describe(x, k, depth + 1)]));
  }
  return v;
}

export default async (req) => {
  const url = new URL(req.url);
  if (!process.env.SYNC_KEY || url.searchParams.get("key") !== process.env.SYNC_KEY) {
    return new Response("Forbidden", { status: 403 });
  }
  const db = (await getStore("zepp").get("workouts", { type: "json" })) || {};
  const list = Object.values(db).sort((a, b) => (b.start || 0) - (a.start || 0));
  const w = url.searchParams.get("id") ? db[url.searchParams.get("id")] : list[0];
  if (!w) return Response.json({ error: "keine Einheit gefunden" });
  const json = await zeppGet("/v1/sport/run/detail.json", { trackid: w.id, source: w.source });
  let data = json?.data;
  let decoded = false;
  if (typeof data === "string") {
    try { data = JSON.parse(Buffer.from(data, "base64").toString("utf8")); decoded = true; } catch {}
  }
  return Response.json({
    trackid: w.id, type: w.type, source: w.source,
    topLevelKeys: Object.keys(json || {}),
    code: json?.code, message: json?.message,
    dataWasBase64: decoded,
    data: describe(data),
  });
};

export const config = { path: "/api/debug-detail" };
