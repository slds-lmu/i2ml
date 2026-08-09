import { describe, expect, it } from "vitest";

import {
  buildSlideIndex,
  formatTimeMs,
  occurrenceTimeMs,
  revisedTeachingStateIds,
  searchSlides,
  slideTitle
} from "../src/lecture-data";
import { normalizeLectureManifest, type PageState, type RevisionAsset } from "../src/types";

function state(id: string, deck: string, page: number, text: string): PageState {
  return {
    id,
    deck_id: deck,
    page,
    text,
    revision: "teaching",
    aliases: [],
    recorded_page_state_ids: [],
    teaching_page_state_ids: []
  };
}

describe("time formatting", () => {
  it("formats minutes and hours", () => {
    expect(formatTimeMs(0)).toBe("0:00");
    expect(formatTimeMs(727_000)).toBe("12:07");
    expect(formatTimeMs(3_725_000)).toBe("1:02:05");
    expect(formatTimeMs(-50)).toBe("0:00");
  });
});

describe("slide titles", () => {
  it("uses the first Markdown heading and strips emphasis", () => {
    expect(slideTitle(state("a", "d", 3, "## Linear **Models** with L2 Loss\n\nBody")))
      .toBe("Linear Models with L2 Loss");
  });

  it("falls back to the first text line or the page number", () => {
    expect(slideTitle(state("a", "d", 3, "Plain first line\nRest"))).toBe("Plain first line");
    expect(slideTitle(state("a", "d", 7, ""))).toBe("Slide 7");
  });
});

describe("slide index", () => {
  const asset: RevisionAsset = {
    decks: [
      {
        deck_id: "d1",
        order: 1,
        page_count: 3,
        page_states: [
          state("d1-p1", "d1", 1, "## Intro"),
          state("d1-p2", "d1", 2, "## Second topic")
        ]
      },
      {
        deck_id: "d2",
        order: 2,
        page_states: [state("d2-p1", "d2", 1, "## Continuation deck")]
      }
    ],
    page_states: []
  };
  asset.page_states = asset.decks.flatMap((deck) => deck.page_states);
  const cues = [
    { start_ms: 1000, stable_at_ms: 1200, end_ms: 5000, state_kind: "slide" as const,
      page_state_id: "d1-p2", equivalent_recorded_page_state_ids: [],
      teaching_matcher_page_state_ids: [], teaching_content_page_state_ids: [], errata_ids: [] },
    { start_ms: 9000, end_ms: 12_000, state_kind: "slide" as const,
      page_state_id: "d1-p2", equivalent_recorded_page_state_ids: [],
      teaching_matcher_page_state_ids: [], teaching_content_page_state_ids: [], errata_ids: [] }
  ];

  it("numbers slides continuously across decks and finds first occurrences", () => {
    const index = buildSlideIndex(asset, cues);
    expect(index.entries.map((entry) => entry.position)).toEqual([1, 2, 4]);
    expect(index.total).toBe(4);
    expect(index.byStateId.get("d1-p2")?.timeMs).toBe(1200);
    expect(index.byStateId.get("d1-p1")?.timeMs).toBeUndefined();
  });

  it("searches titles first, then body text with a snippet", () => {
    const index = buildSlideIndex(asset, cues);
    expect(searchSlides(index, "x")).toEqual([]);
    const hits = searchSlides(index, "second");
    expect(hits[0]?.entry.state.id).toBe("d1-p2");
    expect(hits[0]?.matchedTitle).toBe(true);
    const bodyHits = searchSlides(index, "continuation");
    expect(bodyHits[0]?.entry.state.id).toBe("d2-p1");
    expect(bodyHits[0]?.snippet).toContain("Continuation");
  });
});

describe("revision metadata", () => {
  const manifest = normalizeLectureManifest(
    {
      lecture_id: "demo",
      content_revision: "revision-1234",
      presentation: { mode: "video_lecture", provider: "youtube", provider_id: "abc" },
      revisions: {
        teaching: {
          page_states: [
            {
              id: "t-1",
              deck_id: "d1",
              page: 1,
              text: "One",
              revision: { errata: [{ description: "Fixed sign" }] }
            },
            { id: "t-2", deck_id: "d1", page: 2, text: "Two" }
          ]
        }
      },
      revision_mapping: {
        page_states: [
          {
            recorded_page_state_id: "r-2",
            recorded_deck_id: "d1",
            recorded_page_number: 2,
            relation: "corrected",
            teaching_content_page_state_ids: ["t-2"],
            errata_ids: []
          }
        ]
      },
      cues: [
        {
          start_ms: 500,
          stable_at_ms: 700,
          end_ms: 4000,
          state_kind: "slide",
          recorded_page_state_id: "r-2",
          recorded_deck_id: "d1",
          recorded_page_number: 2,
          content_page_state_id: "t-2"
        }
      ]
    },
    "demo"
  );

  it("collects revised teaching states from errata and mappings", () => {
    expect(revisedTeachingStateIds(manifest)).toEqual(new Set(["t-1", "t-2"]));
  });

  it("resolves occurrence times across revisions for citations", () => {
    expect(occurrenceTimeMs(manifest, "t-2")).toBe(700);
    expect(occurrenceTimeMs(manifest, "r-2")).toBe(700);
    expect(occurrenceTimeMs(manifest, "t-1")).toBeUndefined();
  });
});
