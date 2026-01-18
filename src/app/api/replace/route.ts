import OpenAI from "openai";
import { NextResponse } from "next/server";

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

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const body = await req.json().catch(() => ({}));
  const avoid = Array.isArray(body?.avoid) ? body.avoid : [];
  const isFinale = body?.index === 9; // Question 10 is index 9

  const prompt = `Generate ONE trivia question with a short answer.

Difficulty Target: ${isFinale ? "8-9/10 difficulty - difficult and prestigious, require deeper knowledge and be more difficult than regular questions." : "7/10 difficulty - moderately challenging, require solid knowledge but not highly specialized expertise. Focus on interesting facts that aren't common knowledge but are accessible to knowledgeable players."}

Constraints:
- Include some specific details, dates, or lesser-known information, but keep it accessible to intermediate/advanced players
- Answer should be short (ideally 1-5 words). No essays.
- No trick questions, no ambiguity. Answer must be factually verifiable and specific.
- Target intermediate to advanced trivia players - challenging but fair.

Avoid these questions (do not repeat them):
${avoid.map((q: string) => `- ${q}`).join("\n")}

Return ONLY valid JSON with this exact shape:
{ "question": { "question": "...", "answer": "...", "category": "..." } }`;

  const modelEnv = String(process.env.OPENAI_MODEL || "");
  const allowedModels = ["gpt-4o-mini", "gpt-4.1-mini"] as const;
  const model = (allowedModels as readonly string[]).includes(modelEnv) ? modelEnv : "gpt-4o-mini";

  const resp = await client.responses.create({
    model,
    input: prompt,
    max_output_tokens: 250
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
    if (!data?.question?.question || !data?.question?.answer) throw new Error("Bad shape");
    return NextResponse.json({ question: data.question });
  } catch (e: any) {
    console.error("Replace API error:", e);
    console.error("Raw response:", text);
    return NextResponse.json(
      { error: `Failed to parse model output: ${e?.message}`, raw: text.slice(0, 500) },
      { status: 500 }
    );
  }
}
