import type { CueInterval, RevisionKind } from "./types";

export function cueAt(cues: readonly CueInterval[], timeMs: number): CueInterval | undefined {
  if (cues.length === 0 || timeMs < cues[0]!.start_ms) return undefined;
  let low = 0;
  let high = cues.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (cues[middle]!.start_ms <= timeMs) low = middle;
    else high = middle - 1;
  }
  const cue = cues[low];
  return cue && timeMs < cue.end_ms ? cue : undefined;
}

export function cuePageStateIds(
  cue: CueInterval,
  revision?: RevisionKind
): string[] {
  const recorded = [
    cue.recorded_page_state_id,
    ...cue.equivalent_recorded_page_state_ids
  ].filter((id): id is string => Boolean(id));
  const teaching = [
    cue.content_page_state_id,
    ...cue.teaching_content_page_state_ids,
    ...cue.teaching_matcher_page_state_ids
  ].filter((id): id is string => Boolean(id));
  const legacy = cue.page_state_id ? [cue.page_state_id] : [];
  const selected = revision === "recorded"
    ? recorded
    : revision === "teaching"
      ? teaching
      : [...recorded, ...teaching, ...legacy];
  return [...new Set(selected.length > 0 ? selected : legacy)];
}

export function occurrencesFor(
  cues: readonly CueInterval[],
  pageStateIds: string | readonly string[]
): CueInterval[] {
  const targets = new Set(typeof pageStateIds === "string" ? [pageStateIds] : pageStateIds);
  return cues.filter(
    (cue) =>
      cue.state_kind === "slide" &&
      cuePageStateIds(cue).some((pageStateId) => targets.has(pageStateId))
  );
}

export function nearestOccurrence(
  cues: readonly CueInterval[],
  pageStateIds: string | readonly string[],
  currentTimeMs: number
): CueInterval | undefined {
  return occurrencesFor(cues, pageStateIds).sort(
    (left, right) =>
      Math.abs((left.stable_at_ms ?? left.start_ms) - currentTimeMs) -
      Math.abs((right.stable_at_ms ?? right.start_ms) - currentTimeMs)
  )[0];
}
