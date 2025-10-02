import { config as configDotenv } from "dotenv";
import axios, { AxiosInstance } from "axios";

configDotenv();

export type AirQualityParams = {
  latitude?: number;
  longitude?: number;
  radius?: number;
  bbox?: [number, number, number, number];
  parameter?: string;
  limit?: number;
  page?: number;
};

function makeClient(): AxiosInstance {
  const apiKey = process.env.OPENAQ_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAQ_API_KEY");
  return axios.create({
    baseURL: process.env.OPENAQ_BASE_URL || "https://api.openaq.org/v3",
    timeout: 20_000,
    headers: {
      Accept: "application/json",
      "X-API-Key": apiKey,
    },
  });
}

/** Ensure caller uses bbox OR (lat, lon [+radius]), not both. */
function assertValidGeo(p: AirQualityParams) {
  const hasBbox = !!p.bbox;
  const hasPoint = p.latitude != null && p.longitude != null;
  if (hasBbox && hasPoint) {
    throw new Error("Geospatial: use either bbox OR (latitude+longitude [+radius]), not both.");
  }
}

function normalizeParamName(x?: string) {
  if (!x) return undefined;
  return String(x).toLowerCase().replace(/\s+/g, "");
}

/** Returns true if a 'latest' row matches the desired parameter code/name (when present). */
function rowMatchesParam(row: any, want?: string) {
  if (!want) return true;
  const w = normalizeParamName(want);
  // OpenAQ may expose code/name under different fields; normalize and compare.
  const code =
    normalizeParamName(row?.parameter) ||
    normalizeParamName(row?.parameterCode) ||
    normalizeParamName(row?.parametersCode) ||
    normalizeParamName(row?.parameter_name) ||
    normalizeParamName(row?.parametersName);
  return !w || (code ? code === w : true); // if missing, don’t over-filter to zero
}

type LatestItem = {
  locationsId: number;
  locationName?: string;
  sensorsId?: number;
  datetimeUtc?: string;
  datetimeLocal?: string;
  value?: number;
  parameterId?: number;
  coordinates?: { latitude?: number; longitude?: number };
  parameterCode?: string;
};

async function getLocations(client: AxiosInstance, q: Record<string, string>) {
  const r = await client.get("/locations", { params: q });
  const results: any[] = r.data?.results ?? [];
  return results.map((it) => ({ id: it.id as number, name: it.name as string | undefined }));
}

async function getLatestForLocation(client: AxiosInstance, id: number) {
  const r = await client.get(`/locations/${id}/latest`);
  return (r.data?.results ?? []) as any[];
}

/**
 * Internal: fetch latest readings with optional parameter filtering and given radius.
 * - Builds /locations query for bbox OR coordinates+radius.
 * - Iterates matched locations and aggregates /latest rows.
 */
async function fetchCore(
  params: AirQualityParams,
  radiusMeters: number,
  withParamFilter: boolean
) {
  const client = makeClient();
  const {
    latitude,
    longitude,
    bbox,
    parameter,
    limit = 20,
    page = 1,
  } = params;

  const wantParam = withParamFilter ? normalizeParamName(parameter) : undefined;

  const locQuery: Record<string, string> = {
    limit: String(limit),
    page: String(page),
    sort: "desc",
  };

  if (bbox) {
    locQuery["bbox"] = bbox.join(",");
  } else if (latitude != null && longitude != null) {
    locQuery["coordinates"] = `${latitude},${longitude}`;
    locQuery["radius"] = String(radiusMeters);
  }

  const locations = await getLocations(client, locQuery);

  const out: LatestItem[] = [];
  for (const loc of locations) {
    try {
      const rows = await getLatestForLocation(client, loc.id);
      for (const row of rows) {
        if (!rowMatchesParam(row, wantParam)) continue;
        out.push({
          locationsId: row.locationsId ?? loc.id,
          locationName: loc.name,
          sensorsId: row.sensorsId,
          datetimeUtc: row?.datetime?.utc,
          datetimeLocal: row?.datetime?.local,
          value: row.value,
          parameterId: row.parametersId ?? row.parameterId,
          coordinates: row.coordinates,
          parameterCode:
            row?.parameter ||
            row?.parameterCode ||
            row?.parametersCode ||
            row?.parameter_name ||
            row?.parametersName,
        });
      }
    } catch {
      // Skip locations with failing /latest calls (keep robust)
      continue;
    }
  }

  return out;
}

/**
 * Public API: fetchAirQualityLatest(params)
 *
 * Strategy:
 *  1) Try base radius (default 25 km, clamped to 1..25,000 m) WITH parameter filter
 *  2) Same radius WITHOUT filter
 *  3) Expand to min(base+15 km, 40 km) WITH filter
 *  4) Expanded radius WITHOUT filter
 *
 * Returns: { meta: { count, radius, parameterFiltered, page, limit }, results: LatestItem[] }
 * Throws: for 4xx OpenAQ errors (surfaces server message), otherwise falls through attempts.
 */
export async function fetchAirQualityLatest(params: AirQualityParams) {
  assertValidGeo(params);

  const baseRadius = Math.min(Math.max(params.radius ?? 25_000, 1), 25_000);
  const attempts: { r: number; filter: boolean }[] = [
    { r: baseRadius, filter: true },
    { r: baseRadius, filter: false },
    { r: Math.min(baseRadius + 15_000, 40_000), filter: true },
    { r: Math.min(baseRadius + 15_000, 40_000), filter: false },
  ];

  for (const a of attempts) {
    try {
      const rows = await fetchCore(params, a.r, a.filter);
      if (rows.length > 0) {
        return {
          meta: { count: rows.length, radius: a.r, parameterFiltered: a.filter, page: params.page ?? 1, limit: params.limit ?? 20 },
          results: rows,
        };
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status && status >= 400 && status < 500) {
        throw new Error(
          `OpenAQ error ${status}: ${
            typeof err.response?.data === "string"
              ? err.response.data.slice(0, 300)
              : JSON.stringify(err.response?.data)?.slice(0, 300)
          }`
        );
      }
      // Non-4xx: try next attempt
    }
  }

  // No data after all attempts
  return {
    meta: { count: 0, radius: Math.min(baseRadius + 15_000, 40_000), parameterFiltered: false, page: params.page ?? 1, limit: params.limit ?? 20 },
    results: [],
  };
}
