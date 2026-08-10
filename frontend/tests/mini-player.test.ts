import { afterEach, describe, expect, it, vi } from "vitest";

import { MINI_DOCK_RATIO, MiniPlayer } from "../src/mini-player";

type IoCallback = (entries: IntersectionObserverEntry[], observer: IntersectionObserver) => void;

class CapturingObserver {
  static last: CapturingObserver | undefined;
  readonly observed: Element[] = [];

  constructor(
    readonly callback: IoCallback,
    readonly options?: IntersectionObserverInit
  ) {
    CapturingObserver.last = this;
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const originalIntersectionObserver = globalThis.IntersectionObserver;
const originalMatchMedia = globalThis.matchMedia;

function stubEnvironment(portrait: boolean): void {
  vi.stubGlobal("IntersectionObserver", CapturingObserver);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: portrait && query.includes("portrait"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  }));
}

afterEach(() => {
  vi.stubGlobal("IntersectionObserver", originalIntersectionObserver);
  vi.stubGlobal("matchMedia", originalMatchMedia);
  CapturingObserver.last = undefined;
  document.body.replaceChildren();
});

function mount(): { dock: HTMLElement; frame: HTMLElement; bar: HTMLElement; player: MiniPlayer } {
  const dock = document.createElement("div");
  const frame = document.createElement("div");
  const bar = document.createElement("div");
  bar.hidden = true;
  const expand = document.createElement("button");
  expand.dataset.action = "mini-expand";
  const close = document.createElement("button");
  close.dataset.action = "mini-close";
  bar.append(expand, close);
  frame.append(bar);
  dock.append(frame);
  document.body.append(dock);
  return { dock, frame, bar, player: new MiniPlayer(dock, frame, bar) };
}

/** Delivers an intersection callback for the observed dock at this ratio. */
function fire(ratio: number): void {
  const observer = CapturingObserver.last!;
  observer.callback(
    [{ intersectionRatio: ratio } as IntersectionObserverEntry],
    observer as unknown as IntersectionObserver
  );
}

describe("MiniPlayer — midpoint docking threshold", () => {
  it("observes the dock at the midpoint ratio and docks exactly when it is crossed", () => {
    stubEnvironment(true);
    const { dock, frame, bar, player } = mount();
    const observer = CapturingObserver.last!;
    expect(observer.options?.threshold).toEqual([MINI_DOCK_RATIO]);
    expect(observer.observed).toEqual([dock]);

    // More than half visible: stays inline.
    fire(0.51);
    expect(frame.classList.contains("is-docked")).toBe(false);

    // The midpoint scrolled out: floats.
    fire(0.49);
    expect(frame.classList.contains("is-docked")).toBe(true);
    expect(bar.hidden).toBe(false);

    // Back over the midpoint — the same point in the other direction.
    fire(0.51);
    expect(frame.classList.contains("is-docked")).toBe(false);
    expect(bar.hidden).toBe(true);
    player.destroy();
  });

  it("a dismissal holds until the midpoint is visible again", () => {
    stubEnvironment(true);
    const { frame, bar, player } = mount();
    fire(0.2);
    expect(frame.classList.contains("is-docked")).toBe(true);
    bar.querySelector<HTMLButtonElement>("[data-action=mini-close]")!.click();
    expect(frame.classList.contains("is-docked")).toBe(false);

    // Still past the midpoint: stays dismissed.
    fire(0.3);
    expect(frame.classList.contains("is-docked")).toBe(false);

    // Midpoint visible again re-arms the mini-player.
    fire(0.6);
    fire(0.3);
    expect(frame.classList.contains("is-docked")).toBe(true);
    player.destroy();
  });

  it("never docks outside the portrait layout", () => {
    stubEnvironment(false);
    const { frame, player } = mount();
    fire(0);
    expect(frame.classList.contains("is-docked")).toBe(false);
    player.destroy();
  });
});
