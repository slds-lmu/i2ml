import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

interface CourseBinding {
  lecture_id: string;
  internal_path: string;
  presentation_mode: "video_lecture" | "slide_only" | "external_link_only";
  fallback_pdf_urls: string[];
}

const bindingDocument = JSON.parse(
  readFileSync("/workspace/i2ml/data/lecture_bindings.json", "utf8")
) as {
  content_revision: string;
  bindings: Record<string, CourseBinding>;
};
const courseBindings = Object.entries(bindingDocument.bindings);
const supplementBindings = courseBindings.filter(([contentPath]) =>
  readFileSync(`/workspace/i2ml/${contentPath}`, "utf8").includes(
    "<!-- modern-lecture:supplements -->"
  )
);
const legacyRoutes = [
  "/chapters/06_cart/06-08-literature/",
  "/chapters/07_forests/07-06-literature/",
  "/chapters/09_tuning/further-material/",
  "/chapters/11_advriskmin/11-19-literature/",
  "/chapters/13_information_theory/13-12-literature/",
  "/chapters/15_regularization/15-15-literature/",
  "/chapters/18_boosting/18-13-literature/",
  "/chapters/19_gaussian_processes/19-06-literature/",
  "/chapters/21_feature_selection/21-06-literature/"
];

const lectureUrl = "/chapters/01_ml_basics/01-01-what_is_ml/";
const representativeRoutes = [
  ["i2ml-01-01", lectureUrl, "video"],
  ["i2ml-03-06", "/chapters/03_supervised_classification/03-06-classification-naivebayes/", "video"],
  ["i2ml-04-11", "/chapters/04_evaluation/04-11-partialauc-mcauc/", "two-deck"],
  ["i2ml-06-02", "/chapters/06_cart/06-02-treegrowing/", "video"],
  ["i2ml-08-06", "/chapters/08_neural_networks/08-06-history/", "slide-only"],
  ["i2ml-08-07", "/chapters/08_neural_networks/08-07-backprob1/", "external"],
  ["sl-11-01", "/chapters/11_advriskmin/11-01-risk-minimizer/", "video"],
  ["sl-13-01", "/chapters/13_information_theory/13-01-entropy/", "video"],
  ["appml-21-01", "/chapters/21_feature_selection/21-01-introduction/", "video"],
  ["appml-22-05", "/chapters/22_preprocessing/22-05-leakage/", "slide-only"],
  ["advml-24-01", "/chapters/24_imbalanced_learning/24-01-intro/", "video"]
] as const;

