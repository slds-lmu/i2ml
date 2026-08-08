import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  normalizeQaDebugTrace,
  type QaDebugTraceEvent
} from "./qa-debug";

export interface ChatPayload {
  lecture_id: string;
  content_revision: string;
  page_state_ids: string[];
  question: string;
  selection?: { text: string; page_state_id: string };
  conversation_id?: string;
  /** Requested only by a development-gated UI; the server applies its own gate. */
  debug?: boolean;
}

export interface FinalChatEvent {
  answer_markdown: string;
  citations: Array<{ slide_id: string; label: string }>;
  conversation_id: string;
}

export function renderSafeMarkdown(markdown: string): string {
  const rendered = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: [
      "p",
      "ul",
      "ol",
      "li",
      "strong",
      "em",
      "code",
      "pre",
      "blockquote",
      "a",
      "br",
      "span"
    ],
    ALLOWED_ATTR: ["href", "title", "class"],
    ALLOW_DATA_ATTR: false
  });
}

export function stripStructuredCitationMarkers(
  markdown: string,
  slideIds: readonly string[]
): string {
  const allowed = new Set(slideIds);
  return markdown.replace(/\[\[slide:([^\]\s]+)\]\]/g, (marker, slideId: string) =>
    allowed.has(slideId) ? "" : marker
  );
}

export async function typesetSafeMath(element: HTMLElement): Promise<void> {
  const mathJax = (window as Window & {
    MathJax?: { typesetPromise?: (elements?: HTMLElement[]) => Promise<unknown> };
  }).MathJax;
  if (typeof mathJax?.typesetPromise === "function") {
    await mathJax.typesetPromise([element]);
    hardenTypesetMath(element);
  }
}

/**
 * MathJax creates new DOM after the Markdown HTML has been sanitized.  The
 * site-level ui/safe extension rejects URLs in untrusted mathematics; this
 * second boundary also removes generated math links and inline handlers so a
 * configuration or extension regression cannot turn model output into code.
 */
export function hardenTypesetMath(element: HTMLElement): void {
  for (const container of element.querySelectorAll<HTMLElement>("mjx-container")) {
    for (const anchor of container.querySelectorAll<HTMLAnchorElement>("a")) {
      const replacement = document.createElement("span");
      replacement.className = "math-link-disabled";
      replacement.replaceChildren(...anchor.childNodes);
      anchor.replaceWith(replacement);
    }
    for (const node of container.querySelectorAll<HTMLElement>("*")) {
      for (const attribute of [...node.attributes]) {
        if (
          /^on/i.test(attribute.name) ||
          ["href", "xlink:href", "data-mjx-href"].includes(attribute.name.toLowerCase())
        ) {
          node.removeAttribute(attribute.name);
        }
      }
    }
  }
}

export async function streamChat(
  payload: ChatPayload,
  onDelta: (value: string) => void,
  onDebugTrace?: (event: QaDebugTraceEvent) => void
): Promise<FinalChatEvent> {
  const response = await fetch("/api/v1/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok || !response.body) throw new Error(`Chat request failed (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: FinalChatEvent | undefined;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const raw of events) {
      const type = raw.match(/^event:\s*(.+)\r?$/m)?.[1]?.trim();
      const dataLines = [...raw.matchAll(/^data:\s?(.*)\r?$/gm)].map((match) => match[1]);
      if (!type || dataLines.length === 0) continue;
      const serialized = dataLines.join("\n");
      if (type === "debug_trace") {
        try {
          const event = normalizeQaDebugTrace(JSON.parse(serialized));
          if (event) onDebugTrace?.(event);
        } catch {
          // Debug observability is optional and must never break the answer stream.
        }
        continue;
      }
      const data = JSON.parse(serialized) as Record<string, unknown>;
      if (type === "delta") onDelta(String(data.text ?? ""));
      if (type === "error") throw new Error(String(data.detail ?? "Chat failed"));
      if (type === "final") final = data as unknown as FinalChatEvent;
    }
    if (done) break;
  }
  if (!final) throw new Error("Chat stream ended without a final event");
  return final;
}
