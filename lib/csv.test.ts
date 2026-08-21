import { describe, expect, it } from "vitest";
import { formatFaqCsv, parseFaqCsv } from "./csv";

describe("parseFaqCsv", () => {
  it("parses rows into FaqRow objects using the header", () => {
    const csv = "category,question,answer\nเวลาทำการ,เปิดกี่โมง,เปิด 06:00-22:00 น.";

    const result = parseFaqCsv(csv);

    expect(result).toEqual([
      { category: "เวลาทำการ", question: "เปิดกี่โมง", answer: "เปิด 06:00-22:00 น." },
    ]);
  });

  it("handles commas inside quoted fields", () => {
    const csv = 'category,question,answer\n"ที่ตั้ง","อยู่ที่ไหน","ถนน A, ตำบล B, ระนอง"';

    const result = parseFaqCsv(csv);

    expect(result[0].answer).toBe("ถนน A, ตำบล B, ระนอง");
  });

  it("includes updated_at when the column is present", () => {
    const csv = "question,answer,updated_at\nQ1,A1,2026-08-01";

    const result = parseFaqCsv(csv);

    expect(result).toEqual([{ question: "Q1", answer: "A1", updated_at: "2026-08-01" }]);
  });

  it("omits optional columns entirely when the CSV has no such column", () => {
    const csv = "question,answer\nQ1,A1";

    const result = parseFaqCsv(csv);

    expect(result[0]).not.toHaveProperty("category");
    expect(result[0]).not.toHaveProperty("updated_at");
  });

  it("skips rows missing a question or answer", () => {
    const csv = "question,answer\nQ1,\n,A2\nQ3,A3";

    const result = parseFaqCsv(csv);

    expect(result).toEqual([{ question: "Q3", answer: "A3" }]);
  });

  it("returns an empty array for an empty CSV", () => {
    expect(parseFaqCsv("")).toEqual([]);
  });
});

describe("formatFaqCsv", () => {
  it("serializes rows back into CSV with a header row", () => {
    const csv = formatFaqCsv([{ category: "เวลาทำการ", question: "เปิดกี่โมง", answer: "06:00-22:00" }]);

    expect(csv).toBe("category,question,answer,updated_at\nเวลาทำการ,เปิดกี่โมง,06:00-22:00,");
  });

  it("quotes fields that contain a comma", () => {
    const csv = formatFaqCsv([{ question: "อยู่ที่ไหน", answer: "ถนน A, ตำบล B" }]);

    expect(csv).toContain('"ถนน A, ตำบล B"');
  });

  it("returns just the header for an empty list", () => {
    expect(formatFaqCsv([])).toBe("category,question,answer,updated_at");
  });
});
