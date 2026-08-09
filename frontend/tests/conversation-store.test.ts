import { beforeEach, describe, expect, it } from "vitest";

import {
  ConversationStore,
  conversationTitle,
  conversationToMarkdown,
  conversationsToJson,
  newLocalId,
  type StoredConversation
} from "../src/conversation-store";

function conversation(overrides: Partial<StoredConversation> = {}): StoredConversation {
  return {
    local_id: newLocalId(),
    title: "What is a loss?",
    created_at: 1_000,
    updated_at: 1_000,
    messages: [
      { role: "user", markdown: "What is a loss?", at: 1_000 },
      {
        role: "assistant",
        markdown: "A loss measures prediction error.",
        at: 2_000,
        citations: [{ slide_id: "t-1", label: "Slide 4", time_ms: 727_000 }]
      }
    ],
    ...overrides
  };
}

beforeEach(() => window.localStorage.clear());

describe("conversation store", () => {
  it("saves, lists newest-first, and removes conversations per lecture", () => {
    const store = new ConversationStore("demo");
    const first = conversation({ updated_at: 1_000, title: "first" });
    const second = conversation({ updated_at: 2_000, title: "second" });
    store.save(first);
    store.save(second);
    expect(store.list().map((item) => item.title)).toEqual(["second", "first"]);
    expect(new ConversationStore("other").list()).toEqual([]);

    store.remove(second.local_id);
    expect(store.list().map((item) => item.title)).toEqual(["first"]);
    expect(store.get(first.local_id)?.messages).toHaveLength(2);
  });

  it("survives corrupted storage payloads", () => {
    window.localStorage.setItem("i2ml-assistant:v1:demo:conversations", "{not json");
    const store = new ConversationStore("demo");
    expect(store.list()).toEqual([]);
    window.localStorage.setItem(
      "i2ml-assistant:v1:demo:conversations",
      JSON.stringify({ version: 1, conversations: [{ bogus: true }, conversation()] })
    );
    expect(store.list()).toHaveLength(1);
  });

  it("caps stored conversations and message history", () => {
    const store = new ConversationStore("demo");
    for (let index = 0; index < 35; index += 1) {
      store.save(conversation({ updated_at: index, title: `c${index}` }));
    }
    const list = store.list();
    expect(list).toHaveLength(30);
    expect(list[0]?.title).toBe("c34");

    const talkative = conversation({
      messages: Array.from({ length: 250 }, (_, index) => ({
        role: "user" as const,
        markdown: `m${index}`,
        at: index
      }))
    });
    store.save(talkative);
    expect(store.get(talkative.local_id)?.messages).toHaveLength(200);
    expect(store.get(talkative.local_id)?.messages[0]?.markdown).toBe("m50");
  });

  it("persists assistant settings with defaults", () => {
    const store = new ConversationStore("demo");
    expect(store.loadSettings()).toEqual({ language: "en", answer_style: "concise" });
    store.saveSettings({ language: "de", answer_style: "detailed" });
    expect(new ConversationStore("demo").loadSettings()).toEqual({
      language: "de",
      answer_style: "detailed"
    });
  });
});

describe("export formats", () => {
  it("renders a readable Markdown transcript with citations and the AI caveat", () => {
    const markdown = conversationToMarkdown(conversation(), {
      id: "i2ml-02-01",
      title: "Linear Models with L2 Loss"
    });
    expect(markdown).toContain("# Lecture assistant — Linear Models with L2 Loss");
    expect(markdown).toContain("- Lecture: i2ml-02-01");
    expect(markdown).toContain("What is a loss?");
    expect(markdown).toContain("A loss measures prediction error.");
    expect(markdown).toContain("*Citations: Slide 4*");
    expect(markdown).toContain("AI-generated answers can be wrong");
  });

  it("exports machine-readable JSON with settings and every conversation", () => {
    const parsed = JSON.parse(
      conversationsToJson(
        [conversation({ title: "a" }), conversation({ title: "b" })],
        { id: "demo", title: "Demo" },
        { language: "en", answer_style: "concise" }
      )
    ) as { format: string; conversations: unknown[]; settings: { language: string } };
    expect(parsed.format).toBe("i2ml-lecture-assistant-export");
    expect(parsed.conversations).toHaveLength(2);
    expect(parsed.settings.language).toBe("en");
  });

  it("truncates long titles", () => {
    expect(conversationTitle("  spaced   question  ")).toBe("spaced question");
    expect(conversationTitle("x".repeat(80))).toHaveLength(58);
    expect(conversationTitle("x".repeat(80)).endsWith("…")).toBe(true);
    expect(conversationTitle("")).toBe("Conversation");
  });
});
