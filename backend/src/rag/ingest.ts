/**
 * ingestMarkdown.ts
 *
 * Purpose:
 * - Stream-ingest Markdown (*.md) files from a folder into a Chroma collection for RAG.
 * - Chunks text with overlap, cleans Markdown → plain text, embeds via OpenAI, and upserts.
 *
 * Notes on state:
 * - This script is **stateless** (no chat/session memory). It just indexes files.
 *   In production you’d pair it with a **stateful** agent that remembers conversation history.
 *
 * Tunables:
 * - CHUNK_SIZE_CHARS (default: 1200): target chars per chunk
 * - OVERLAP_CHARS (default: 200): sliding window overlap
 * - READ_BLOCK_BYTES (default: 64KB): file read block size
 * - UPSERT_BATCH (default: 16): items per upsert call
 *
 * Flow:
 * 1) Discover .md files in a folder
 * 2) Stream-read each file → decode → window into chunks (with overlap)
 * 3) Clean Markdown → text per chunk
 * 4) Batch-embed + upsert into Chroma with metadata (source, chunk, pollutant tag)
 * 5) Repeat per file, log totals
 *
 * CLI:
 * - node ingestMarkdown.js [folder]    // defaults to ./docs
 */

import { getOrCreateCollection, upsertDocs } from "./chroma";
import fs from "node:fs/promises";
import path from "node:path";

const CHUNK_SIZE_CHARS = 1200;        // target characters per RAG chunk
const OVERLAP_CHARS = 200;            // overlap between chunks
const READ_BLOCK_BYTES = 64 * 1024;   // bytes per low-level read (64KB)
const UPSERT_BATCH = 16;              // number of chunks per Chroma upsert

// Lightweight Markdown → text cleaner (safe per-chunk)
function mdToText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")                 // code fences
    .replace(/`([^`]+)`/g, "$1")                     // inline code
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")        // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")         // links
    .replace(/^#{1,6}\s+/gm, "")                     // headings
    .replace(/(\*\*|__)(.*?)\1/g, "$2")              // bold
    .replace(/(\*|_)(.*?)\1/g, "$2")                 // italics
    .replace(/[ \t]+\n/g, "\n")                      // trailing spaces
    .replace(/\n{3,}/g, "\n\n")                      // collapse newlines
    .trim();
}

// Infer pollutant tag from filename (helps filtering later)
function inferPollutant(file: string): string | undefined {
  const base = path.basename(file).toLowerCase();
  if (base.includes("pm2.5") || base.includes("pm2_5") || base.includes("pm25")) return "pm2.5";
  if (base.includes("pm10")) return "pm10";
  if (base.includes("o3") || base.includes("ozone")) return "o3";
  if (base.includes("no2") || base.includes("nitrogen-dioxide")) return "no2";
  return undefined;
}

/**
 * Windowed emission with overlap. Flushes batches to Chroma via upsertDocs.
 * Returns the remaining tail (to keep overlap continuity) and counters.
 */
async function flushWindows(
  buf: string,
  fileBase: string,
  pollutant: string | undefined,
  startChunkIdx: number,
  collection: Awaited<ReturnType<typeof getOrCreateCollection>>,
  pending: { id: string; text: string; meta?: Record<string, any> }[],
): Promise<{ tail: string; nextChunkIdx: number; emitted: number }> {
  let cursor = 0;
  let emitted = 0;
  let chunkIdx = startChunkIdx;

  while (buf.length - cursor >= CHUNK_SIZE_CHARS) {
    const slice = buf.slice(cursor, cursor + CHUNK_SIZE_CHARS);
    const cleaned = mdToText(slice);
    const item = {
      id: `${fileBase}#${chunkIdx}`,
      text: cleaned,
      meta: { source: fileBase, chunk: chunkIdx, pollutant, type: "markdown" },
    };
    pending.push(item);
    emitted += 1;
    chunkIdx += 1;

    // Slide window forward, keep overlap
    cursor += (CHUNK_SIZE_CHARS - OVERLAP_CHARS);

    // Small, predictable upserts
    if (pending.length >= UPSERT_BATCH) {
      await upsertDocs(collection, pending);
      pending.length = 0;
    }
  }

  return { tail: buf.slice(cursor), nextChunkIdx: chunkIdx, emitted };
}

/**
 * Stream-ingest a single Markdown file.
 * - Streaming decode handles multibyte boundaries.
 * - Flush windows as we go to bound memory.
 */
async function ingestOneMarkdownFile(
  fullPath: string,
  collection: Awaited<ReturnType<typeof getOrCreateCollection>>
): Promise<number> {
  const fileBase = path.basename(fullPath);
  const pollutant = inferPollutant(fullPath);

  const fd = await fs.open(fullPath, "r");
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let acc = "";                    // bounded via flushWindows
  let bytesRead = 0;
  let chunkIdx = 0;
  let totalChunks = 0;
  const pending: { id: string; text: string; meta?: Record<string, any> }[] = [];

  try {
    const buf = Buffer.allocUnsafe(READ_BLOCK_BYTES);

    while (true) {
      const { bytesRead: n } = await fd.read(buf, 0, READ_BLOCK_BYTES, null);
      if (n <= 0) break;
      bytesRead += n;

      acc += decoder.decode(buf.subarray(0, n), { stream: true });

      const { tail, nextChunkIdx, emitted } = await flushWindows(
        acc, fileBase, pollutant, chunkIdx, collection, pending
      );
      acc = tail;
      chunkIdx = nextChunkIdx;
      totalChunks += emitted;
    }

    // End of stream: flush decoder + final tail
    acc += decoder.decode();
    if (acc.trim().length > 0) {
      const cleaned = mdToText(acc);
      pending.push({
        id: `${fileBase}#${chunkIdx}`,
        text: cleaned,
        meta: { source: fileBase, chunk: chunkIdx, pollutant, type: "markdown" },
      });
      totalChunks += 1;
    }

    if (pending.length > 0) {
      await upsertDocs(collection, pending);
      pending.length = 0;
    }
  } finally {
    await fd.close();
  }

  console.log(`Ingested ${totalChunks} chunks from ${fileBase}`);
  return totalChunks;
}

/**
 * Ingest all .md files from a folder (sequentially).
 */
async function ingestFolder(folder = "./docs") {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const mdFiles = entries
    .filter(e => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .map(e => path.join(folder, e.name));

  if (mdFiles.length === 0) {
    console.warn(`No .md files found in: ${folder}`);
    return;
  }

  const collection = await getOrCreateCollection();
  let totalFiles = 0;
  let totalChunks = 0;

  for (const file of mdFiles) {
    try {
      const emitted = await ingestOneMarkdownFile(file, collection);
      totalChunks += emitted;
      totalFiles += 1;
    } catch (err) {
      console.error(`Failed to ingest ${path.basename(file)}:`, err);
    }
  }

  console.log(`Done. Ingested ${totalChunks} chunks from ${totalFiles} file(s).`);
}

// CLI entry
if (require.main === module) {
  const folder = process.argv[2] ?? "./docs";
  ingestFolder(folder).catch(err => {
    console.error("Ingest failed:", err);
    process.exit(1);
  });
}
