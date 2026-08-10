import { afterEach, describe, expect, it, vi } from "vitest";

import { PdfViewer, STRIP_TOP_GAP } from "../src/pdf-viewer";
import type { PageState } from "../src/types";

afterEach(() => document.body.replaceChildren());

function makeState(page: number, id = `slide-${page}`): PageState {
  return {
    id,
    deck_id: "deck-1",
    page,
    text: `Slide ${page}`,
    revision: "teaching",
    aliases: [],
    recorded_page_state_ids: [],
    teaching_page_state_ids: []
  };
}

function stubRect(element: HTMLElement, rect: Partial<DOMRect>): void {
  element.getBoundingClientRect = () =>
    ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, ...rect }) as DOMRect;
}

describe("PDF viewer strip", () => {
  it("scrolls only the strip container to the top position, without stealing focus", async () => {
    const input = document.createElement("input");
    const container = document.createElement("div");
    document.body.append(input, container);
    const viewer = new PdfViewer(container, () => undefined);
    await viewer.load(undefined, [makeState(1)]);
    const slide = container.querySelector<HTMLElement>("[data-page-state-id=slide-1]")!;
    let scrollTop = 0;
    Object.defineProperty(container, "scrollTop", {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
      configurable: true
    });
    stubRect(container, { top: 0, bottom: 300, height: 300 });
    stubRect(slide, { top: 200, bottom: 400, height: 200 });
    Object.defineProperty(container, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 300, configurable: true });
    input.focus();

    await viewer.scrollToTopPosition("slide-1", "instant");

    expect(document.activeElement).toBe(input);
    // scrollTop 0 + (200 - 0) - gap → the slide's top sits at the top position.
    expect(container.scrollTop).toBe(200 - STRIP_TOP_GAP);
    viewer.focusSlide("slide-1");
    expect(document.activeElement).toBe(slide);
    viewer.destroy();
  });

  it("reports lower-half visibility and top-position distance", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const viewer = new PdfViewer(container, () => undefined);
    await viewer.load(undefined, [makeState(1)]);
    const slide = container.querySelector<HTMLElement>("[data-page-state-id=slide-1]")!;
    stubRect(container, { top: 0, bottom: 300, height: 300 });
    Object.defineProperty(container, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 300, configurable: true });

    // Lower half [250, 350], visible up to 300 → half visible.
    stubRect(slide, { top: 150, bottom: 350, height: 200 });
    expect(viewer.lowerHalfVisibleFraction("slide-1")).toBeCloseTo(0.5);

    // Entirely above the viewport → nothing of the lower half visible.
    stubRect(slide, { top: -400, bottom: -200, height: 200 });
    expect(viewer.lowerHalfVisibleFraction("slide-1")).toBe(0);

    // Midpoint below the viewport bottom → scrolled up too far.
    stubRect(slide, { top: 250, bottom: 450, height: 200 });
    expect(viewer.lowerHalfVisibleFraction("slide-1")).toBe(0);

    // Fully visible lower half.
    stubRect(slide, { top: 50, bottom: 250, height: 200 });
    expect(viewer.lowerHalfVisibleFraction("slide-1")).toBe(1);

    // Distance: slide top at 50 → target = scrollTop + 50 - gap; distance = -target.
    expect(viewer.distanceFromTopPosition("slide-1")).toBeCloseTo(-(50 - STRIP_TOP_GAP));
    viewer.destroy();
  });

  it("selects a slide already on pointer-down (and on Enter), not via other buttons", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const selected: string[] = [];
    const viewer = new PdfViewer(container, (state) => selected.push(state.id));
    await viewer.load(undefined, [makeState(1), makeState(2)]);
    const first = container.querySelector<HTMLElement>("[data-page-state-id=slide-1]")!;
    const second = container.querySelector<HTMLElement>("[data-page-state-id=slide-2]")!;

    // Pointer-down selects immediately — so starting a text selection on a
    // different slide selects that slide too.
    first.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(selected).toEqual(["slide-1"]);
    second
      .querySelector(".structured-slide-surface p")!
      .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(selected).toEqual(["slide-1", "slide-2"]);

    // Secondary buttons (context menu) do not select.
    first.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 2 }));
    expect(selected).toEqual(["slide-1", "slide-2"]);

    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(selected).toEqual(["slide-1", "slide-2", "slide-1"]);

    // Touch pointer-downs start scroll gestures and must NOT select; the
    // tap's click (which a scroll never produces) selects instead.
    const touchDown = new MouseEvent("pointerdown", { bubbles: true, button: 0 });
    Object.defineProperty(touchDown, "pointerType", { value: "touch" });
    second.dispatchEvent(touchDown);
    expect(selected).toEqual(["slide-1", "slide-2", "slide-1"]);
    second.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(selected).toEqual(["slide-1", "slide-2", "slide-1", "slide-2"]);
    viewer.destroy();
  });

  it("floats the play pill on the requested slide; its click plays, never selects", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const selected: string[] = [];
    const played: string[] = [];
    const viewer = new PdfViewer(
      container,
      (state) => selected.push(state.id),
      (state) => played.push(state.id)
    );
    await viewer.load(undefined, [makeState(1), makeState(2)]);
    const first = container.querySelector<HTMLElement>("[data-page-state-id=slide-1]")!;
    const second = container.querySelector<HTMLElement>("[data-page-state-id=slide-2]")!;

    // Never shown until requested.
    expect(container.querySelector(".slide-play-cta")).toBeNull();

    viewer.setPlayCta("slide-1");
    const pill = first.querySelector<HTMLButtonElement>(".slide-play-cta")!;
    expect(pill.textContent).toContain("Play from start of this slide");
    expect(pill.disabled).toBe(false);

    // The pill is a button inside a selectable slide: the button guard in the
    // selection handlers keeps its pointer-down/click from (re)selecting.
    pill.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    pill.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(selected).toEqual([]);
    expect(played).toEqual(["slide-1"]);

    // It moves between slides; a slide without a video occurrence gets a
    // disabled pill whose click does not fire.
    viewer.setPlayCta("slide-2", { disabled: true });
    expect(first.querySelector(".slide-play-cta")).toBeNull();
    const moved = second.querySelector<HTMLButtonElement>(".slide-play-cta")!;
    expect(moved.disabled).toBe(true);
    expect(moved.title).toBe("This slide has no video occurrence.");
    moved.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(played).toEqual(["slide-1"]);

    viewer.setPlayCta(undefined);
    expect(container.querySelector(".slide-play-cta")).toBeNull();
    viewer.destroy();
  });

  it("numbers the strip, badges revised slides, and moves the video-current chip", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const viewer = new PdfViewer(container, () => undefined);
    await viewer.load(undefined, [makeState(1), makeState(2)]);

    const numbers = [...container.querySelectorAll(".slide-page-num")].map(
      (label) => label.textContent
    );
    expect(numbers).toEqual(["1 / 2", "2 / 2"]);

    viewer.setRevisionBadges(new Set(["slide-2"]), "revised after recording");
    expect(
      container.querySelector("[data-page-state-id=slide-2] .slide-revision-badge")?.textContent
    ).toBe("revised after recording");
    expect(container.querySelectorAll(".slide-revision-badge")).toHaveLength(1);
    viewer.setRevisionBadges(new Set(), "revised after recording");
    expect(container.querySelectorAll(".slide-revision-badge")).toHaveLength(0);

    viewer.setVideoCurrent("slide-1", "Current · 12:07");
    const first = container.querySelector<HTMLElement>("[data-page-state-id=slide-1]")!;
    expect([...first.classList]).toContain("is-video-current");
    expect(first.querySelector(".slide-current-chip")?.textContent).toBe("Current · 12:07");
    viewer.setVideoCurrent("slide-2", "Current · 15:30");
    expect(first.querySelector(".slide-current-chip")).toBeNull();
    expect(
      container.querySelector("[data-page-state-id=slide-2] .slide-current-chip")?.textContent
    ).toBe("Current · 15:30");
    viewer.setVideoCurrent(undefined);
    expect(container.querySelector(".slide-current-chip")).toBeNull();

    // Selected and video-current are independent decorations.
    viewer.setActive("slide-2");
    viewer.setVideoCurrent("slide-1", "Current");
    const second = container.querySelector<HTMLElement>("[data-page-state-id=slide-2]")!;
    expect([...second.classList]).toContain("is-active");
    expect([...first.classList]).toContain("is-video-current");
    expect([...second.classList]).not.toContain("is-video-current");
    viewer.destroy();
  });

  it("associates a reviewed long description with its slide", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const state: PageState = {
      ...makeState(1, "described-slide"),
      text: "A chart",
      long_description: "The chart rises steadily from left to right."
    };
    const viewer = new PdfViewer(container, () => undefined);

    await viewer.load(undefined, [state]);

    const slide = container.querySelector<HTMLElement>("[data-page-state-id=described-slide]")!;
    const descriptionId = slide.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toBe(
      "The chart rises steadily from left to right."
    );
    viewer.destroy();
  });
});

