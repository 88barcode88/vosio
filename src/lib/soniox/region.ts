import { z } from "zod";

export const sonioxRegionSchema = z.enum(["global", "eu"]);

export type SonioxRegion = z.infer<typeof sonioxRegionSchema>;

export const sonioxRegionOptions: ReadonlyArray<{
  id: SonioxRegion;
  label: string;
}> = [
  { id: "global", label: "Globální" },
  { id: "eu", label: "Evropská unie" }
] as const;

const sonioxRegionTargets: Record<SonioxRegion, {
  apiBaseUrl: string;
  sttWsUrl: string;
}> = {
  global: {
    apiBaseUrl: "https://api.soniox.com",
    sttWsUrl: "wss://stt-rt.soniox.com"
  },
  eu: {
    apiBaseUrl: "https://api.eu.soniox.com",
    sttWsUrl: "wss://stt-rt.eu.soniox.com"
  }
};

// getSonioxRegionTarget returns the REST and realtime endpoints for a supported region.
export function getSonioxRegionTarget(region: SonioxRegion) {
  return sonioxRegionTargets[region];
}
