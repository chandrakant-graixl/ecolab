import { ChromaClient, type Collection } from "chromadb";
import { configDotenv } from "dotenv";
import OpenAI from "openai";

configDotenv()

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const chroma = new ChromaClient({
  path: process.env.CHROMA_URL ?? "http://localhost:8000",
});

// --- keep your manual embedding helpers exactly as before ---
export async function embed(texts: string[]) {
  const res = await openai.embeddings.create({
    input: texts,
    model: "text-embedding-3-large",
  });
  return res.data.map(e => e.embedding);
}

// Provide a "no-op" embeddingFunction so the client never tries to import a default embedder.
// We still pass embeddings manually in upsertDocs/query, preserving existing behavior.
const noEmbed = {
  generate: async (_: string[]) => {
    throw new Error(
      "EmbeddingFunction disabled: pass embeddings explicitly to collection.add/upsert/query."
    );
  },
};

export async function getOrCreateCollection(name = "ecolab_rag"): Promise<Collection> {
  const collection = await chroma.getOrCreateCollection({
    name,
    embeddingFunction: noEmbed, // <- prevents @chroma-core/default-embed auto-load
  });
  return collection;
}

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

export async function query(collection: Collection, queryText: string, k = 5) {
  const [qVec] = await embed([queryText]);
  const res = await collection.query({ queryEmbeddings: [qVec], nResults: k });

  // Flatten to the same shape you were returning earlier
  return (res.documents?.[0] ?? []).map((doc, i) => ({
    text: doc,
    score: res.distances?.[0]?.[i],
    meta: res.metadatas?.[0]?.[i],
    id: res.ids?.[0]?.[i],
  }));
}