/**
 * Models a real scroller in jsdom: a settable scrollTop and slide rects that
 * move with it, laid out like the strip (STRIP_TOP_GAP of top padding, half
 * of it between slides).
 */
function stubScroller(
  container: HTMLElement,
  heights: number[],
  metrics: { clientHeight: number; scrollHeight: number }
): void {
  let scrollTop = 0;
  Object.defineProperty(container, "scrollTop", {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
    configurable: true
  });
  Object.defineProperty(container, "clientHeight", {
    value: metrics.clientHeight,
    configurable: true
  });
  Object.defineProperty(container, "scrollHeight", {
    value: metrics.scrollHeight,
    configurable: true
  });
  container.getBoundingClientRect = () =>
    ({ top: 0, bottom: metrics.clientHeight, height: metrics.clientHeight } as DOMRect);
  const sections = [...container.querySelectorAll<HTMLElement>(".structured-slide, .pdf-page")];
  let top = STRIP_TOP_GAP;
  for (const [index, section] of sections.entries()) {
    const contentTop = top;
    const height = heights[index] ?? heights.at(-1) ?? 200;
    section.getBoundingClientRect = () =>
      ({
        top: contentTop - container.scrollTop,
        bottom: contentTop + height - container.scrollTop,
        height
      } as DOMRect);
    top = contentTop + height + STRIP_TOP_GAP / 2;
  }
}

