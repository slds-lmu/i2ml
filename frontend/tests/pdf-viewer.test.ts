import { afterEach, describe, expect, it, vi } from "vitest";

import { PdfViewer } from "../src/pdf-viewer";
import type { PageState } from "../src/types";

afterEach(() => document.body.replaceChildren());

describe("PDF viewer navigation", () => {
  it("does not steal focus during automatic follow scrolling", async () => {
    const input = document.createElement("input");
    const container = document.createElement("div");
    document.body.append(input, container);
    const state: PageState = {
      id: "slide-1",
      deck_id: "deck-1",
      page: 1,
      text: "Slide one",
      revision: "teaching",
      aliases: [],
      recorded_page_state_ids: [],
      teaching_page_state_ids: []
    };
    const viewer = new PdfViewer(container, () => undefined);
    await viewer.load(undefined, [state]);
    const slide = container.querySelector<HTMLElement>("[data-page-state-id=slide-1]")!;
    const scrollSpy = vi.fn();
    (container as HTMLElement & { scrollTo(options: ScrollToOptions): void }).scrollTo = scrollSpy;
    input.focus();

    viewer.scrollTo("slide-1", "auto");

    expect(document.activeElement).toBe(input);
    // Scrolling targets only the strip container, never the page.
    expect(scrollSpy).toHaveBeenCalledOnce();
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
    viewer.scrollTo("slide-1", "auto", true);
    expect(document.activeElement).toBe(slide);
    viewer.destroy();
  });

  it("numbers the strip, badges revised slides, and moves the video-current chip", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const states: PageState[] = [1, 2].map((page) => ({
      id: `slide-${page}`,
      deck_id: "deck-1",
      page,
      text: `Slide ${page}`,
      revision: "teaching",
      aliases: [],
      recorded_page_state_ids: [],
      teaching_page_state_ids: []
    }));
    const viewer = new PdfViewer(container, () => undefined);
    await viewer.load(undefined, states);

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
    viewer.destroy();
  });

  it("associates a reviewed long description with its slide", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const state: PageState = {
      id: "described-slide",
      deck_id: "deck-1",
      page: 1,
      text: "A chart",
      long_description: "The chart rises steadily from left to right.",
      revision: "teaching",
      aliases: [],
      recorded_page_state_ids: [],
      teaching_page_state_ids: []
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
