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
      decks: [
        {
          deck_id: "d1",
          order: 1,
          download_url: "/video-slides.pdf"
        }
      ],
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
        },
        {
          id: "t-3",
          deck_id: "d1",
          page: 3,
          text: `## Optimisation\n\nGradient descent minimises the empirical risk. ${filler}`,
          correction: { kind: "correction", summary: "Step size fixed in the derivation." }
        }
      ]
    }
  },
  cues: [
    { start_ms: 0, stable_at_ms: 100, end_ms: 5000, state_kind: "slide", page_state_id: "t-1" },
    { start_ms: 5000, end_ms: 9000, state_kind: "non_slide", non_slide_kind: "interlude" },
    { start_ms: 9000, stable_at_ms: 9100, end_ms: 20_000, state_kind: "slide", page_state_id: "t-2" },
    { start_ms: 20_000, stable_at_ms: 20_100, end_ms: 30_000, state_kind: "slide", page_state_id: "t-3" }
  ]
};

// Both revisions with deliberately different slide heights (the teaching
// slides are much shorter), like a 4:3 deck revised as 16:9.
const shortFiller = Array.from({ length: 12 }, () => "Compact revised text.").join(" ");
const dualManifest = {
  lecture_id: "dualdemo",
  title: "Dual Revision Demo",
  content_revision: "revision-dual-1",
  presentation: { mode: "video_lecture", provider: "youtube", provider_id: "fake-video-2" },
  revisions: {
    recorded: {
      decks: [{ deck_id: "rd1", order: 1, download_url: "/recorded.pdf" }],
      page_states: [1, 2, 3, 4].map((n) => ({
        id: `r-${n}`,
        deck_id: "rd1",
        page: n,
        text: `## Recorded slide ${n}\n\n${filler}`,
        teaching_page_state_ids: [`t-${n}`]
      }))
    },
    teaching: {
      decks: [{ deck_id: "td1", order: 1, download_url: "/teaching.pdf" }],
      page_states: [1, 2, 3, 4].map((n) => ({
        id: `t-${n}`,
        deck_id: "td1",
        page: n,
        text: `## Updated slide ${n}\n\n${shortFiller}`,
        recorded_page_state_ids: [`r-${n}`]
      }))
    }
  },
  cues: [
    { start_ms: 0, stable_at_ms: 100, end_ms: 9000, state_kind: "slide",
      recorded_page_state_id: "r-1", teaching_content_page_state_ids: ["t-1"] },
    { start_ms: 9000, stable_at_ms: 9100, end_ms: 20_000, state_kind: "slide",
      recorded_page_state_id: "r-2", teaching_content_page_state_ids: ["t-2"] },
    { start_ms: 20_000, stable_at_ms: 20_100, end_ms: 30_000, state_kind: "slide",
      recorded_page_state_id: "r-3", teaching_content_page_state_ids: ["t-3"] }
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
            setPlaybackRate(rate) {
              this.rate = rate;
              window.__ytRates = [...(window.__ytRates || []), rate];
            }
            getPlaybackRate() { return this.rate ?? 1; }
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

/**
 * Scrolls the strip like a user. The wheel event marks it as user input (real
 * scrolling always starts with one) so it cannot be mistaken for the trailing
 * end of a programmatic placement, and cancels any in-flight animation.
 */
async function userScrollStrip(page: Page, top: number): Promise<void> {
  await page.locator(".slide-scroll").evaluate((strip, value) => {
    strip.dispatchEvent(new WheelEvent("wheel", { deltaY: 1 }));
    strip.scrollTop = value;
  }, top);
  // Let the settle debounce (160ms) run so stickiness logic completes.
  await page.waitForTimeout(260);
}

async function stripScrollTop(page: Page): Promise<number> {
  return page.locator(".slide-scroll").evaluate((strip) => strip.scrollTop);
}

/** Visual offset of the slide's top from the strip's top edge (16 = top position). */
async function topOffsetOf(page: Page, stateId: string): Promise<number> {
  return page.evaluate((id) => {
    const strip = document.querySelector<HTMLElement>(".slide-scroll")!;
    const slide = document.querySelector<HTMLElement>(`[data-page-state-id=${id}]`)!;
    return slide.getBoundingClientRect().top - strip.getBoundingClientRect().top;
  }, stateId);
}

/**
 * Where the strip's top-position line (16px below the strip's top edge) cuts
 * the slide, as a fraction of the slide's height. 0 = the slide sits exactly
 * at the top position; outside [0, 1) the line misses the slide.
 */
async function lineFractionOf(page: Page, stateId: string): Promise<number> {
  return page.evaluate((id) => {
    const strip = document.querySelector<HTMLElement>(".slide-scroll")!;
    const slide = document.querySelector<HTMLElement>(`[data-page-state-id=${id}]`)!;
    const line = strip.getBoundingClientRect().top + 16;
    const rect = slide.getBoundingClientRect();
    return (line - rect.top) / rect.height;
  }, stateId);
}

test.beforeEach(async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/v1/lectures/demo", (route) => route.fulfill({ json: manifest }));
  await page.route("**/api/v1/lectures/videodemo", (route) =>
    route.fulfill({ json: videoManifest })
  );
  await page.route("**/api/v1/lectures/dualdemo", (route) =>
    route.fulfill({ json: dualManifest })
  );
  await stubYouTube(page);
  // Instant scrolling keeps geometry assertions deterministic.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.setContent(`
    <!doctype html><html><head>
      <link rel="stylesheet" href="http://127.0.0.1:4173/lecture/lecture-app.css">
      <style>body { margin: 0; }</style><!-- Bootstrap resets it on the real site -->
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
  // No video → no floating play pill, even though a slide starts selected.
  await expect(page.locator(".slide-play-cta")).toHaveCount(0);
  await expect(page.locator(".qa-debug-trace")).toHaveCount(0);
  await expect(page.locator(".slide-page-num").first()).toHaveText("1 / 2");
  // The first slide starts selected so the assistant has context.
  await expect(page.locator("[data-page-state-id=demo-p1]")).toHaveClass(/is-active/);
  await page.getByLabel("Scrollable slides").focus();
  await expect(page.getByLabel("Scrollable slides")).toBeFocused();
});

test("the PDF menu is gone; downloads live in the slide list header", async ({ page }) => {
  await expect(page.locator(".pdf-menu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Print slides" })).toHaveCount(0);
  await page.getByRole("button", { name: "Slides", exact: true }).click();
  const drawer = page.locator(".toc-drawer");
  await expect(drawer.locator(".toc-title")).toHaveText("All slides (2)");
  const download = drawer.locator(".toc-download-link");
  await expect(download).toHaveCount(1);
  await expect(download).toHaveText("Download PDF");
  await expect(download).toHaveAttribute("href", "/slides.pdf");
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
  await expect(page.locator(".scope-chip")).toHaveCount(0);
  await expect(page.getByLabel("Question")).toHaveAttribute(
    "placeholder",
    "Ask about the lecture..."
  );
  expect(await panel.getAttribute("aria-modal")).toBeNull();
  const viewport = page.viewportSize();
  expect((await panel.boundingBox())?.width).toBeLessThanOrEqual(viewport?.width ?? 9999);
  await expect(page.getByLabel("Question")).toBeFocused();
  // The send button points upwards (vertical arrow path).
  await expect(panel.locator("button[type=submit] svg path")).toHaveAttribute(
    "d",
    /M8 14V2/
  );

  // The question field grows with its content without showing a scrollbar,
  // up to half of the chat area's height.
  await page.getByLabel("Question").fill("line one\nline two\nline three\nline four");
  const fieldMetrics = await page.getByLabel("Question").evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    clipped: element.scrollHeight > element.clientHeight + 2,
    height: element.clientHeight,
    cap: document.querySelector(".chat-body")!.clientHeight / 2
  }));
  expect(fieldMetrics.overflowY).toBe("hidden");
  expect(fieldMetrics.clipped).toBe(false);
  expect(fieldMetrics.height).toBeLessThanOrEqual(fieldMetrics.cap + 2);
  await page.getByLabel("Question").fill("");

  const close = panel.getByRole("button", { name: "Collapse the assistant panel" });
  await close.focus();
  await close.press("Space");
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();

  // The footer collapse control (next to the disclaimer) closes it too.
  await toggle.click();
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Collapse the assistant panel" }).click();
  await expect(panel).toBeHidden();
});

