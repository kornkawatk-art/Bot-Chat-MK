import type { FaqRow } from "../types";
import { parseFaqCsv } from "./csv";

const TTL_MS = 60_000;

interface Cache {
  data: FaqRow[];
  fetchedAt: number;
}

let cache: Cache | null = null;

interface GetFaqOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Fetches the published FAQ CSV, caching it in memory for 60s. Serves stale data on fetch failure if any cache exists. */
export async function getFaq(opts: GetFaqOptions = {}): Promise<FaqRow[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const nowMs = now();

  if (cache && nowMs - cache.fetchedAt < TTL_MS) {
    return cache.data;
  }

  const url = process.env.SHEET_CSV_URL;
  if (!url) throw new Error("SHEET_CSV_URL not set");

  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Sheet fetch failed with status ${res.status}`);
    const csv = await res.text();
    const data = parseFaqCsv(csv);
    cache = { data, fetchedAt: nowMs };
    return data;
  } catch (err) {
    if (cache) {
      console.warn(
        JSON.stringify({ level: "warn", msg: "sheet_fetch_failed_using_stale_cache", error: String(err) }),
      );
      return cache.data;
    }
    throw err;
  }
}
