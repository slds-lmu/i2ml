import { cueAt, cuePageStateIds, nearestOccurrence } from "./cue-engine";
import {
  renderSafeMarkdown,
  streamChat,
  stripStructuredCitationMarkers,
  typesetSafeMath,
  type ChatPayload
} from "./chat";
import { PdfViewer } from "./pdf-viewer";
import { QaDebugTraceView } from "./qa-debug";
import { SyncState } from "./sync-state";
import {
  normalizeLectureManifest,
  pageStateForId,
  pageStateIdForRevision,
  type CueInterval,
  type LectureManifest,
  type PageState,
  type RevisionAsset,
  type RevisionKind
} from "./types";
import { YouTubeController } from "./youtube";

const template = document.createElement("template");
template.innerHTML = `
  <section class="lecture-shell" aria-label="Synchronized lecture">
    <div class="lecture-status" role="status" aria-live="polite"></div>
    <div class="lecture-fallback" hidden></div>
    <div class="lecture-main">
      <section class="media-panel" aria-label="Lecture media">
        <div class="video-container"></div>
        <p class="external-video" hidden></p>
        <div class="sync-toolbar" aria-label="Synchronization controls">
          <button type="button" data-action="follow">Follow video</button>
          <button type="button" data-action="return">Return to video slide</button>
          <button type="button" data-action="set-time">Set video to this slide</button>
          <button type="button" data-action="play-time">Play from this slide</button>
          <span class="sync-mode">Following video</span>
        </div>
      </section>
      <section class="slide-panel" role="tabpanel" aria-label="Lecture slides">
        <div class="revision-tabs" role="tablist" aria-label="Slide revision">
          <button type="button" role="tab" data-revision="recorded">Recorded slides</button>
          <button type="button" role="tab" data-revision="teaching">Corrected slides</button>
        </div>
        <div class="correction-notice" hidden></div>
        <div class="slide-scroll" tabindex="0" aria-label="Scrollable slides"></div>
        <div class="slide-actions">
          <div class="pdf-download" hidden></div>
          <button type="button" data-action="print">Print slides</button>
        </div>
      </section>
    </div>
    <div class="assistant-column">
      <button
        type="button"
        class="assistant-toggle"
        data-action="toggle-assistant"
        aria-label="Open course assistant"
        aria-expanded="false">
        <span data-assistant-toggle-label>Open course assistant</span>
      </button>
      <aside class="chat-panel" aria-label="Course assistant" hidden>
        <header>
          <h2>Ask about this lecture</h2>
          <div class="assistant-header-actions">
            <button type="button" data-action="clear-chat">Clear</button>
            <button type="button" data-action="close-assistant">Close</button>
          </div>
        </header>
        <p class="assistant-warning">The assistant can be wrong. Check its slide citations.</p>
        <p class="assistant-student-notice" data-student-notice-hook>
          <strong>Student notice placeholder.</strong>
          Required privacy and usage information will be added before student deployment.
        </p>
        <div class="selection-chip" hidden>
          <span></span><button type="button" data-action="clear-selection" aria-label="Clear selected text">×</button>
        </div>
        <button type="button" data-action="capture-selection">Use selected slide text</button>
        <div class="chat-messages" aria-live="polite"></div>
        <form class="chat-form">
          <label>Question<textarea name="question" maxlength="4000" required></textarea></label>
          <button type="submit">Ask</button>
        </form>
      </aside>
    </div>
  </section>`;

let assistantInstance = 0;

interface LectureUrlState {
  slideId?: string;
  timeMs?: number;
}

export class LectureApp extends HTMLElement {
  private manifest: LectureManifest | undefined;
  private revision: RevisionKind = "recorded";
  private state = new SyncState();
  private player = new YouTubeController();
  private viewer: PdfViewer | undefined;
  private currentTimeMs = 0;
  private selection: ChatPayload["selection"];
  private conversationId: string | undefined;
  private debugTrace: QaDebugTraceView | undefined;
  private revisionRequest = 0;
  private pendingScrollTargetId: string | undefined;
  private urlStateReady = false;
  private readonly popStateHandler = () => {
    if (this.urlStateReady) void this.applyUrlState();
  };

