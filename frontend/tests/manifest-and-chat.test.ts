import { describe, expect, it, vi } from "vitest";

import {
  renderSafeMarkdown,
  stripStructuredCitationMarkers,
  typesetSafeMath
} from "../src/chat";
import {
  normalizeLectureManifest,
  pageStateIdForRevision
} from "../src/types";

describe("lecture manifest adapter", () => {
  it("normalizes slide-only and repeated cue data", () => {
    const manifest = normalizeLectureManifest(
      {
        lecture_id: "demo",
        content_revision: "revision-1234",
        presentation: { mode: "external_link_only", external_url: "https://example.test/video" },
        revisions: {
          teaching: {
            page_states: [
              { id: "demo-p1", deck_id: "demo-d1", page: 1, text: "Slide one" }
            ]
          }
        },
        cues: [
          { start_ms: 100, stable_at_ms: 120, end_ms: 200, page_state_id: "demo-p1" }
        ]
      },
      "demo"
    );
    expect(manifest.presentation.mode).toBe("external_link_only");
    expect(manifest.revisions.teaching.page_states[0]?.revision).toBe("teaching");
    expect(manifest.cues[0]?.stable_at_ms).toBe(120);
  });

  it("adapts the browser-safe DTO with opaque recorded IDs and per-deck assets", () => {
    const manifest = normalizeLectureManifest(
      {
        lecture_id: "demo",
        content_revision: "revision-safe-1",
        presentation: {
          mode: "video_lecture",
          provider: "youtube",
          provider_id: "abc123",
          external_link: null,
          video_status: "available"
        },
        decks: [
          {
            deck_id: "deck-a",
            order: 1,
            recorded_revision: { pdf: { url: "/a-recorded.pdf", page_count: 1 } },
            teaching_revision: { pdf: { url: "/a-teaching.pdf", page_count: 1 } }
          },
          {
            deck_id: "deck-b",
            order: 2,
            recorded_revision: { pdf: { url: "/b-recorded.pdf", page_count: 1 } },
            teaching_revision: { pdf: { url: "/b-teaching.pdf", page_count: 1 } }
          }
        ],
        page_states: {
          "teaching-a": {
            page_state_id: "teaching-a",
            deck_id: "deck-a",
            page_number: 1,
            text: "Corrected slide",
            revision: { errata: [{ description: "Corrected a label" }] }
          },
          "teaching-b": {
            page_state_id: "teaching-b",
            deck_id: "deck-b",
            page_number: 1,
            text: "Second deck",
            revision: { errata: [] }
          }
        },
        revision_mapping: {
          page_states: [
            {
              recorded_page_state_id: "opaque-recorded-a",
              recorded_deck_id: "deck-a",
              recorded_page_number: 1,
              relation: "corrected",
              teaching_matcher_page_state_ids: ["opaque-teaching-matcher-a"],
              teaching_content_page_state_ids: ["teaching-a"],
              errata_ids: ["erratum-1"]
            },
            {
              recorded_page_state_id: "opaque-recorded-b",
              recorded_deck_id: "deck-b",
              recorded_page_number: 1,
              relation: "unchanged",
              teaching_matcher_page_state_ids: ["opaque-teaching-matcher-b"],
              teaching_content_page_state_ids: ["teaching-b"],
              errata_ids: []
            }
          ]
        },
        cue_timeline: {
          intervals: [
            {
              occurrence_id: "occ-1",
              state_kind: "slide",
              recorded_page_state_id: "opaque-recorded-a",
              recorded_deck_id: "deck-a",
              recorded_page_number: 1,
              equivalent_recorded_page_state_ids: ["opaque-recorded-a"],
              content_page_state_id: "teaching-a",
              teaching_matcher_page_state_ids: ["opaque-teaching-matcher-a"],
              teaching_content_page_state_ids: ["teaching-a"],
              errata_ids: ["erratum-1"],
              start_ms: 0,
              stable_at_ms: 200,
              end_ms: 1000
            },
            {
              occurrence_id: "occ-2",
              state_kind: "non_slide",
              non_slide_kind: "demo",
              start_ms: 1000,
              end_ms: 1500
            }
          ]
        }
      },
      "demo"
    );

    expect(manifest.presentation.mode).toBe("video_lecture");
    expect(manifest.revisions.teaching.decks.map((deck) => deck.pdf_url)).toEqual([
      "/a-teaching.pdf",
      "/b-teaching.pdf"
    ]);
    expect(manifest.revisions.recorded?.decks).toHaveLength(2);
    expect(pageStateIdForRevision(manifest, "opaque-recorded-a", "teaching")).toBe(
      "teaching-a"
    );
    expect(pageStateIdForRevision(manifest, "teaching-a", "recorded")).toBe(
      "opaque-recorded-a"
    );
    expect(manifest.revisions.teaching.page_states[0]?.correction?.kind).toBe("erratum");
    expect(manifest.cues[1]?.state_kind).toBe("non_slide");
  });

  it("assigns unique asset pages to legacy concatenated multi-deck PDFs", () => {
    const manifest = normalizeLectureManifest(
      {
        lecture_id: "combined",
        content_revision: "revision-combined",
        revisions: {
          teaching: {
            pdf_url: "/combined.pdf",
            page_states: [
              { id: "a-1", deck_id: "a", page: 1, text: "A" },
              { id: "b-1", deck_id: "b", page: 1, text: "B" }
            ]
          }
        }
      },
      "combined"
    );
    expect(manifest.revisions.teaching.decks).toHaveLength(1);
    expect(
      manifest.revisions.teaching.decks[0]?.page_states.map((state) => state.asset_page)
    ).toEqual([1, 2]);
  });
});

describe("assistant rendering", () => {
  it("removes executable HTML and unsafe links", () => {
    const html = renderSafeMarkdown(
      "Hello <img src=x onerror=alert(1)><script>alert(1)</script> [bad](javascript:alert(1))"
    );
    expect(html).not.toContain("script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });

  it("typesets only the already-rendered answer element when MathJax is available", async () => {
    const typesetPromise = vi.fn(async () => undefined);
    (window as Window & { MathJax?: unknown }).MathJax = { typesetPromise };
    const answer = document.createElement("div");
    answer.innerHTML = renderSafeMarkdown("Inline $x^2$");

    await typesetSafeMath(answer);

    expect(typesetPromise).toHaveBeenCalledWith([answer]);
    delete (window as Window & { MathJax?: unknown }).MathJax;
  });

  it("removes links and handlers introduced by math typesetting", async () => {
    const answer = document.createElement("div");
    const typesetPromise = vi.fn(async () => {
      answer.innerHTML =
        '<mjx-container><a data-mjx-href="javascript:window.__mathxss=1" ' +
        'href="javascript:window.__mathxss=1">CLICK</a><span onclick="alert(1)">x</span></mjx-container>';
    });
    (window as Window & { MathJax?: unknown }).MathJax = { typesetPromise };

    await typesetSafeMath(answer);

    expect(answer.querySelector("mjx-container a")).toBeNull();
    expect(answer.innerHTML).not.toContain("javascript:");
    expect(answer.innerHTML).not.toContain("onclick");
    delete (window as Window & { MathJax?: unknown }).MathJax;
  });

  it("hides only citation markers backed by structured citations", () => {
    expect(
      stripStructuredCitationMarkers(
        "See [[slide:known-slide]] and [[slide:unverified-slide]].",
        ["known-slide"]
      )
    ).toBe("See  and [[slide:unverified-slide]].");
  });
});
