import { runSync } from "../../lib/sync.mjs";

export default async () => {
  const meta = await runSync();
  console.log(JSON.stringify(meta));
};

// 04:00 UTC = 05:00/06:00 Uhr deutscher Zeit
export const config = { schedule: "0 4 * * *" };
