import { occurrencesFor } from "./cue-engine";
import {
  pageStateIdsForRevision,
  type CueInterval,
  type LectureManifest,
  type PageState,
  type RevisionAsset
} from "./types";

/** One strip/TOC entry for a page state, with display metadata. */
export interface SlideIndexEntry {
  state: PageState;
  title: string;
  /** 1-based position in the continuous strip across all decks. */
  position: number;
  /** First video occurrence, if the lecture has a synchronized recording. */
  timeMs?: number;
}

export interface SlideIndex {
  entries: SlideIndexEntry[];
  /** Total strip length (PDF pages across decks when known, else page states). */
  total: number;
  byStateId: Map<string, SlideIndexEntry>;
}

export interface SlideSearchHit {
  entry: SlideIndexEntry;
  /** Short context around the first match, normalized to single spaces. */
  snippet: string;
  matchedTitle: boolean;
}

export function formatTimeMs(timeMs: number): string {
  const total = Math.max(0, Math.floor(timeMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/** Derives a human title from the semantic slide text (first Markdown heading). */
export function slideTitle(state: PageState): string {
  const source = state.text || state.markdown || "";
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = trimmed.match(/^#{1,6}\s+(.*)$/);
    const candidate = (heading ? heading[1] : trimmed) ?? "";
    const cleaned = candidate
      .replace(/[*_`]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned) return cleaned.length > 120 ? `${cleaned.slice(0, 117)}…` : cleaned;
    break;
  }
  return `Slide ${state.page}`;
}

export function firstOccurrence(
  cues: readonly CueInterval[],
  pageStateIds: string | readonly string[]
): CueInterval | undefined {
  return occurrencesFor(cues, pageStateIds).sort((left, right) => left.start_ms - right.start_ms)[0];
}

/**
 * Earliest video occurrence for a page state in either revision, so citations
 * and TOC rows can deep-link into the recording.
 */
export function occurrenceTimeMs(
  manifest: LectureManifest,
  stateId: string
): number | undefined {
  const ids = new Set([
    stateId,
    ...pageStateIdsForRevision(manifest, stateId, "recorded"),
    ...pageStateIdsForRevision(manifest, stateId, "teaching")
  ]);
  const cue = firstOccurrence(manifest.cues, [...ids]);
  return cue ? cue.stable_at_ms ?? cue.start_ms : undefined;
}

/**
 * Continuous strip numbering across decks. Uses the deck page count when the
 * manifest provides it so numbers match the rendered PDF pages, and falls back
 * to the largest known page state otherwise.
 */
export function buildSlideIndex(
  asset: RevisionAsset,
  cues: readonly CueInterval[],
  resolveTitle?: (state: PageState) => string | undefined
): SlideIndex {
  const entries: SlideIndexEntry[] = [];
  const decks = asset.decks.length > 0
    ? asset.decks
    : [{ deck_id: "all", order: 1, page_states: asset.page_states, page_count: undefined }];
  let offset = 0;
  for (const deck of decks) {
    const deckPages = deck.page_states.map((state) => state.asset_page ?? state.page);
    const deckSize = deck.page_count ?? Math.max(0, ...deckPages);
    for (const state of deck.page_states) {
      const cue = firstOccurrence(cues, [state.id, ...state.aliases]);
      const hasOwnText = Boolean(state.text || state.markdown);
      entries.push({
        state,
        title: (hasOwnText ? undefined : resolveTitle?.(state)) ?? slideTitle(state),
        position: offset + (state.asset_page ?? state.page),
        timeMs: cue ? cue.stable_at_ms ?? cue.start_ms : undefined
      });
    }
    offset += deckSize;
  }
  entries.sort((left, right) => left.position - right.position);
  return {
    entries,
    total: Math.max(offset, entries.length),
    byStateId: new Map(entries.map((entry) => [entry.state.id, entry]))
  };
}

export function searchSlides(index: SlideIndex, query: string, limit = 12): SlideSearchHit[] {
  const needle = query.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  if (needle.length < 2) return [];
  const hits: SlideSearchHit[] = [];
  for (const entry of index.entries) {
    const title = entry.title.toLocaleLowerCase();
    const text = (entry.state.text || entry.state.markdown || "").replace(/\s+/g, " ");
    const haystack = text.toLocaleLowerCase();
    const inTitle = title.includes(needle);
    const at = haystack.indexOf(needle);
    if (!inTitle && at < 0) continue;
    let snippet = "";
    if (at >= 0) {
      const start = Math.max(0, at - 40);
      const end = Math.min(text.length, at + needle.length + 60);
      snippet = `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
    }
    hits.push({ entry, snippet, matchedTitle: inTitle });
  }
  hits.sort((left, right) =>
    Number(right.matchedTitle) - Number(left.matchedTitle) ||
    left.entry.position - right.entry.position
  );
  return hits.slice(0, limit);
}

/**
 * Teaching page states revised after the recording (errata or a non-unchanged
 * recorded-to-teaching mapping). Drives the tab hint and per-card badges.
 */
export function revisedTeachingStateIds(manifest: LectureManifest): Set<string> {
  const revised = new Set<string>();
  for (const state of manifest.revisions.teaching.page_states) {
    if (state.correction) revised.add(state.id);
  }
  for (const mapping of manifest.revision_mappings) {
    if (mapping.relation === "unchanged" || mapping.relation === "unresolved") continue;
    for (const id of mapping.teaching_content_page_state_ids) revised.add(id);
  }
  return revised;
}