test("selection follows the video; scrolling pauses only once the slide is out of view", async ({
  page
}) => {
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

  // The current slide sits in the top position (16px below the strip edge).
  await expect.poll(() => topOffsetOf(page, "t-2")).toBeCloseTo(16, 0);

  // A small scroll does not pause following (the slide is still visible).
  const settled = await stripScrollTop(page);
  await userScrollStrip(page, settled + 60);
  await expect(pill).toHaveAttribute("data-follow-state", "following");
  // …and the sticky top position pulls the slide back.
  await expect.poll(async () => Math.abs((await stripScrollTop(page)) - settled)).toBeLessThan(3);

  // Scrolling until the slide's lower half is entirely out of view pauses.
  await userScrollStrip(page, 0);
  await expect(pill).toHaveAttribute("data-follow-state", "paused");
  await expect(pill.getByRole("button", { name: "Resume following" })).toBeVisible();
  // While paused by scrolling, the selection still mirrors the video.
  await expect(page.locator("[data-page-state-id=t-2]")).toHaveClass(/is-active/);

  // Scrolling the playing slide back into view resumes, without any scroll jump.
  await userScrollStrip(page, settled - 40);
  await expect(pill).toHaveAttribute("data-follow-state", "following");
  expect(Math.abs((await stripScrollTop(page)) - (settled - 40))).toBeLessThan(3);
});

test("clicking slides moves the selection; the video slide keeps its own highlight", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "videodemo");
  await playVideoAt(page, 10);
  await expect(page.locator("[data-page-state-id=t-2]")).toHaveClass(/is-active/);
  const pill = page.locator(".follow-pill");

  // Selecting a different slide pauses following by selection.
  await userScrollStrip(page, 0);
  await page.locator("[data-page-state-id=t-1] h3").click();
  await expect(pill).toHaveAttribute("data-follow-state", "paused");
  await expect(page.locator("[data-page-state-id=t-1]")).toHaveClass(/is-active/);
  await expect(page.locator("[data-page-state-id=t-2]")).not.toHaveClass(/is-active/);
  // The video slide keeps the distinct video highlight and chip.
  await expect(page.locator("[data-page-state-id=t-2]")).toHaveClass(/is-video-current/);
  await expect(page.locator("[data-page-state-id=t-2] .slide-current-chip")).toHaveCount(1);
  await expect(page.locator(".now-viewing")).toContainText("Video: slide 2");
  await expect(page.locator(".now-viewing")).toContainText("selected slide 1");

  // Scrolling the playing slide into view must NOT resume a selection pause.
  await page.locator(".slide-scroll").evaluate((strip) => {
    const slide = document.querySelector<HTMLElement>("[data-page-state-id=t-2]")!;
    strip.scrollTop += slide.getBoundingClientRect().top - strip.getBoundingClientRect().top - 16;
  });
  await page.waitForTimeout(260);
  await expect(pill).toHaveAttribute("data-follow-state", "paused");

  // Selecting the slide that is currently playing resumes following in place.
  const before = await stripScrollTop(page);
  await page.locator("[data-page-state-id=t-2] h3").click();
  await expect(pill).toHaveAttribute("data-follow-state", "following");
  expect(Math.abs((await stripScrollTop(page)) - before)).toBeLessThan(3);

  // Resume button re-sticks the current slide into the top position.
  await userScrollStrip(page, 0);
  await expect(pill).toHaveAttribute("data-follow-state", "paused");
  await pill.getByRole("button", { name: "Resume following" }).click();
  await expect(pill).toHaveAttribute("data-follow-state", "following");
  await expect.poll(() => topOffsetOf(page, "t-2")).toBeCloseTo(16, 0);
});