  connectedCallback(): void {
    document.body.classList.add("has-modern-lecture");
    this.replaceChildren(template.content.cloneNode(true));
    this.debugTrace = undefined;
    const instance = ++assistantInstance;
    const panelId = `i2ml-course-assistant-${instance}`;
    const slidePanelId = `i2ml-lecture-slides-${instance}`;
    const slidePanel = this.element<HTMLElement>(".slide-panel");
    slidePanel.id = slidePanelId;
    this.querySelectorAll<HTMLButtonElement>("[data-revision]").forEach((tab) => {
      tab.id = `i2ml-revision-${tab.dataset.revision}-${instance}`;
      tab.setAttribute("aria-controls", slidePanelId);
    });
    const chatPanel = this.element<HTMLElement>(".chat-panel");
    chatPanel.id = panelId;
    this.element<HTMLButtonElement>("[data-action=toggle-assistant]").setAttribute(
      "aria-controls",
      panelId
    );
    if (this.dataset.qaDebug === "true") {
      this.debugTrace = new QaDebugTraceView();
      chatPanel.classList.add("has-debug-trace");
      this.element<HTMLElement>(".assistant-student-notice").after(this.debugTrace.element);
    }
    this.viewer = new PdfViewer(this.element(".slide-scroll"), (state) => this.visibleSlide(state));
    this.bindControls();
    window.addEventListener("popstate", this.popStateHandler);
    void this.load();
  }

  disconnectedCallback(): void {
    window.removeEventListener("popstate", this.popStateHandler);
    this.player.destroy();
    this.viewer?.destroy();
    this.urlStateReady = false;
  }

