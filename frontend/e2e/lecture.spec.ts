import { expect, test } from "@playwright/test";

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

test.beforeEach(async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/v1/lectures/demo", (route) => route.fulfill({ json: manifest }));
  await page.goto("/");
  await page.setContent(`
    <!doctype html><html><head>
      <link rel="stylesheet" href="http://127.0.0.1:4173/lecture/lecture-app.css">
    </head><body></body></html>`);
  await page.addScriptTag({
    type: "module",
    url: "http://127.0.0.1:4173/lecture/lecture-app.js"
  });
  await page.evaluate(async () => {
    await customElements.whenDefined("i2ml-lecture-app");
    const lecture = document.createElement("i2ml-lecture-app");
    lecture.dataset.lectureId = "demo";
    document.body.append(lecture);
  });
  // Surface custom-element upgrade failures in the test output instead of timing out opaquely.
  expect(pageErrors).toEqual([]);
});

test("slide-only lecture is keyboard accessible and has no video player", async ({ page }) => {
  await expect(page.getByRole("region", { name: "Synchronized lecture" })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Corrected slides" })).toBeVisible();
  await expect(page.getByLabel("Scrollable slides")).toContainText("Selectable slide text");
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator(".qa-debug-trace")).toHaveCount(0);
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
  await page.locator("i2ml-lecture-app").evaluate((current) => current.remove());
  await page.evaluate(async () => {
    const lecture = document.createElement("i2ml-lecture-app");
    lecture.dataset.lectureId = "demo";
    lecture.dataset.qaDebug = "true";
    document.body.append(lecture);
  });
  await expect(page.getByLabel("Scrollable slides")).toContainText("Selectable slide text");
  await page.getByRole("button", { name: "Open course assistant" }).click();

  const trace = page.locator(".qa-debug-trace");
  await expect(trace).not.toHaveAttribute("open", "");
  await page.getByLabel("Question").fill("Show the trace.");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(trace.locator("summary")).toContainText("2 events");
  await expect(trace.locator("pre")).toHaveText(
    "[001] prompt — system message\nSystem text\n\n" +
    "[002] provider_response — provider reasoning\nReasoning text"
  );
  expect(submitted).toMatchObject({ debug: true, question: "Show the trace." });
});

test("mobile assistant disclosure is compact and keyboard operable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = page.locator(".chat-panel");
  const toggle = page.locator("[data-action=toggle-assistant]");
  await expect(toggle).toHaveAccessibleName("Open course assistant");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-controls", await panel.getAttribute("id") as string);

  await toggle.focus();
  await toggle.press("Enter");

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAccessibleName("Hide course assistant");
  await expect(page.getByRole("complementary", { name: "Course assistant" })).toBeVisible();
  await expect(page.getByText("The assistant can be wrong.")).toBeVisible();
  await expect(page.getByText("Student notice placeholder.")).toBeVisible();
  expect(await panel.getAttribute("aria-modal")).toBeNull();
  expect((await panel.boundingBox())?.width).toBeLessThanOrEqual(390);

  const close = panel.getByRole("button", { name: "Close", exact: true });
  await close.focus();
  await close.press("Space");
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAccessibleName("Open course assistant");
  await expect(toggle).toBeFocused();
  await expect(page.getByRole("tab", { name: "Corrected slides" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
});

test("print retains slides and downloads but hides interactive media and assistant controls", async ({
  page
}) => {
  await page.getByRole("button", { name: "Open course assistant" }).click();
  await page.emulateMedia({ media: "print" });

  await expect(page.getByLabel("Lecture media")).toBeHidden();
  await expect(page.locator(".assistant-column")).toBeHidden();
  await expect(page.getByRole("tablist", { name: "Slide revision" })).toBeHidden();
  await expect(page.getByRole("tabpanel", { name: "Corrected slides" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download slides (PDF)" })).toBeVisible();
});
