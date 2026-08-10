"use client";

import { UtilityRouteError } from "@/components/utility-route-error";

// DocumentationError owns recoverable loading failures for the documentation route.
export default function DocumentationError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <UtilityRouteError {...props} title="Dokumentaci se nepodařilo načíst" />;
}