test("video catching up to a selected slide does not re-enable following", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "videodemo");
  await playVideoAt(page, 2);
  await expect(page.locator("[data-page-state-id=t-1]")).toHaveClass(/is-active/);

  // Select slide 2 before the video reaches it.
  await page.locator("[data-page-state-id=t-2] h3").click();
  const pill = page.locator(".follow-pill");
  await expect(pill).toHaveAttribute("data-follow-state", "paused");

  await playVideoAt(page, 10); // video is now on t-2, the selected slide
  await expect(page.locator("[data-page-state-id=t-2]")).toHaveClass(/is-active/);
  await expect(pill).toHaveAttribute("data-follow-state", "paused");
});

test("switching revisions keeps the top-position line through the same slide at the same height fraction", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "dualdemo");
  await expect(page.locator("[data-page-state-id=r-2]")).toBeVisible();

  // Put the line 40% into recorded slide 2.
  const target = await page.evaluate(() => {
    const strip = document.querySelector<HTMLElement>(".slide-scroll")!;
    const slide = document.querySelector<HTMLElement>("[data-page-state-id=r-2]")!;
    const rect = slide.getBoundingClientRect();
    return strip.scrollTop + rect.top - strip.getBoundingClientRect().top + 0.4 * rect.height - 16;
  });
  await userScrollStrip(page, target);
  expect(await lineFractionOf(page, "r-2")).toBeCloseTo(0.4, 2);

  // The teaching slides are much shorter, so the scroll offset must change —
  // but the line still cuts the mapped slide at 40% of its height.
  await page.getByRole("tab", { name: "Updated slides" }).click();
  await expect(page.locator("[data-page-state-id=t-2]")).toBeVisible();
  await expect.poll(() => lineFractionOf(page, "t-2")).toBeCloseTo(0.4, 1);

  // And back, restoring the taller recorded geometry.
  await page.getByRole("tab", { name: "Slides as in video" }).click();
  await expect(page.locator("[data-page-state-id=r-2]")).toBeVisible();
  await expect.poll(() => lineFractionOf(page, "r-2")).toBeCloseTo(0.4, 1);
});

test("a slide stuck at the top position stays stuck across a revision switch", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "dualdemo");
  await playVideoAt(page, 10);
  await expect.poll(() => topOffsetOf(page, "r-2")).toBeCloseTo(16, 0);

  await page.getByRole("tab", { name: "Updated slides" }).click();
  await expect(page.locator("[data-page-state-id=t-2]")).toBeVisible();
  await expect.poll(() => topOffsetOf(page, "t-2")).toBeCloseTo(16, 0);
  await expect(page.locator(".follow-pill")).toHaveAttribute("data-follow-state", "following");

  // Still stuck: a small scroll bounces back to the top position.
  const current = await stripScrollTop(page);
  await userScrollStrip(page, current + 60);
  await expect.poll(() => topOffsetOf(page, "t-2"), { timeout: 3000 }).toBeCloseTo(16, 0);
});

test("the top-position line survives column drags, window resizes, and orientation switches", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "dualdemo");
  await expect(page.locator("[data-page-state-id=r-2]")).toBeVisible();
  const target = await page.evaluate(() => {
    const strip = document.querySelector<HTMLElement>(".slide-scroll")!;
    const slide = document.querySelector<HTMLElement>("[data-page-state-id=r-2]")!;
    const rect = slide.getBoundingClientRect();
    return strip.scrollTop + rect.top - strip.getBoundingClientRect().top + 0.4 * rect.height - 16;
  });
  await userScrollStrip(page, target);
  expect(await lineFractionOf(page, "r-2")).toBeCloseTo(0.4, 2);

  // Dragging the slides divider changes the column width (and with it every
  // slide height); the line must keep cutting r-2 at 40%.
  const divider = page.locator(".col-resizer[data-resizer=slides]");
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 160, box.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => lineFractionOf(page, "r-2")).toBeCloseTo(0.4, 1);

  // Window resize in landscape.
  await page.setViewportSize({ width: 1160, height: 820 });
  await expect.poll(() => lineFractionOf(page, "r-2")).toBeCloseTo(0.4, 1);

  // Orientation switch to portrait and back.
  await page.setViewportSize({ width: 600, height: 900 });
  await expect.poll(() => lineFractionOf(page, "r-2")).toBeCloseTo(0.4, 1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(() => lineFractionOf(page, "r-2")).toBeCloseTo(0.4, 1);
});

test("the revision hint re-measures truncation when its column resizes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "dualdemo");
  await expect(page.locator("[data-page-state-id=r-2]")).toBeVisible();
  const hint = page.locator(".revision-hint");
  await expect(hint).toHaveText("exact match with the video");

  // Squeeze the slides column to its minimum: the hint truncates and gains
  // its hover-expand affordance.
  const divider = page.locator(".col-resizer[data-resizer=slides]");
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 700, box.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect(hint).toHaveClass(/is-truncated/);

  // Widen it again without re-rendering the hint: the affordance goes away.
  const box2 = (await divider.boundingBox())!;
  await page.mouse.move(box2.x + box2.width / 2, box2.y + 300);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width / 2 - 700, box2.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect(hint).not.toHaveClass(/is-truncated/);
});

