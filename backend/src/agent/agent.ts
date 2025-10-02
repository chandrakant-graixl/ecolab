/**
 * answerUser.ts
 *
 * Purpose:
 * - RAG + tool-augmented answerer. Retrieves relevant passages from Chroma,
 *   builds a context block, calls OpenAI for an answer, and (optionally)
 *   executes a tool call to fetch live air-quality data before finalizing.
 *
 * Important:
 * - The agent is **stateless**: it does not remember prior turns.
 *   In real-world usage you’d prefer a **stateful** agent that persists conversation history
 *   (e.g., store/rehydrate messages per session).
 *
 * Inputs:
 * - queryText: user’s question.
 *
 * Outputs:
 * - { answer, passages, tool } where:
 *   - answer: final model reply (string)
 *   - passages: retrieved RAG passages (for debug/UX)
 *   - tool: { name, args } when a tool was invoked, else null
 *
 * Flow:
 * 1) getOrCreateCollection() → ragQuery() → buildContext(passages)
 * 2) OpenAI chat completion with SYSTEM_PROMPT, user query, and Context
 * 3) If model requests a tool (get_air_quality_latest):
 *    - Parse args (zod-validated), call fetchAirQualityLatest()
 *    - Send a second model call including the tool result as a tool message
 * 4) Return final answer + metadata
 */

import OpenAI from "openai";
import { getOrCreateCollection, query as ragQuery } from "../rag/chroma";
import { fetchAirQualityLatest, type AirQualityParams } from "../tools/openaq";
import { configDotenv } from "dotenv";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { AirQualitySchema, Passage } from "../types";
import { buildContext } from "./utils";
import { tools } from "./tools";

configDotenv();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function answerUser(queryText: string) {
  // --- RAG: fetch similar passages and build a compact context block ---
  const collection = await getOrCreateCollection();
  const passages = (await ragQuery(collection, queryText, 6)) as Passage[];
  const contextBlocks = buildContext(passages);

  // --- First model pass: may produce a direct answer or request a tool call ---
  const result = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: queryText },
      { role: "system", content: `Context:\n${contextBlocks}` },
    ],
    tools,            // declare callable tools
    tool_choice: "auto",
  });

  const msg = result.choices[0]?.message;

  // No tool calls → return the model’s first-shot answer
  if (!msg?.tool_calls?.length) {
    return {
      answer: msg?.content ?? "",
      passages,
      tool: null
    };
  }

  // Handle supported tool calls (currently: get_air_quality_latest)
  for (const call of msg.tool_calls) {
    const name = (call as any).function?.name;
    if (name === "get_air_quality_latest") {
      // Parse tool args (safe default to {})
      let args: AirQualityParams = {};
      try {
        const raw = JSON.parse((call as any).function?.arguments ?? "{}");
        args = AirQualitySchema.parse(raw) as any;
      } catch {
        args = {};
      }

      // Execute tool and feed result back as a tool message
      const toolData = await fetchAirQualityLatest(args);

      // --- Second model pass: same context + tool result to ground the final answer ---
      const second = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: queryText },
          { role: "system", content: `Context:\n${contextBlocks}` },
          msg, // include the assistant message that requested the tool
          {
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(toolData).slice(0, 15000), // guard oversized payloads
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

  // Unknown tool name (defensive fallback)
  return {
    answer: msg?.content ?? "",
    passages,
    tool: null
  };
}
