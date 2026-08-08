import { afterEach, describe, expect, it, vi } from "vitest";

import { streamChat } from "../src/chat";
import {
  normalizeQaDebugTrace,
  QaDebugTraceView
} from "../src/qa-debug";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("development QA trace", () => {
  it("validates trace records and renders their sequence order as text", () => {
    expect(normalizeQaDebugTrace({ sequence: 0, phase: "prompt", label: "bad", content: "x" }))
      .toBeUndefined();
    expect(normalizeQaDebugTrace({ sequence: 1, phase: "", label: "bad", content: "x" }))
      .toBeUndefined();

    const view = new QaDebugTraceView();
    view.add({ sequence: 2, phase: "tool_result", label: "load_slides result", content: "two" });
    view.add({
      sequence: 1,
      phase: "prompt",
      label: "system message",
      content: "one <script>alert(1)</script>"
    });

    expect(view.element.open).toBe(false);
    expect(view.element.querySelector(".qa-debug-count")?.textContent).toBe("(2 events)");
    expect(view.element.querySelector("pre")?.textContent).toBe(
      "[001] prompt — system message\none <script>alert(1)</script>\n\n" +
      "[002] tool_result — load_slides result\ntwo"
    );
    expect(view.element.innerHTML).not.toContain("<script>alert");
  });

  it("ignores malformed debug events without interrupting the answer stream", async () => {
    const traces: unknown[] = [];
    const deltas: string[] = [];
    globalThis.fetch = vi.fn(async () => new Response(
      "event: debug_trace\ndata: {not-json}\n\n" +
      "event: debug_trace\ndata: {\"sequence\":1,\"phase\":\"prompt\",\"label\":\"context\",\"content\":\"lecture\"}\n\n" +
      "event: delta\ndata: {\"text\":\"Answer\"}\n\n" +
      "event: final\ndata: {\"answer_markdown\":\"Answer\",\"citations\":[],\"conversation_id\":\"c1\"}\n\n",
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    ));

    const final = await streamChat(
      {
        lecture_id: "demo",
        content_revision: "r1",
        page_state_ids: ["p1"],
        question: "Question",
        debug: true
      },
      (delta) => deltas.push(delta),
      (trace) => traces.push(trace)
    );

    expect(deltas).toEqual(["Answer"]);
    expect(traces).toEqual([
      { sequence: 1, phase: "prompt", label: "context", content: "lecture" }
    ]);
    expect(final.answer_markdown).toBe("Answer");
  });
});
