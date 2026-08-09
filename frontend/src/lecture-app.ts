import { AssistantPanel, type ChatSelection } from "./assistant";
import { cueAt, cuePageStateIds, nearestOccurrence } from "./cue-engine";
import {
  buildSlideIndex,
  formatTimeMs,
  occurrenceTimeMs,
  revisedTeachingStateIds,
  searchSlides,
  slideTitle,
  type SlideIndex
} from "./lecture-data";
import { MiniPlayer } from "./mini-player";
import { PdfViewer } from "./pdf-viewer";
import { QaDebugTraceView } from "./qa-debug";
import { SelectionPopover } from "./selection-popover";
import { SyncState } from "./sync-state";
import {
  normalizeLectureManifest,
  pageStateForId,
  pageStateIdForRevision,
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
        <div class="video-dock" hidden>
          <div class="video-frame">
            <div class="video-container"></div>
            <div class="mini-player-bar" hidden>
              <span class="mini-player-time" aria-hidden="true"></span>
              <span class="mini-player-hint" aria-hidden="true">drag to move</span>
              <button type="button" data-action="mini-expand" aria-label="Return the video to the page">⤢</button>
              <button type="button" data-action="mini-close" aria-label="Hide the floating video">×</button>
            </div>
          </div>
        </div>
        <p class="external-video" hidden></p>
        <div class="video-statusbar" hidden>
          <span class="video-time"><span data-time-now>0:00</span> / <span data-time-total>–:––</span></span>
          <span class="follow-pill" data-follow-state="following">
            <span class="follow-indicator"><span class="follow-dot" aria-hidden="true"></span><span
              class="follow-label">Slides following video</span></span>
            <span class="follow-paused-label">Auto-follow paused</span>
            <button type="button" data-action="resume-follow">Resume following</button>
          </span>
          <span class="now-viewing"></span>
        </div>
        <div class="media-below" hidden></div>
      </section>
      <section class="slide-panel" role="tabpanel" aria-label="Lecture slides">
        <div class="slide-toolbar" aria-label="Slide controls">
          <button type="button" data-action="toggle-toc" aria-expanded="false" aria-haspopup="true">
            <span aria-hidden="true">☰</span> <span class="toolbar-label">Slides</span>
          </button>
          <div class="slide-search">
            <input type="search" placeholder="Search in slides…" aria-label="Search in slides"
              autocomplete="off">
            <div class="search-results" hidden></div>
          </div>
          <div class="pdf-menu">
            <button type="button" data-action="toggle-pdf-menu" aria-haspopup="true"
              aria-expanded="false">PDF</button>
            <div class="pdf-menu-list" hidden>
              <div class="pdf-download" hidden></div>
              <button type="button" data-action="print">Print slides</button>
            </div>
          </div>
          <button type="button" class="play-from-slide" data-action="play-time">
            <span aria-hidden="true">▶</span> <span class="toolbar-label">Play video from this slide</span>
          </button>
        </div>
        <div class="revision-row">
          <div class="revision-tabs" role="tablist" aria-label="Slide revision">
            <button type="button" role="tab" data-revision="recorded">Slides as in video</button>
            <button type="button" role="tab" data-revision="teaching">Updated slides</button>
          </div>
          <span class="revision-hint"></span>
        </div>
        <div class="correction-notice" hidden></div>
        <div class="slide-strip">
          <div class="toc-drawer" hidden>
            <header>
              <h2 class="toc-title">All slides</h2>
              <button type="button" data-action="close-toc" aria-label="Close the slide list">×</button>
            </header>
            <ul class="toc-list"></ul>
          </div>
          <div class="slide-scroll" tabindex="0" aria-label="Scrollable slides"></div>
        </div>
      </section>
    </div>
    <div class="assistant-region"></div>
    <div class="selection-popover" hidden></div>
  </section>`;

let lectureInstance = 0;

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
  private assistant: AssistantPanel | undefined;
  private selectionPopover: SelectionPopover | undefined;
  private miniPlayer: MiniPlayer | undefined;
  private slideIndex: SlideIndex = { entries: [], total: 0, byStateId: new Map() };
  private revisedIds = new Set<string>();
  private currentTimeMs = 0;
  private videoCueKey: string | undefined;
  private lastSlideStateId: string | undefined;
  private debugTrace: QaDebugTraceView | undefined;
  private revisionRequest = 0;
  private pendingScrollTargetId: string | undefined;
  private urlStateReady = false;
  private searchDebounce: number | undefined;
  private tocThumbnailObserver: IntersectionObserver | undefined;
  private readonly layoutQuery = window.matchMedia("(max-width: 1149.98px)");
  private readonly layoutListener = () => this.placeSupplements();
  private readonly popStateHandler = () => {
    if (this.urlStateReady) void this.applyUrlState();
  };

  connectedCallback(): void {
    document.body.classList.add("has-modern-lecture");
    const supplements = this.querySelector("[data-lecture-supplements]");
    supplements?.remove();
    this.replaceChildren(template.content.cloneNode(true));
    if (supplements) {
      const below = this.element<HTMLElement>(".media-below");
      below.append(supplements);
      below.hidden = false;
    }
    this.debugTrace = undefined;
    const instance = ++lectureInstance;
    const slidePanel = this.element<HTMLElement>(".slide-panel");
    slidePanel.id = `i2ml-lecture-slides-${instance}`;
    this.querySelectorAll<HTMLButtonElement>("[data-revision]").forEach((tab) => {
      tab.id = `i2ml-revision-${tab.dataset.revision}-${instance}`;
      tab.setAttribute("aria-controls", slidePanel.id);
    });
    if (this.dataset.qaDebug === "true") this.debugTrace = new QaDebugTraceView();
    this.viewer = new PdfViewer(this.element(".slide-scroll"), (state) => this.visibleSlide(state));
    this.assistant = new AssistantPanel(
      this.element(".assistant-region"),
      {
        lectureId: () => this.manifest?.lecture_id ?? this.dataset.lectureId ?? "",
        lectureTitle: () => this.manifest?.title ?? document.title,
        contentRevision: () => this.manifest?.content_revision ?? "",
        hasVideo: () => this.hasControllableVideo(),
        activeSlideNumber: () => this.activeSlideNumber(),
        citationTimeMs: (slideId) =>
          this.manifest && this.hasControllableVideo()
            ? occurrenceTimeMs(this.manifest, slideId)
            : undefined,
        prepareQuestion: (selection) => this.prepareQuestion(selection),
        openCitation: (slideId) => {
          void this.navigateToCitation(slideId).catch((error) =>
            this.fail(error instanceof Error ? error.message : "Cited slide failed to load")
          );
        },
        seekVideo: (timeMs) => this.seekFromCitation(timeMs),
        announce: (message) => this.status(message)
      },
      this.debugTrace
    );
    this.selectionPopover = new SelectionPopover(
      this.element(".selection-popover"),
      this.element(".slide-scroll"),
      {
        onAsk: (text, slide) => this.askAboutSelection(text, slide),
        announce: (message) => this.status(message)
      }
    );
    this.bindControls();
    this.placeSupplements();
    this.layoutQuery.addEventListener?.("change", this.layoutListener);
    window.addEventListener("popstate", this.popStateHandler);
    void this.load();
  }

  disconnectedCallback(): void {
    this.layoutQuery.removeEventListener?.("change", this.layoutListener);
    window.removeEventListener("popstate", this.popStateHandler);
    this.player.destroy();
    this.viewer?.destroy();
    this.selectionPopover?.destroy();
    this.miniPlayer?.destroy();
    this.assistant?.destroy();
    this.tocThumbnailObserver?.disconnect();
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
      this.revisedIds = revisedTeachingStateIds(this.manifest);
      this.assistant?.activate();
      const requestedUrlState = this.readUrlState();
      const requestedSlide = requestedUrlState.slideId
        ? this.resolveUrlSlide(requestedUrlState.slideId)
        : undefined;
      if (requestedSlide) {
        this.revision = requestedSlide.revision;
        this.state.explore();
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
      this.updateSyncUi();
      this.urlStateReady = true;
      this.replaceUrlState();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Lecture failed to load");
    }
  }

  private hasControllableVideo(): boolean {
    return (
      this.manifest?.presentation.mode === "video_lecture" &&
      !this.element<HTMLElement>(".media-panel").classList.contains("has-media-error")
    );
  }

  /**
   * Keeps the below-video content (description, quiz, downloads) under the
   * video in the desktop two-column layout, but after the slide strip in the
   * stacked and slide-only layouts, matching the agreed reading order.
   */
  private placeSupplements(): void {
    const below = this.element<HTMLElement>(".media-below");
    const main = this.element<HTMLElement>(".lecture-main");
    const media = this.element<HTMLElement>(".media-panel");
    const stackAfterSlides = this.layoutQuery.matches || main.classList.contains("is-slide-only");
    const target = stackAfterSlides ? main : media;
    if (below.parentElement !== target) target.append(below);
  }

  private async mountPresentation(): Promise<void> {
    if (!this.manifest) return;
    const presentation = this.manifest.presentation;
    const media = this.element<HTMLElement>(".media-panel");
    if (
      presentation.mode === "video_lecture" &&
      presentation.provider === "youtube" &&
      presentation.provider_id
    ) {
      this.element<HTMLElement>(".video-dock").hidden = false;
      this.element<HTMLElement>(".video-statusbar").hidden = false;
      await this.player.mount(
        this.element(".video-container"),
        presentation.provider_id,
        () => this.updateTimeDisplay()
      );
      this.player.onTime((time) => this.onVideoTime(time));
      this.miniPlayer = new MiniPlayer(
        this.element(".video-dock"),
        this.element(".video-frame"),
        this.element(".mini-player-bar")
      );
      this.updateTimeDisplay();
      return;
    }
    media.classList.add("is-slide-only");
    this.element<HTMLElement>(".lecture-main").classList.add("is-slide-only");
    this.element<HTMLElement>(".video-dock").hidden = true;
    this.element<HTMLElement>(".video-statusbar").hidden = true;
    let hasExternalLink = false;
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
      hasExternalLink = true;
    }
    this.placeSupplements();
    media.hidden = !hasExternalLink;
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
    this.renderRevisionHint();
    this.renderPdfMenu(asset);
    await this.viewer.load(asset);
    if (request !== this.revisionRequest) return;
    this.slideIndex = buildSlideIndex(asset, this.manifest.cues, (state) => {
      // Recorded pages without their own text inherit the mapped teaching title.
      const manifest = this.manifest;
      if (!manifest) return undefined;
      const teachingId = pageStateIdForRevision(manifest, state.id, "teaching");
      const teaching = teachingId
        ? manifest.revisions.teaching.page_states.find((item) => item.id === teachingId)
        : undefined;
      return teaching ? slideTitle(teaching) : undefined;
    });
    if (revision === "teaching") {
      this.viewer.setRevisionBadges(this.revisedIds, "revised after recording");
    }
    this.videoCueKey = undefined;
    this.refreshVideoCue();
    this.renderToc();
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
    this.updateSyncUi();
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

  private renderRevisionHint(): void {
    if (!this.manifest) return;
    const hint = this.element<HTMLElement>(".revision-hint");
    const revisedCount = this.revisedIds.size;
    if (!this.manifest.revisions.recorded) {
      hint.textContent = "current teaching slides";
      return;
    }
    if (this.revision === "recorded") {
      hint.textContent = revisedCount > 0
        ? `exact match with the video · the updated version fixes errata on ${revisedCount} slide${
            revisedCount === 1 ? "" : "s"
          }`
        : "exact match with the video";
    } else {
      hint.textContent = revisedCount > 0
        ? `errata fixed on ${revisedCount} slide${
            revisedCount === 1 ? "" : "s"
          } — may differ slightly from the video`
        : "viewing updated slides — may differ slightly from the video";
    }
  }

  private renderPdfMenu(asset: RevisionAsset): void {
    const downloads = this.element<HTMLElement>(".pdf-download");
    downloads.replaceChildren();
    const available = asset.decks.filter((deck) => deck.download_url);
    for (const [index, deck] of available.entries()) {
      const link = document.createElement("a");
      link.href = deck.download_url!;
      link.textContent = available.length === 1
        ? "Download slides (PDF)"
        : `Download deck ${deck.order || index + 1} (PDF)`;
      downloads.append(link);
    }
    downloads.hidden = available.length === 0;
    this.element<HTMLButtonElement>("[data-action=toggle-pdf-menu]").disabled = false;
  }

  private onVideoTime(timeMs: number): void {
    this.currentTimeMs = timeMs;
    this.updateTimeDisplay();
    if (!this.manifest) return;
    const cue = cueAt(this.manifest.cues, timeMs);
    this.refreshVideoCue();
    if (this.state.mode !== "follow") {
      this.updateSyncUi();
      return;
    }
    if (!cue || cue.state_kind === "non_slide") {
      const kind = cue?.non_slide_kind ?? cue?.state ?? "unmapped";
      if (!this.state.activePageStateId && this.state.activeNonSlideKind === kind) return;
      this.state.activateNonSlide(kind);
      this.viewer?.setActive(undefined);
      this.updateCorrection(undefined);
      this.updateSyncUi();
      this.assistant?.refreshContext();
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
      this.updateSyncUi();
      this.replaceUrlState();
      return;
    }
    if (target === this.state.activePageStateId && !this.state.activeNonSlideKind) return;
    this.status("");
    this.setActive(target, true);
  }

  /** Keeps the "current in video" chip and TOC marker in sync with playback. */
  private refreshVideoCue(): void {
    if (!this.manifest || !this.hasControllableVideo()) return;
    const cue = cueAt(this.manifest.cues, this.currentTimeMs);
    const target = cue && cue.state_kind === "slide"
      ? this.cueStateForRevision(cuePageStateIds(cue, this.revision))
      : undefined;
    const key = `${target ?? "none"}:${cue?.start_ms ?? -1}`;
    if (key === this.videoCueKey) return;
    this.videoCueKey = key;
    this.viewer?.setVideoCurrent(
      target,
      cue ? `Current · ${formatTimeMs(cue.stable_at_ms ?? cue.start_ms)}` : undefined
    );
    this.decorateToc();
  }

  private visibleSlide(page: PageState): void {
    if (
      this.manifest?.presentation.mode === "video_lecture" &&
      this.state.mode === "follow"
    ) return;
    if (this.pendingScrollTargetId && page.id !== this.pendingScrollTargetId) return;
    if (page.id === this.pendingScrollTargetId) this.pendingScrollTargetId = undefined;
    this.state.activatePage(page.id);
    this.lastSlideStateId = page.id;
    this.viewer?.setActive(page.id);
    this.updateCorrection(page);
    this.updateSyncUi();
    this.assistant?.refreshContext();
    this.replaceUrlState();
  }

  private setActive(pageStateId: string | undefined, scroll: boolean, focus = false): void {
    if (!pageStateId) return;
    const page = this.currentAsset()?.page_states.find(
      (item) => item.id === pageStateId || item.aliases.includes(pageStateId)
    );
    if (!page) return;
    this.state.activatePage(page.id);
    this.lastSlideStateId = page.id;
    this.viewer?.setActive(page.id);
    if (scroll) {
      const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      this.pendingScrollTargetId = page.id;
      this.state.withProgrammaticScroll(() => this.viewer?.scrollTo(page.id, behavior, focus));
    }
    this.updateCorrection(page);
    this.updateSyncUi();
    this.assistant?.refreshContext();
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
    const targetTime = cue.stable_at_ms ?? cue.start_ms;
    this.currentTimeMs = targetTime;
    this.player.seek(targetTime, play);
    this.updateTimeDisplay();
    this.refreshVideoCue();
    this.updateSyncUi();
    this.replaceUrlState();
  }

  private seekFromCitation(timeMs: number): void {
    if (!this.hasControllableVideo()) return;
    this.state.follow();
    this.currentTimeMs = timeMs;
    this.player.seek(timeMs, true);
    this.updateTimeDisplay();
    this.onVideoTime(timeMs);
    this.updateSyncUi();
  }

  private bindControls(): void {
    const scroll = this.element<HTMLElement>(".slide-scroll");
    const manualKeys = new Set([
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "
    ]);
    const manualIntent = () => {
      this.pendingScrollTargetId = undefined;
      const wasFollowing = this.state.mode === "follow";
      this.state.manualIntent();
      if (wasFollowing && this.state.mode === "explore") this.updateSyncUi();
    };
    scroll.addEventListener("wheel", manualIntent, { passive: true });
    scroll.addEventListener("touchstart", manualIntent, { passive: true });
    scroll.addEventListener("pointerdown", manualIntent);
    scroll.addEventListener("keydown", (event) => {
      if (manualKeys.has(event.key)) manualIntent();
    });
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
    this.action("resume-follow", () => {
      this.state.follow();
      this.updateSyncUi();
      this.onVideoTime(this.currentTimeMs);
      this.status("Slides follow the video again.");
    });
    this.action("play-time", () => this.syncVideo(true));
    this.action("print", () => {
      this.setPdfMenuOpen(false);
      void this.printSlides();
    });
    this.action("toggle-pdf-menu", () =>
      this.setPdfMenuOpen(Boolean(this.element<HTMLElement>(".pdf-menu-list").hidden))
    );
    this.action("toggle-toc", () =>
      this.setTocOpen(Boolean(this.element<HTMLElement>(".toc-drawer").hidden))
    );
    this.action("close-toc", () => this.setTocOpen(false, true));
    document.addEventListener("pointerdown", (event) => {
      const target = event.target as Node;
      const pdfMenu = this.querySelector<HTMLElement>(".pdf-menu");
      if (pdfMenu && !pdfMenu.contains(target)) this.setPdfMenuOpen(false);
      const search = this.querySelector<HTMLElement>(".slide-search");
      if (search && !search.contains(target)) this.setSearchResultsOpen(false);
      const drawer = this.querySelector<HTMLElement>(".toc-drawer");
      const tocToggle = this.querySelector<HTMLElement>("[data-action=toggle-toc]");
      if (
        drawer && !drawer.hidden &&
        !drawer.contains(target) &&
        !(tocToggle && tocToggle.contains(target))
      ) {
        this.setTocOpen(false);
      }
    });
    const drawer = this.element<HTMLElement>(".toc-drawer");
    drawer.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.setTocOpen(false, true);
    });
    const searchInput = this.element<HTMLInputElement>(".slide-search input");
    searchInput.addEventListener("input", () => {
      if (this.searchDebounce !== undefined) window.clearTimeout(this.searchDebounce);
      this.searchDebounce = window.setTimeout(() => this.renderSearchResults(), 120);
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (searchInput.value) {
          searchInput.value = "";
          this.setSearchResultsOpen(false);
        }
        return;
      }
      if (event.key === "ArrowDown") {
        const first = this.querySelector<HTMLButtonElement>(".search-results button");
        if (first) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === "Enter") {
        event.preventDefault();
        this.querySelector<HTMLButtonElement>(".search-results button")?.click();
      }
    });
    this.element<HTMLElement>(".search-results").addEventListener("keydown", (event) => {
      const results = [...this.querySelectorAll<HTMLButtonElement>(".search-results button")];
      const index = results.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown" && index >= 0 && index < results.length - 1) {
        event.preventDefault();
        results[index + 1]!.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (index > 0) results[index - 1]!.focus();
        else searchInput.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.setSearchResultsOpen(false);
        searchInput.focus();
      }
    });
  }

  private setPdfMenuOpen(open: boolean): void {
    const list = this.element<HTMLElement>(".pdf-menu-list");
    list.hidden = !open;
    this.element<HTMLButtonElement>("[data-action=toggle-pdf-menu]").setAttribute(
      "aria-expanded",
      String(open)
    );
  }

  private setSearchResultsOpen(open: boolean): void {
    const results = this.element<HTMLElement>(".search-results");
    results.hidden = !open;
    if (!open) results.replaceChildren();
  }

  private renderSearchResults(): void {
    const input = this.element<HTMLInputElement>(".slide-search input");
    const hits = searchSlides(this.slideIndex, input.value);
    const results = this.element<HTMLElement>(".search-results");
    if (input.value.replace(/\s+/g, " ").trim().length < 2) {
      this.setSearchResultsOpen(false);
      return;
    }
    results.hidden = false;
    if (hits.length === 0) {
      const empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = "No slides match this search.";
      results.replaceChildren(empty);
      return;
    }
    results.replaceChildren(
      ...hits.map((hit) => {
        const button = document.createElement("button");
        button.type = "button";
        const title = document.createElement("strong");
        title.textContent = `${hit.entry.position} · ${hit.entry.title}`;
        button.append(title);
        if (hit.snippet && !hit.matchedTitle) {
          const snippet = document.createElement("span");
          snippet.textContent = hit.snippet;
          button.append(snippet);
        }
        button.addEventListener("click", () => {
          this.setSearchResultsOpen(false);
          this.jumpToSlide(hit.entry.state.id, true);
        });
        return button;
      })
    );
  }

  private jumpToSlide(stateId: string, focus = false): void {
    this.state.explore();
    this.setActive(stateId, true, focus);
  }

  private setTocOpen(open: boolean, returnFocus = false): void {
    const drawer = this.element<HTMLElement>(".toc-drawer");
    const toggle = this.element<HTMLButtonElement>("[data-action=toggle-toc]");
    drawer.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      this.renderToc();
      drawer.querySelector<HTMLElement>(".toc-list button")?.focus();
    } else {
      this.tocThumbnailObserver?.disconnect();
      this.tocThumbnailObserver = undefined;
      if (returnFocus) toggle.focus();
    }
  }

  private renderToc(): void {
    const drawer = this.element<HTMLElement>(".toc-drawer");
    if (drawer.hidden) return;
    const list = this.element<HTMLElement>(".toc-list");
    this.element<HTMLElement>(".toc-title").textContent =
      `All slides (${this.slideIndex.entries.length})`;
    this.tocThumbnailObserver?.disconnect();
    this.tocThumbnailObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const row = entry.target as HTMLElement;
          this.tocThumbnailObserver?.unobserve(row);
          const stateId = row.dataset.stateId;
          const image = row.querySelector<HTMLImageElement>("img");
          if (!stateId || !image) continue;
          void this.viewer?.thumbnail(stateId, 120).then((url) => {
            if (url) {
              image.src = url;
              image.hidden = false;
            }
          });
        }
      },
      { root: list, threshold: 0.1 }
    );
    const showDecks = new Set(this.slideIndex.entries.map((entry) => entry.state.deck_id)).size > 1;
    let renderedDeck: string | undefined;
    const rows: HTMLElement[] = [];
    for (const entry of this.slideIndex.entries) {
      if (showDecks && entry.state.deck_id !== renderedDeck) {
        renderedDeck = entry.state.deck_id;
        const heading = document.createElement("li");
        heading.className = "toc-deck-heading";
        heading.textContent = `Deck ${rows.filter((row) => row.className === "toc-deck-heading").length + 1}`;
        rows.push(heading);
      }
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.stateId = entry.state.id;
      const thumb = document.createElement("span");
      thumb.className = "toc-thumb";
      const image = document.createElement("img");
      image.alt = "";
      image.hidden = true;
      thumb.append(image);
      const text = document.createElement("span");
      text.className = "toc-text";
      const title = document.createElement("strong");
      title.textContent = `${entry.position} · ${entry.title}`;
      const marker = document.createElement("span");
      marker.className = "toc-marker";
      text.append(title, marker);
      if (entry.timeMs !== undefined) {
        const time = document.createElement("span");
        time.className = "toc-time";
        time.textContent = formatTimeMs(entry.timeMs);
        text.append(time);
      }
      button.append(thumb, text);
      button.addEventListener("click", () => {
        this.jumpToSlide(entry.state.id, true);
        this.decorateToc();
      });
      item.append(button);
      rows.push(item);
      this.tocThumbnailObserver.observe(button);
    }
    list.replaceChildren(...rows);
    this.decorateToc();
  }

  private decorateToc(): void {
    const drawer = this.querySelector<HTMLElement>(".toc-drawer");
    if (!drawer || drawer.hidden) return;
    const videoStateId = this.videoCueStateId();
    for (const button of drawer.querySelectorAll<HTMLElement>(".toc-list button")) {
      const stateId = button.dataset.stateId;
      const isVideo = Boolean(videoStateId && stateId === videoStateId);
      const isViewing = Boolean(stateId && stateId === this.state.activePageStateId);
      button.classList.toggle("is-video-current", isVideo);
      button.classList.toggle("is-viewing", isViewing);
      const marker = button.querySelector<HTMLElement>(".toc-marker");
      if (marker) {
        marker.textContent = isViewing && isVideo
          ? "— video · viewing"
          : isVideo
            ? "— video"
            : isViewing
              ? "— viewing"
              : "";
      }
    }
  }

  private videoCueStateId(): string | undefined {
    if (!this.manifest || !this.hasControllableVideo()) return undefined;
    const cue = cueAt(this.manifest.cues, this.currentTimeMs);
    return cue && cue.state_kind === "slide"
      ? this.cueStateForRevision(cuePageStateIds(cue, this.revision))
      : undefined;
  }

  private activeSlideNumber(): number | undefined {
    const stateId = this.state.activePageStateId ?? this.lastSlideStateId;
    if (!stateId) return undefined;
    return this.slideIndex.byStateId.get(stateId)?.position;
  }

  private updateTimeDisplay(): void {
    if (!this.hasControllableVideo()) return;
    const now = formatTimeMs(this.currentTimeMs);
    this.element<HTMLElement>("[data-time-now]").textContent = now;
    const durationMs = this.player.durationMs();
    this.element<HTMLElement>("[data-time-total]").textContent = durationMs > 0
      ? formatTimeMs(durationMs)
      : "–:––";
    const miniTime = this.element<HTMLElement>(".mini-player-time");
    miniTime.textContent = durationMs > 0 ? `${now} / ${formatTimeMs(durationMs)}` : now;
  }

  /** Refreshes the follow pill, the now-viewing label, and control states. */
  private updateSyncUi(): void {
    const following = this.state.mode === "follow";
    const pill = this.element<HTMLElement>(".follow-pill");
    pill.dataset.followState = following ? "following" : "paused";
    const nowViewing = this.element<HTMLElement>(".now-viewing");
    nowViewing.replaceChildren();
    if (this.hasControllableVideo()) {
      const videoStateId = this.videoCueStateId();
      const videoEntry = videoStateId ? this.slideIndex.byStateId.get(videoStateId) : undefined;
      const activeEntry = this.state.activePageStateId
        ? this.slideIndex.byStateId.get(this.state.activePageStateId)
        : undefined;
      if (following) {
        if (activeEntry) {
          nowViewing.append(
            "Now: ",
            strong(`Slide ${activeEntry.position}`),
            ` — ${activeEntry.title}`
          );
        } else {
          const kind = this.state.activeNonSlideKind;
          nowViewing.append(kind ? `Now: ${humanize(kind)} (no slide)` : "");
        }
      } else {
        const videoText = videoEntry ? `slide ${videoEntry.position}` : "no slide";
        nowViewing.append("Video: ", strong(videoText));
        if (activeEntry) nowViewing.append(" · viewing ", strong(`slide ${activeEntry.position}`));
      }
    }
    const playButton = this.element<HTMLButtonElement>("[data-action=play-time]");
    const stateId = this.state.activePageStateId;
    const hasOccurrence = Boolean(
      this.manifest &&
      stateId &&
      this.hasControllableVideo() &&
      nearestOccurrence(this.manifest.cues, stateId, this.currentTimeMs)
    );
    playButton.disabled = !hasOccurrence;
    playButton.hidden = !this.hasControllableVideo();
    this.decorateToc();
  }

  private askAboutSelection(text: string, slide: HTMLElement): void {
    if (!this.manifest || !this.assistant) return;
    const stateId = slide.dataset.pageStateId;
    if (!stateId) {
      this.status("This page has no linked slide content to reference.");
      return;
    }
    const teachingId = pageStateIdForRevision(this.manifest, stateId, "teaching");
    const teaching = teachingId
      ? this.manifest.revisions.teaching.page_states.find((state) => state.id === teachingId)
      : undefined;
    if (!teachingId || !teaching) {
      this.status(
        "This recorded slide has no reviewed teaching-revision mapping; the question will not quote it."
      );
      this.assistant.open();
      return;
    }
    if (!normalized(teaching.text).includes(normalized(text))) {
      this.status(
        "The selected recorded text differs from the corrected slide, so it was not attached to the question."
      );
      this.assistant.open();
      return;
    }
    const entry = this.slideIndex.byStateId.get(stateId) ??
      this.slideIndex.byStateId.get(teachingId);
    this.assistant.setSelection(
      { text: text.slice(0, 2000), page_state_id: teachingId },
      entry ? `Slide ${entry.position}` : slideTitle(teaching)
    );
    this.assistant.open();
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
    this.updateSyncUi();
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
    this.status(
      `The recorded slide has no reviewed teaching mapping; using corrected slide ${fallback.page} for this question.`
    );
    await this.showRevision("teaching", fallback.id);
    return fallback.id;
  }

  private validatedTeachingSelection(
    selection: ChatSelection | undefined
  ): ChatSelection | undefined {
    if (!selection || !this.manifest) return undefined;
    const teachingId = pageStateIdForRevision(this.manifest, selection.page_state_id, "teaching");
    const teaching = teachingId
      ? this.manifest.revisions.teaching.page_states.find((state) => state.id === teachingId)
      : undefined;
    if (
      !teachingId ||
      !teaching ||
      !normalized(teaching.text).includes(normalized(selection.text))
    ) {
      this.assistant?.setSelection(undefined);
      this.status(
        "The selected text is not present in its corrected slide, so it was omitted from the question."
      );
      return undefined;
    }
    return { ...selection, page_state_id: teachingId };
  }

  private async prepareQuestion(selection: ChatSelection | undefined): Promise<
    { pageStateIds: string[]; selection?: ChatSelection } | undefined
  > {
    if (!this.manifest) return undefined;
    const contextSource = this.state.activePageStateId ??
      this.lastSlideStateId ??
      this.manifest.revisions.teaching.page_states[0]?.id;
    if (!contextSource) {
      this.status("This lecture has no slide content for the assistant yet.");
      return undefined;
    }
    const teachingContextId = await this.resolveTeachingContext(contextSource);
    if (!teachingContextId) return undefined;
    const validated = this.validatedTeachingSelection(selection);
    return {
      pageStateIds: [...new Set([
        teachingContextId,
        ...(validated ? [validated.page_state_id] : [])
      ])],
      ...(validated ? { selection: validated } : {})
    };
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
    this.element<HTMLElement>(".lecture-main").classList.add("is-slide-only");
    this.element<HTMLElement>(".video-statusbar").hidden = true;
    const dock = this.element<HTMLElement>(".video-dock");
    dock.hidden = true;
    this.element<HTMLElement>(".video-container").replaceChildren();
    this.miniPlayer?.destroy();
    this.miniPlayer = undefined;
    this.placeSupplements();
    media.hidden = true;
    this.status(`Video unavailable: ${message}. Slides and the assistant remain available.`);
    this.showFallbackLinks();
    this.updateSyncUi();
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
        this.updateSyncUi();
        this.onVideoTime(requested.timeMs);
      }
    }
    const target = requested.slideId ? this.resolveUrlSlide(requested.slideId) : undefined;
    if (target) {
      this.state.explore();
      this.updateSyncUi();
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

function strong(text: string): HTMLElement {
  const element = document.createElement("strong");
  element.textContent = text;
  return element;
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
