"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ArrowDownUp } from "lucide-react";
import {
  buildRecordingSortSearchParams,
  recordingSortOptions,
  type RecordingSort
} from "@/lib/recordings/list-sort";

// RecordingSortSelect switches the URL-backed order of the recordings list while keeping filters and status.
export function RecordingSortSelect({ searchParams, value }: { searchParams: string; value: RecordingSort }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // changeSort navigates to the same list with only the `sort` parameter replaced.
  function changeSort(next: RecordingSort) {
    const query = buildRecordingSortSearchParams(new URLSearchParams(searchParams), next).toString();
    startTransition(() => router.push(query ? `/recordings?${query}` : "/recordings"));
  }

  return (
    <label className="recordings-sort">
      <ArrowDownUp aria-hidden="true" size={14} />
      <span>Řadit</span>
      <select aria-busy={isPending || undefined} name="sort" value={value} onChange={(event) => changeSort(event.target.value as RecordingSort)}>
        {recordingSortOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}
