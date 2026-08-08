import { describe, expect, it } from "vitest";

import { SyncState } from "../src/sync-state";

describe("Follow / Explore state", () => {
  it("manual intent suspends following", () => {
    const state = new SyncState();
    state.manualIntent();
    expect(state.mode).toBe("explore");
    state.follow();
    expect(state.mode).toBe("follow");
  });

  it("programmatic scrolling does not look like exploration", async () => {
    const state = new SyncState();
    state.withProgrammaticScroll(() => state.manualIntent());
    expect(state.mode).toBe("follow");
    await Promise.resolve();
    state.manualIntent();
    expect(state.mode).toBe("explore");
  });

  it("clears the active slide for an explicit non-slide interval", () => {
    const state = new SyncState();
    state.activatePage("slide-1");
    state.activateNonSlide("title_card");
    expect(state.activePageStateId).toBeUndefined();
    expect(state.activeNonSlideKind).toBe("title_card");
    state.activatePage("slide-2");
    expect(state.activeNonSlideKind).toBeUndefined();
  });
});