test("transport controls jump between slide cues, toggle playback, and set the speed", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "videodemo");
  await playVideoAt(page, 10);
  await expect(page.locator(".now-viewing")).toContainText("Slide 2");

  // The toggle mirrors the player state.
  const toggle = page.locator("[data-action=toggle-play]");
  await expect(toggle).toHaveClass(/is-playing/);
  await toggle.click();
  await expect(toggle).not.toHaveClass(/is-playing/);
  await expect(toggle).toHaveAttribute("title", "Play");
  await toggle.click();
  await expect(toggle).toHaveClass(/is-playing/);

  // Cue-level jumps with scrubbing semantics: the play state is untouched.
  await page.locator("[data-action=slide-start]").click();
  await expect(page.locator("[data-time-now]")).toHaveText("0:09");
  await page.locator("[data-action=next-slide]").click();
  await expect(page.locator(".now-viewing")).toContainText("Slide 3");
  await page.locator("[data-action=prev-slide]").click();
  await page.locator("[data-action=prev-slide]").click();
  await expect(page.locator(".now-viewing")).toContainText("Slide 1");
  await expect(toggle).toHaveClass(/is-playing/);

  // The slides keep following through the jumps (green = blue = current).
  await expect(page.locator(".follow-pill")).toHaveAttribute("data-follow-state", "following");
  await expect(page.locator("[data-page-state-id=t-1]")).toHaveClass(/is-active/);

  // The stopwatch opens a continuous slider: 0.5×–2×, linear, 0.05 steps
  // (2× is the IFrame API ceiling; faster is Premium-only in YouTube's UI).
  await page.locator("[data-action=playback-speed]").click();
  const slider = page.locator(".speed-slider");
  await expect(slider).toHaveAttribute("min", "0.5");
  await expect(slider).toHaveAttribute("max", "2");
  await expect(slider).toHaveAttribute("step", "0.05");
  // While the popup is open the badge reserves its spot even at 1×, so the
  // popup's anchor cannot move once dragging starts.
  await expect(page.locator(".speed-value")).toHaveText("1.00×");
  const menuBefore = (await page.locator(".speed-menu").boundingBox())!;
  await slider.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "1.35";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(await page.evaluate(() => (window as unknown as { __ytRates?: number[] }).__ytRates))
    .toEqual([1.35]);
  await expect(page.locator(".speed-readout")).toHaveText("1.35×");  // two decimals always
  await expect(page.locator(".speed-value")).toHaveText("1.35×");
  await expect(page.locator("[data-action=playback-speed]")).toHaveAttribute(
    "title",
    "Playback speed · 1.35×"
  );
  // Changing the digit count must not move or resize the popup (the slider
  // would wander under the pointer mid-drag).
  const menuAfter = (await page.locator(".speed-menu").boundingBox())!;
  expect(Math.abs(menuAfter.x - menuBefore.x)).toBeLessThan(1.5);
  expect(Math.abs(menuAfter.width - menuBefore.width)).toBeLessThan(1.5);
  // Adjusting keeps the slider open; Escape closes it.
  await expect(page.locator(".speed-menu")).toBeVisible();
  await slider.press("Escape");
  await expect(page.locator(".speed-menu")).toBeHidden();
  // Closed at a non-1 rate the badge stays; back at 1× it disappears.
  await expect(page.locator(".speed-value")).toBeVisible();
  await page.locator("[data-action=playback-speed]").click();
  await slider.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await slider.press("Escape");
  await expect(page.locator(".speed-value")).toBeHidden();
});

test("slide-only pages dock the chat as a column, resizing the content", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The default mounted "demo" lecture is slide-only.
  await expect(page.locator(".lecture-shell")).toHaveClass(/is-slide-only/);
  // No media|slides split, but the right edge still pulls the chat out.
  await expect(page.locator(".col-resizer[data-resizer=slides]")).toBeHidden();
  await expect(page.locator(".chat-pull-handle")).toBeVisible();

  const main = page.locator(".lecture-main");
  const mainBefore = (await main.boundingBox())!.width;
  await page.getByRole("button", { name: "Ask about this lecture" }).click();

  // Docked like on video pages: a real column, the content resizes, and
  // nothing gets darkened by a scrim.
  const chat = page.locator(".chat-panel");
  await expect(chat).toBeVisible();
  expect(await chat.evaluate((element) => getComputedStyle(element).position)).toBe("static");
  const chatBox = (await chat.boundingBox())!;
  expect(chatBox.height).toBeGreaterThan(500);
  const mainOpen = (await main.boundingBox())!.width;
  expect(mainOpen).toBeLessThan(mainBefore - 250);
  await expect(page.locator(".assistant-scrim")).toBeHidden();
  await expect(page.locator(".col-resizer[data-resizer=assistant]")).toBeVisible();

  // Resizing below the minimum closes it, exactly like on video pages.
  const divider = page.locator(".col-resizer[data-resizer=assistant]");
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 500, box.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect(chat).toBeHidden();
  await expect(page.locator(".assistant-pill")).toBeVisible();
  expect((await main.boundingBox())!.width).toBeGreaterThan(mainBefore - 30);

  // Portrait keeps the floating sheet.
  await page.setViewportSize({ width: 600, height: 900 });
  await page.getByRole("button", { name: "Ask about this lecture" }).click();
  await expect(chat).toBeVisible();
  expect(await chat.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
});

test("switching revisions during a strip animation uses the animation's target position", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "dualdemo");
  await expect(page.locator("[data-page-state-id=r-1]")).toBeVisible();

  // A drawer row selection scrolls the strip with a 320ms animation; switch
  // revisions while it is still in flight.
  await page.getByRole("button", { name: "Slides", exact: true }).click();
  await page.locator(".toc-list button[data-state-id=r-3]").click();
  await page.evaluate(() =>
    document.querySelector<HTMLButtonElement>("[data-revision=teaching]")!.click()
  );

  // The restored position is the animation's target: the mapped slide sits
  // exactly at the top position, and the selection survives the switch.
  await expect(page.locator("[data-page-state-id=t-3]")).toBeVisible();
  await expect.poll(() => topOffsetOf(page, "t-3")).toBeCloseTo(16, 0);
  await expect(page.locator("[data-page-state-id=t-3]")).toHaveClass(/is-active/);
});

test("video segments without slides are labelled instead of forcing a slide", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "videodemo");
  await playVideoAt(page, 6);
  await expect(page.locator(".now-viewing")).toContainText("interlude (no slide)");
  await expect(page.locator(".slide-current-chip")).toHaveCount(0);
  await expect(page.locator(".pdf-page.is-active, .structured-slide.is-active")).toHaveCount(0);
});

