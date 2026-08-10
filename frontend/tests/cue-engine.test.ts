import { describe, expect, it } from "vitest";

import { cueAt, nearestOccurrence, slideCueNavigation } from "../src/cue-engine";
import type { CueInterval } from "../src/types";

const cues: CueInterval[] = [
  {
    start_ms: 0,
    stable_at_ms: 100,
    end_ms: 1000,
    state_kind: "non_slide",
    equivalent_recorded_page_state_ids: [],
    teaching_matcher_page_state_ids: [],
    teaching_content_page_state_ids: [],
    errata_ids: [],
    state: "intro"
  },
  {
    start_ms: 1000,
    stable_at_ms: 1100,
    end_ms: 3000,
    state_kind: "slide",
    equivalent_recorded_page_state_ids: [],
    teaching_matcher_page_state_ids: [],
    teaching_content_page_state_ids: [],
    errata_ids: [],
    page_state_id: "slide-1",
    occurrence: 1
  },
  {
    start_ms: 3000,
    stable_at_ms: 3100,
    end_ms: 4000,
    state_kind: "slide",
    equivalent_recorded_page_state_ids: [],
    teaching_matcher_page_state_ids: [],
    teaching_content_page_state_ids: [],
    errata_ids: [],
    page_state_id: "slide-2",
    occurrence: 1
  },
  {
    start_ms: 4000,
    stable_at_ms: 4100,
    end_ms: 6000,
    state_kind: "slide",
    equivalent_recorded_page_state_ids: [],
    teaching_matcher_page_state_ids: [],
    teaching_content_page_state_ids: [],
    errata_ids: [],
    page_state_id: "slide-1",
    occurrence: 2
  }
];

describe("cue engine", () => {
  it("uses ordered intervals and preserves non-slide states", () => {
    expect(cueAt(cues, 500)?.state).toBe("intro");
    expect(cueAt(cues, 3500)?.page_state_id).toBe("slide-2");
    expect(cueAt(cues, 6000)).toBeUndefined();
  });

  it("selects the occurrence nearest the current player time", () => {
    expect(nearestOccurrence(cues, "slide-1", 5000)?.occurrence).toBe(2);
    expect(nearestOccurrence(cues, "slide-1", 1500)?.occurrence).toBe(1);
  });

  it("navigates slide cues for the transport controls, skipping non-slide segments", () => {
    // Inside the second slide cue: full neighbourhood.
    expect(slideCueNavigation(cues, 3500)).toMatchObject({
      previous: { start_ms: 1000 },
      current: { start_ms: 3000 },
      next: { start_ms: 4000 }
    });

    // Inside the non-slide intro: nothing current or previous yet.
    const beforeSlides = slideCueNavigation(cues, 500);
    expect(beforeSlides.previous).toBeUndefined();
    expect(beforeSlides.current).toBeUndefined();
    expect(beforeSlides.next?.start_ms).toBe(1000);

    // After the last cue: current is the most recent slide, no next.
    const atEnd = slideCueNavigation(cues, 9000);
    expect(atEnd.current?.start_ms).toBe(4000);
    expect(atEnd.previous?.start_ms).toBe(3000);
    expect(atEnd.next).toBeUndefined();

    // Exactly at a cue start: that cue is current, not next.
    expect(slideCueNavigation(cues, 4000).current?.start_ms).toBe(4000);
  });

  it("matches teaching content IDs and falls back to the cue start time", () => {
    const mapped: CueInterval = {
      start_ms: 7000,
      end_ms: 9000,
      state_kind: "slide",
      recorded_page_state_id: "recorded-1",
      equivalent_recorded_page_state_ids: [],
      content_page_state_id: "teaching-1",
      teaching_matcher_page_state_ids: [],
      teaching_content_page_state_ids: ["teaching-1"],
      errata_ids: []
    };
    expect(nearestOccurrence([mapped], "teaching-1", 8500)).toBe(mapped);
  });
});
