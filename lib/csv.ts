import type { FaqRow } from "../types";

export function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const text = csv.replace(/\r\n/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/**
 * Parses the published FAQ Google Sheet CSV into FaqRow objects.
 * Handles comma-in-quotes per column; rows missing question/answer are dropped.
 */
export function parseFaqCsv(csv: string): FaqRow[] {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  let categoryIdx = header.indexOf("category");
  let questionIdx = header.indexOf("question");
  let answerIdx = header.indexOf("answer");
  let updatedAtIdx = header.indexOf("updated_at");

  // Real-world sheets are often maintained by non-technical staff who rename the
  // header row into their own language. When we can't recognize question/answer by
  // name, fall back to the documented column order: category, question, answer, updated_at.
  if (questionIdx === -1 || answerIdx === -1) {
    categoryIdx = 0;
    questionIdx = 1;
    answerIdx = 2;
    updatedAtIdx = 3;
  }

  const result: FaqRow[] = [];
  for (const cols of rows.slice(1)) {
    const question = (questionIdx >= 0 ? cols[questionIdx] : undefined)?.trim();
    const answer = (answerIdx >= 0 ? cols[answerIdx] : undefined)?.trim();
    if (!question || !answer) continue;

    const rowResult: FaqRow = { question, answer };
    if (categoryIdx >= 0 && cols[categoryIdx]?.trim()) {
      rowResult.category = cols[categoryIdx].trim();
    }
    if (updatedAtIdx >= 0 && cols[updatedAtIdx]?.trim()) {
      rowResult.updated_at = cols[updatedAtIdx].trim();
    }
    result.push(rowResult);
  }

  return result;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serializes FaqRow objects back into CSV text for embedding in the Gemini prompt. */
export function formatFaqCsv(rows: FaqRow[]): string {
  const header = "category,question,answer,updated_at";
  const lines = rows.map((r) =>
    [r.category ?? "", r.question, r.answer, r.updated_at ?? ""].map(csvEscape).join(","),
  );
  return [header, ...lines].join("\n");
}
