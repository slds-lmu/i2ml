import {
  renderSafeMarkdown,
  streamChat,
  stripStructuredCitationMarkers,
  typesetSafeMath,
  type ChatPayload
} from "./chat";
import {
  ASSISTANT_LANGUAGES,
  ASSISTANT_STYLES,
  ConversationStore,
  conversationTitle,
  conversationToMarkdown,
  conversationsToJson,
  downloadTextFile,
  newLocalId,
  type StoredCitation,
  type StoredConversation,
  type StoredMessage
} from "./conversation-store";
import { formatTimeMs } from "./lecture-data";
import type { QaDebugTraceView } from "./qa-debug";

export type ChatSelection = NonNullable<ChatPayload["selection"]>;

export interface AssistantHost {
  lectureId(): string;
  lectureTitle(): string;
  contentRevision(): string;
  hasVideo(): boolean;
  /** 1-based strip position of the slide the student is viewing, if any. */
  activeSlideNumber(): number | undefined;
  citationTimeMs(slideId: string): number | undefined;
  /**
   * Resolve the teaching-revision context for a question. Returns undefined
   * (after announcing why) when the lecture is not ready for questions.
   */
  prepareQuestion(selection: ChatSelection | undefined): Promise<
    { pageStateIds: string[]; selection?: ChatSelection } | undefined
  >;
  openCitation(slideId: string): void;
  seekVideo(timeMs: number): void;
  announce(message: string): void;
}

const panelTemplate = document.createElement("template");
panelTemplate.innerHTML = `
  <button
    type="button"
    class="assistant-pill"
    data-action="toggle-assistant"
    aria-expanded="false">
    <span class="assistant-pill-icon" aria-hidden="true">?</span>
    <span class="assistant-pill-label">Ask about this lecture</span>
    <span class="assistant-pill-note">AI · can make mistakes</span>
  </button>
  <div class="assistant-scrim" hidden></div>
  <aside class="chat-panel" aria-label="Lecture assistant" hidden>
    <header class="chat-header">
      <span class="assistant-pill-icon" aria-hidden="true">?</span>
      <h2>Lecture assistant</h2>
      <span class="scope-chip" title="Questions automatically include the slide you are viewing.">scope: auto</span>
      <button
        type="button"
        data-action="assistant-menu"
        aria-haspopup="true"
        aria-expanded="false"
        aria-label="Assistant options">…</button>
      <button type="button" data-action="close-assistant" aria-label="Close assistant">×</button>
      <div class="assistant-menu" hidden
      <p class="assistant-menu-heading" role="presentation">Settings</p>
      <label class="assistant-menu-row">Language
        <select data-setting="language"></select>
      </label>
      <label class="assistant-menu-row">Answer style
        <select data-setting="answer-style"></select>
      </label>
      <p class="assistant-menu-note">Language and style preferences will shape new answers once the
        assistant backend supports them; your choice is saved now.</p>
      <p class="assistant-menu-heading" role="presentation">Conversations</p>
      <button type="button" data-action="new-conversation">New conversation</button>
      <button type="button" data-action="show-conversations">Past conversations…</button>
      <button type="button" data-action="export-conversation">Export this conversation</button>
      <button type="button" data-action="export-all">Export all…</button>
      </div>
    </header>
    <p class="assistant-student-notice" data-student-notice-hook>
      <strong>Student notice placeholder.</strong>
      Required privacy and usage information will be added before student deployment.
    </p>
    <div class="chat-body">
      <div class="chat-messages" aria-live="polite"></div>
      <div class="conversation-list" hidden>
        <header>
          <h3>Past conversations</h3>
          <button type="button" data-action="close-conversations">Back to chat</button>
        </header>
        <ul></ul>
        <p class="conversation-list-empty" hidden>No saved conversations for this lecture yet.</p>
      </div>
    </div>
    <div class="selection-chip" hidden>
      <span class="selection-chip-slide"></span>
      <span class="selection-chip-text"></span>
      <button type="button" data-action="clear-selection" aria-label="Remove the selected slide text">×</button>
    </div>
    <form class="chat-form">
      <label class="lecture-visually-hidden" for="">Question</label>
      <textarea name="question" maxlength="4000" required rows="1"></textarea>
      <button type="submit" aria-label="Ask">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path d="M1 8h11M8 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </form>
    <p class="assistant-warning">AI-generated answers can be wrong — verify against slides and video.</p>
  </aside>`;

let assistantInstance = 0;

