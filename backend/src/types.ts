import { z } from "zod";

export const AirQualitySchema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  radius: z.number().optional(), // meters (1..25000)
  bbox: z.array(z.number()).length(4).optional(), // [minLon, minLat, maxLon, maxLat]
  parameter: z.string().optional(), // e.g., "pm25", "pm10", "o3", "no2"
  limit: z.number().optional(),
  page: z.number().optional(),
});

export type Passage = { text: string; score?: number; meta?: any; id?: string };
