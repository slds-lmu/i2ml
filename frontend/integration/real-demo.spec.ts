import { expect, test } from "@playwright/test";

const lectureUrl = "/chapters/01_ml_basics/01-01-what_is_ml/";
const pilotRoutes = [
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
  await expect(page.getByRole("tab", { name: "Recorded slides" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.locator(".pdf-page").first()).toBeVisible();
  await expect(page.locator(".pdf-page canvas").first()).toBeVisible();
  await expect(page.locator(".pdf-text-layer").first()).not.toBeEmpty();
  await expect(page.getByRole("link", { name: /Download slides/ })).toHaveAttribute(
    "href",
    /pilot-assets\/pdfs\/[a-f0-9]{64}\.pdf/
  );
  await page.evaluate(() => {
    const state = window as typeof window & { __printCalled?: boolean };
    state.__printCalled = false;
    window.print = () => {
      state.__printCalled = true;
    };
  });
  await page.getByRole("button", { name: "Print slides" }).click();
  await expect.poll(
    () => page.evaluate(() => (window as typeof window & { __printCalled?: boolean }).__printCalled)
  ).toBe(true);
  expect(await page.locator(".pdf-page").count()).toBeGreaterThan(1);
  expect(await page.locator(".pdf-page canvas").count()).toBe(
    await page.locator(".pdf-page").count()
  );
  await expect(page.locator(".pdf-page-loading")).toHaveCount(0);
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

  await page.getByRole("button", { name: "Open course assistant" }).click();
  await page.getByLabel("Question").fill("Exercise the complete local debug trace.");
  await page.getByRole("button", { name: "Ask" }).click();
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
  await page.getByRole("button", { name: "Open course assistant" }).click();
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
  const capture = page.getByRole("button", { name: "Use selected slide text" });
  const pointerTarget = await capture.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    const target = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2
    );
    return {
      inside: target === button || button.contains(target),
      button: {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom
      },
      target: target?.outerHTML.slice(0, 300) ?? null
    };
  });
  expect(pointerTarget.inside, JSON.stringify(pointerTarget)).toBe(true);
  await capture.click();
  await expect(page.locator(".selection-chip")).toContainText(selectedText);
  await page.getByLabel("Question").fill("Explain this selected text.");
  await page.getByRole("button", { name: "Ask" }).click();
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

test("all pilot routes load their real presentation modes and teaching assets", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  for (const [lectureId, route, mode] of pilotRoutes) {
    await page.goto(route);
    await expect(page.locator(`i2ml-lecture-app[data-lecture-id="${lectureId}"]`)).toBeVisible();
    await expect(page.locator(".pdf-page").first()).toBeVisible();
    await expect(page.locator(".pdf-page canvas").first()).toBeVisible();
    if (mode === "slide-only" || mode === "external") {
      await expect(page.locator(".video-container iframe")).toHaveCount(0);
      await expect(page.locator(".sync-toolbar")).toBeHidden();
    } else {
      await expect(page.locator(".video-container iframe")).toHaveCount(1);
    }
    if (mode === "two-deck") {
      await expect(page.locator(".pdf-download a")).toHaveCount(2);
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

  await expect(page.getByRole("tab", { name: "Corrected slides" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.locator(`[data-page-state-id="${teachingId}"]`)).toHaveAttribute(
    "aria-current",
    "true"
  );
  await expect.poll(() => page.evaluate(
    () => (window as typeof window & { __integrationSeekTimes?: number[] })
      .__integrationSeekTimes ?? []
  )).toContain(12.5);
  expect(new URL(page.url()).searchParams.get("slide")).toBe(teachingId);
  expect(new URL(page.url()).searchParams.get("time")).toBe("12.5");
  expect(await page.evaluate(
    () => (window as typeof window & { __pushStateCalls?: number }).__pushStateCalls
  )).toBe(0);

  const corrected = page.getByRole("tab", { name: "Corrected slides" });
  await corrected.focus();
  await corrected.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Recorded slides" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Recorded slides" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
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
});

test("desktop assistant and narrow mobile layout preserve PDF text geometry", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(lectureUrl);
  await expect(page.locator(".pdf-page canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Open course assistant" }).click();

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
    const canvas = document.querySelector<HTMLCanvasElement>(".pdf-page canvas")!;
    const text = document.querySelector<HTMLElement>(".pdf-text-layer")!;
    return {
      content: content.getBoundingClientRect().width,
      media: media.getBoundingClientRect().width,
      slides: slides.getBoundingClientRect().width,
      geometryDelta: Math.abs(canvas.getBoundingClientRect().width - text.getBoundingClientRect().width)
    };
  });
  expect(desktop.content).toBeGreaterThan(1200);
  expect(desktop.media).toBeGreaterThan(350);
  expect(desktop.slides).toBeGreaterThan(350);
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