  private async load(): Promise<void> {
    const lectureId = this.dataset.lectureId;
    if (!lectureId) return this.fail("Missing lecture identifier.");
    this.status("Loading lecture…");
    try {
      const endpoint = this.dataset.manifestUrl || `/api/v1/lectures/${encodeURIComponent(lectureId)}`;
      const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Lecture data returned ${response.status}`);
      this.manifest = normalizeLectureManifest(await response.json(), lectureId);
      if (!this.manifest.content_revision) throw new Error("Lecture data has no content revision");
      this.revision = this.manifest.revisions.recorded ? "recorded" : "teaching";
      const requestedUrlState = this.readUrlState();
      const requestedSlide = requestedUrlState.slideId
        ? this.resolveUrlSlide(requestedUrlState.slideId)
        : undefined;
      if (requestedSlide) {
        this.revision = requestedSlide.revision;
        this.state.explore();
        this.updateMode();
      }
      await this.showRevision(this.revision, requestedSlide?.pageStateId, Boolean(requestedSlide));
      let mediaReady = false;
      try {
        await this.mountPresentation();
        mediaReady = true;
        this.status("");
      } catch (error) {
        this.mediaFailed(error instanceof Error ? error.message : "Video failed to load");
      }
      if (
        mediaReady &&
        requestedUrlState.timeMs !== undefined &&
        this.manifest.presentation.mode === "video_lecture"
      ) {
        this.currentTimeMs = requestedUrlState.timeMs;
        this.player.seek(requestedUrlState.timeMs, false);
        if (!requestedSlide) this.onVideoTime(requestedUrlState.timeMs);
      }
      this.urlStateReady = true;
      this.replaceUrlState();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Lecture failed to load");
    }
  }

  private async mountPresentation(): Promise<void> {
    if (!this.manifest) return;
    const presentation = this.manifest.presentation;
    const media = this.element<HTMLElement>(".media-panel");
    const toolbar = this.element<HTMLElement>(".sync-toolbar");
    if (
      presentation.mode === "video_lecture" &&
      presentation.provider === "youtube" &&
      presentation.provider_id
    ) {
      await this.player.mount(
        this.element(".video-container"),
        presentation.provider_id,
        () => undefined
      );
      this.player.onTime((time) => this.onVideoTime(time));
      return;
    }
    media.classList.add("is-slide-only");
    toolbar.hidden = true;
    this.element<HTMLElement>(".video-container").hidden = true;
    if (presentation.mode === "external_link_only" && presentation.external_url) {
      const paragraph = this.element<HTMLElement>(".external-video");
      const link = document.createElement("a");
      const externalUrl = safeHttpUrl(presentation.external_url);
      if (!externalUrl) throw new Error("External video link is not a safe HTTP URL");
      link.href = externalUrl;
      link.textContent = "Open the externally hosted lecture video";
      link.rel = "noopener noreferrer";
      paragraph.replaceChildren(link);
      paragraph.hidden = false;
    }
  }

  private async showRevision(
    revision: RevisionKind,
    preferredStateId?: string,
    focus = false
  ): Promise<void> {
    if (!this.manifest || !this.viewer) return;
    const asset = this.manifest.revisions[revision];
    if (!asset) return;
    const request = ++this.revisionRequest;
    this.revision = revision;
    for (const tab of this.querySelectorAll<HTMLButtonElement>("[data-revision]")) {
      const selected = tab.dataset.revision === revision;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.hidden = tab.dataset.revision === "recorded" && !this.manifest.revisions.recorded;
      if (selected) this.element<HTMLElement>(".slide-panel").setAttribute("aria-labelledby", tab.id);
    }
    this.renderDownloads(asset);
    await this.viewer.load(asset);
    if (request !== this.revisionRequest) return;
    const mappedPreferred = preferredStateId
      ? pageStateIdForRevision(this.manifest, preferredStateId, revision)
      : undefined;
    const mappedCurrent = this.state.activePageStateId
      ? pageStateIdForRevision(this.manifest, this.state.activePageStateId, revision)
      : undefined;
    const keepNonSlide =
      this.state.mode === "follow" && Boolean(this.state.activeNonSlideKind);
    const target = keepNonSlide
      ? undefined
      : mappedPreferred ?? mappedCurrent ?? asset.page_states[0]?.id;
    if (target) this.setActive(target, Boolean(preferredStateId), focus);
    else if (keepNonSlide) this.viewer.setActive(undefined);
  }

  private async switchRevision(revision: RevisionKind): Promise<void> {
    if (!this.manifest || revision === this.revision || !this.manifest.revisions[revision]) return;
    const cue = this.state.mode === "follow"
      ? cueAt(this.manifest.cues, this.currentTimeMs)
      : undefined;
    const cueTarget = cue?.state_kind === "slide"
      ? this.cueStateForRevision(cuePageStateIds(cue, revision), revision)
      : undefined;
    const activeTarget = this.state.activePageStateId
      ? pageStateIdForRevision(this.manifest, this.state.activePageStateId, revision)
      : undefined;
    await this.showRevision(revision, cueTarget ?? activeTarget);
  }

  private cueStateForRevision(
    candidateIds: readonly string[],
    revision: RevisionKind = this.revision
  ): string | undefined {
    if (!this.manifest) return undefined;
    for (const candidate of candidateIds) {
      const mapped = pageStateIdForRevision(this.manifest, candidate, revision);
      if (mapped) return mapped;
    }
    return undefined;
  }

  private renderDownloads(asset: RevisionAsset): void {
    const downloads = this.element<HTMLElement>(".pdf-download");
    downloads.replaceChildren();
    const available = asset.decks.filter((deck) => deck.download_url);
    for (const [index, deck] of available.entries()) {
      const link = document.createElement("a");
      link.href = deck.download_url!;
      link.textContent = available.length === 1
        ? "Download slides (PDF)"
        : `Download deck ${deck.order || index + 1} (PDF)`;
      if (index > 0) downloads.append(document.createTextNode(" · "));
      downloads.append(link);
    }
    downloads.hidden = available.length === 0;
  }

  private onVideoTime(timeMs: number): void {
    this.currentTimeMs = timeMs;
    if (!this.manifest || this.state.mode !== "follow") return;
    const cue = cueAt(this.manifest.cues, timeMs);
    if (!cue || cue.state_kind === "non_slide") {
      const kind = cue?.non_slide_kind ?? cue?.state ?? "unmapped";
      if (!this.state.activePageStateId && this.state.activeNonSlideKind === kind) return;
      this.state.activateNonSlide(kind);
      this.viewer?.setActive(undefined);
      this.updateCorrection(undefined);
      this.status(`Video segment: ${humanize(kind)} (no lecture slide).`);
      this.replaceUrlState();
      return;
    }
    const target = this.cueStateForRevision(cuePageStateIds(cue, this.revision));
    if (!target) {
      if (this.state.activeNonSlideKind === "unmapped_slide") return;
      this.state.activateNonSlide("unmapped_slide");
      this.viewer?.setActive(undefined);
      this.updateCorrection(undefined);
      this.status("This video segment has no reviewed slide mapping for the selected revision.");
      this.replaceUrlState();
      return;
    }
    if (target === this.state.activePageStateId && !this.state.activeNonSlideKind) return;
    this.status("");
    this.setActive(target, true);
  }

  private visibleSlide(page: PageState): void {
    if (
      this.manifest?.presentation.mode === "video_lecture" &&
      this.state.mode === "follow"
    ) return;
    if (this.pendingScrollTargetId && page.id !== this.pendingScrollTargetId) return;
    if (page.id === this.pendingScrollTargetId) this.pendingScrollTargetId = undefined;
    this.state.activatePage(page.id);
    this.viewer?.setActive(page.id);
    this.updateCorrection(page);
    this.replaceUrlState();
  }

  private setActive(pageStateId: string | undefined, scroll: boolean, focus = false): void {
    if (!pageStateId) return;
    const page = this.currentAsset()?.page_states.find(
      (item) => item.id === pageStateId || item.aliases.includes(pageStateId)
    );
    if (!page) return;
    this.state.activatePage(page.id);
    this.viewer?.setActive(page.id);
    if (scroll) {
      const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      this.pendingScrollTargetId = page.id;
      this.state.withProgrammaticScroll(() => this.viewer?.scrollTo(page.id, behavior, focus));
    }
    this.updateCorrection(page);
    this.replaceUrlState();
  }

  private syncVideo(play: boolean): void {
    if (!this.manifest || !this.state.activePageStateId) return;
    const cue = nearestOccurrence(
      this.manifest.cues,
      this.state.activePageStateId,
      this.currentTimeMs
    );
    if (!cue) return this.status("This slide has no video occurrence.");
    this.state.follow();
    this.updateMode();
    const targetTime = cue.stable_at_ms ?? cue.start_ms;
    this.currentTimeMs = targetTime;
    this.player.seek(targetTime, play);
    this.replaceUrlState();
  }

  private bindControls(): void {
    const scroll = this.element<HTMLElement>(".slide-scroll");
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"] as const) {
      scroll.addEventListener(event, () => {
        this.pendingScrollTargetId = undefined;
        this.state.manualIntent();
        this.updateMode();
      });
    }
    this.querySelectorAll<HTMLButtonElement>("[data-revision]").forEach((button) => {
      button.addEventListener("click", () => {
        void this.switchRevision(button.dataset.revision as RevisionKind).catch((error) =>
          this.fail(error instanceof Error ? error.message : "Slides failed to load")
        );
      });
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = [...this.querySelectorAll<HTMLButtonElement>("[data-revision]")]
          .filter((tab) => !tab.hidden);
        const current = Math.max(0, tabs.indexOf(button));
        const target = event.key === "Home"
          ? tabs[0]
          : event.key === "End"
            ? tabs.at(-1)
            : tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
        if (!target) return;
        event.preventDefault();
        target.focus();
        target.click();
      });
    });
    this.action("follow", () => {
      this.state.follow();
      this.updateMode();
      this.onVideoTime(this.currentTimeMs);
    });
    this.action("return", () => {
      this.state.follow();
      this.updateMode();
      this.onVideoTime(this.currentTimeMs);
    });
    this.action("set-time", () => this.syncVideo(false));
    this.action("play-time", () => this.syncVideo(true));
    this.action("print", () => void this.printSlides());
    this.action("capture-selection", () => this.captureSelection());
    this.action("clear-selection", () => this.setSelection(undefined));
    this.action("clear-chat", () => void this.clearChat());
    this.action("toggle-assistant", () => {
      const toggle = this.element<HTMLButtonElement>("[data-action=toggle-assistant]");
      this.setAssistantExpanded(toggle.getAttribute("aria-expanded") !== "true");
    });
    this.action("close-assistant", () => this.setAssistantExpanded(false, true));
    this.element<HTMLElement>(".chat-panel").addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.setAssistantExpanded(false, true);
    });
    this.element<HTMLFormElement>(".chat-form").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.ask().catch((error) =>
        this.fail(error instanceof Error ? error.message : "Assistant context failed to load")
      );
    });
    this.addEventListener("lecture-citation", (event) => {
      const slideId = (event as CustomEvent<string>).detail;
      void this.navigateToCitation(slideId).catch((error) =>
        this.fail(error instanceof Error ? error.message : "Cited slide failed to load")
      );
    });
  }

  private captureSelection(): void {
    const selection = window.getSelection();
    const value = selection?.toString().trim().replace(/\s+/g, " ") ?? "";
    const anchor = selection?.anchorNode;
    const slide = anchor instanceof Node
      ? anchor.parentElement?.closest<HTMLElement>(".pdf-page,.structured-slide")
      : null;
    if (!value || !slide?.dataset.pageStateId || slide.dataset.pageStateId !== this.state.activePageStateId) {
      return this.status("Select text on the active slide first.");
    }
    if (!this.manifest) return;
    const teachingId = pageStateIdForRevision(
      this.manifest,
      slide.dataset.pageStateId,
      "teaching"
    );
    if (!teachingId) {
      this.setSelection(undefined);
      return this.status(
        "This recorded slide has no reviewed teaching-revision mapping; select text on the corrected slides instead."
      );
    }
    this.setSelection({ text: value.slice(0, 2000), page_state_id: teachingId });
  }

  private setSelection(selection: ChatPayload["selection"]): void {
    this.selection = selection;
    const chip = this.element<HTMLElement>(".selection-chip");
    chip.hidden = !selection;
    this.element<HTMLElement>(".selection-chip span").textContent = selection?.text ?? "";
  }

  private async navigateToCitation(slideId: string): Promise<void> {
    if (!this.manifest) return;
    const teachingId = pageStateIdForRevision(this.manifest, slideId, "teaching");
    const recordedId = pageStateIdForRevision(this.manifest, slideId, "recorded");
    const targetRevision: RevisionKind | undefined = teachingId
      ? "teaching"
      : recordedId
        ? "recorded"
        : undefined;
    const targetId = teachingId ?? recordedId;
    if (!targetRevision || !targetId) {
      this.status("That citation is not part of this lecture revision.");
      return;
    }
    this.state.explore();
    this.updateMode();
    if (targetRevision === this.revision) this.setActive(targetId, true, true);
    else await this.showRevision(targetRevision, targetId, true);
  }

  private async resolveTeachingContext(stateId: string): Promise<string | undefined> {
    if (!this.manifest) return undefined;
    const mapped = pageStateIdForRevision(this.manifest, stateId, "teaching");
    if (mapped) return mapped;

    const source = pageStateForId(this.manifest, stateId);
    const fallback = this.manifest.revisions.teaching.page_states.find(
      (state) => state.deck_id === source?.deck_id && state.page === source?.page
    ) ?? this.manifest.revisions.teaching.page_states[0];
    if (!fallback) {
      this.status("No teaching-revision slide is available for the assistant.");
      return undefined;
    }
    this.setSelection(undefined);
    this.status(
      `The recorded slide has no reviewed teaching mapping; using corrected slide ${fallback.page} for this question.`
    );
    await this.showRevision("teaching", fallback.id);
    return fallback.id;
  }

  private validatedTeachingSelection(): ChatPayload["selection"] {
    if (!this.selection || !this.manifest) return undefined;
    const teachingId = pageStateIdForRevision(
      this.manifest,
      this.selection.page_state_id,
      "teaching"
    );
    const teaching = teachingId
      ? this.manifest.revisions.teaching.page_states.find((state) => state.id === teachingId)
      : undefined;
    if (
      !teachingId ||
      !teaching ||
      !normalized(teaching.text).includes(normalized(this.selection.text))
    ) {
      this.setSelection(undefined);
      this.status(
        "The selected recorded text is not present in its corrected slide, so it was omitted from the question."
      );
      return undefined;
    }
    return { ...this.selection, page_state_id: teachingId };
  }

  private async ask(): Promise<void> {
    if (!this.manifest || !this.state.activePageStateId) return;
    const form = this.element<HTMLFormElement>(".chat-form");
    const question = new FormData(form).get("question")?.toString().trim();
    if (!question) return;
    const teachingContextId = await this.resolveTeachingContext(this.state.activePageStateId);
    if (!teachingContextId) return;
    const selection = this.validatedTeachingSelection();
    const pageStateIds = [...new Set([
      teachingContextId,
      ...(selection ? [selection.page_state_id] : [])
    ])];
    const messages = this.element<HTMLElement>(".chat-messages");
    const user = document.createElement("div");
    user.className = "chat-message is-user";
    user.textContent = question;
    const answer = document.createElement("div");
    answer.className = "chat-message is-assistant";
    answer.textContent = "Thinking…";
    messages.append(user, answer);
    form.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled = true;
    this.debugTrace?.reset();
    let markdown = "";
    try {
      const final = await streamChat(
        {
          lecture_id: this.manifest.lecture_id,
          content_revision: this.manifest.content_revision,
          page_state_ids: pageStateIds,
          question,
          selection,
          conversation_id: this.conversationId,
          ...(this.debugTrace ? { debug: true } : {})
        },
        (delta) => {
          markdown += delta;
          answer.innerHTML = renderSafeMarkdown(markdown);
        },
        (event) => this.debugTrace?.add(event)
      );
      this.conversationId = final.conversation_id;
      answer.innerHTML = renderSafeMarkdown(
        stripStructuredCitationMarkers(
          final.answer_markdown,
          final.citations.map((citation) => citation.slide_id)
        )
      );
      await typesetSafeMath(answer).catch(() => undefined);
      const citations = document.createElement("div");
      citations.className = "chat-citations";
      for (const citation of final.citations) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = citation.label;
        button.addEventListener("click", () =>
          this.dispatchEvent(
            new CustomEvent("lecture-citation", { detail: citation.slide_id, bubbles: true })
          )
        );
        citations.append(button);
      }
      answer.append(citations);
      form.reset();
    } catch (error) {
      answer.textContent = error instanceof Error ? error.message : "The assistant is unavailable.";
      answer.classList.add("is-error");
    } finally {
      form.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled = false;
    }
  }

  private async clearChat(): Promise<void> {
    if (this.conversationId) {
      await fetch(`/api/v1/conversations/${encodeURIComponent(this.conversationId)}`, {
        method: "DELETE"
      }).catch(() => undefined);
    }
    this.conversationId = undefined;
    this.element(".chat-messages").replaceChildren();
    this.debugTrace?.reset();
  }

  private async printSlides(): Promise<void> {
    const button = this.element<HTMLButtonElement>("[data-action=print]");
    button.disabled = true;
    this.status("Preparing every slide for printing…");
    try {
      await this.viewer?.prepareForPrint();
      this.status("");
      window.print();
    } catch {
      this.status("Slides could not be prepared for printing. Use the PDF download instead.");
    } finally {
      button.disabled = false;
    }
  }

  private updateCorrection(page: PageState | undefined): void {
    const notice = this.element<HTMLElement>(".correction-notice");
    notice.hidden = !page?.correction;
    notice.textContent = page?.correction
      ? `${page.correction.kind === "erratum" ? "Erratum" : "Correction"}: ${page.correction.summary}`
      : "";
  }

  private updateMode(): void {
    const label = this.element<HTMLElement>(".sync-mode");
    label.textContent = this.state.mode === "follow" ? "Following video" : "Exploring slides";
    this.querySelector<HTMLButtonElement>("[data-action=follow]")!.setAttribute(
      "aria-pressed",
      String(this.state.mode === "follow")
    );
  }

  private setAssistantExpanded(expanded: boolean, returnFocus = false): void {
    const column = this.element<HTMLElement>(".assistant-column");
    const toggle = this.element<HTMLButtonElement>("[data-action=toggle-assistant]");
    const panel = this.element<HTMLElement>(".chat-panel");
    const focusWasInside = panel.contains(document.activeElement);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute(
      "aria-label",
      expanded ? "Hide course assistant" : "Open course assistant"
    );
    this.element<HTMLElement>("[data-assistant-toggle-label]").textContent = expanded
      ? "Hide course assistant"
      : "Open course assistant";
    column.classList.toggle("is-expanded", expanded);
    panel.hidden = !expanded;
    if (!expanded && (returnFocus || focusWasInside)) toggle.focus();
  }

  private currentAsset() {
    return this.manifest?.revisions[this.revision];
  }

  private action(name: string, handler: () => void): void {
    this.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)?.addEventListener(
      "click",
      handler
    );
  }

  private element<T extends Element = HTMLElement>(selector: string): T {
    const element = this.querySelector<T>(selector);
    if (!element) throw new Error(`Lecture UI is missing ${selector}`);
    return element;
  }

  private status(message: string): void {
    this.element<HTMLElement>(".lecture-status").textContent = message;
  }

  private fail(message: string): void {
    this.status(`Lecture unavailable: ${message}`);
    this.classList.add("has-error");
    this.showFallbackLinks();
  }

  private mediaFailed(message: string): void {
    const media = this.element<HTMLElement>(".media-panel");
    media.classList.add("is-slide-only", "has-media-error");
    this.element<HTMLElement>(".sync-toolbar").hidden = true;
    const video = this.element<HTMLElement>(".video-container");
    video.hidden = true;
    video.replaceChildren();
    this.status(`Video unavailable: ${message}. Slides and the assistant remain available.`);
    this.showFallbackLinks();
  }

  private showFallbackLinks(): void {
    const fallback = this.element<HTMLElement>(".lecture-fallback");
    const manifestPdfs = this.manifest?.revisions.teaching.decks
      .map((deck) => deck.download_url)
      .filter((url): url is string => Boolean(url)) ?? [];
    const configuredPdfs = this.configuredFallbackPdfs();
    const pdfs = manifestPdfs.length > 0 ? manifestPdfs : configuredPdfs;
    const candidates = [
      {
        url: this.dataset.fallbackVideoUrl,
        label: "Open the lecture video"
      },
      ...pdfs.map((url, index) => ({
        url,
        label: pdfs.length === 1
          ? "Download the lecture slides (PDF)"
          : `Download lecture slide deck ${index + 1} (PDF)`
      }))
    ];
    fallback.replaceChildren();
    for (const candidate of candidates) {
      const url = safeHttpUrl(candidate.url);
      if (!url) continue;
      if (fallback.childNodes.length > 0) fallback.append(document.createTextNode(" · "));
      const link = document.createElement("a");
      link.href = url;
      link.textContent = candidate.label;
      link.rel = "noopener noreferrer";
      fallback.append(link);
    }
    fallback.hidden = fallback.childNodes.length === 0;
  }

  private configuredFallbackPdfs(): string[] {
    const indexed = this.getAttributeNames()
      .map((name) => {
        const match = name.match(/^data-fallback-pdf-url-(\d+)$/);
        return match
          ? { order: Number(match[1]), url: this.getAttribute(name)?.trim() ?? "" }
          : undefined;
      })
      .filter((item): item is { order: number; url: string } => Boolean(item?.url))
      .sort((left, right) => left.order - right.order)
      .map((item) => item.url);
    if (indexed.length > 0) return indexed;

    // Compatibility with early previews whose Hugo URL context escaped `|`.
    const combined = this.dataset.fallbackPdfUrls?.replace(/%7c/gi, "|");
    if (combined) return combined.split("|").map((url) => url.trim()).filter(Boolean);
    return this.dataset.fallbackPdfUrl ? [this.dataset.fallbackPdfUrl] : [];
  }

  private readUrlState(): LectureUrlState {
    if (!this.manifest) return {};
    const parameters = new URL(window.location.href).searchParams;
    const lecture = parameters.get("lecture");
    if (lecture && lecture !== this.manifest.lecture_id) return {};
    const slideId = parameters.get("slide")?.trim() || undefined;
    const seconds = Number(parameters.get("time"));
    const timeMs = parameters.has("time") && Number.isFinite(seconds) && seconds >= 0 && seconds <= 86_400
      ? Math.round(seconds * 1000)
      : undefined;
    return { slideId, timeMs };
  }

  private resolveUrlSlide(
    slideId: string
  ): { revision: RevisionKind; pageStateId: string } | undefined {
    if (!this.manifest) return undefined;
    const revisions: RevisionKind[] = [this.revision, this.revision === "recorded" ? "teaching" : "recorded"];
    for (const revision of revisions) {
      const direct = this.manifest.revisions[revision]?.page_states.find(
        (state) => state.id === slideId || state.aliases.includes(slideId)
      );
      if (direct) return { revision, pageStateId: direct.id };
    }
    for (const revision of revisions) {
      const mapped = pageStateIdForRevision(this.manifest, slideId, revision);
      if (mapped) return { revision, pageStateId: mapped };
    }
    return undefined;
  }

  private async applyUrlState(): Promise<void> {
    if (!this.manifest) return;
    const requested = this.readUrlState();
    if (
      requested.timeMs !== undefined &&
      this.manifest.presentation.mode === "video_lecture"
    ) {
      this.currentTimeMs = requested.timeMs;
      this.player.seek(requested.timeMs, false);
      if (!requested.slideId) {
        this.state.follow();
        this.updateMode();
        this.onVideoTime(requested.timeMs);
      }
    }
    const target = requested.slideId ? this.resolveUrlSlide(requested.slideId) : undefined;
    if (target) {
      this.state.explore();
      this.updateMode();
      if (target.revision === this.revision) this.setActive(target.pageStateId, true, true);
      else await this.showRevision(target.revision, target.pageStateId, true);
    }
    this.replaceUrlState();
  }

  private replaceUrlState(): void {
    if (!this.urlStateReady || !this.manifest) return;
    const url = new URL(window.location.href);
    url.searchParams.set("lecture", this.manifest.lecture_id);
    if (this.state.activePageStateId) url.searchParams.set("slide", this.state.activePageStateId);
    else url.searchParams.delete("slide");
    if (this.manifest.presentation.mode === "video_lecture" && this.currentTimeMs > 0) {
      const seconds = (this.currentTimeMs / 1000).toFixed(3).replace(/\.?0+$/, "");
      url.searchParams.set("time", seconds);
    } else {
      url.searchParams.delete("time");
    }
    if (url.href !== window.location.href) history.replaceState(history.state, "", url);
  }
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ");
}

function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