export class AssistantPanel {
  private readonly root: HTMLElement;
  private store: ConversationStore;
  private conversation: StoredConversation;
  private selection: ChatSelection | undefined;
  private streaming = false;
  private enabled = false;
  private deleteArmedId: string | undefined;
  private readonly instance: number;

  constructor(
    container: HTMLElement,
    private readonly host: AssistantHost,
    private readonly debugTrace?: QaDebugTraceView
  ) {
    this.instance = ++assistantInstance;
    this.root = container;
    this.root.classList.add("assistant-region");
    this.root.append(panelTemplate.content.cloneNode(true));
    this.store = new ConversationStore("pending");
    this.conversation = this.blankConversation();
    const panel = this.element(".chat-panel");
    panel.id = `i2ml-course-assistant-${this.instance}`;
    const toggle = this.element<HTMLButtonElement>("[data-action=toggle-assistant]");
    toggle.setAttribute("aria-controls", panel.id);
    const question = this.element<HTMLTextAreaElement>("textarea[name=question]");
    question.id = `i2ml-assistant-question-${this.instance}`;
    this.element<HTMLLabelElement>(".chat-form label").htmlFor = question.id;
    if (this.debugTrace) {
      panel.classList.add("has-debug-trace");
      this.element(".assistant-student-notice").after(this.debugTrace.element);
    }
    this.fillSettingSelect("language", ASSISTANT_LANGUAGES);
    this.fillSettingSelect("answer-style", ASSISTANT_STYLES);
    this.bind();
    this.refreshContext();
  }

  /** Called once the lecture manifest is ready; wires storage to the lecture. */
  activate(): void {
    this.store = new ConversationStore(this.host.lectureId());
    this.conversation = this.blankConversation();
    this.enabled = true;
    const settings = this.store.loadSettings();
    this.settingSelect("language").value = settings.language;
    this.settingSelect("answer-style").value = settings.answer_style;
    this.renderMessages();
    this.refreshContext();
  }

  get isOpen(): boolean {
    return !this.element<HTMLElement>(".chat-panel").hidden;
  }

  open(focusInput = true): void {
    if (this.isOpen) return;
    this.setExpanded(true);
    if (focusInput) this.element<HTMLTextAreaElement>("textarea[name=question]").focus();
  }

  close(returnFocus = false): void {
    if (this.isOpen) this.setExpanded(false, returnFocus);
  }

  setSelection(selection: ChatSelection | undefined, slideLabel?: string): void {
    this.selection = selection;
    const chip = this.element<HTMLElement>(".selection-chip");
    chip.hidden = !selection;
    this.element<HTMLElement>(".selection-chip-slide").textContent = slideLabel ?? "";
    this.element<HTMLElement>(".selection-chip-text").textContent = selection?.text ?? "";
  }

  /** Updates slide-dependent hints (composer placeholder). */
  refreshContext(): void {
    const slide = this.host.activeSlideNumber();
    const question = this.element<HTMLTextAreaElement>("textarea[name=question]");
    question.placeholder = slide
      ? `Ask about slide ${slide} or the lecture…`
      : "Ask about this lecture…";
  }

  destroy(): void {
    this.root.replaceChildren();
  }

  private blankConversation(): StoredConversation {
    return {
      local_id: newLocalId(),
      title: "Conversation",
      created_at: Date.now(),
      updated_at: Date.now(),
      messages: []
    };
  }

