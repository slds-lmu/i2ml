import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantPanel, type AssistantHost } from "../src/assistant";
import { ConversationStore } from "../src/conversation-store";

const SERVER_ID = "a".repeat(36);
const originalFetch = globalThis.fetch;

function sseResponse(events: string): Response {
  return new Response(events, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

function answerStream(answer: string, conversationId = SERVER_ID): string {
  return (
    `event: delta\ndata: ${JSON.stringify({ text: answer })}\n\n` +
    "event: final\ndata: " +
    JSON.stringify({
      answer_markdown: answer,
      citations: [{ slide_id: "t-1", label: "Slide 4" }],
      conversation_id: conversationId
    }) +
    "\n\n"
  );
}

function makeHost(): AssistantHost {
  return {
    lectureId: () => "demo",
    lectureTitle: () => "Demo lecture",
    contentRevision: () => "revision-1234",
    hasVideo: () => true,
    citationTimeMs: (slideId) => (slideId === "t-1" ? 727_000 : undefined),
    prepareQuestion: async () => ({ pageStateIds: ["t-1"] }),
    openCitation: vi.fn(),
    seekVideo: vi.fn(),
    announce: vi.fn()
  };
}

async function askQuestion(container: HTMLElement, question: string): Promise<void> {
  const settled = ".chat-message.is-assistant:not(.is-thinking)";
  const before = container.querySelectorAll(settled).length;
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea[name=question]")!;
  textarea.value = question;
  container
    .querySelector<HTMLFormElement>(".chat-form")!
    .dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => {
    expect(container.querySelectorAll(settled).length).toBe(before + 1);
    expect(
      container.querySelector<HTMLButtonElement>(".chat-form button[type=submit]")?.disabled
    ).toBe(false);
  });
}

let container: HTMLElement;

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  document.body.replaceChildren();
  globalThis.fetch = originalFetch;
});

