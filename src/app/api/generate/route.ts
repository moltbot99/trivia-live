import OpenAI from "openai";
import { NextResponse } from "next/server";

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON found");
  return JSON.parse(text.slice(start, end + 1));
}

export async function POST() {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const prompt = `Generate 10 trivia questions with answers. Question 10 will be used as the Final Jeopardy question.

Difficulty Target:
- Questions 1-9: 7/10 difficulty - moderately challenging, require solid knowledge but not highly specialized expertise. Focus on interesting facts that aren't common knowledge but are accessible to knowledgeable players.
- Question 10 (Final Jeopardy): 8-9/10 difficulty - difficult and prestigious, require deeper knowledge and be more difficult than regular questions.

Constraints:
- Diverse categories: history, geography, sports, pop culture, science, literature, movies/TV, music, academia.
- Include some specific details, dates, or lesser-known information, but keep it accessible to intermediate/advanced players
- Each answer should be short (ideally 1-5 words). No essays.
- No trick questions, no ambiguity. Answers must be factually verifiable and specific.
- Do NOT repeat the same category more than once.
- Target intermediate to advanced trivia players - challenging but fair.
- IMPORTANT: Question 10 should have a SPECIFIC subject category (like "American History", "World Geography", "Classical Music", etc.), NOT a generic category like "Final Jeopardy" or "General Knowledge".

Return ONLY valid JSON with this exact shape:
{
  "questions": [
    { "question": "...", "answer": "...", "category": "..." },
    ... (10 total, with question 10 being the Final Jeopardy)
  ]
}
`;

  const modelEnv = String(process.env.OPENAI_MODEL || "");
  const allowedModels = ["gpt-4o-mini", "gpt-4.1-mini"] as const;
  const model = (allowedModels as readonly string[]).includes(modelEnv) ? modelEnv : "gpt-4o-mini";

  const resp = await client.responses.create({
    model,
    input: prompt,
    max_output_tokens: 1200
  });

  const text = (resp.output_text || "").trim();

  try {
    let data: any;
    if (text) {
      data = extractJson(text);
    } else {
      const firstItem: any = (resp as any).output?.[0]?.content?.[0];
      if (firstItem?.type === "json" && firstItem.json) {
        data = firstItem.json;
      } else if (firstItem?.type === "output_text" && typeof firstItem.text === "string") {
        data = extractJson(firstItem.text);
      } else {
        throw new Error("No JSON found");
      }
    }
    const qs = data?.questions;
    if (!Array.isArray(qs) || qs.length !== 10) throw new Error("Bad questions array");
    const normalized = qs.map((q: any, i: number) => ({
      question: String(q.question ?? "").trim(),
      answer: String(q.answer ?? "").trim(),
      category: String(q.category ?? "").trim() || "General",
      id: String(i + 1)
    }));
    if (normalized.some((q: any) => !q.question || !q.answer)) throw new Error("Empty question/answer");
    return NextResponse.json({ questions: normalized });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to parse model output", raw: text.slice(0, 2000), details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