  private bind(): void {
    this.action("toggle-assistant", () => {
      if (this.isOpen) this.setExpanded(false, true);
      else this.open();
    });
    this.action("close-assistant", () => this.setExpanded(false, true));
    this.element<HTMLElement>(".assistant-scrim").addEventListener("click", () =>
      this.setExpanded(false)
    );
    this.element<HTMLElement>(".chat-panel").addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const menu = this.element<HTMLElement>(".assistant-menu");
      if (!menu.hidden) {
        event.preventDefault();
        event.stopPropagation();
        this.setMenuOpen(false, true);
        return;
      }
      event.preventDefault();
      this.setExpanded(false, true);
    });
    this.action("assistant-menu", () =>
      this.setMenuOpen(Boolean(this.element<HTMLElement>(".assistant-menu").hidden))
    );
    document.addEventListener("pointerdown", (event) => {
      const menu = this.element<HTMLElement>(".assistant-menu");
      if (menu.hidden) return;
      const target = event.target as Node;
      if (!menu.contains(target) && !this.element("[data-action=assistant-menu]").contains(target)) {
        this.setMenuOpen(false);
      }
    });
    this.action("new-conversation", () => {
      this.startNewConversation();
      this.setMenuOpen(false);
      this.element<HTMLTextAreaElement>("textarea[name=question]").focus();
    });
    this.action("show-conversations", () => {
      this.setMenuOpen(false);
      this.showConversationList(true);
    });
    this.action("close-conversations", () => this.showConversationList(false));
    this.action("export-conversation", () => this.exportCurrent());
    this.action("export-all", () => this.exportAll());
    this.action("clear-selection", () => this.setSelection(undefined));
    for (const name of ["language", "answer-style"] as const) {
      this.settingSelect(name).addEventListener("change", () => {
        this.store.saveSettings({
          language: this.settingSelect("language").value,
          answer_style: this.settingSelect("answer-style").value
        });
      });
    }
    const form = this.element<HTMLFormElement>(".chat-form");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.ask();
    });
    const question = this.element<HTMLTextAreaElement>("textarea[name=question]");
    question.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    question.addEventListener("input", () => {
      question.style.height = "auto";
      question.style.height = `${Math.min(question.scrollHeight, 160)}px`;
    });
  }

  private setExpanded(expanded: boolean, returnFocus = false): void {
    const panel = this.element<HTMLElement>(".chat-panel");
    const toggle = this.element<HTMLButtonElement>("[data-action=toggle-assistant]");
    const focusWasInside = panel.contains(document.activeElement);
    toggle.setAttribute("aria-expanded", String(expanded));
    panel.hidden = !expanded;
    this.element<HTMLElement>(".assistant-scrim").hidden = !expanded;
    this.root.classList.toggle("is-expanded", expanded);
    this.root.closest(".lecture-shell")?.classList.toggle("assistant-open", expanded);
    if (!expanded) this.setMenuOpen(false);
    if (!expanded && (returnFocus || focusWasInside)) toggle.focus();
  }

  private setMenuOpen(open: boolean, returnFocus = false): void {
    const menu = this.element<HTMLElement>(".assistant-menu");
    const button = this.element<HTMLButtonElement>("[data-action=assistant-menu]");
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      const exportOne = this.element<HTMLButtonElement>("[data-action=export-conversation]");
      exportOne.disabled = this.conversation.messages.length === 0;
      const exportAll = this.element<HTMLButtonElement>("[data-action=export-all]");
      exportAll.disabled =
        this.store.list().length === 0 && this.conversation.messages.length === 0;
      menu.querySelector<HTMLElement>("select, button")?.focus();
    } else if (returnFocus) {
      button.focus();
    }
  }

  private startNewConversation(): void {
    if (this.streaming) return;
    this.conversation = this.blankConversation();
    this.setSelection(undefined);
    this.debugTrace?.reset();
    this.renderMessages();
    this.showConversationList(false);
  }

  private showConversationList(show: boolean): void {
    const list = this.element<HTMLElement>(".conversation-list");
    const messages = this.element<HTMLElement>(".chat-messages");
    const form = this.element<HTMLFormElement>(".chat-form");
    list.hidden = !show;
    messages.hidden = show;
    form.hidden = show;
    this.element<HTMLElement>(".assistant-warning").hidden = show;
    if (!show) {
      this.deleteArmedId = undefined;
      return;
    }
    this.renderConversationList();
  }

  private renderConversationList(): void {
    const container = this.element<HTMLElement>(".conversation-list ul");
    const conversations = this.store.list();
    this.element<HTMLElement>(".conversation-list-empty").hidden = conversations.length > 0;
    container.replaceChildren(
      ...conversations.map((conversation) => {
        const item = document.createElement("li");
        const open = document.createElement("button");
        open.type = "button";
        open.className = "conversation-open";
        const title = document.createElement("strong");
        title.textContent = conversation.title;
        const meta = document.createElement("span");
        const questions = conversation.messages.filter((message) => message.role === "user").length;
        meta.textContent = `${formatDay(conversation.updated_at)} · ${questions} question${
          questions === 1 ? "" : "s"
        }`;
        open.append(title, meta);
        open.addEventListener("click", () => {
          this.openConversation(conversation.local_id);
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "conversation-delete";
        remove.setAttribute("aria-label", `Delete conversation: ${conversation.title}`);
        remove.textContent = this.deleteArmedId === conversation.local_id ? "Delete?" : "×";
        remove.addEventListener("click", () => {
          if (this.deleteArmedId !== conversation.local_id) {
            this.deleteArmedId = conversation.local_id;
            this.renderConversationList();
            return;
          }
          this.store.remove(conversation.local_id);
          this.deleteArmedId = undefined;
          if (conversation.local_id === this.conversation.local_id) {
            this.conversation = this.blankConversation();
            this.renderMessages();
          }
          this.renderConversationList();
        });
        item.append(open, remove);
        return item;
      })
    );
  }

  private openConversation(localId: string): void {
    if (this.streaming) return;
    const stored = this.store.get(localId);
    if (!stored) return;
    this.conversation = stored;
    this.setSelection(undefined);
    this.debugTrace?.reset();
    this.renderMessages();
    this.showConversationList(false);
    this.element<HTMLTextAreaElement>("textarea[name=question]").focus();
  }

  private persist(): void {
    if (this.conversation.messages.length === 0) return;
    this.conversation.updated_at = Date.now();
    this.store.save(this.conversation);
  }

  private renderMessages(): void {
    const container = this.element<HTMLElement>(".chat-messages");
    container.replaceChildren();
    if (this.conversation.server_context_lost) {
      container.append(this.contextLostNotice());
    }
    for (const message of this.conversation.messages) {
      container.append(this.messageElement(message));
    }
    container.scrollTop = container.scrollHeight;
  }

  private contextLostNotice(): HTMLElement {
    const notice = document.createElement("p");
    notice.className = "chat-notice";
    notice.textContent =
      "The assistant's server-side memory of this conversation expired; new questions start from a fresh context.";
    return notice;
  }

  private messageElement(message: StoredMessage): HTMLElement {
    const element = document.createElement("div");
    element.className = `chat-message is-${message.role}`;
    if (message.role === "user") {
      if (message.selection) {
        const quoted = document.createElement("span");
        quoted.className = "chat-quoted-selection";
        quoted.textContent = message.selection.text;
        element.append(quoted);
      }
      const text = document.createElement("span");
      text.textContent = message.markdown;
      element.append(text);
      return element;
    }
    if (message.error) {
      element.classList.add("is-error");
      element.textContent = message.markdown;
      return element;
    }
    const body = document.createElement("div");
    body.className = "chat-answer";
    body.innerHTML = renderSafeMarkdown(message.markdown);
    element.append(body);
    void typesetSafeMath(body).catch(() => undefined);
    if (message.citations && message.citations.length > 0) {
      element.append(this.citationRow(message.citations));
    }
    return element;
  }

  private citationRow(citations: readonly StoredCitation[]): HTMLElement {
    const row = document.createElement("div");
    row.className = "chat-citations";
    for (const citation of citations) {
      const slide = document.createElement("button");
      slide.type = "button";
      slide.className = "citation-slide";
      slide.textContent = citation.label;
      slide.addEventListener("click", () => this.host.openCitation(citation.slide_id));
      row.append(slide);
      if (citation.time_ms !== undefined) {
        const time = document.createElement("button");
        time.type = "button";
        time.className = "citation-time";
        time.textContent = `▶ ${formatTimeMs(citation.time_ms)} in video`;
        time.addEventListener("click", () => this.host.seekVideo(citation.time_ms!));
        row.append(time);
      }
    }
    return row;
  }

  private async ask(): Promise<void> {
    if (this.streaming || !this.enabled) return;
    const form = this.element<HTMLFormElement>(".chat-form");
    const questionField = this.element<HTMLTextAreaElement>("textarea[name=question]");
    const question = questionField.value.trim();
    if (!question) return;
    const context = await this.host.prepareQuestion(this.selection).catch(() => undefined);
    if (!context) return;
    this.showConversationList(false);
    const container = this.element<HTMLElement>(".chat-messages");
    const userMessage: StoredMessage = {
      role: "user",
      markdown: question,
      at: Date.now(),
      ...(context.selection ? { selection: context.selection } : {})
    };
    if (this.conversation.messages.length === 0) {
      this.conversation.title = conversationTitle(question);
      this.conversation.created_at = Date.now();
    }
    this.conversation.messages.push(userMessage);
    this.persist();
    container.append(this.messageElement(userMessage));
    const pending = document.createElement("div");
    pending.className = "chat-message is-assistant is-thinking";
    pending.setAttribute("aria-busy", "true");
    pending.innerHTML =
      '<span class="chat-thinking-dots" role="img" aria-label="The assistant is thinking">' +
      "<span></span><span></span><span></span></span>";
    container.append(pending);
    container.scrollTop = container.scrollHeight;
    this.streaming = true;
    form.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled = true;
    this.debugTrace?.reset();
    this.setSelection(undefined);

    const payload: ChatPayload = {
      lecture_id: this.host.lectureId(),
      content_revision: this.host.contentRevision(),
      page_state_ids: context.pageStateIds,
      question,
      selection: context.selection,
      conversation_id: this.conversation.server_id,
      ...(this.debugTrace ? { debug: true } : {})
    };
    try {
      const { final, retried } = await this.streamWithContextRecovery(payload, pending);
      if (retried) {
        this.conversation.server_context_lost = true;
        container.insertBefore(this.contextLostNotice(), pending);
      }
      this.conversation.server_id = final.conversation_id;
      const citations: StoredCitation[] = final.citations.map((citation) => ({
        slide_id: citation.slide_id,
        label: citation.label,
        time_ms: this.host.citationTimeMs(citation.slide_id)
      }));
      const answer: StoredMessage = {
        role: "assistant",
        markdown: stripStructuredCitationMarkers(
          final.answer_markdown,
          final.citations.map((citation) => citation.slide_id)
        ),
        at: Date.now(),
        citations
      };
      this.conversation.messages.push(answer);
      this.persist();
      pending.replaceWith(this.messageElement(answer));
      questionField.value = "";
      questionField.style.height = "";
    } catch (error) {
      const message: StoredMessage = {
        role: "assistant",
        markdown: error instanceof Error ? error.message : "The assistant is unavailable.",
        at: Date.now(),
        error: true
      };
      this.conversation.messages.push(message);
      this.persist();
      pending.replaceWith(this.messageElement(message));
    } finally {
      this.streaming = false;
      form.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled = false;
      container.scrollTop = container.scrollHeight;
    }
  }

  /**
   * Streams the answer; when the backend no longer knows the stored
   * conversation (HTTP 409), transparently restarts with a fresh context.
   */
  private async streamWithContextRecovery(
    payload: ChatPayload,
    pending: HTMLElement
  ): Promise<{ final: Awaited<ReturnType<typeof streamChat>>; retried: boolean }> {
    const container = this.element<HTMLElement>(".chat-messages");
    const stream = (attempt: ChatPayload) => {
      let markdown = "";
      return streamChat(
        attempt,
        (delta) => {
          markdown += delta;
          pending.classList.remove("is-thinking");
          pending.removeAttribute("aria-busy");
          pending.innerHTML = renderSafeMarkdown(markdown);
          const nearBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight < 160;
          if (nearBottom) container.scrollTop = container.scrollHeight;
        },
        (event) => this.debugTrace?.add(event)
      );
    };
    try {
      return { final: await stream(payload), retried: false };
    } catch (error) {
      const conflict =
        payload.conversation_id !== undefined &&
        error instanceof Error &&
        /\(409\)/.test(error.message);
      if (!conflict) throw error;
      this.conversation.server_id = undefined;
      return {
        final: await stream({ ...payload, conversation_id: undefined }),
        retried: true
      };
    }
  }

  private exportCurrent(): void {
    if (this.conversation.messages.length === 0) return;
    this.setMenuOpen(false);
    downloadTextFile(
      `${this.host.lectureId()}-assistant-conversation.md`,
      "text/markdown",
      conversationToMarkdown(this.conversation, {
        id: this.host.lectureId(),
        title: this.host.lectureTitle()
      })
    );
  }

  private exportAll(): void {
    this.setMenuOpen(false);
    const stored = this.store.list();
    const all = stored.some((item) => item.local_id === this.conversation.local_id)
      ? stored
      : this.conversation.messages.length > 0
        ? [this.conversation, ...stored]
        : stored;
    if (all.length === 0) return;
    downloadTextFile(
      `${this.host.lectureId()}-assistant-conversations.json`,
      "application/json",
      conversationsToJson(
        all,
        { id: this.host.lectureId(), title: this.host.lectureTitle() },
        this.store.loadSettings()
      )
    );
  }

  private fillSettingSelect(
    name: "language" | "answer-style",
    options: readonly { value: string; label: string }[]
  ): void {
    const select = this.settingSelect(name);
    select.replaceChildren(
      ...options.map((option) => {
        const element = document.createElement("option");
        element.value = option.value;
        element.textContent = option.label;
        return element;
      })
    );
  }

  private settingSelect(name: "language" | "answer-style"): HTMLSelectElement {
    return this.element<HTMLSelectElement>(`select[data-setting="${name}"]`);
  }

  private action(name: string, handler: () => void): void {
    this.root
      .querySelector<HTMLButtonElement>(`[data-action="${name}"]`)
      ?.addEventListener("click", handler);
  }

  private element<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Assistant UI is missing ${selector}`);
    return element;
  }
}

function formatDay(at: number): string {
  const date = new Date(at);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}
