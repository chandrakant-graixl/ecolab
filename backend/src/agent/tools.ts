/**
 * Tools which would be used by our agent
 */
export const tools = [
  {
    type: "function" as const,
    function: {
      name: "get_air_quality_latest",
      description:
        "Get latest air quality measurements near a point (latitude, longitude, radius in meters) or within a bbox. Optional filter by parameter (e.g., pm25).",
      parameters: {
        type: "object",
        properties: {
          latitude: { type: "number" },
          longitude: { type: "number" },
          radius: { type: "number", description: "meters, <= 25000" },
          bbox: {
            type: "array",
            items: { type: "number" },
            minItems: 4,
            maxItems: 4,
            description: "minLon, minLat, maxLon, maxLat",
          },
          parameter: { type: "string", description: "pm25|pm10|o3|no2 etc." },
          limit: { type: "number" },
          page: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
];