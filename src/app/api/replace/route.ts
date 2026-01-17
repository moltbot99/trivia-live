import OpenAI from "openai";
import { NextResponse } from "next/server";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON found");
  return JSON.parse(text.slice(start, end + 1));
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });
  }
  const body = await req.json().catch(() => ({}));
  const avoid = Array.isArray(body?.avoid) ? body.avoid : [];
  const isFinale = body?.index === 9; // Question 10 is index 9

  const prompt = `Generate ONE ${isFinale ? "expert-level, extremely challenging" : "hard-difficulty"} trivia question with a short answer.
${isFinale ? "This is a Final Jeopardy question - it should be very prestigious and require deep specialized knowledge." : ""}

Constraints:
- Require specific knowledge, not general/common knowledge
- Focus on lesser-known facts, obscure details, specific dates/numbers, niche topics
- Answer should be short (ideally 1-5 words). No essays.
- No trick questions, no ambiguity. Answer must be factually verifiable and specific.
- Avoid common/mainstream questions that casual trivia players would know.

Avoid these questions (do not repeat them):
${avoid.map((q: string) => `- ${q}`).join("\n")}

Return ONLY valid JSON with this exact shape:
{ "question": { "question": "...", "answer": "...", "category": "..." } }`;

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: prompt,
    max_output_tokens: 250
  });

  const text = response.output_text;
  try {
    const data = extractJson(text);
    if (!data?.question?.question || !data?.question?.answer) throw new Error("Bad shape");
    return NextResponse.json({ question: data.question });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to parse model output", raw: text.slice(0, 2000), details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
