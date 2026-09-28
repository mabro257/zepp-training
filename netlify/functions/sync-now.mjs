import { runSync } from "../../lib/sync.mjs";

// Manueller Sync, z. B. für den initialen Backfill: /api/sync?key=<SYNC_KEY>
export default async (req) => {
  const key = new URL(req.url).searchParams.get("key");
  if (!process.env.SYNC_KEY || key !== process.env.SYNC_KEY) {
    return new Response("Forbidden", { status: 403 });
  }
  // Synchrone Functions haben ca. 10 s Laufzeit, daher knappes Zeitbudget; bei Rest einfach erneut aufrufen
  return Response.json(await runSync({ budgetMs: 6000 }), { headers: { "cache-control": "no-store" } });
};

export const config = { path: "/api/sync" };
