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
    slide.scrollIntoView = vi.fn();
    input.focus();

    viewer.scrollTo("slide-1", "auto");

    expect(document.activeElement).toBe(input);
    expect(slide.scrollIntoView).toHaveBeenCalledOnce();
    viewer.scrollTo("slide-1", "auto", true);
    expect(document.activeElement).toBe(slide);
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
