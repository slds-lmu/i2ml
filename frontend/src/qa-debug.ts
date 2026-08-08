export interface QaDebugTraceEvent {
  sequence: number;
  phase: string;
  label: string;
  content: string;
}

const debugTemplate = document.createElement("template");
debugTemplate.innerHTML = `
  <details class="qa-debug-trace">
    <summary>
      QA provider trace <span class="qa-debug-count">(0 events)</span>
    </summary>
    <p>
      Development-only plain-text trace. It can contain the full model context and
      provider reasoning; do not use it with student data.
    </p>
    <pre class="qa-debug-output" tabindex="0" aria-label="Ordered QA provider trace">No trace events received.</pre>
  </details>`;

/**
 * Parse an untrusted debug event without making the normal answer stream depend
 * on optional observability data. Unknown phases are intentionally retained so
 * a newer backend remains inspectable by an older development frontend.
 */
export function normalizeQaDebugTrace(value: unknown): QaDebugTraceEvent | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const { sequence, phase, label, content } = candidate;
  if (
    typeof sequence !== "number" ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    typeof phase !== "string" ||
    !phase.trim() ||
    typeof label !== "string" ||
    !label.trim() ||
    typeof content !== "string"
  ) {
    return undefined;
  }
  return {
    sequence,
    phase: phase.trim(),
    label: label.trim(),
    content
  };
}

export class QaDebugTraceView {
  readonly element: HTMLDetailsElement;
  private readonly count: HTMLElement;
  private readonly output: HTMLElement;
  private readonly events = new Map<number, QaDebugTraceEvent>();

  constructor() {
    this.element = debugTemplate.content.firstElementChild!.cloneNode(true) as HTMLDetailsElement;
    this.count = this.element.querySelector<HTMLElement>(".qa-debug-count")!;
    this.output = this.element.querySelector<HTMLElement>(".qa-debug-output")!;
  }

  reset(): void {
    this.events.clear();
    this.render();
  }

  add(event: QaDebugTraceEvent): void {
    this.events.set(event.sequence, event);
    this.render();
  }

  private render(): void {
    const ordered = [...this.events.values()].sort((left, right) => left.sequence - right.sequence);
    const suffix = ordered.length === 1 ? "event" : "events";
    this.count.textContent = `(${ordered.length} ${suffix})`;
    this.output.textContent = ordered.length === 0
      ? "No trace events received."
      : ordered.map((event) =>
          `[${String(event.sequence).padStart(3, "0")}] ${event.phase} — ${event.label}\n${event.content}`
        ).join("\n\n");
  }
}
