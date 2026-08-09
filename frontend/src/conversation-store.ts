export interface StoredCitation {
  slide_id: string;
  label: string;
  time_ms?: number;
}

export interface StoredMessage {
  role: "user" | "assistant";
  markdown: string;
  at: number;
  citations?: StoredCitation[];
  selection?: { text: string; page_state_id: string };
  error?: boolean;
}

export interface StoredConversation {
  local_id: string;
  server_id?: string;
  /** True once the backend forgot this conversation and a fresh context began. */
  server_context_lost?: boolean;
  title: string;
  created_at: number;
  updated_at: number;
  messages: StoredMessage[];
}

export interface AssistantSettings {
  language: string;
  answer_style: string;
}

export const ASSISTANT_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" }
] as const;

export const ASSISTANT_STYLES = [
  { value: "concise", label: "Concise" },
  { value: "detailed", label: "Detailed" }
] as const;

export const DEFAULT_SETTINGS: AssistantSettings = { language: "en", answer_style: "concise" };

const STORE_VERSION = 1;
const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES = 200;

export function newLocalId(): string {
  const generator = globalThis.crypto;
  if (generator?.randomUUID) return generator.randomUUID();
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Browser-local persistence for assistant conversations and preferences.
 * Falls back to in-memory storage when localStorage is unavailable so the
 * assistant keeps working in restrictive browsing modes.
 */
export class ConversationStore {
  private readonly memory = new Map<string, string>();

  constructor(private readonly lectureId: string) {}

  list(): StoredConversation[] {
    const conversations = this.readAll();
    return conversations.sort((left, right) => right.updated_at - left.updated_at);
  }

  get(localId: string): StoredConversation | undefined {
    return this.readAll().find((conversation) => conversation.local_id === localId);
  }

  save(conversation: StoredConversation): void {
    const trimmed: StoredConversation = {
      ...conversation,
      messages: conversation.messages.slice(-MAX_MESSAGES)
    };
    const others = this.readAll().filter((item) => item.local_id !== conversation.local_id);
    const all = [trimmed, ...others]
      .sort((left, right) => right.updated_at - left.updated_at)
      .slice(0, MAX_CONVERSATIONS);
    this.write(this.conversationKey(), JSON.stringify({ version: STORE_VERSION, conversations: all }));
  }

  remove(localId: string): void {
    const remaining = this.readAll().filter((item) => item.local_id !== localId);
    this.write(
      this.conversationKey(),
      JSON.stringify({ version: STORE_VERSION, conversations: remaining })
    );
  }

  loadSettings(): AssistantSettings {
    const raw = this.read(settingsKey());
    if (!raw) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(raw) as Partial<AssistantSettings>;
      return {
        language: typeof parsed.language === "string" ? parsed.language : DEFAULT_SETTINGS.language,
        answer_style: typeof parsed.answer_style === "string"
          ? parsed.answer_style
          : DEFAULT_SETTINGS.answer_style
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings(settings: AssistantSettings): void {
    this.write(settingsKey(), JSON.stringify(settings));
  }

  private conversationKey(): string {
    return `i2ml-assistant:v${STORE_VERSION}:${this.lectureId}:conversations`;
  }

  private readAll(): StoredConversation[] {
    const raw = this.read(this.conversationKey());
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as { conversations?: unknown };
      if (!Array.isArray(parsed.conversations)) return [];
      return parsed.conversations.filter(isStoredConversation);
    } catch {
      return [];
    }
  }

  private read(key: string): string | undefined {
    try {
      return window.localStorage.getItem(key) ?? this.memory.get(key);
    } catch {
      return this.memory.get(key);
    }
  }

  private write(key: string, value: string): void {
    this.memory.set(key, value);
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Quota/private-mode failures fall back to the in-memory copy.
    }
  }
}

function settingsKey(): string {
  return `i2ml-assistant:v${STORE_VERSION}:settings`;
}

function isStoredConversation(value: unknown): value is StoredConversation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StoredConversation>;
  return (
    typeof item.local_id === "string" &&
    typeof item.title === "string" &&
    typeof item.created_at === "number" &&
    typeof item.updated_at === "number" &&
    Array.isArray(item.messages) &&
    item.messages.every(
      (message) =>
        message &&
        typeof message === "object" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.markdown === "string" &&
        typeof message.at === "number"
    )
  );
}

export function conversationTitle(question: string): string {
  const normalized = question.replace(/\s+/g, " ").trim();
  if (!normalized) return "Conversation";
  return normalized.length > 60 ? `${normalized.slice(0, 57)}…` : normalized;
}

function formatStamp(at: number): string {
  const date = new Date(at);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}`;
}

function citationText(citations: readonly StoredCitation[] | undefined): string {
  if (!citations || citations.length === 0) return "";
  const labels = citations.map((citation) => citation.label).join(" · ");
  return `\n\n*Citations: ${labels}*`;
}

export function conversationToMarkdown(
  conversation: StoredConversation,
  lecture: { id: string; title: string }
): string {
  const lines = [
    `# Lecture assistant — ${lecture.title}`,
    "",
    `- Lecture: ${lecture.id}`,
    `- Started: ${formatStamp(conversation.created_at)}`,
    `- Exported: ${formatStamp(Date.now())}`,
    "- AI-generated answers can be wrong — verify against slides and video.",
    ""
  ];
  for (const message of conversation.messages) {
    if (message.role === "user") {
      lines.push(`## You (${formatStamp(message.at)})`, "");
      if (message.selection) {
        lines.push(`> ${message.selection.text.replace(/\r?\n/g, " ")}`, "");
      }
      lines.push(message.markdown, "");
    } else {
      lines.push(
        `## Assistant${message.error ? " (error)" : ""}`,
        "",
        message.markdown + citationText(message.citations),
        ""
      );
    }
  }
  return lines.join("\n");
}

export function conversationsToJson(
  conversations: readonly StoredConversation[],
  lecture: { id: string; title: string },
  settings: AssistantSettings
): string {
  return JSON.stringify(
    {
      format: "i2ml-lecture-assistant-export",
      version: STORE_VERSION,
      lecture_id: lecture.id,
      lecture_title: lecture.title,
      exported_at: new Date().toISOString(),
      settings,
      conversations
    },
    null,
    2
  );
}

export function downloadTextFile(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
