/**
 * chroma.ts
 *
 * Purpose:
 * - Thin wrapper around ChromaDB for RAG: create/get a collection, embed text with OpenAI,
 *   upsert documents with explicit embeddings, and run kNN queries.
 *
 * Notes on state:
 * - This module is stateless; it does not track chat history or per-user context.
 *   In real-world systems you’d usually pair this with a **stateful** agent that
 *   remembers conversation history and user/session metadata.
 *
 * Env:
 * - OPENAI_API_KEY: OpenAI credential
 * - CHROMA_URL: Chroma endpoint (defaults to http://localhost:8000)
 *
 * Exposed API:
 * - embed(texts): number[][] — OpenAI embedding for an array of strings.
 * - getOrCreateCollection(name?): Collection — Chroma collection with no-op embedder.
 * - upsertDocs(collection, items): void — Upsert {id, text, meta}[] with manual embeddings.
 * - query(collection, queryText, k?): {text, score, meta, id}[] — Top-k results (flattened).
 */

import { ChromaClient, type Collection } from "chromadb";
import { configDotenv } from "dotenv";
import OpenAI from "openai";

configDotenv();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const chroma = new ChromaClient({
  path: process.env.CHROMA_URL ?? "http://localhost:8000",
});

/**
 * Embed an array of texts via OpenAI.
 * - Model: text-embedding-3-large
 * - Returns embeddings aligned by index with input texts.
 */
export async function embed(texts: string[]) {
  const res = await openai.embeddings.create({
    input: texts,
    model: "text-embedding-3-large",
  });
  return res.data.map(e => e.embedding);
}

/**
 * No-op embedding function to prevent Chroma from auto-loading a default embedder.
 * We always pass embeddings explicitly in upsert/query.
 */
const noEmbed = {
  generate: async (_: string[]) => {
    throw new Error(
      "EmbeddingFunction disabled: pass embeddings explicitly to collection.add/upsert/query."
    );
  },
};

/**
 * Get or create a Chroma collection.
 * - Uses noEmbed to keep responsibility for embeddings in this module.
 */
export async function getOrCreateCollection(name = "ecolab_rag"): Promise<Collection> {
  const collection = await chroma.getOrCreateCollection({
    name,
    embeddingFunction: noEmbed, // avoid @chroma-core/default-embed auto-load
  });
  return collection;
}

/**
 * Upsert documents with manual embeddings.
 * - items: [{ id, text, meta? }]
 * - Writes ids, documents, embeddings, and optional metadatas in one call.
 */
export async function upsertDocs(
  collection: Collection,
  items: { id: string; text: string; meta?: Record<string, any> }[]
) {
  const embeddings = await embed(items.map(i => i.text));
  await collection.upsert({
    ids: items.map(i => i.id),
    documents: items.map(i => i.text),
    embeddings,
    metadatas: items.map(i => i.meta ?? {}),
  });
}

/**
 * Query top-k nearest documents for a query string.
 * - Embeds the query, runs collection.query with k results.
 * - Flattens the response to a convenient shape.
 */
export async function query(collection: Collection, queryText: string, k = 5) {
  const [qVec] = await embed([queryText]);
  const res = await collection.query({ queryEmbeddings: [qVec], nResults: k });

  // Flatten to a stable structure expected by the rest of the app
  return (res.documents?.[0] ?? []).map((doc, i) => ({
    text: doc,
    score: res.distances?.[0]?.[i],
    meta: res.metadatas?.[0]?.[i],
    id: res.ids?.[0]?.[i],
  }));
}