test.beforeEach(async ({ page }) => {
  await page.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
        window.YT = {
          PlayerState: { PLAYING: 1 },
          Player: class {
            constructor(element, options) {
              this.time = 0;
              this.state = 2;
              this.options = options;
              window.__integrationPlayerVars = options.playerVars;
              const iframe = document.createElement("iframe");
              iframe.title = "Fake YouTube player for browser integration testing";
              element.append(iframe);
              setTimeout(() => options.events.onReady(), 0);
            }
            destroy() {}
            getCurrentTime() { return this.time; }
            getPlayerState() { return this.state; }
            pauseVideo() { this.state = 2; this.options.events.onStateChange({ data: 2 }); }
            playVideo() { this.state = 1; this.options.events.onStateChange({ data: 1 }); }
            seekTo(seconds) {
              this.time = seconds;
              window.__integrationSeekTimes = [...(window.__integrationSeekTimes || []), seconds];
            }
          }
        };
        setTimeout(() => window.onYouTubeIframeAPIReady?.(), 0);
      `
    })
  );
});

test("combined FastAPI/Hugo demo loads the real release DTO and PDF", async ({ page }) => {
  const errors: string[] = [];
  const cdnRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/cdn\.|unpkg|jsdelivr|cdnjs/i.test(request.url())) cdnRequests.push(request.url());
  });
  await page.goto(lectureUrl);
  await expect(page.getByRole("region", { name: "Synchronized lecture" })).toBeVisible();
  await expect(page.locator(".qa-debug-trace")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Slides as in video" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.locator(".pdf-page").first()).toBeVisible();
  await expect(page.locator(".pdf-page canvas").first()).toBeVisible();
  await expect(page.locator(".pdf-text-layer").first()).not.toBeEmpty();
  // The PDF menu is gone: downloads live below the video and in the slide list.
  await expect(page.locator(".pdf-menu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Print slides" })).toHaveCount(0);
  await expect(page.locator("[data-lecture-downloads] .lecture-download-link")).toHaveAttribute(
    "href",
    /course-assets\/pdfs\/[a-f0-9]{64}\.pdf/
  );
  await page.getByRole("button", { name: "Slides", exact: true }).click();
  await expect(page.locator(".toc-download-link")).toHaveAttribute(
    "href",
    /course-assets\/pdfs\/[a-f0-9]{64}\.pdf/
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => Boolean((window as typeof window & { MathJax?: { startup?: { promise?: unknown } } }).MathJax?.startup?.promise)
  );
  await page.evaluate(async () => {
    const host = document.createElement("div");
    host.id = "mathjax-integration";
    host.textContent = String.raw`
      \(\mathbb{P}_{xy}, \mathbf{x}^{(i)}, \mathcal{R}(f)\)
      $$\begin{aligned}
        f^{\ast}_{\mathcal{H}_{\text{all}}}
        &= \mathop{\mathrm{arg\,min}}_{f \in \mathcal{H}_{\text{all}}}
           \mathbb{E}_{xy}\left[L\left(y,f(\mathbf{x})\right)\right]
      \end{aligned}$$
      $$\begin{gathered}a=b\\c=d\end{gathered}$$
    `;
    document.body.append(host);
    const mathJax = (
      window as typeof window & {
        MathJax: {
          startup: { promise: Promise<unknown> };
          typesetPromise: (nodes: HTMLElement[]) => Promise<unknown>;
        };
      }
    ).MathJax;
    await mathJax.startup.promise;
    await mathJax.typesetPromise([host]);
  });
  const renderedMath = page.locator("#mathjax-integration mjx-container");
  await expect(renderedMath).toHaveCount(3);
  await expect(renderedMath.first()).toBeVisible();
  await expect(page.locator("#mathjax-integration mjx-merror")).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(cdnRequests).toEqual([]);
});

test("production backend omits a requested trace when its server gate is off", async ({
  page
}) => {
  const lecture = await page.request.get("/api/v1/lectures/i2ml-01-01");
  const dto = await lecture.json() as {
    content_revision: string;
    revision_mapping: {
      page_states: Array<{ teaching_content_page_state_ids: string[] }>;
    };
  };
  const pageStateId = dto.revision_mapping.page_states
    .flatMap((mapping) => mapping.teaching_content_page_state_ids)[0];
  expect(pageStateId).toBeTruthy();
  const response = await page.request.post("/api/v1/chat", {
    data: {
      lecture_id: "i2ml-01-01",
      content_revision: dto.content_revision,
      page_state_ids: [pageStateId],
      question: "Production trace gate integration check.",
      debug: true
    }
  });
  expect(response.ok()).toBe(true);
  expect(await response.json()).not.toHaveProperty("debug_trace");
});

test("debug Hugo and FastAPI render the ordered provider and tool trace", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  page.on("request", (request) => {
    if (request.url() !== "http://127.0.0.1:8002/api/v1/chat/stream") return;
    submitted = request.postDataJSON() as Record<string, unknown>;
  });

  await page.goto(`http://127.0.0.1:8002${lectureUrl}`);
  const app = page.locator("i2ml-lecture-app");
  await expect(app).toHaveAttribute("data-qa-debug", "true");
  const trace = page.locator(".qa-debug-trace");
  await expect(trace).toHaveCount(1);
  await expect(trace).not.toHaveAttribute("open", "");

  await page.getByRole("button", { name: "Ask about this lecture" }).click();
  await page.getByLabel("Question").fill("Exercise the complete local debug trace.");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".chat-message.is-assistant")).toContainText(
    "Integration debug answer from the local provider."
  );
  await expect(trace.locator("summary")).toContainText(/\([1-9][0-9]* events\)/);
  await trace.locator("summary").click();

  const output = trace.locator("pre");
  await expect(output).toContainText("prompt — system policy message");
  await expect(output).toContainText("prompt — stable lecture context message");
  await expect(output).toContainText("provider_request — DeepSeek request 1, attempt 1");
  await expect(output).toContainText("provider_response — provider reasoning 1");
  await expect(output).toContainText("tool_call — tool call 1: search_course");
  await expect(output).toContainText("tool_result — validated tool result 1: search_course");
  await expect(output).toContainText("final — final plain-text answer");
  await expect(output).toContainText("Integration-only reasoning before requesting");
  await expect(output).toContainText("Exercise the complete local debug trace.");
  await expect(output).not.toContainText("browser-integration-test-only");

  const sequences = (await output.textContent())
    ?.match(/^\[(\d+)]/gm)
    ?.map((value) => Number(value.slice(1, -1))) ?? [];
  expect(sequences.length).toBeGreaterThan(8);
  expect(sequences).toEqual(sequences.map((_, index) => index + 1));
  expect(submitted).toMatchObject({
    debug: true,
    lecture_id: "i2ml-01-01",
    question: "Exercise the complete local debug trace."
  });
});

