import { expect, test, type Page } from "@playwright/test";

const manifest = {
  lecture_id: "demo",
  title: "Demo",
  content_revision: "revision-1234",
  presentation: { mode: "slide_only" },
  revisions: {
    teaching: {
      decks: [
        {
          deck_id: "demo-d1",
          order: 1,
          download_url: "/slides.pdf"
        }
      ],
      page_states: [
        { id: "demo-p1", deck_id: "demo-d1", page: 1, text: "Selectable slide text" },
        { id: "demo-p2", deck_id: "demo-d1", page: 2, text: "Second slide" }
      ]
    }
  },
  cues: []
};

// Long filler makes each structured slide tall enough that the strip really
// scrolls, like rendered PDF pages do.
const filler = Array.from({ length: 60 }, () => "Additional derivation details continue here.").join(" ");

const videoManifest = {
  lecture_id: "videodemo",
  title: "Video Demo",
  content_revision: "revision-video-1",
  presentation: { mode: "video_lecture", provider: "youtube", provider_id: "fake-video" },
  revisions: {
    teaching: {
      page_states: [
        {
          id: "t-1",
          deck_id: "d1",
          page: 1,
          text: `## Intro to Losses\n\nWhy losses matter for learning. ${filler}`
        },
        {
          id: "t-2",
          deck_id: "d1",
          page: 2,
          text: `## L2 Loss defined\n\nThe squared error penalises residuals quadratically. ${filler}`
        }
      ]
    }
  },
  cues: [
    { start_ms: 0, stable_at_ms: 100, end_ms: 5000, state_kind: "slide", page_state_id: "t-1" },
    { start_ms: 5000, end_ms: 9000, state_kind: "non_slide", non_slide_kind: "interlude" },
    { start_ms: 9000, stable_at_ms: 9100, end_ms: 30_000, state_kind: "slide", page_state_id: "t-2" }
  ]
};

