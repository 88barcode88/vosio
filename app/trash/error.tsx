"use client";

import { UtilityRouteError } from "@/components/utility-route-error";

// TrashError owns recoverable loading failures for the Trash route.
export default function TrashError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <UtilityRouteError {...props} title="Koš se nepodařilo načíst" />;
}