test("selection payload and malicious streamed answer remain safe", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/v1/chat/stream", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    const pageStateId = (submitted.page_state_ids as string[])[0];
    const final = {
      answer_markdown:
        "Grounded answer <img src=x onerror=window.__xss=1> " +
        "$\\href{javascript:window.__mathxss=1}{CLICK}$ [[slide:" + pageStateId + "]]",
      citations: [{ slide_id: pageStateId, label: "Referenced slide" }],
      conversation_id: "integration_conversation",
      model: "fake-provider",
      content_revision: submitted.content_revision,
      prompt_version: "test",
      finish_reason: "stop",
      tool_count: 0,
      usage: {}
    };
    await route.fulfill({
      contentType: "text/event-stream",
      body:
        `event: delta\ndata: {"text":"Grounded answer"}\n\n` +
        `event: final\ndata: ${JSON.stringify(final)}\n\n`
    });
  });
  await page.goto(lectureUrl);
  await expect(page.locator(".pdf-text-layer span").first()).toBeVisible();
  const teachingText = await page.evaluate(async () => {
    const lecture = await fetch("/api/v1/lectures/i2ml-01-01").then((response) => response.json());
    const teachingId = lecture.revision_mapping.page_states[0].teaching_content_page_state_ids[0];
    return lecture.page_states[teachingId].text as string;
  });
  const selectedText = await page.locator(".pdf-page").first().evaluate((slide, allowedText) => {
    for (const span of slide.querySelectorAll(".pdf-text-layer span")) {
      const value = span.textContent ?? "";
      for (const match of value.matchAll(/[A-Za-z]{2,}/g)) {
        const candidate = match[0];
        if (!allowedText.toLocaleLowerCase().includes(candidate.toLocaleLowerCase())) continue;
        const textNode = span.firstChild;
        if (!(textNode instanceof Text) || match.index === undefined) continue;
        const range = document.createRange();
        range.setStart(textNode, match.index);
        range.setEnd(textNode, match.index + candidate.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return candidate;
      }
    }
    return "";
  }, teachingText);
  expect(selectedText).toBeTruthy();
  const popover = page.locator(".selection-popover");
  await expect(popover).toBeVisible();
  const pointerTarget = await popover.getByRole("button", { name: "Ask about this" })
    .evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      const target = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      );
      return {
        inside: target === button || button.contains(target),
        target: target?.outerHTML.slice(0, 300) ?? null
      };
    });
  expect(pointerTarget.inside, JSON.stringify(pointerTarget)).toBe(true);
  await popover.getByRole("button", { name: "Ask about this" }).click();
  await expect(page.locator(".chat-panel")).toBeVisible();
  await expect(page.locator(".selection-chip")).toContainText(selectedText);
  await page.getByLabel("Question").fill("Explain this selected text.");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("button", { name: "Referenced slide" })).toBeVisible();
  await expect(page.locator(".chat-message.is-assistant img")).toHaveCount(0);
  await expect(page.locator(".chat-message.is-assistant")).not.toContainText("[[slide:");
  await expect(page.locator(".chat-message.is-assistant mjx-container")).toBeVisible();
  await expect(page.locator(".chat-message.is-assistant mjx-container a")).toHaveCount(0);
  await expect(page.locator(
    ".chat-message.is-assistant mjx-container [href], " +
    ".chat-message.is-assistant mjx-container [data-mjx-href]"
  )).toHaveCount(0);
  await page.locator(".chat-message.is-assistant mjx-container").click();
  expect(await page.evaluate(() => (window as typeof window & { __xss?: number }).__xss)).toBe(
    undefined
  );
  expect(
    await page.evaluate(() => (window as typeof window & { __mathxss?: number }).__mathxss)
  ).toBe(undefined);
  expect(submitted).toMatchObject({
    lecture_id: "i2ml-01-01",
    question: "Explain this selected text."
  });
  expect(submitted).not.toHaveProperty("debug");
  expect((submitted?.selection as { text?: string } | undefined)?.text).toBeTruthy();
});

