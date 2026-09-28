import { getStore } from "@netlify/blobs";

// Öffentlich lesbar. Liefert nur Trainings- und Tageskennzahlen, keine Rohdaten (kein Ort, kein GPS).
export default async () => {
  const store = getStore("zepp");
  const db = (await store.get("workouts", { type: "json" })) || {};
  const days = (await store.get("days", { type: "json" })) || {};
  const meta = (await store.get("meta", { type: "json" })) || null;
  const workouts = Object.values(db)
    .map(({ raw, source, detailTries, detailVersion, tries2, tries3, ...w }) => w)
    .sort((a, b) => (a.start || 0) - (b.start || 0));
  const { userId, ...publicMeta } = meta || {};
  return Response.json(
    { meta: meta ? publicMeta : null, days, workouts },
    { headers: { "cache-control": "public, max-age=300" } }
  );
};

export const config = { path: "/api/data" };
