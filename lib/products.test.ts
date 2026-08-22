import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProductReply, isProductCode, parseProductsCsv } from "./products";

describe("parseProductsCsv", () => {
  it("parses rows into a Map keyed by product code, skipping the header row", () => {
    const csv = "code,name,price,stock\n4323,ขนมปัง A,25,40\n76543,นม B,18,120";

    const result = parseProductsCsv(csv);

    expect(result.get("4323")).toEqual({ code: "4323", name: "ขนมปัง A", price: "25", stock: "40" });
    expect(result.get("76543")).toEqual({ code: "76543", name: "นม B", price: "18", stock: "120" });
    expect(result.size).toBe(2);
  });

  it("does not depend on header wording, only column position", () => {
    const csv = "รหัสสินค้า,ชื่อสินค้า,ราคา,สต็อก\n4323,ขนมปัง A,25,40";

    const result = parseProductsCsv(csv);

    expect(result.get("4323")).toEqual({ code: "4323", name: "ขนมปัง A", price: "25", stock: "40" });
  });

  it("skips rows with an empty product code", () => {
    const csv = "code,name,price,stock\n,ไม่มีรหัส,10,5\n4323,ขนมปัง A,25,40";

    const result = parseProductsCsv(csv);

    expect(result.size).toBe(1);
    expect(result.has("4323")).toBe(true);
  });

  it("returns an empty Map for an empty CSV", () => {
    expect(parseProductsCsv("").size).toBe(0);
  });
});

describe("isProductCode", () => {
  it("returns true for a message that is only digits", () => {
    expect(isProductCode("4323")).toBe(true);
  });

  it("returns true when the digits are surrounded by whitespace", () => {
    expect(isProductCode("  4323  ")).toBe(true);
  });

  it("returns false when digits are mixed with other text", () => {
    expect(isProductCode("รหัส 4323 ราคาเท่าไหร่")).toBe(false);
  });

  it("returns false for non-numeric text", () => {
    expect(isProductCode("เปิดกี่โมง")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isProductCode("")).toBe(false);
  });
});

describe("buildProductReply", () => {
  it("renders the product name, code, price and stock into a friendly message", () => {
    const message = buildProductReply({ code: "4323", name: "ขนมปัง A", price: "25", stock: "40" });

    expect(message).toBe("ขนมปัง A (รหัสสินค้า 4323)\nราคา 25 บาทค่ะ\nคงเหลือในสต็อก 40 ชิ้นค่ะ");
  });
});

describe("getProducts", () => {
  const PRICE_SHEET_CSV_URL = "https://example.com/products.csv";
  const CSV_V1 = "code,name,price,stock\n4323,ขนมปัง A,25,40";
  const CSV_V2 = "code,name,price,stock\n4323,ขนมปัง A,30,10";

  function textResponse(csv: string) {
    return { ok: true, status: 200, text: async () => csv };
  }

  beforeEach(() => {
    vi.resetModules();
    process.env.PRICE_SHEET_CSV_URL = PRICE_SHEET_CSV_URL;
  });

  afterEach(() => {
    delete process.env.PRICE_SHEET_CSV_URL;
  });

  it("fetches and parses the price sheet on the first call", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(CSV_V1));
    const { getProducts } = await import("./products");

    const result = await getProducts({ fetchImpl, now: () => 0 });

    expect(fetchImpl).toHaveBeenCalledWith(PRICE_SHEET_CSV_URL);
    expect(result.get("4323")?.price).toBe("25");
  });

  it("serves from cache within the 30-minute TTL without re-fetching", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(CSV_V1));
    const { getProducts } = await import("./products");

    await getProducts({ fetchImpl, now: () => 0 });
    await getProducts({ fetchImpl, now: () => 29 * 60 * 1000 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the 30-minute TTL has expired", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(textResponse(CSV_V1)).mockResolvedValueOnce(textResponse(CSV_V2));
    const { getProducts } = await import("./products");

    await getProducts({ fetchImpl, now: () => 0 });
    const result = await getProducts({ fetchImpl, now: () => 31 * 60 * 1000 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.get("4323")?.price).toBe("30");
  });

  it("falls back to the stale cache when a later fetch fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(textResponse(CSV_V1)).mockRejectedValueOnce(new Error("network down"));
    const { getProducts } = await import("./products");

    await getProducts({ fetchImpl, now: () => 0 });
    const result = await getProducts({ fetchImpl, now: () => 31 * 60 * 1000 });

    expect(result.get("4323")?.price).toBe("25");
  });

  it("throws when the fetch fails and there is no cache yet", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const { getProducts } = await import("./products");

    await expect(getProducts({ fetchImpl, now: () => 0 })).rejects.toThrow();
  });
});