test("every course binding resolves through the site and checksum-gated backend", async ({
  request
}) => {
  test.setTimeout(180_000);
  const failures: string[] = [];
  const modeCounts: Record<string, number> = {};
  for (const [contentPath, binding] of courseBindings) {
    const siteResponse = await request.get(binding.internal_path);
    const html = await siteResponse.text();
    if (!siteResponse.ok()) failures.push(`${binding.lecture_id}: site ${siteResponse.status()}`);
    if (!html.includes(`data-lecture-id="${binding.lecture_id}"`)) {
      failures.push(`${binding.lecture_id}: site binding missing for ${contentPath}`);
    }
    for (const pdfUrl of binding.fallback_pdf_urls) {
      if (!html.includes(pdfUrl)) failures.push(`${binding.lecture_id}: missing PDF fallback`);
    }

    const apiResponse = await request.get(`/api/v1/lectures/${binding.lecture_id}`);
    if (!apiResponse.ok()) {
      failures.push(`${binding.lecture_id}: API ${apiResponse.status()}`);
      continue;
    }
    const lecture = await apiResponse.json() as {
      lecture_id: string;
      content_revision: string;
      presentation: { mode: string };
      decks: unknown[];
    };
    if (lecture.lecture_id !== binding.lecture_id) failures.push(`${binding.lecture_id}: ID drift`);
    if (lecture.content_revision !== bindingDocument.content_revision) {
      failures.push(`${binding.lecture_id}: revision drift`);
    }
    if (lecture.presentation.mode !== binding.presentation_mode) {
      failures.push(`${binding.lecture_id}: presentation-mode drift`);
    }
    if (binding.lecture_id === "i2ml-04-11" && lecture.decks.length !== 2) {
      failures.push("i2ml-04-11: two-deck ordering was lost");
    }
    modeCounts[binding.presentation_mode] = (modeCounts[binding.presentation_mode] ?? 0) + 1;
  }

  expect(courseBindings).toHaveLength(189);
  expect(modeCounts).toEqual({
    external_link_only: 6,
    slide_only: 32,
    video_lecture: 151
  });
  expect(failures).toEqual([]);
});

test("supplementary material remains visible and non-lecture pages remain legacy", async ({
  request
}) => {
  expect(supplementBindings).toHaveLength(26);
  for (const [, binding] of supplementBindings) {
    const response = await request.get(binding.internal_path);
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('aria-label="Supplementary lecture material"');
    expect(html).toContain("data-lecture-supplements");
    // Lecture pages get the thin top bar (with hamburger menu) and the
    // server-rendered heading/nav slots instead of the legacy header.
    expect(html).toContain('class="lecture-topbar"');
    expect(html).toContain("lecture-topbar-menu");
    expect(html).toContain("data-lecture-heading");
    expect(html).toContain('class="has-modern-lecture"');
    expect(html).not.toContain('id="nav-border"');
  }
  for (const route of legacyRoutes) {
    const response = await request.get(route);
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).not.toContain("<i2ml-lecture-app");
    // Non-lecture pages keep the untouched theme header.
    expect(html).toContain('id="nav-border"');
    expect(html).not.toContain("lecture-topbar");
  }
});

test("representative course routes load their real presentation modes and teaching assets", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  for (const [lectureId, route, mode] of representativeRoutes) {
    await page.goto(route);
    await expect(page.locator(`i2ml-lecture-app[data-lecture-id="${lectureId}"]`)).toBeVisible();
    await expect(page.locator(".pdf-page").first()).toBeVisible();
    await expect(page.locator(".pdf-page canvas").first()).toBeVisible();
    if (mode === "slide-only" || mode === "external") {
      await expect(page.locator(".video-container iframe")).toHaveCount(0);
      await expect(page.locator(".video-statusbar")).toBeHidden();
    } else {
      await expect(page.locator(".video-container iframe")).toHaveCount(1);
    }
    if (mode === "two-deck") {
      await expect(page.locator("[data-lecture-downloads] .lecture-download-link")).toHaveCount(2);
    }
    if (mode === "external") {
      await expect(page.getByRole("link", { name: "Open the externally hosted lecture video" }))
        .toHaveAttribute("href", /drive\.google\.com/);
    }
    if (lectureId === "i2ml-03-06") {
      await expect(page.getByRole("region", { name: "Supplementary lecture material" }))
        .toContainText("Comparison of classification methods");
      await expect(page.locator(".lecture-supplements .quizdown")).toHaveCount(1);
    }
  }
  expect(pageErrors).toEqual([]);
});