describe("assistant panel", () => {
  it("streams an answer, stores the conversation locally, and links citations to the video", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return sseResponse(answerStream("The answer."));
    }) as typeof fetch;
    const host = makeHost();
    const panel = new AssistantPanel(container, host);
    panel.activate();
    panel.open();
    expect(
      container.querySelector<HTMLTextAreaElement>("textarea[name=question]")?.placeholder
    ).toBe("Ask about the lecture...");
    // No scope chip in the header anymore.
    expect(container.querySelector(".scope-chip")).toBeNull();

    await askQuestion(container, "Why L2?");
    // The input is emptied as soon as the question is sent (checked settled
    // here; the e2e suite covers the mid-stream state).
    expect(
      container.querySelector<HTMLTextAreaElement>("textarea[name=question]")?.value
    ).toBe("");

    expect(payloads[0]).toMatchObject({
      lecture_id: "demo",
      content_revision: "revision-1234",
      page_state_ids: ["t-1"],
      question: "Why L2?"
    });
    expect(payloads[0]).not.toHaveProperty("language");
    expect(payloads[0]).not.toHaveProperty("answer_style");
    expect(container.querySelector(".chat-message.is-assistant")?.textContent).toContain(
      "The answer."
    );
    const citations = [...container.querySelectorAll<HTMLButtonElement>(".chat-citations button")];
    expect(citations.map((button) => button.textContent?.trim())).toEqual([
      "Slide 4",
      "▶ 12:07 in video"
    ]);
    // Every bubble carries a hover copy control with a plain title tooltip.
    const copyButtons = container.querySelectorAll<HTMLButtonElement>(".chat-message .chat-copy");
    expect(copyButtons).toHaveLength(2);
    expect(copyButtons[0]?.title).toBe("copy");
    citations[1]!.click();
    expect(host.seekVideo).toHaveBeenCalledWith(727_000);

    const stored = new ConversationStore("demo").list();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.title).toBe("Why L2?");
    expect(stored[0]?.server_id).toBe(SERVER_ID);
    expect(stored[0]?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(stored[0]?.messages[1]?.citations?.[0]?.time_ms).toBe(727_000);
  });

  it("recovers with a fresh context when the stored server conversation expired", async () => {
    let call = 0;
    const payloads: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      call += 1;
      if (call === 1) return sseResponse(answerStream("First."));
      if (call === 2) return new Response("conversation expired", { status: 409 });
      return sseResponse(answerStream("Recovered."));
    }) as typeof fetch;
    const panel = new AssistantPanel(container, makeHost());
    panel.activate();
    panel.open();

    await askQuestion(container, "First question");
    expect(payloads[0]?.conversation_id).toBeUndefined();

    await askQuestion(container, "Second question");
    expect(payloads[1]?.conversation_id).toBe(SERVER_ID);
    expect(payloads[2]?.conversation_id).toBeUndefined();
    expect(container.querySelector(".chat-notice")?.textContent).toContain(
      "server-side memory of this conversation expired"
    );
    expect(container.querySelectorAll(".chat-message.is-assistant")).toHaveLength(2);
    const stored = new ConversationStore("demo").list();
    expect(stored[0]?.server_context_lost).toBe(true);
    expect(stored[0]?.messages).toHaveLength(4);
  });

  it("restores stored conversations from the picker and starts new ones", async () => {
    globalThis.fetch = vi.fn(async () => sseResponse(answerStream("Answer one."))) as typeof fetch;
    const first = new AssistantPanel(container, makeHost());
    first.activate();
    first.open();
    await askQuestion(container, "Persisted question");
    first.destroy();
    container.replaceChildren();

    const panel = new AssistantPanel(container, makeHost());
    panel.activate();
    panel.open();
    expect(container.querySelectorAll(".chat-message")).toHaveLength(0);

    container.querySelector<HTMLButtonElement>("[data-action=assistant-menu]")!.click();
    container.querySelector<HTMLButtonElement>("[data-action=show-conversations]")!.click();
    const openButton = container.querySelector<HTMLButtonElement>(".conversation-open")!;
    expect(openButton.textContent).toContain("Persisted question");
    openButton.click();

    await vi.waitFor(() => {
      expect(container.querySelectorAll(".chat-message")).toHaveLength(2);
    });
    expect(container.querySelector(".chat-message.is-assistant")?.textContent).toContain(
      "Answer one."
    );

    container.querySelector<HTMLButtonElement>("[data-action=assistant-menu]")!.click();
    container.querySelector<HTMLButtonElement>("[data-action=new-conversation]")!.click();
    expect(container.querySelectorAll(".chat-message")).toHaveLength(0);
  });

  it("arms deletion before removing a stored conversation", async () => {
    globalThis.fetch = vi.fn(async () => sseResponse(answerStream("A."))) as typeof fetch;
    const panel = new AssistantPanel(container, makeHost());
    panel.activate();
    panel.open();
    await askQuestion(container, "Deletable");

    container.querySelector<HTMLButtonElement>("[data-action=assistant-menu]")!.click();
    container.querySelector<HTMLButtonElement>("[data-action=show-conversations]")!.click();
    const armed = container.querySelector<HTMLButtonElement>(".conversation-delete")!;
    armed.click();
    expect(new ConversationStore("demo").list()).toHaveLength(1);
    container.querySelector<HTMLButtonElement>(".conversation-delete")!.click();
    expect(new ConversationStore("demo").list()).toHaveLength(0);
    expect(container.querySelector(".conversation-list-empty")?.hasAttribute("hidden")).toBe(false);
  });

  it("offers History and New chat shortcuts in the header, mirroring the menu", async () => {
    globalThis.fetch = vi.fn(async () => sseResponse(answerStream("A."))) as typeof fetch;
    const panel = new AssistantPanel(container, makeHost());
    panel.activate();
    panel.open();
    const history = container.querySelector<HTMLButtonElement>(
      ".chat-header .assistant-header-icon[data-action=show-conversations]"
    )!;
    const newChat = container.querySelector<HTMLButtonElement>(
      ".chat-header .assistant-header-icon[data-action=new-conversation]"
    )!;
    expect(history.title).toBe("History");
    expect(newChat.title).toBe("New chat");

    await askQuestion(container, "Header question");
    expect(container.querySelectorAll(".chat-message")).toHaveLength(2);

    // Header "New chat" starts a fresh conversation like the menu entry.
    newChat.click();
    expect(container.querySelectorAll(".chat-message")).toHaveLength(0);

    // Header "History" opens the stored-conversations list.
    history.click();
    const list = container.querySelector<HTMLElement>(".conversation-list")!;
    expect(list.hidden).toBe(false);
    expect(container.querySelector(".conversation-open")?.textContent).toContain(
      "Header question"
    );
    expect(history.getAttribute("aria-pressed")).toBe("true");

    // Clicking History while the list shows toggles back to the chat,
    // exactly like "Back to chat".
    history.click();
    expect(list.hidden).toBe(true);
    expect(history.getAttribute("aria-pressed")).toBe("false");
    history.click();
    expect(list.hidden).toBe(false);

    // The menu entries stay wired too — every control with the action fires.
    container.querySelector<HTMLButtonElement>("[data-action=close-conversations]")!.click();
    expect(list.hidden).toBe(true);
    container.querySelector<HTMLButtonElement>("[data-action=assistant-menu]")!.click();
    container
      .querySelector<HTMLButtonElement>(".assistant-menu [data-action=show-conversations]")!
      .click();
    expect(list.hidden).toBe(false);
  });

  it("persists language and answer-style preferences without sending them to the backend", () => {
    const panel = new AssistantPanel(container, makeHost());
    panel.activate();
    const language = container.querySelector<HTMLSelectElement>("select[data-setting=language]")!;
    language.value = "de";
    language.dispatchEvent(new Event("change"));
    expect(new ConversationStore("demo").loadSettings().language).toBe("de");
    const style = container.querySelector<HTMLSelectElement>(
      "select[data-setting=answer-style]"
    )!;
    style.value = "detailed";
    style.dispatchEvent(new Event("change"));
    expect(new ConversationStore("demo").loadSettings().answer_style).toBe("detailed");
  });
});