test("slide list drawer: titles, times, markers, downloads, and play-from-here", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "videodemo");
  await playVideoAt(page, 10);
  await expect(page.locator(".now-viewing")).toContainText("Slide 2");

  const toggle = page.getByRole("button", { name: "Slides", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".toc-title")).toHaveText("All slides (3)");
  await expect(page.locator(".toc-download-link")).toHaveAttribute("href", "/video-slides.pdf");
  const rows = page.locator(".toc-list button[data-state-id]");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("1 · Intro to Losses");
  await expect(rows.nth(0)).toContainText("0:00");
  await expect(rows.nth(1)).toContainText("2 · L2 Loss defined");
  await expect(rows.nth(1)).toContainText("0:09");
  await expect(rows.nth(1)).toContainText("— video · selected");

  // "Play from here" appears only on the hovered (or focused) row.
  const playButtons = page.locator(".toc-play");
  await rows.nth(0).blur();
  await expect(playButtons.nth(0)).toBeHidden();
  await rows.nth(2).hover();
  await expect(playButtons.nth(2)).toBeVisible();
  await expect(playButtons.nth(0)).toBeHidden();
  await playButtons.nth(2).click();
  // Playing keeps the list open, exactly like selecting does.
  await expect(page.locator(".toc-drawer")).toBeVisible();
  const seeks = await page.evaluate(() => (window as unknown as { __seeks: number[] }).__seeks);
  expect(seeks.at(-1)).toBeCloseTo(20.1, 5);
  // Following was on, so it stays on and the strip force-scrolls to slide 3.
  await expect(page.locator(".follow-pill")).toHaveAttribute("data-follow-state", "following");
  await page.getByRole("button", { name: "Close the slide list" }).click();
  await expect(page.locator(".toc-drawer")).toBeHidden();

  // Drawer rows select; Escape closes and returns focus to the toggle.
  await toggle.click();
  await expect(rows.nth(0)).toBeFocused();
  await rows.nth(0).press("Escape");
  await expect(page.locator(".toc-drawer")).toBeHidden();
  await expect(toggle).toBeFocused();

  // Selecting a slide keeps the list open; markers update in place.
  await toggle.click();
  await rows.nth(0).click();
  await expect(page.locator(".follow-pill")).toHaveAttribute("data-follow-state", "paused");
  await expect(page.locator("[data-page-state-id=t-1]")).toHaveClass(/is-active/);
  await expect(page.locator(".toc-drawer")).toBeVisible();
  await expect(rows.nth(0)).toContainText("— selected");
  await page.getByRole("button", { name: "Close the slide list" }).click();
  await expect(page.locator(".toc-drawer")).toBeHidden();
});

test("the play pill floats on the selected slide and resumes following in place", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "videodemo");
  await playVideoAt(page, 10);
  const pill = page.locator(".follow-pill");
  const playCta = page.locator(".slide-play-cta");
  // The old toolbar button is gone for good.
  await expect(page.locator(".play-from-slide")).toHaveCount(0);

  // By default (nothing explicitly selected) the pill is not shown, even
  // though the following selection mirrors the video slide.
  await expect(page.locator("[data-page-state-id=t-2]")).toHaveClass(/is-active/);
  await expect(playCta).toHaveCount(0);

  // Selecting the currently playing slide shows it, attached to that slide.
  await page.locator("[data-page-state-id=t-2] h3").click();
  await expect(playCta).toBeVisible();
  await expect(playCta).toContainText("Play from start of this slide");
  expect(
    await playCta.evaluate(
      (element) => element.closest("[data-page-state-id]")?.getAttribute("data-page-state-id")
    )
  ).toBe("t-2");

  // Geometry: it is centred on the slide's 75% point, and the slide's
  // bottom edge cuts it at about half the pill's height.
  const slideBox = (await page.locator("[data-page-state-id=t-2]").boundingBox())!;
  const ctaBox = (await playCta.boundingBox())!;
  expect(
    Math.abs(ctaBox.x + ctaBox.width / 2 - (slideBox.x + slideBox.width * 0.75))
  ).toBeLessThan(8);
  expect(Math.abs(ctaBox.y + ctaBox.height / 2 - (slideBox.y + slideBox.height))).toBeLessThan(5);

  // The revision badge (t-3 carries a correction) sits below the top-right
  // current-chip slot on every slide — capture it while the chip is NOT on
  // its slide…
  const badgeOffsets = () =>
    page.evaluate(() => {
      const slide = document.querySelector("[data-page-state-id=t-3]")!;
      const badge = slide.querySelector(".slide-revision-badge")!;
      const slideRect = slide.getBoundingClientRect();
      const badgeRect = badge.getBoundingClientRect();
      return { top: badgeRect.top - slideRect.top, right: slideRect.right - badgeRect.right };
    });
  const badgeBefore = await badgeOffsets();

  // Once the video moves on, the mirrored selection is no longer explicit.
  await playVideoAt(page, 25);
  await expect(page.locator("[data-page-state-id=t-3]")).toHaveClass(/is-active/);
  await expect(playCta).toHaveCount(0);

  // …and the chip now sits at the slide's TOP RIGHT while the badge stayed
  // exactly where it was, below the chip, without overlap.
  const chip = await page.evaluate(() => {
    const slide = document.querySelector("[data-page-state-id=t-3]")!;
    const chipRect = slide.querySelector(".slide-current-chip")!.getBoundingClientRect();
    const slideRect = slide.getBoundingClientRect();
    return {
      top: chipRect.top - slideRect.top,
      right: slideRect.right - chipRect.right,
      bottom: chipRect.bottom - slideRect.top
    };
  });
  expect(Math.abs(chip.top)).toBeLessThan(4);
  expect(Math.abs(chip.right)).toBeLessThan(4);
  const badgeAfter = await badgeOffsets();
  expect(badgeAfter.top).toBeCloseTo(badgeBefore.top, 0);
  expect(badgeAfter.right).toBeCloseTo(badgeBefore.right, 0);
  expect(badgeAfter.top).toBeGreaterThanOrEqual(chip.bottom - 1);

  // Pause by selecting another slide, then play from its pill: the video
  // seeks to the slide's start and following turns back ON…
  await page.locator("[data-page-state-id=t-1] h3").click();
  await expect(pill).toHaveAttribute("data-follow-state", "paused");
  await expect(playCta).toBeVisible();
  const scrollBefore = await page
    .locator(".slide-scroll")
    .evaluate((element) => element.scrollTop);
  await playCta.click();
  const seeks = await page.evaluate(() => (window as unknown as { __seeks: number[] }).__seeks);
  expect(seeks.at(-1)).toBeCloseTo(0.1, 5);
  await expect(pill).toHaveAttribute("data-follow-state", "following");
  // The chip moved to the now-playing selected slide.
  await expect(page.locator("[data-page-state-id=t-1] .slide-current-chip")).toHaveCount(1);
  // …but in place: resuming must not scroll or stick the strip.
  await page.waitForTimeout(400);
  expect(await page.locator(".slide-scroll").evaluate((element) => element.scrollTop)).toBe(
    scrollBefore
  );
  // Playing consumed the explicit selection: the pill hides again until the
  // user selects a slide once more.
  await expect(playCta).toHaveCount(0);
  await page.locator("[data-page-state-id=t-1] h3").click();
  await expect(playCta).toBeVisible();
});

