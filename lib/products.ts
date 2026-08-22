import type { ProductRow } from "../types";
import { parseCsvRows } from "./csv";

const TTL_MS = 30 * 60 * 1000;

export interface ProductCatalog {
  products: Map<string, ProductRow>;
  /** Manually keyed into cell E1 by whoever exports the sheet — a human-entered "as of" time, not a fetch timestamp (see BRIEF discussion on why staleness must stay visible). */
  updatedAt?: string;
}

/** Product codes vary in length and are matched by position, not header name (see BRIEF discussion). */
export function parseProductsCsv(csv: string): ProductCatalog {
  const rows = parseCsvRows(csv);
  const products = new Map<string, ProductRow>();

  for (const cols of rows.slice(1)) {
    const code = cols[0]?.trim();
    if (!code) continue;
    products.set(code, {
      code,
      name: cols[1]?.trim() ?? "",
      price: cols[2]?.trim() ?? "",
      stock: cols[3]?.trim() ?? "",
    });
  }

  const updatedAt = rows[0]?.[4]?.trim() || undefined;

  return { products, updatedAt };
}

/** True when the whole message is a bare product code (digits only) — the required format for a price/stock lookup. */
export function isProductCode(text: string): boolean {
  return /^\d+$/.test(text.trim());
}

/** Deterministic reply for a found product — no Gemini call, so price/stock can never be hallucinated. */
export function buildProductReply(product: ProductRow, updatedAt?: string): string {
  const base = `${product.name} (รหัสสินค้า ${product.code})\nราคา ${product.price} บาทค่ะ\nคงเหลือในสต็อก ${product.stock} ชิ้นค่ะ`;
  return updatedAt ? `${base}\n(ข้อมูล ณ ${updatedAt})` : base;
}

let cache: (ProductCatalog & { fetchedAt: number }) | null = null;

interface GetProductsOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Fetches the published product price/stock CSV, caching it in memory for 30 minutes (matches the ~3-4h ERP export cadence). */
export async function getProducts(opts: GetProductsOptions = {}): Promise<ProductCatalog> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const nowMs = now();

  if (cache && nowMs - cache.fetchedAt < TTL_MS) {
    return cache;
  }

  const url = process.env.PRICE_SHEET_CSV_URL;
  if (!url) throw new Error("PRICE_SHEET_CSV_URL not set");

  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Price sheet fetch failed with status ${res.status}`);
    const csv = await res.text();
    const catalog = parseProductsCsv(csv);
    cache = { ...catalog, fetchedAt: nowMs };
    return cache;
  } catch (err) {
    if (cache) {
      console.warn(
        JSON.stringify({ level: "warn", msg: "price_sheet_fetch_failed_using_stale_cache", error: String(err) }),
      );
      return cache;
    }
    throw err;
  }
}
