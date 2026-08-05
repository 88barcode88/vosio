import type { DevelopmentRecordingFactory } from "@/components/browser-recorder/types";

// assertDevelopmentRecordingFactoryAllowed prevents fixture injection in test and production bundles.
export function assertDevelopmentRecordingFactoryAllowed(
  factory: DevelopmentRecordingFactory | undefined
) {
  if (factory && process.env.NODE_ENV !== "development") {
    throw new Error("The browser recorder development factory is development-only.");
  }
}
