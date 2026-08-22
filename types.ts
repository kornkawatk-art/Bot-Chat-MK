export interface FaqRow {
  category?: string;
  question: string;
  answer: string;
  updated_at?: string;
}

export interface GeminiResult {
  text: string;
  finishReason: string;
  thoughtsTokenCount: number;
  candidatesTokenCount: number;
}

export interface ProductRow {
  code: string;
  name: string;
  price: string;
  stock: string;
}

export interface HistoryEntry {
  role: "user" | "assistant";
  text: string;
}
