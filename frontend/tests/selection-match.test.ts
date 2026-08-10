import { describe, expect, it } from "vitest";

import { matchSelectionToSlideText } from "../src/selection-match";

const MINED =
  "Linear Regression: Hypothesis Space\n" +
  "We model the target as a linear combination of the features.\n" +
  "The L2 loss penalizes the squared error quadratically.";

describe("matching selections onto mined slide text", () => {
  it("returns the exact mined substring for an exact selection", () => {
    expect(matchSelectionToSlideText("linear combination of the features", MINED)).toBe(
      "linear combination of the features"
    );
  });

  it("bridges PDF text-layer spacing and punctuation artifacts", () => {
    // pdf.js often splits glyph runs ("L 2") and drops/mangles punctuation.
    expect(matchSelectionToSlideText("The L 2 loss penalizes the squared", MINED)).toBe(
      "The L2 loss penalizes the squared"
    );
    expect(
      matchSelectionToSlideText("model the target as a linear-combination", MINED)
    ).toContain("model the target as a linear combination");
  });

  it("is case-insensitive but returns the mined text's own casing", () => {
    expect(matchSelectionToSlideText("HYPOTHESIS SPACE", MINED)).toBe("Hypothesis Space");
  });

  it("tolerates small wording differences between revisions", () => {
    // e.g. the recorded slide said "penalises", the corrected one "penalizes".
    const matched = matchSelectionToSlideText(
      "the L2 loss penalises the squared error quadratically",
      MINED
    );
    expect(matched).toBeTruthy();
    expect(matched).toContain("squared error quadratically");
  });

  it("rejects selections that mostly do not appear on the slide", () => {
    expect(
      matchSelectionToSlideText("gradient descent minimises the empirical risk", MINED)
    ).toBeUndefined();
    expect(matchSelectionToSlideText("xy", MINED)).toBeUndefined();
    expect(matchSelectionToSlideText("anything", "")).toBeUndefined();
  });
});