test("the play pill maps across revision switches, disables without a cue, never resurrects", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "dualdemo");
  await playVideoAt(page, 12); // video on r-2
  const playCta = page.locator(".slide-play-cta");

  // Explicitly select a slide that is NOT the video slide.
  await page.locator("[data-page-state-id=r-1] h3").click();
  await expect(playCta).toBeVisible();

  // A revision switch maps the explicit selection through its OWN id: the
  // pill lands on the counterpart slide, not on the video-mirrored selection.
  await page.getByRole("tab", { name: "Updated slides" }).click();
  await expect(playCta).toHaveCount(1);
  expect(
    await playCta.evaluate(
      (element) => element.closest("[data-page-state-id]")?.getAttribute("data-page-state-id")
    )
  ).toBe("t-1");

  // The straddling lower half paints (and hit-tests) ABOVE the gap and the
  // next slide: probing just below the slide's bottom edge hits the pill.
  const t1Box = (await page.locator("[data-page-state-id=t-1]").boundingBox())!;
  const ctaBox = (await playCta.boundingBox())!;
  expect(
    await page.evaluate(
      ([x, y]) => Boolean(document.elementFromPoint(x!, y!)?.closest(".slide-play-cta")),
      [ctaBox.x + Math.min(20, ctaBox.width / 2), t1Box.y + t1Box.height + 4]
    )
  ).toBe(true);

  // Slide 4 has no cue: the pill renders but the app's occurrence lookup
  // disables it — in both revisions.
  await page.locator("[data-page-state-id=t-4] h3").click();
  await expect(playCta).toBeVisible();
  await expect(playCta).toBeDisabled();
  await page.getByRole("tab", { name: "Slides as in video" }).click();
  await expect(playCta).toHaveCount(1);
  await expect(playCta).toBeDisabled();
  expect(
    await playCta.evaluate(
      (element) => element.closest("[data-page-state-id]")?.getAttribute("data-page-state-id")
    )
  ).toBe("r-4");

  // Playing consumes the selection; a later revision switch must NOT
  // resurrect the pill from the mirrored video selection.
  await page.locator("[data-page-state-id=r-1] h3").click();
  await expect(playCta).toBeEnabled();
  await playCta.click();
  await expect(playCta).toHaveCount(0);
  await page.getByRole("tab", { name: "Updated slides" }).click();
  await expect(page.locator("[data-page-state-id=t-1]")).toHaveClass(/is-active/);
  await expect(playCta).toHaveCount(0);
});

test("phone portrait: the play pill keeps its full label un-clipped inside the slide", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountLecture(page, "videodemo");
  await page.locator("[data-page-state-id=t-1] h3").click();
  const playCta = page.locator(".slide-play-cta");
  await expect(playCta).toBeVisible();

  // The whole label renders — no hard clip, not even an ellipsis.
  const label = playCta.locator(".slide-play-cta-label");
  expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true
  );

  // The pill shifted left of the 75% point to fit, but keeps a minimal
  // distance to the slide's right edge, stays inside the slide, and still
  // straddles its bottom edge.
  const slideBox = (await page.locator("[data-page-state-id=t-1]").boundingBox())!;
  const ctaBox = (await playCta.boundingBox())!;
  expect(ctaBox.x).toBeGreaterThanOrEqual(slideBox.x);
  expect(slideBox.x + slideBox.width - (ctaBox.x + ctaBox.width)).toBeGreaterThanOrEqual(8);
  expect(Math.abs(ctaBox.y + ctaBox.height / 2 - (slideBox.y + slideBox.height))).toBeLessThan(5);
});

