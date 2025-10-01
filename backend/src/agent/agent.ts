import OpenAI from "openai";
import { z } from "zod";
import { getOrCreateCollection, query as ragQuery } from "../rag/chroma";
import { fetchAirQualityLatest, type AirQualityParams } from "../tools/openaq";
import { configDotenv } from "dotenv";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { AirQualitySchema, Passage } from "../types";
import { buildContext } from "./utils";
import { tools } from "./tools";

configDotenv()

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function answerUser(queryText: string) {
  const collection = await getOrCreateCollection();
  const passages = (await ragQuery(collection, queryText, 6)) as Passage[];
  const contextBlocks = buildContext(passages);

  const result = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: queryText },
      { role: "system", content: `Context:\n${contextBlocks}` },
    ],
    tools,
    tool_choice: "auto",
  });

  const msg = result.choices[0]?.message;

  if (!msg?.tool_calls?.length) {
    return {
      answer: msg?.content ?? "",
      passages,
      tool: null
    };
  }

  for (const call of msg.tool_calls) {
    const name = (call as any).function?.name;
    if (name === "get_air_quality_latest") {
      let args: AirQualityParams = {};
      try {
        const raw = JSON.parse((call as any).function?.arguments ?? "{}");
        args = AirQualitySchema.parse(raw) as any;
      } catch {
        args = {};
      }

      const toolData = await fetchAirQualityLatest(args);

      const second = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: queryText },
          { role: "system", content: `Context:\n${contextBlocks}` },
          msg,
          {
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(toolData).slice(0, 15000),
          },
        ],
      });

      return {
        answer: second.choices[0]?.message?.content ?? "",
        passages,
        tool: { name, args },
      };
    }
  }

  // Fallback if an unknown tool name appears
  return {
    answer: msg?.content ?? "",
    passages,
    tool: null
  };
}
