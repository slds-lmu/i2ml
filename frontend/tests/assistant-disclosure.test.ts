import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LectureApp } from "../src/lecture-app";

const elementName = "i2ml-lecture-app-disclosure-test";
if (!customElements.get(elementName)) customElements.define(elementName, LectureApp);
const originalFetch = globalThis.fetch;

const manifest = {
  lecture_id: "demo",
  content_revision: "revision-1234",
  presentation: { mode: "slide_only" },
  revisions: {
    teaching: {
      page_states: [{ id: "demo-p1", deck_id: "demo-d1", page: 1, text: "Slide" }]
    }
  },
  cues: []
};

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(manifest), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  }));
});

afterEach(() => {
  document.body.replaceChildren();
  document.body.classList.remove("has-modern-lecture");
  delete window.YT;
  globalThis.fetch = originalFetch;
});

describe("assistant disclosure", () => {
  it("starts compact and exposes an ARIA-controlled non-modal region", () => {
    const lecture = document.createElement(elementName) as LectureApp;
    lecture.dataset.lectureId = "demo";
    document.body.append(lecture);
    const toggle = lecture.querySelector<HTMLButtonElement>("[data-action=toggle-assistant]")!;
    const panel = lecture.querySelector<HTMLElement>(".chat-panel")!;

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.hidden).toBe(true);
    expect(panel.hasAttribute("aria-modal")).toBe(false);
    expect(lecture.querySelector(".qa-debug-trace")).toBeNull();

    toggle.click();

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect([...lecture.querySelector(".assistant-region")!.classList]).toContain("is-expanded");
    expect(lecture.querySelector("[data-student-notice-hook]")?.textContent).toContain(
      "Student notice placeholder"
    );
    expect(lecture.querySelector(".assistant-warning")?.textContent).toContain(
      "AI-generated answers can be wrong"
    );
  });

  it("adds a collapsed trace only when the page carries the development flag", () => {
    const lecture = document.createElement(elementName) as LectureApp;
    lecture.dataset.lectureId = "demo";
    lecture.dataset.qaDebug = "true";
    document.body.append(lecture);

    const trace = lecture.querySelector<HTMLDetailsElement>(".qa-debug-trace");
    expect(trace).not.toBeNull();
    expect(trace?.open).toBe(false);
    expect(trace?.querySelector("pre")?.textContent).toBe("No trace events received.");
  });

  it("returns focus to the persistent toggle when closed", () => {
    const lecture = document.createElement(elementName) as LectureApp;
    lecture.dataset.lectureId = "demo";
    document.body.append(lecture);
    const toggle = lecture.querySelector<HTMLButtonElement>("[data-action=toggle-assistant]")!;
    toggle.click();
    const close = lecture.querySelector<HTMLButtonElement>("[data-action=close-assistant]")!;
    close.focus();

    close.click();

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(lecture.querySelector<HTMLElement>(".chat-panel")?.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });

  it("keeps slides usable when the video player fails", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      ...manifest,
      presentation: {
        mode: "video_lecture",
        provider: "youtube",
        provider_id: "blocked-video"
      }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    class FailingPlayer {
      constructor() {
        throw new Error("blocked player");
      }

      destroy = vi.fn();
      getCurrentTime = () => 0;
      getPlayerState = () => 0;
      pauseVideo = vi.fn();
      playVideo = vi.fn();
      seekTo = vi.fn();
    }
    window.YT = {
      Player: FailingPlayer,
      PlayerState: { PLAYING: 1 }
    };
    const lecture = document.createElement(elementName) as LectureApp;
    lecture.dataset.lectureId = "demo";
    lecture.dataset.fallbackVideoUrl = "https://video.example.test/demo";
    document.body.append(lecture);

    await vi.waitFor(() => {
      expect(lecture.querySelector(".structured-slide")?.textContent).toContain("Slide");
      expect(lecture.querySelector(".lecture-status")?.textContent).toContain(
        "Slides and the assistant remain available"
      );
    });
    expect(lecture.querySelector<HTMLElement>(".video-statusbar")?.hidden).toBe(true);
    expect(lecture.querySelector<HTMLElement>(".video-dock")?.hidden).toBe(true);
    expect(lecture.querySelector<HTMLAnchorElement>(".lecture-fallback a")?.href).toBe(
      "https://video.example.test/demo"
    );
  });
});
