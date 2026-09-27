import { runSync } from "../../lib/sync.mjs";

// Manueller Sync, z. B. für den initialen Backfill: /api/sync?key=<SYNC_KEY>
export default async (req) => {
  const key = new URL(req.url).searchParams.get("key");
  if (!process.env.SYNC_KEY || key !== process.env.SYNC_KEY) {
    return new Response("Forbidden", { status: 403 });
  }
  return Response.json(await runSync());
};

export const config = { path: "/api/sync" };