test("deep links, revision-tab keys, and URL replacement work without history spam", async ({
  page
}) => {
  const response = await page.request.get("/api/v1/lectures/i2ml-01-01");
  const dto = await response.json() as { page_states: Record<string, unknown> };
  const teachingId = Object.keys(dto.page_states)[2];
  expect(teachingId).toBeTruthy();
  await page.addInitScript(() => {
    const original = history.pushState.bind(history);
    (window as typeof window & { __pushStateCalls?: number }).__pushStateCalls = 0;
    history.pushState = (...arguments_: Parameters<History["pushState"]>) => {
      (window as typeof window & { __pushStateCalls?: number }).__pushStateCalls! += 1;
      return original(...arguments_);
    };
  });

  await page.goto(
    `${lectureUrl}?lecture=i2ml-01-01&slide=${encodeURIComponent(teachingId!)}&time=12.5`
  );

  await expect(page.getByRole("tab", { name: "Updated slides" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.locator(`[data-page-state-id="${teachingId}"]`)).toHaveAttribute(
    "aria-current",
    "true"
  );
  // The requested time cues the player via playerVars (no seek+pause, which
  // would leave an unstarted player as a black box).
  await expect.poll(() => page.evaluate(
    () => (window as typeof window & { __integrationPlayerVars?: { start?: number } })
      .__integrationPlayerVars?.start
  )).toBe(12);
  await expect(page.locator("[data-time-now]")).toHaveText("0:12");
  expect(new URL(page.url()).searchParams.get("slide")).toBe(teachingId);
  expect(new URL(page.url()).searchParams.get("time")).toBe("12.5");
  expect(await page.evaluate(
    () => (window as typeof window & { __pushStateCalls?: number }).__pushStateCalls
  )).toBe(0);

  const corrected = page.getByRole("tab", { name: "Updated slides" });
  await corrected.focus();
  await corrected.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Slides as in video" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Slides as in video" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
});

test("revision toggle preserves the strip's top-position line on real PDFs", async ({ page }) => {
  // 02-01 ships both revisions with real (lazily rendered) PDF decks.
  await page.goto("/chapters/02_supervised_regression/02-01-l2-loss/");
  await expect(page.locator(".pdf-page canvas").first()).toBeVisible({ timeout: 20_000 });

  const lineHit = () =>
    page.evaluate(() => {
      const strip = document.querySelector<HTMLElement>(".slide-scroll")!;
      const line = strip.getBoundingClientRect().top + 16;
      const sections = [...document.querySelectorAll<HTMLElement>(".pdf-page, .structured-slide")];
      const hit = sections.find((section) => section.getBoundingClientRect().bottom > line)
        ?? sections.at(-1);
      // Mid-switch the strip is momentarily empty while the new PDF loads.
      if (!hit) {
        return { stateId: undefined, position: undefined, fraction: Number.NaN, rendered: false };
      }
      const rect = hit.getBoundingClientRect();
      return {
        stateId: hit.dataset.pageStateId,
        position: hit.dataset.stripPosition,
        fraction: (line - rect.top) / rect.height,
        rendered: Boolean(hit.querySelector("canvas"))
      };
    });

  // Scroll a couple of slides in, let the lazy renders settle, then take the
  // actual measured position as the reference. The wheel event marks the
  // scroll as user input (it would otherwise race the load-time placement's
  // trailing suppression window).
  await page.locator(".slide-scroll").evaluate((strip) => {
    strip.dispatchEvent(new WheelEvent("wheel", { deltaY: 1 }));
    const third = strip.querySelectorAll(".pdf-page")[2]!;
    strip.scrollTop += third.getBoundingClientRect().top - strip.getBoundingClientRect().top
      + 0.4 * third.getBoundingClientRect().height - 16;
  });
  await expect.poll(async () => (await lineHit()).rendered, { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(600);
  const reference = await lineHit();
  expect(reference.fraction).toBeGreaterThan(0);
  expect(reference.fraction).toBeLessThan(1);

  // Recorded (the default) → updated: the line must cut the mapped slide
  // (same strip position for this parallel deck) at the same height fraction.
  await page.getByRole("tab", { name: "Updated slides" }).click();
  await expect.poll(
    async () => {
      const hit = await lineHit();
      return hit.position === reference.position ? hit.fraction : Number.NaN;
    },
    { timeout: 15_000 }
  ).toBeCloseTo(reference.fraction, 1);

  // And back: the exact same slide ends up under the line again.
  await page.getByRole("tab", { name: "Slides as in video" }).click();
  await expect.poll(
    async () => {
      const hit = await lineHit();
      return hit.stateId === reference.stateId ? hit.fraction : Number.NaN;
    },
    { timeout: 15_000 }
  ).toBeCloseTo(reference.fraction, 1);
});

test("selecting a slide floats the play pill straddling the slide's bottom edge", async ({
  page
}) => {
  await page.goto(lectureUrl);
  await expect(page.locator(".pdf-page canvas").first()).toBeVisible({ timeout: 20_000 });
  // Never shown before an explicit selection, and the old toolbar button no
  // longer exists anywhere in the shell.
  await expect(page.locator(".slide-play-cta")).toHaveCount(0);
  await expect(page.locator(".play-from-slide")).toHaveCount(0);

  const first = page.locator(".pdf-page").first();
  await first.click();
  await expect(first).toHaveClass(/is-active/);
  const cta = page.locator(".slide-play-cta");
  await expect(cta).toBeVisible();
  // The title slide occurs in the video, so the pill is playable.
  await expect(cta).toBeEnabled();
  expect(
    await cta.evaluate((element) => element.closest(".pdf-page")?.classList.contains("is-active"))
  ).toBe(true);

  // Geometry on a real rendered PDF page: the pill is centred on the
  // slide's 75% point and the slide's bottom edge cuts it at ~half height.
  const slideBox = (await first.boundingBox())!;
  const ctaBox = (await cta.boundingBox())!;
  expect(
    Math.abs(ctaBox.x + ctaBox.width / 2 - (slideBox.x + slideBox.width * 0.75))
  ).toBeLessThan(8);
  expect(Math.abs(ctaBox.y + ctaBox.height / 2 - (slideBox.y + slideBox.height))).toBeLessThan(5);
});

test("PDF glyph layer matches the rendered scale and the line anchor survives resizes", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chapters/02_supervised_regression/02-01-l2-loss/");
  await expect(page.locator(".pdf-page canvas").first()).toBeVisible({ timeout: 20_000 });

  // The text layer carries the per-render scale (pdf.js sizes glyph spans
  // from it); without it, selection highlights drift along each line.
  await expect
    .poll(() =>
      page
        .locator(".pdf-text-layer")
        .first()
        .evaluate((layer) => layer.style.getPropertyValue("--scale-factor"))
    )
    .not.toBe("");
  const overflow = await page.evaluate(() => {
    const canvas = document.querySelector(".pdf-page canvas")!;
    const section = canvas.closest(".pdf-page")!;
    const canvasRight = canvas.getBoundingClientRect().right;
    let max = -Infinity;
    for (const span of section.querySelectorAll(".pdf-text-layer span")) {
      max = Math.max(max, span.getBoundingClientRect().right - canvasRight);
    }
    return max;
  });
  // Every glyph span ends inside the displayed canvas (sub-glyph tolerance).
  expect(overflow).toBeLessThan(6);

  // Line-anchor stability through a window resize with real lazy renders.
  await page.locator(".slide-scroll").evaluate((strip) => {
    strip.dispatchEvent(new WheelEvent("wheel", { deltaY: 1 }));
    const third = strip.querySelectorAll(".pdf-page")[2]!;
    strip.scrollTop += third.getBoundingClientRect().top - strip.getBoundingClientRect().top
      + 0.4 * third.getBoundingClientRect().height - 16;
  });
  await page.waitForTimeout(800);
  const fractionOfHit = () =>
    page.evaluate(() => {
      const strip = document.querySelector<HTMLElement>(".slide-scroll")!;
      const line = strip.getBoundingClientRect().top + 16;
      const sections = [...document.querySelectorAll<HTMLElement>(".pdf-page")];
      const hit = sections.find((section) => section.getBoundingClientRect().bottom > line)
        ?? sections.at(-1);
      if (!hit) return { id: undefined, fraction: Number.NaN };
      const rect = hit.getBoundingClientRect();
      return { id: hit.dataset.pageStateId, fraction: (line - rect.top) / rect.height };
    });
  const reference = await fractionOfHit();
  await page.setViewportSize({ width: 1120, height: 780 });
  await expect
    .poll(
      async () => {
        const hit = await fractionOfHit();
        return hit.id === reference.id ? hit.fraction : Number.NaN;
      },
      { timeout: 10_000 }
    )
    .toBeCloseTo(reference.fraction, 1);
});

test("slide-only pages dock the assistant as a column in landscape", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chapters/08_neural_networks/08-06-history/");
  await expect(
    page.locator(".pdf-page canvas, .structured-slide").first()
  ).toBeVisible({ timeout: 20_000 });

  const main = page.locator(".lecture-main");
  const mainBefore = (await main.boundingBox())!.width;
  await page.getByRole("button", { name: "Ask about this lecture" }).click();
  const chat = page.locator(".chat-panel");
  await expect(chat).toBeVisible();
  const box = (await chat.boundingBox())!;
  expect(box.height).toBeGreaterThan(500);
  expect(box.width).toBeGreaterThan(260);
  // A real docked column: static position, resized content, no scrim.
  expect(await chat.evaluate((element) => getComputedStyle(element).position)).toBe("static");
  expect((await main.boundingBox())!.width).toBeLessThan(mainBefore - 250);
  await expect(page.locator(".assistant-scrim")).toBeHidden();
});

test("04-11 API failure retains two distinct usable PDF fallbacks", async ({ page }) => {
  await page.route("**/api/v1/lectures/i2ml-04-11", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  );
  await page.goto("/chapters/04_evaluation/04-11-partialauc-mcauc/");

  const links = page.locator(".lecture-fallback a[href$='.pdf']");
  await expect(links).toHaveCount(2);
  const urls = await links.evaluateAll((items) => items.map((item) => (item as HTMLAnchorElement).href));
  expect(new Set(urls).size).toBe(2);
  expect(urls.every((url) => !url.toLocaleLowerCase().includes("%7c"))).toBe(true);
  for (const url of urls) expect((await page.request.get(url)).ok()).toBe(true);

  // Landscape locks the page to the viewport: the footer is a static flex
  // item, always visible at the window bottom while the columns scroll.
  const landscape = await page.locator("footer").evaluate((element) => ({
    position: getComputedStyle(element).position,
    bodyOverflow: getComputedStyle(document.body).overflowY
  }));
  expect(landscape.position).toBe("static");
  expect(landscape.bodyOverflow).toBe("hidden");
  const footer = await page.locator("footer").boundingBox();
  const viewport = page.viewportSize();
  expect(footer).not.toBeNull();
  expect(footer!.y + footer!.height).toBeGreaterThanOrEqual((viewport?.height ?? 0) - 2);

  // Portrait windows put the footer in the flow, pinned to the bottom of the
  // scroll range even when the page is shorter than the window.
  await page.setViewportSize({ width: 700, height: 1000 });
  const portraitPosition = await page
    .locator("footer")
    .evaluate((element) => getComputedStyle(element).position);
  expect(portraitPosition).toBe("static");
  const portraitFooter = await page.locator("footer").boundingBox();
  expect(portraitFooter).not.toBeNull();
  expect(portraitFooter!.y + portraitFooter!.height).toBeGreaterThanOrEqual(998);
});

test("slides render in browsers without the newest Map/Iterator/Promise APIs", async ({
  page
}) => {
  // pdfjs-dist 6 assumes map-upsert, Iterator helpers, and Promise.try; the
  // bundle ships polyfills because student browsers are often a year behind.
  await page.addInitScript(() => {
    const remove = (target: object, ...names: string[]) => {
      for (const name of names) delete (target as Record<string, unknown>)[name];
    };
    remove(Map.prototype, "getOrInsert", "getOrInsertComputed");
    remove(WeakMap.prototype, "getOrInsert", "getOrInsertComputed");
    remove(Promise, "try", "withResolvers");
    remove(Uint8Array.prototype, "toHex", "toBase64");
    remove(Uint8Array, "fromBase64", "fromHex");
    remove(Math, "sumPrecise");
    remove(Set.prototype, "intersection");
    remove(globalThis, "Iterator");
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(lectureUrl);
  await expect(page.getByRole("region", { name: "Synchronized lecture" })).toBeVisible();
  await expect(page.locator(".pdf-page canvas").first()).toBeVisible();
  await expect(page.locator(".pdf-text-layer").first()).not.toBeEmpty();
  await expect(page.locator(".lecture-status")).not.toContainText("Lecture unavailable");
  expect(errors).toEqual([]);
});

test("desktop assistant and narrow mobile layout preserve PDF text geometry", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(lectureUrl);
  await expect(page.locator(".pdf-page canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Ask about this lecture" }).click();

  await expect.poll(() => page.evaluate(() => {
    const content = document.querySelector<HTMLElement>("#content")!;
    const media = document.querySelector<HTMLElement>(".media-panel")!;
    const slides = document.querySelector<HTMLElement>(".slide-panel")!;
    const canvas = document.querySelector<HTMLCanvasElement>(".pdf-page canvas")!;
    const text = document.querySelector<HTMLElement>(".pdf-text-layer")!;
    return content.getBoundingClientRect().width > 1200 &&
      media.getBoundingClientRect().width > 350 &&
      slides.getBoundingClientRect().width > 350 &&
      Math.abs(canvas.getBoundingClientRect().width - text.getBoundingClientRect().width) < 3;
  })).toBe(true);
  const desktop = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>("#content")!;
    const media = document.querySelector<HTMLElement>(".media-panel")!;
    const slides = document.querySelector<HTMLElement>(".slide-panel")!;
    const chat = document.querySelector<HTMLElement>(".chat-panel")!;
    const canvas = document.querySelector<HTMLCanvasElement>(".pdf-page canvas")!;
    const text = document.querySelector<HTMLElement>(".pdf-text-layer")!;
    return {
      content: content.getBoundingClientRect().width,
      media: media.getBoundingClientRect().width,
      slides: slides.getBoundingClientRect().width,
      // The docked chat column bleeds to the right window edge, square.
      chatFlush: Math.abs(chat.getBoundingClientRect().right - window.innerWidth),
      chatRadius: getComputedStyle(chat).borderTopLeftRadius,
      geometryDelta: Math.abs(canvas.getBoundingClientRect().width - text.getBoundingClientRect().width)
    };
  });
  expect(desktop.content).toBeGreaterThan(1200);
  expect(desktop.media).toBeGreaterThan(350);
  expect(desktop.slides).toBeGreaterThan(350);
  expect(desktop.chatFlush).toBeLessThan(2);
  expect(desktop.chatRadius).toBe("0px");
  expect(desktop.geometryDelta).toBeLessThan(3);

  await page.setViewportSize({ width: 320, height: 800 });
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".pdf-page canvas")!;
    const text = document.querySelector<HTMLElement>(".pdf-text-layer")!;
    const canvasBounds = canvas.getBoundingClientRect();
    const spans = [...text.querySelectorAll<HTMLElement>("span")];
    const rightmost = Math.max(canvasBounds.left, ...spans.map((span) => span.getBoundingClientRect().right));
    return Math.abs(canvasBounds.width - text.getBoundingClientRect().width) < 3 &&
      rightmost - canvasBounds.right < 8 &&
      text.scrollWidth - canvasBounds.width < 8;
  })).toBe(true);
  const mobile = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".pdf-page canvas")!;
    const text = document.querySelector<HTMLElement>(".pdf-text-layer")!;
    const canvasBounds = canvas.getBoundingClientRect();
    const spans = [...text.querySelectorAll<HTMLElement>("span")];
    return {
      widthDelta: Math.abs(canvasBounds.width - text.getBoundingClientRect().width),
      overflow: Math.max(canvasBounds.left, ...spans.map((span) => span.getBoundingClientRect().right)) - canvasBounds.right,
      scrollOverflow: text.scrollWidth - canvasBounds.width
    };
  });
  expect(mobile.widthDelta).toBeLessThan(3);
  expect(mobile.overflow).toBeLessThan(8);
  expect(mobile.scrollOverflow).toBeLessThan(8);
});
