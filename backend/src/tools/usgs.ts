// backend/src/tools/usgs.ts
// WQP Result service client that avoids 406 by using CSV (mimeType=csv & zip=no)
// and parses the CSV into JS objects.

import { request } from "undici";
import { parse } from "csv-parse/sync";

/**
 * Developer-friendly params (camelCase). We'll map these to WQP names.
 * Docs + parameter table + examples:
 * - Base URL for Result: /data/Result/search
 * - If mimeType not specified, default is WQX-XML
 * - Valid mimeTypes include: xml, xlsx, csv, tsv|tab (and geojson for some profiles; kml/kmz not for results)
 * - Dates: startDateLo/startDateHi must be MM-DD-YYYY
 */
export type WaterQualityParams = {
  countryCode?: string;        // e.g., "US"
  stateCode?: string;          // e.g., "US:48" (Texas)
  countyCode?: string;         // e.g., "US:48:201"
  siteType?: string;           // e.g., "Stream"
  characteristicName?: string; // e.g., "Nitrate"
  characteristicType?: string; // e.g., "Nutrient"
  huc?: string;                // 8-digit HUC(s), semicolon-delimited
  siteid?: string;             // agency-code + "-" + id
  bBox?: string;               // "west,south,east,north"
  sampleMedia?: string;        // e.g., "Water"
  providers?: string;          // "NWIS" | "EPA" | "STEWARDS", semicolon-separated if multiple
  startDateLo?: string;        // "YYYY-MM-DD" or "MM-DD-YYYY"
  startDateHi?: string;        // "YYYY-MM-DD" or "MM-DD-YYYY"
  sorted?: "yes" | "no";       // default "no" (faster)
  limit?: number;              // maps to pagesize
  page?: number;               // maps to pagenumber
};

function toWqpDate(d?: string) {
  if (!d) return undefined;
  if (/^\d{2}-\d{2}-\d{4}$/.test(d)) return d; // already MM-DD-YYYY
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (m) return `${m[2]}-${m[3]}-${m[1]}`;     // YYYY-MM-DD -> MM-DD-YYYY
  return d; // pass-through
}

function buildWqpResultUrl(p: WaterQualityParams) {
  const base = "https://www.waterqualitydata.us/data/Result/search";

  const qs = new URLSearchParams({
    // Force CSV to avoid 406 from servers that won't return JSON for Results:
    mimeType: "csv",
    zip: "no",
    sorted: p.sorted ?? "no",
  });

  if (p.countryCode) qs.set("countrycode", p.countryCode);
  if (p.stateCode) qs.set("statecode", p.stateCode);
  if (p.countyCode) qs.set("countycode", p.countyCode);
  if (p.siteType) qs.set("siteType", p.siteType);
  if (p.characteristicName) qs.set("characteristicName", p.characteristicName);
  if (p.characteristicType) qs.set("characteristicType", p.characteristicType);
  if (p.huc) qs.set("huc", p.huc);
  if (p.siteid) qs.set("siteid", p.siteid);
  if (p.bBox) qs.set("bBox", p.bBox);
  if (p.sampleMedia) qs.set("sampleMedia", p.sampleMedia);
  if (p.providers) qs.set("providers", p.providers);

  const lo = toWqpDate(p.startDateLo);
  const hi = toWqpDate(p.startDateHi);
  if (lo) qs.set("startDateLo", lo);
  if (hi) qs.set("startDateHi", hi);

  if (p.limit) qs.set("pagesize", String(p.limit));
  if (p.page) qs.set("pagenumber", String(p.page));

  return `${base}?${qs.toString()}`;
}

export async function fetchWaterQuality(params: WaterQualityParams) {
  const url = buildWqpResultUrl(params);

  const res = await request(url, {
    method: "GET",
    headers: {
      // Be explicit that CSV is fine; keep Accept broad to avoid negotiation failures.
      "Accept": "text/csv, application/octet-stream, text/plain, */*",
      "User-Agent": "ecolab-rag-agent/1.0 (+https://example.org)",
    },
  });

  const buf = Buffer.from(await res.body.arrayBuffer());

  if (res.statusCode === 406) {
    const snippet = buf.toString("utf8").slice(0, 500);
    throw new Error(
      `USGS WQP returned 406 Not Acceptable. We now use mimeType=csv&zip=no. ` +
      `Response snippet: ${snippet}`
    );
  }

  if (res.statusCode >= 400) {
    const snippet = buf.toString("utf8").slice(0, 500);
    throw new Error(`USGS WQP error ${res.statusCode}: ${snippet}`);
  }

  // Parse CSV to records
  const records = parse(buf.toString("utf8"), {
    columns: true,
    skip_empty_lines: true,
  });

  return records; // array of result rows as objects
}
