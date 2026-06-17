import { AiJob, DictionaryEntry } from "../../types";

export type DictionaryScopeFilters = {
  sourceEntryIds?: Set<string> | null;
  typeFilter: string;
  levelFilter: string;
};

export type DictionaryQueueSummary = {
  scopedEntries: DictionaryEntry[];
  pendingEntries: DictionaryEntry[];
  relevantJobs: AiJob[];
  pendingJobs: AiJob[];
  runningJobs: AiJob[];
  erroredJobs: AiJob[];
  completedJobs: AiJob[];
  staleCompletedJobs: AiJob[];
  totalActionableJobs: number;
  progressPercent: number;
};

const RECENT_COMPLETED_WINDOW_MS = 10 * 60 * 1000;

export function hasDictionaryContent(entry: DictionaryEntry): boolean {
  return Boolean(
    entry.main_meaning?.trim() ||
      entry.kana?.trim() ||
      entry.romaji?.trim(),
  );
}

export function getCorrectDictionaryStatus(entry: DictionaryEntry) {
  if (entry.status === "reviewed") return "reviewed";
  return hasDictionaryContent(entry) ? "ai_enriched" : "pending";
}

export function filterDictionaryEntries(
  entries: DictionaryEntry[],
  filters: DictionaryScopeFilters,
) {
  return entries.filter((entry) => {
    if (filters.sourceEntryIds && !filters.sourceEntryIds.has(entry.id)) {
      return false;
    }
    if (filters.typeFilter !== "all" && entry.type !== filters.typeFilter) {
      return false;
    }
    if (
      filters.levelFilter !== "all" &&
      entry.jlpt_level !== filters.levelFilter
    ) {
      return false;
    }
    return true;
  });
}

export function summarizeDictionaryQueue(
  entries: DictionaryEntry[],
  jobs: AiJob[],
  filters: DictionaryScopeFilters,
): DictionaryQueueSummary {
  const scopedEntries = filterDictionaryEntries(entries, filters);
  const scopedEntryIds = new Set(scopedEntries.map((entry) => entry.id));
  const pendingEntries = scopedEntries.filter(
    (entry) => getCorrectDictionaryStatus(entry) === "pending",
  );
  const pendingEntryIds = new Set(pendingEntries.map((entry) => entry.id));

  const enrichJobs = jobs.filter(
    (job) =>
      job.type === "enrich_dictionary_entry" &&
      scopedEntryIds.has(job.target_id),
  );

  const relevantJobs = enrichJobs.filter(
    (job) =>
      job.status !== "completed" ||
      pendingEntryIds.has(job.target_id) ||
      isRecentlyCompleted(job),
  );

  const pendingJobs = relevantJobs.filter((job) => job.status === "pending");
  const runningJobs = relevantJobs.filter((job) => job.status === "running");
  const erroredJobs = relevantJobs.filter(
    (job) => job.status === "error" || job.status === "cancelled",
  );
  const completedJobs = relevantJobs.filter(
    (job) => job.status === "completed" && !pendingEntryIds.has(job.target_id),
  );
  const staleCompletedJobs = relevantJobs.filter(
    (job) => job.status === "completed" && pendingEntryIds.has(job.target_id),
  );
  const totalActionableJobs =
    pendingJobs.length +
    runningJobs.length +
    erroredJobs.length +
    staleCompletedJobs.length +
    completedJobs.length;
  const progressPercent =
    totalActionableJobs > 0
      ? Math.round((completedJobs.length / totalActionableJobs) * 100)
      : 0;

  return {
    scopedEntries,
    pendingEntries,
    relevantJobs,
    pendingJobs,
    runningJobs,
    erroredJobs,
    completedJobs,
    staleCompletedJobs,
    totalActionableJobs,
    progressPercent,
  };
}

function isRecentlyCompleted(job: AiJob): boolean {
  if (job.status !== "completed") return false;
  const timestamp = job.completed_at || job.updated_at || job.created_at;
  if (!timestamp) return false;
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) && Date.now() - time <= RECENT_COMPLETED_WINDOW_MS;
}