describe("PDF viewer strip anchor (revision-switch scroll preservation)", () => {
  const states = [makeState(1), makeState(2), makeState(3)];

  async function makeStrip(heights: number[], scrollHeight = 1000) {
    const container = document.createElement("div");
    document.body.append(container);
    const viewer = new PdfViewer(container, () => undefined);
    await viewer.load(undefined, states);
    stubScroller(container, heights, { clientHeight: 300, scrollHeight });
    return { container, viewer };
  }

  it("captures the slide and height fraction the top-position line goes through", async () => {
    const { container, viewer } = await makeStrip([200, 200, 200]);
    // Layout: slide tops at 16 / 224 / 448 (gap 8).

    container.scrollTop = 300; // line at 316 → inside slide 2
    expect(viewer.captureStripAnchor()).toMatchObject({
      stateId: "slide-2",
      stripIndex: 1,
      fraction: (316 - 224) / 200
    });

    // In the gap above slide 2: anchored to slide 2 with a small negative fraction.
    container.scrollTop = 202; // line at 218; slide 1 ends at 216, slide 2 starts at 224
    expect(viewer.captureStripAnchor()).toMatchObject({
      stateId: "slide-2",
      stripIndex: 1,
      fraction: (218 - 224) / 200
    });

    // In the tail spacer: anchored past the end of the last slide.
    container.scrollTop = 660; // line at 676; slide 3 ends at 648
    const tail = viewer.captureStripAnchor()!;
    expect(tail.stateId).toBe("slide-3");
    expect(tail.fraction).toBeGreaterThan(1);
    viewer.destroy();
  });

  it("captures at the target of an in-flight animation, not mid-flight", async () => {
    const { viewer } = await makeStrip([200, 200, 200]);
    const frames: FrameRequestCallback[] = [];
    // Restore rAF specifically afterwards — unstubAllGlobals would also drop
    // the observer stubs from tests/setup.ts for every later test.
    const originalRaf = globalThis.requestAnimationFrame;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    try {
      // Animation toward slide 3's top position (448 - 16 = 432); no frames
      // run, so the live scrollTop stays at 0.
      void viewer.scrollToTopPosition("slide-3", "smooth");
      expect(viewer.captureStripAnchor()).toMatchObject({
        stateId: "slide-3",
        stripIndex: 2,
        fraction: 0
      });

      // The user takes over: the anchor reads the live position again.
      viewer.cancelProgrammaticScroll();
      expect(viewer.captureStripAnchor()).toMatchObject({ stateId: "slide-1", fraction: 0 });
    } finally {
      vi.stubGlobal("requestAnimationFrame", originalRaf);
    }
    viewer.destroy();
  });

  it("restores the same slide and fraction against different slide heights", async () => {
    const { container, viewer } = await makeStrip([200, 200, 200]);
    container.scrollTop = 300;
    const anchor = viewer.captureStripAnchor()!;
    expect(anchor.fraction).toBeCloseTo(0.46);

    // Reload (the other revision, 4:3 → 16:9): slides are 300px tall now,
    // slide tops at 16 / 324 / 632.
    await viewer.load(undefined, states);
    stubScroller(container, [300, 300, 300], { clientHeight: 300, scrollHeight: 2000 });
    await viewer.restoreStripAnchor(anchor);
    expect(container.scrollTop).toBeCloseTo(324 + 0.46 * 300 - STRIP_TOP_GAP);

    // Fraction 0 restores the exact top position (stuck-slide pinning).
    await viewer.restoreStripAnchor({ stateId: "slide-2", stripIndex: 1, fraction: 0 });
    expect(container.scrollTop).toBe(324 - STRIP_TOP_GAP);
    expect(viewer.distanceFromTopPosition("slide-2")).toBe(0);

    // Unmapped id: the strip index is the fallback.
    await viewer.restoreStripAnchor({ stateId: undefined, stripIndex: 1, fraction: 0.5 });
    expect(container.scrollTop).toBeCloseTo(324 + 150 - STRIP_TOP_GAP);
    viewer.destroy();
  });

  it("lets a user scroll during the restore win over the final placement", async () => {
    const { container, viewer } = await makeStrip([200, 200, 200]);
    const restore = viewer.restoreStripAnchor({ stateId: "slide-2", stripIndex: 1, fraction: 0 });
    // The rough placement happened synchronously; the user grabs the strip
    // before the render-settled re-placement.
    expect(container.scrollTop).toBe(224 - STRIP_TOP_GAP);
    viewer.cancelProgrammaticScroll();
    container.scrollTop = 999;
    await restore;
    expect(container.scrollTop).toBe(999);
    viewer.destroy();
  });
});
