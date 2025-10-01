import { getOrCreateCollection, upsertDocs } from "./chroma";
import fs from "node:fs/promises";
import path from "node:path";

const CHUNK_SIZE_CHARS = 1200;        // target characters per RAG chunk
const OVERLAP_CHARS = 200;            // overlap between chunks
const READ_BLOCK_BYTES = 64 * 1024;   // bytes per low-level read (64KB)
const UPSERT_BATCH = 16;              // number of chunks per Chroma upsert

// Very lightweight Markdown → text cleaner, safe to use per-chunk.
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

// Infer pollutant tag from filename to help future filtering
function inferPollutant(file: string): string | undefined {
  const base = path.basename(file).toLowerCase();
  if (base.includes("pm2.5") || base.includes("pm2_5") || base.includes("pm25")) return "pm2.5";
  if (base.includes("pm10")) return "pm10";
  if (base.includes("o3") || base.includes("ozone")) return "o3";
  if (base.includes("no2") || base.includes("nitrogen-dioxide")) return "no2";
  return undefined;
}

// Emit windowed chunks (with overlap) from a growing text buffer without
// letting the buffer grow unbounded. Returns the remaining tail string.
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

    // Move window forward, keeping overlap
    cursor += (CHUNK_SIZE_CHARS - OVERLAP_CHARS);

    // Upsert in small batches to control memory/latency
    if (pending.length >= UPSERT_BATCH) {
      await upsertDocs(collection, pending);
      pending.length = 0;
    }
  }

  // Keep the un-emitted tail in memory (includes the overlap naturally)
  const tail = buf.slice(cursor);
  return { tail, nextChunkIdx: chunkIdx, emitted };
}

async function ingestOneMarkdownFile(
  fullPath: string,
  collection: Awaited<ReturnType<typeof getOrCreateCollection>>
): Promise<number> {
  const fileBase = path.basename(fullPath);
  const pollutant = inferPollutant(fullPath);

  // Low-level streaming read
  const fd = await fs.open(fullPath, "r");
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let acc = "";                    // growing text buffer (but bounded via flushWindows)
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

      // Stream decode into text; decoder handles multibyte boundaries
      acc += decoder.decode(buf.subarray(0, n), { stream: true });

      // Turn current buffer into windows and upsert in batches
      const { tail, nextChunkIdx, emitted } = await flushWindows(
        acc, fileBase, pollutant, chunkIdx, collection, pending
      );
      acc = tail;
      chunkIdx = nextChunkIdx;
      totalChunks += emitted;
    }

    // Flush the decoder's internal state and any remaining text
    acc += decoder.decode(); // end of stream

    // Final windows (may be less than full size)
    if (acc.trim().length > 0) {
      const cleaned = mdToText(acc);
      const item = {
        id: `${fileBase}#${chunkIdx}`,
        text: cleaned,
        meta: { source: fileBase, chunk: chunkIdx, pollutant, type: "markdown" },
      };
      pending.push(item);
      totalChunks += 1;
    }

    // Final upsert for remaining batch
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

  // Process files strictly one-by-one
  for (const file of mdFiles) {
    try {
      const emitted = await ingestOneMarkdownFile(file, collection);
      totalChunks += emitted;
      totalFiles += 1;
    } catch (err) {
      console.error(`Failed to ingest ${path.basename(file)}:`, err);
    }
  }

  console.log(`✅ Done. Ingested ${totalChunks} chunks from ${totalFiles} file(s).`);
}

if (require.main === module) {
  const folder = process.argv[2] ?? "./docs";
  ingestFolder(folder).catch(err => {
    console.error("Ingest failed:", err);
    process.exit(1);
  });
}