test("landscape dividers resize the columns; dragging the chat away closes it live", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "videodemo");
  await expect(page.locator("[data-page-state-id=t-1]")).toBeVisible();
  const slides = page.locator(".slide-panel");
  const media = page.locator(".media-panel");

  // Opening the chat shrinks media and slides PROPORTIONALLY (both flex).
  const mediaBefore = (await media.boundingBox())!.width;
  const slidesBefore = (await slides.boundingBox())!.width;
  await page.getByRole("button", { name: "Ask about this lecture" }).click();
  await expect(page.locator(".chat-panel")).toBeVisible();
  const mediaOpen = (await media.boundingBox())!.width;
  const slidesOpen = (await slides.boundingBox())!.width;
  expect(mediaOpen).toBeLessThan(mediaBefore - 40);
  expect(slidesOpen).toBeLessThan(slidesBefore - 40);
  expect(Math.abs(mediaOpen / slidesOpen - mediaBefore / slidesBefore)).toBeLessThan(0.08);
  await page.getByRole("button", { name: "Collapse the assistant panel" }).click();
  await expect(page.locator(".chat-panel")).toBeHidden();

  const startWidth = (await slides.boundingBox())!.width;

  // Dragging the slides divider to the right shrinks the slide panel.
  const divider = page.locator("[data-resizer=slides]");
  const dividerBox = (await divider.boundingBox())!;
  await page.mouse.move(dividerBox.x + 3, dividerBox.y + 300);
  await page.mouse.down();
  await page.mouse.move(dividerBox.x + 163, dividerBox.y + 300, { steps: 5 });
  await page.mouse.up();
  const shrunk = (await slides.boundingBox())!.width;
  expect(startWidth - shrunk).toBeGreaterThan(120);

  // It can never go below its chat-closed minimum (340px).
  await page.mouse.move(dividerBox.x + 3, dividerBox.y + 300);
  await page.mouse.down();
  await page.mouse.move(1400, dividerBox.y + 300, { steps: 5 });
  await page.mouse.up();
  expect((await slides.boundingBox())!.width).toBeGreaterThanOrEqual(338);

  // Open the assistant; drag its divider right until the chat collapses —
  // while still holding, the pill reappears; dragging back left re-opens it.
  await page.getByRole("button", { name: "Ask about this lecture" }).click();
  const chat = page.locator(".chat-panel");
  await expect(chat).toBeVisible();
  const chatDivider = page.locator("[data-resizer=assistant]");
  const chatDividerBox = (await chatDivider.boundingBox())!;
  await page.mouse.move(chatDividerBox.x + 3, chatDividerBox.y + 300);
  await page.mouse.down();
  await page.mouse.move(1430, chatDividerBox.y + 300, { steps: 6 });
  await expect(chat).toBeHidden(); // collapsed mid-drag (visibility)
  await expect(page.locator(".assistant-pill")).toBeVisible();
  await page.mouse.move(chatDividerBox.x - 60, chatDividerBox.y + 300, { steps: 6 });
  await expect(chat).toBeVisible(); // re-opened in the same gesture
  await page.mouse.up();
  await expect(chat).toBeVisible();

  // Dragging away and releasing actually closes it; the pill returns.
  const settledBox = (await chatDivider.boundingBox())!;
  await page.mouse.move(settledBox.x + 3, settledBox.y + 300);
  await page.mouse.down();
  await page.mouse.move(1430, settledBox.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect(chat).toBeHidden();
  await expect(page.locator(".assistant-pill")).toBeVisible();

  // With the chat closed, grabbing the very right edge pulls it back out:
  // nothing happens until the drag reaches the minimum chat width.
  await page.mouse.move(1437, 400);
  await page.mouse.down();
  await page.mouse.move(1337, 400, { steps: 4 }); // 100px: below minimum
  await expect(chat).toBeHidden();
  await page.mouse.move(1039, 400, { steps: 6 }); // 398px: opens live
  await expect(chat).toBeVisible();
  await page.mouse.move(1339, 400, { steps: 6 }); // back under: collapses again
  await expect(chat).toBeHidden();
  await expect(page.locator(".assistant-pill")).toBeVisible();
  await page.mouse.move(1039, 400, { steps: 6 });
  await expect(chat).toBeVisible();
  await page.mouse.up();
  await expect(chat).toBeVisible(); // released while wide enough: stays open
});

test("portrait: the chat sheet resizes from its left edge and closes by dragging away", async ({
  page
}) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await mountLecture(page, "videodemo");
  await expect(page.locator("[data-page-state-id=t-1]")).toBeVisible();
  // No pull-in handle in portrait: the window's right edge belongs to the
  // page scrollbar.
  await expect(page.locator(".chat-pull-handle")).toBeHidden();

  await page.getByRole("button", { name: "Ask about this lecture" }).click();
  const chat = page.locator(".chat-panel");
  await expect(chat).toBeVisible();
  const startWidth = (await chat.boundingBox())!.width;
  const handle = page.locator(".chat-sheet-resizer");
  const handleBox = (await handle.boundingBox())!;

  // Drag left: wider.
  await page.mouse.move(handleBox.x + 4, handleBox.y + 300);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 26, handleBox.y + 300, { steps: 4 });
  await page.mouse.up();
  expect((await chat.boundingBox())!.width).toBeGreaterThan(startWidth + 20);

  // Drag right past the minimum: collapses live (pill returns), dragging
  // back re-opens; releasing collapsed closes for real.
  const grownBox = (await handle.boundingBox())!;
  await page.mouse.move(grownBox.x + 4, grownBox.y + 300);
  await page.mouse.down();
  await page.mouse.move(425, grownBox.y + 300, { steps: 6 });
  await expect(chat).toBeHidden();
  await expect(page.locator(".assistant-pill")).toBeVisible();
  await page.mouse.move(grownBox.x + 4, grownBox.y + 300, { steps: 6 });
  await expect(chat).toBeVisible();
  await page.mouse.move(425, grownBox.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect(chat).toBeHidden();
  await expect(page.locator(".assistant-pill")).toBeVisible();
});

test("portrait: scrolling the chat never scrolls the page while it is scrollable", async ({
  page
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await mountLecture(page, "videodemo");
  await page.getByRole("button", { name: "Ask about this lecture" }).click();
  const messages = page.locator(".chat-messages");
  const behavior = await messages.evaluate(
    (element) => getComputedStyle(element).overscrollBehaviorY
  );
  expect(behavior).toBe("contain");
  // With scrollable chat content, wheel events over the panel are consumed.
  await page.evaluate(() => {
    const container = document.querySelector(".chat-messages")!;
    for (let index = 0; index < 60; index += 1) {
      const bubble = document.createElement("div");
      bubble.className = "chat-message is-assistant";
      bubble.textContent = `Filler message ${index}`;
      container.append(bubble);
    }
  });
  const pageScroll = await page.evaluate(() => window.scrollY);
  await page.locator(".chat-header").hover();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
});

test("landscape: slide panel bleeds square-cornered to the window edges", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "videodemo");
  await expect(page.locator("[data-page-state-id=t-1]")).toBeVisible();
  const panel = page.locator(".slide-panel");
  const box = (await panel.boundingBox())!;
  expect(Math.abs(box.x + box.width - 1440)).toBeLessThan(2);
  const chrome = await panel.evaluate((element) => {
    const style = getComputedStyle(element);
    return { radius: style.borderTopLeftRadius, cursor: getComputedStyle(
      document.querySelector(".structured-slide")!
    ).cursor };
  });
  expect(chrome.radius).toBe("0px");
  // Slides do not pretend to be links.
  expect(chrome.cursor).not.toBe("pointer");
});