async function stubYouTube(page: Page): Promise<void> {
  await page.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
        window.YT = {
          PlayerState: { PLAYING: 1 },
          Player: class {
            constructor(element, options) {
              this.time = 0;
              this.duration = 1985;
              this.state = 2;
              this.options = options;
              const iframe = document.createElement("iframe");
              iframe.title = "Fake YouTube player";
              element.append(iframe);
              window.__ytPlayer = this;
              setTimeout(() => options.events.onReady(), 0);
            }
            destroy() {}
            getCurrentTime() { return this.time; }
            getDuration() { return this.duration; }
            getPlayerState() { return this.state; }
            pauseVideo() { this.state = 2; this.options.events.onStateChange({ data: 2 }); }
            playVideo() { this.state = 1; this.options.events.onStateChange({ data: 1 }); }
            seekTo(seconds) {
              this.time = seconds;
              window.__seeks = [...(window.__seeks || []), seconds];
            }
          }
        };
        setTimeout(() => window.onYouTubeIframeAPIReady?.(), 0);
      `
    })
  );
}

async function mountLecture(page: Page, lectureId: string, qaDebug = false): Promise<void> {
  await page.evaluate(
    async ({ id, debug }) => {
      document.querySelectorAll("i2ml-lecture-app").forEach((element) => element.remove());
      await customElements.whenDefined("i2ml-lecture-app");
      const lecture = document.createElement("i2ml-lecture-app");
      lecture.dataset.lectureId = id;
      if (debug) lecture.dataset.qaDebug = "true";
      document.body.append(lecture);
    },
    { id: lectureId, debug: qaDebug }
  );
}

async function waitForPlayer(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __ytPlayer?: unknown }).__ytPlayer)
  );
}

async function playVideoAt(page: Page, seconds: number): Promise<void> {
  await waitForPlayer(page);
  await page.evaluate((time) => {
    const player = (window as unknown as {
      __ytPlayer: { time: number; playVideo(): void };
    }).__ytPlayer;
    player.time = time;
    player.playVideo();
  }, seconds);
}

test.beforeEach(async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/v1/lectures/demo", (route) => route.fulfill({ json: manifest }));
  await page.route("**/api/v1/lectures/videodemo", (route) =>
    route.fulfill({ json: videoManifest })
  );
  await stubYouTube(page);
  // Instant scrolling keeps IntersectionObserver-driven assertions deterministic.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.setContent(`
    <!doctype html><html><head>
      <link rel="stylesheet" href="http://127.0.0.1:4173/lecture/lecture-app.css">
    </head><body></body></html>`);
  await page.addScriptTag({
    type: "module",
    url: "http://127.0.0.1:4173/lecture/lecture-app.js"
  });
  await mountLecture(page, "demo");
  // Surface custom-element upgrade failures in the test output instead of timing out opaquely.
  expect(pageErrors).toEqual([]);
});

test("slide-only lecture is keyboard accessible and has no video player", async ({ page }) => {
  await expect(page.getByRole("region", { name: "Synchronized lecture" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Updated slides" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.getByLabel("Scrollable slides")).toContainText("Selectable slide text");
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator(".video-statusbar")).toBeHidden();
  await expect(page.locator(".play-from-slide")).toBeHidden();
  await expect(page.locator(".qa-debug-trace")).toHaveCount(0);
  await expect(page.locator(".slide-page-num").first()).toHaveText("1 / 2");
  await page.getByLabel("Scrollable slides").focus();
  await expect(page.getByLabel("Scrollable slides")).toBeFocused();
});

test("development QA trace is collapsed, ordered, and tolerates malformed events", async ({
  page
}) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/v1/chat/stream", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "text/event-stream",
      body:
        "event: debug_trace\ndata: {malformed}\n\n" +
        "event: debug_trace\ndata: {\"sequence\":2,\"phase\":\"provider_response\",\"label\":\"provider reasoning\",\"content\":\"Reasoning text\"}\n\n" +
        "event: debug_trace\ndata: {\"sequence\":1,\"phase\":\"prompt\",\"label\":\"system message\",\"content\":\"System text\"}\n\n" +
        "event: delta\ndata: {\"text\":\"Answer\"}\n\n" +
        "event: final\ndata: {\"answer_markdown\":\"Answer\",\"citations\":[],\"conversation_id\":\"debug-c1\"}\n\n"
    });
  });
  await mountLecture(page, "demo", true);
  await expect(page.getByLabel("Scrollable slides")).toContainText("Selectable slide text");
  await page.getByRole("button", { name: "Ask about this lecture" }).click();

  const trace = page.locator(".qa-debug-trace");
  await expect(trace).not.toHaveAttribute("open", "");
  await page.getByLabel("Question").fill("Show the trace.");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(trace.locator("summary")).toContainText("2 events");
  await expect(trace.locator("pre")).toHaveText(
    "[001] prompt — system message\nSystem text\n\n" +
    "[002] provider_response — provider reasoning\nReasoning text"
  );
  expect(submitted).toMatchObject({ debug: true, question: "Show the trace." });
});

test("assistant sheet is compact, keyboard operable, and returns focus", async ({ page }) => {
  const panel = page.locator(".chat-panel");
  const toggle = page.locator("[data-action=toggle-assistant]");
  await expect(toggle).toContainText("Ask about this lecture");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-controls", await panel.getAttribute("id") as string);

  await toggle.focus();
  await toggle.press("Enter");

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("complementary", { name: "Lecture assistant" })).toBeVisible();
  await expect(page.getByText("AI-generated answers can be wrong")).toBeVisible();
  await expect(page.getByText("Student notice placeholder.")).toBeVisible();
  expect(await panel.getAttribute("aria-modal")).toBeNull();
  const viewport = page.viewportSize();
  expect((await panel.boundingBox())?.width).toBeLessThanOrEqual(viewport?.width ?? 9999);
  await expect(page.getByLabel("Question")).toBeFocused();

  const close = panel.getByRole("button", { name: "Close assistant" });
  await close.focus();
  await close.press("Space");
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await expect(page.getByRole("tab", { name: "Updated slides" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
});

test("print retains slides and downloads but hides interactive media and assistant controls", async ({
  page
}) => {
  await page.getByRole("button", { name: "Ask about this lecture" }).click();
  await page.emulateMedia({ media: "print" });

  await expect(page.getByLabel("Lecture media")).toBeHidden();
  await expect(page.locator(".assistant-region .chat-panel")).toBeHidden();
  await expect(page.getByRole("tablist", { name: "Slide revision" })).toBeHidden();
  await expect(page.getByLabel("Scrollable slides")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download slides (PDF)" })).toBeVisible();
});

test("video lecture follows the recording and pauses on manual browsing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "videodemo");
  await waitForPlayer(page);
  const pill = page.locator(".follow-pill");
  await expect(pill).toHaveAttribute("data-follow-state", "following");
  await expect(page.locator(".video-time")).toContainText("/ 33:05");
  await expect(page.locator(".slide-current-chip")).toHaveText("Current · 0:00");

  await playVideoAt(page, 10);
  await expect(page.locator(".now-viewing")).toContainText("Slide 2 — L2 Loss defined");
  await expect(page.locator("[data-page-state-id=t-2]")).toHaveClass(/is-active/);
  await expect(page.locator(".slide-current-chip")).toHaveText("Current · 0:09");
  await expect(page.locator("[data-page-state-id=t-2] .slide-current-chip")).toHaveCount(1);

  await page.locator(".slide-scroll").dispatchEvent("wheel");
  await expect(pill).toHaveAttribute("data-follow-state", "paused");
  await expect(pill.getByRole("button", { name: "Resume following" })).toBeVisible();
  await page.locator(".slide-scroll").evaluate((strip) => {
    strip.scrollTop = 0;
  });
  await expect(page.locator(".now-viewing")).toContainText("Video: slide 2");
  await expect(page.locator(".now-viewing")).toContainText("viewing slide 1");

  await pill.getByRole("button", { name: "Resume following" }).click();
  await expect(pill).toHaveAttribute("data-follow-state", "following");
  await expect(page.locator("[data-page-state-id=t-2]")).toHaveClass(/is-active/);

  await page.locator(".slide-scroll").dispatchEvent("wheel");
  await page.locator(".slide-scroll").evaluate((strip) => {
    strip.scrollTop = 0;
  });
  await expect(page.locator("[data-page-state-id=t-1]")).toHaveClass(/is-active/);
  await page.getByRole("button", { name: "Play video from this slide" }).click();
  await expect(pill).toHaveAttribute("data-follow-state", "following");
  const seeks = await page.evaluate(() => (window as unknown as { __seeks: number[] }).__seeks);
  expect(seeks.at(-1)).toBeCloseTo(0.1, 5);
});

test("video segments without slides are labelled instead of forcing a slide", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "videodemo");
  await playVideoAt(page, 6);
  await expect(page.locator(".now-viewing")).toContainText("interlude (no slide)");
  await expect(page.locator(".slide-current-chip")).toHaveCount(0);
  await expect(page.locator(".pdf-page.is-active, .structured-slide.is-active")).toHaveCount(0);
});

test("slide list drawer shows numbered titles with times and jumps to slides", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "videodemo");
  await playVideoAt(page, 10);
  await expect(page.locator(".now-viewing")).toContainText("Slide 2");

  const toggle = page.getByRole("button", { name: "Slides", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".toc-title")).toHaveText("All slides (2)");
  const rows = page.locator(".toc-list button");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("1 · Intro to Losses");
  await expect(rows.nth(0)).toContainText("0:00");
  await expect(rows.nth(1)).toContainText("2 · L2 Loss defined");
  await expect(rows.nth(1)).toContainText("0:09");
  await expect(rows.nth(1)).toContainText("— video");

  // The drawer focuses its first row; Escape closes and returns to the toggle.
  await expect(rows.nth(0)).toBeFocused();
  await rows.nth(0).press("Escape");
  await expect(page.locator(".toc-drawer")).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await rows.nth(0).click();
  await expect(page.locator(".follow-pill")).toHaveAttribute("data-follow-state", "paused");
  await expect(rows.nth(0)).toContainText("— viewing");
  await expect(page.locator("[data-page-state-id=t-1]")).toHaveClass(/is-active/);
  await page.getByRole("button", { name: "Close the slide list" }).click();
  await expect(page.locator(".toc-drawer")).toBeHidden();
});

test("slide search jumps to matches and reports empty results", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "videodemo");
  const input = page.getByLabel("Search in slides");
  await input.fill("squared error");
  const results = page.locator(".search-results button");
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText("2 · L2 Loss defined");
  await results.first().click();
  await expect(page.locator("[data-page-state-id=t-2]")).toHaveClass(/is-active/);
  await expect(page.locator(".follow-pill")).toHaveAttribute("data-follow-state", "paused");

  await input.fill("zzzunmatchable");
  await expect(page.locator(".search-empty")).toContainText("No slides match");
});

test("selecting slide text offers Ask about this and quotes it in the question", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/v1/chat/stream", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "text/event-stream",
      body:
        "event: delta\ndata: {\"text\":\"Answer about the selection.\"}\n\n" +
        "event: final\ndata: {\"answer_markdown\":\"Answer about the selection.\"," +
        "\"citations\":[{\"slide_id\":\"t-2\",\"label\":\"Slide 2\"}]," +
        "\"conversation_id\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}\n\n"
    });
  });
  await mountLecture(page, "videodemo");
  await expect(page.locator("[data-page-state-id=t-2]")).toBeVisible();
  await page.evaluate(() => {
    const slide = document.querySelector("[data-page-state-id=t-2] p");
    const range = document.createRange();
    range.selectNodeContents(slide!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const popover = page.locator(".selection-popover");
  await expect(popover).toBeVisible();
  await expect(popover.getByRole("button", { name: "Copy text" })).toBeVisible();
  await popover.getByRole("button", { name: "Ask about this" }).click();

  await expect(page.locator(".chat-panel")).toBeVisible();
  await expect(page.locator(".selection-chip")).toContainText("Slide 2");
  await expect(page.locator(".selection-chip")).toContainText("squared error");
  await page.getByLabel("Question").fill("Explain this in simple terms.");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  await expect(page.locator(".chat-message.is-user .chat-quoted-selection")).toContainText(
    "squared error"
  );
  await expect(page.locator(".chat-message.is-assistant")).toContainText(
    "Answer about the selection."
  );
  expect(submitted?.selection).toMatchObject({ page_state_id: "t-2" });
  expect(submitted?.page_state_ids).toContain("t-2");

  const citationTime = page.getByRole("button", { name: "▶ 0:09 in video" });
  await expect(citationTime).toBeVisible();
  await citationTime.click();
  const seeks = await page.evaluate(() => (window as unknown as { __seeks: number[] }).__seeks);
  expect(seeks.at(-1)).toBeCloseTo(9.1, 5);
  await expect(page.locator(".follow-pill")).toHaveAttribute("data-follow-state", "following");
});

test("assistant conversations persist in the browser and can be exported", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/api/v1/chat/stream", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body:
        "event: delta\ndata: {\"text\":\"Stored answer.\"}\n\n" +
        "event: final\ndata: {\"answer_markdown\":\"Stored answer.\",\"citations\":[]," +
        "\"conversation_id\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"}\n\n"
    })
  );
  await mountLecture(page, "videodemo");
  await page.getByRole("button", { name: "Ask about this lecture" }).click();
  await page.getByLabel("Question").fill("Will this persist?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".chat-message.is-assistant")).toContainText("Stored answer.");

  // Remount the app (as after a page reload) and restore from Past conversations.
  await mountLecture(page, "videodemo");
  await page.getByRole("button", { name: "Ask about this lecture" }).click();
  await expect(page.locator(".chat-message")).toHaveCount(0);
  await page.getByRole("button", { name: "Assistant options" }).click();
  await page.getByRole("button", { name: "Past conversations…" }).click();
  const stored = page.locator(".conversation-open");
  await expect(stored).toHaveCount(1);
  await expect(stored).toContainText("Will this persist?");
  await stored.click();
  await expect(page.locator(".chat-message.is-user")).toContainText("Will this persist?");
  await expect(page.locator(".chat-message.is-assistant")).toContainText("Stored answer.");

  await page.evaluate(() => {
    (window as unknown as { __downloads: unknown[] }).__downloads = [];
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      (window as unknown as { __downloads: { name: string; href: string }[] }).__downloads.push({
        name: this.download,
        href: this.href
      });
    };
  });
  await page.getByRole("button", { name: "Assistant options" }).click();
  await page.getByRole("button", { name: "Export this conversation" }).click();
  const download = await page.evaluate(async () => {
    const downloads = (window as unknown as {
      __downloads: { name: string; href: string }[];
    }).__downloads;
    const body = await fetch(downloads[0]!.href).then((response) => response.text());
    return { name: downloads[0]!.name, body };
  });
  expect(download.name).toBe("videodemo-assistant-conversation.md");
  expect(download.body).toContain("Will this persist?");
  expect(download.body).toContain("Stored answer.");
  expect(download.body).toContain("AI-generated answers can be wrong");

  await page.getByRole("button", { name: "Assistant options" }).click();
  const languageSelect = page.locator("select[data-setting=language]");
  await languageSelect.selectOption("de");
  await page.getByRole("button", { name: "Export all…" }).click();
  const exportAll = await page.evaluate(async () => {
    const downloads = (window as unknown as {
      __downloads: { name: string; href: string }[];
    }).__downloads;
    const last = downloads[downloads.length - 1]!;
    const body = await fetch(last.href).then((response) => response.text());
    return { name: last.name, body: JSON.parse(body) as Record<string, unknown> };
  });
  expect(exportAll.name).toBe("videodemo-assistant-conversations.json");
  expect(exportAll.body.format).toBe("i2ml-lecture-assistant-export");
  expect((exportAll.body.settings as { language: string }).language).toBe("de");
});

test("stacked layout docks the video as a dismissable mini-player when scrolled away", async ({
  page
}) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await mountLecture(page, "videodemo");
  await waitForPlayer(page);
  await expect(page.locator(".video-container iframe")).toHaveCount(1);
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.style.height = "2600px";
    spacer.id = "spacer";
    document.body.append(spacer);
  });
  const frame = page.locator(".video-frame");
  await page.evaluate(() => window.scrollTo(0, 2200));
  await expect(frame).toHaveClass(/is-docked/);
  await expect(page.locator(".mini-player-bar")).toBeVisible();

  await page.getByRole("button", { name: "Hide the floating video" }).click();
  await expect(frame).not.toHaveClass(/is-docked/);
  await page.evaluate(() => window.scrollTo(0, 2300));
  await expect(frame).not.toHaveClass(/is-docked/);

  // Scrolling the inline video back into view re-arms the mini-player.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator(".video-dock")).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 2200));
  await expect(frame).toHaveClass(/is-docked/);
  await page.getByRole("button", { name: "Return the video to the page" }).click();
  await expect(frame).not.toHaveClass(/is-docked/);
  await expect(page.locator(".video-dock")).toBeInViewport();
});