test("slide search selects matches and reports empty results", async ({ page }) => {
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

test("the revision hint exposes its full text when truncated", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountLecture(page, "videodemo");
  const hint = page.locator(".revision-hint");
  await expect(hint).toHaveAttribute("data-full", /.+/);
  // Force truncation by narrowing the window; the hover overlay is CSS-driven,
  // so asserting the class + data-full contract is what matters here.
  await page.setViewportSize({ width: 1030, height: 780 });
  await page.waitForTimeout(200);
  const truncated = await hint.evaluate((element) =>
    element.classList.contains("is-truncated") === element.scrollWidth > element.clientWidth + 1
  );
  expect(truncated).toBe(true);
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
});

test("assistant conversations persist in the browser and can be exported", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/api/v1/chat/stream", async (route) => {
    // A short delay keeps the "thinking" phase observable.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({
      contentType: "text/event-stream",
      body:
        "event: delta\ndata: {\"text\":\"Stored answer.\"}\n\n" +
        "event: final\ndata: {\"answer_markdown\":\"Stored answer.\",\"citations\":[]," +
        "\"conversation_id\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"}\n\n"
    });
  });
  await mountLecture(page, "videodemo");
  await page.getByRole("button", { name: "Ask about this lecture" }).click();
  await page.getByLabel("Question").fill("Will this persist?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  // The input empties immediately on send, not only once the answer arrives.
  await expect(page.getByLabel("Question")).toHaveValue("");
  await expect(page.locator(".chat-message.is-thinking")).toBeVisible();
  await expect(page.locator(".chat-message.is-assistant")).toContainText("Stored answer.");

  // Hovering a bubble reveals a copy control (title tooltip "copy") that
  // puts the raw message content on the clipboard.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const answerBubble = page.locator(".chat-message.is-assistant").last();
  await answerBubble.hover();
  const copy = answerBubble.locator(".chat-copy");
  await expect(copy).toBeVisible();
  await expect(copy).toHaveAttribute("title", "copy");
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Stored answer.");

  // Remount the app (as after a page reload) and restore from Past conversations.
  await mountLecture(page, "videodemo");
  await page.getByRole("button", { name: "Ask about this lecture" }).click();
  await expect(page.locator(".chat-message")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
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
  await page.getByRole("button", { name: "Settings" }).click();
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

  await page.getByRole("button", { name: "Settings" }).click();
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

test("portrait: the video docks as a floating, resizable 16:9 mini-player", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 1000 }); // portrait
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

  // The mini-player arms at the video's MIDPOINT: it floats once the middle
  // is scrolled out and returns at the same point on the way back — not only
  // once the video is entirely out of view.
  const dockBox = (await page.locator(".video-dock").boundingBox())!;
  const midpoint = dockBox.y + dockBox.height / 2; // page is still unscrolled
  await page.evaluate((y) => window.scrollTo(0, y), midpoint + 12);
  await expect(frame).toHaveClass(/is-docked/);
  await page.evaluate((y) => window.scrollTo(0, y), midpoint - 12);
  await expect(frame).not.toHaveClass(/is-docked/);

  await page.evaluate(() => window.scrollTo(0, 2200));
  await expect(frame).toHaveClass(/is-docked/);
  await expect(page.locator(".mini-player-bar")).toBeVisible();

  // 16:9 video area (the bar below is extra) and inside the viewport.
  const container = await page.locator(".video-frame.is-docked .video-container").boundingBox();
  expect(container).toBeTruthy();
  expect(Math.abs(container!.height - (container!.width * 9) / 16)).toBeLessThan(2);
  const box = await frame.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(700);
  expect(box!.y + box!.height).toBeLessThanOrEqual(1000);

  // Dragging the right edge resizes while keeping the ratio and the bounds.
  const handle = page.locator("[data-mini-edge=right]");
  const handleBox = (await handle.boundingBox())!;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 160, handleBox.y + handleBox.height / 2, { steps: 4 });
  await page.mouse.up();
  const resized = await frame.boundingBox();
  expect(resized!.width).toBeGreaterThan(box!.width + 100);
  const resizedVideo = await page
    .locator(".video-frame.is-docked .video-container")
    .boundingBox();
  expect(Math.abs(resizedVideo!.height - (resizedVideo!.width * 9) / 16)).toBeLessThan(2);
  expect(resized!.x + resized!.width).toBeLessThanOrEqual(700);
  expect(resized!.y + resized!.height).toBeLessThanOrEqual(1000);

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

test("portrait: the strip scrolls internally and overscroll stays contained", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 1000 });
  await mountLecture(page, "videodemo");
  const strip = page.locator(".slide-scroll");
  const behavior = await strip.evaluate((element) => getComputedStyle(element).overscrollBehaviorY);
  expect(behavior).toBe("contain");
  // The strip is narrower than the page, leaving gutters that scroll the page.
  const stripBox = (await strip.boundingBox())!;
  expect(stripBox.width).toBeLessThan(700 - 20);

  // The play pill behaves like in landscape: it floats on the selected slide.
  const playCta = page.locator(".slide-play-cta");
  await expect(playCta).toHaveCount(0);
  await page.locator("[data-page-state-id=t-1] h3").click();
  await expect(playCta).toBeVisible();
  await expect(playCta).toContainText("Play from start of this slide");
  const slideBox = (await page.locator("[data-page-state-id=t-1]").boundingBox())!;
  const ctaBox = (await playCta.boundingBox())!;
  expect(Math.abs(ctaBox.y + ctaBox.height / 2 - (slideBox.y + slideBox.height))).toBeLessThan(5);
});
