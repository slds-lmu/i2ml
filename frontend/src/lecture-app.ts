import { AssistantPanel, type ChatSelection } from "./assistant";
import { cueAt, cuePageStateIds, nearestOccurrence, slideCueNavigation } from "./cue-engine";
import { FollowSync, type StripScrollBehavior } from "./follow-sync";
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
import { matchSelectionToSlideText } from "./selection-match";
import { SelectionPopover } from "./selection-popover";
import {
  normalizeLectureManifest,
  pageStateForId,
  pageStateIdForRevision,
  type LectureManifest,
  type PageState,
  type RevisionAsset,
  type RevisionKind
} from "./types";
import { PLAYER_STATE, YouTubeController } from "./youtube";

const template = document.createElement("template");
template.innerHTML = `
  <section class="lecture-shell" aria-label="Synchronized lecture">
    <div class="lecture-main">
      <section class="media-panel" aria-label="Lecture media">
        <header class="lecture-heading-host" hidden></header>
        <div class="lecture-status" role="status" aria-live="polite"></div>
        <div class="lecture-fallback" hidden></div>
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
            <button type="button" class="follow-indicator" data-action="follow-pill"
              title="Scroll the current slide back to the top position">
              <span class="follow-dot" aria-hidden="true"></span><span
              class="follow-label">Slides following video</span>
            </button>
            <span class="follow-paused-label">Auto-follow paused</span>
            <button type="button" data-action="resume-follow">Resume following</button>
          </span>
          <span class="player-controls" role="group" aria-label="Playback controls">
            <button type="button" data-action="prev-slide" title="Jump to the previous slide"
              aria-label="Jump to the previous slide">
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
                <path d="M4 3v10" fill="none" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round"/>
                <path d="M13 3.5v9L6.5 8z" fill="currentColor"/>
              </svg>
            </button>
            <button type="button" data-action="slide-start" title="Jump to the start of this slide"
              aria-label="Jump to the start of this slide">
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
                <path d="M11.5 3.5v9L5 8z" fill="currentColor"/>
              </svg>
            </button>
            <button type="button" data-action="toggle-play" title="Play" aria-label="Play">
              <svg class="icon-play" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"
                focusable="false">
                <path d="M4.5 2.8v10.4L13.2 8z" fill="currentColor"/>
              </svg>
              <svg class="icon-pause" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"
                focusable="false">
                <path d="M4.5 3h2.4v10H4.5zM9.1 3h2.4v10H9.1z" fill="currentColor"/>
              </svg>
            </button>
            <button type="button" data-action="next-slide" title="Jump to the next slide"
              aria-label="Jump to the next slide">
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
                <path d="M12 3v10" fill="none" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round"/>
                <path d="M3 3.5v9L9.5 8z" fill="currentColor"/>
              </svg>
            </button>
            <span class="speed-wrap">
              <button type="button" data-action="playback-speed" title="Playback speed"
                aria-label="Playback speed" aria-haspopup="true" aria-expanded="false">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                  <circle cx="8" cy="9.2" r="5.2" fill="none" stroke="currentColor"
                    stroke-width="1.6"/>
                  <path d="M8 6.6v2.6l1.9 1.2M6.3 1.4h3.4M8 1.4v2.1" fill="none"
                    stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                </svg>
                <span class="speed-value" hidden></span>
              </button>
              <div class="speed-menu" aria-label="Playback speed" hidden></div>
            </span>
          </span>
          <span class="now-viewing"></span>
        </div>
        <div class="media-below" hidden></div>
      </section>
      <div class="col-resizer" data-resizer="slides" role="separator" aria-orientation="vertical"
        aria-label="Resize the slide panel"></div>
      <section class="slide-panel" role="tabpanel" aria-label="Lecture slides">
        <div class="slide-toolbar" aria-label="Slide controls">
          <button type="button" data-action="toggle-toc" aria-expanded="false" aria-haspopup="true"
            aria-label="Slides">
            <span aria-hidden="true">☰</span> <span class="toolbar-label">Slides</span>
          </button>
          <div class="slide-search">
            <input type="search" placeholder="Search in slides…" aria-label="Search in slides"
              autocomplete="off">
            <div class="search-results" hidden></div>
          </div>
        </div>
        <div class="revision-row">
          <div class="revision-tabs" role="tablist" aria-label="Slide revision">
            <button type="button" role="tab" data-revision="recorded">Slides as in video</button>
            <button type="button" role="tab" data-revision="teaching">Updated slides</button>
          </div>
          <span class="revision-hint"></span>
        </div>
        <div class="slide-strip">
          <div class="toc-drawer" hidden>
            <header>
              <h2 class="toc-title">All slides</h2>
              <span class="toc-downloads"></span>
              <button type="button" data-action="close-toc" aria-label="Close the slide list">×</button>
            </header>
            <ul class="toc-list"></ul>
          </div>
          <div class="slide-scroll" tabindex="0" aria-label="Scrollable slides"></div>
        </div>
      </section>
    </div>
    <div class="col-resizer" data-resizer="assistant" role="separator" aria-orientation="vertical"
      aria-label="Resize the assistant panel"></div>
    <div class="assistant-region"></div>
    <div class="chat-pull-handle" aria-hidden="true"></div>
    <div class="selection-popover" hidden></div>
  </section>`;

let lectureInstance = 0;

interface LectureUrlState {
  slideId?: string;
  timeMs?: number;
}

/**
 * Minimum landscape column widths. With the chat docked, their sum plus
 * dividers (320+300+280+12 = 912) stays below the 1000px docking threshold,
 * so opening the chat can always be absorbed without violating a minimum.
 * With the chat closed there is more room, so the minimums are larger
 * (scaled down via a viewport fraction on small landscape windows).
 */
const MIN_MEDIA_DOCKED = 320;
const MIN_SLIDES_DOCKED = 300;
/** Slide-only pages have one flowing column next to the docked chat. */
const MIN_MAIN_SLIDE_ONLY = 480;
const MIN_MEDIA_SOLO = 380;
const MIN_SLIDES_SOLO = 340;
const MIN_CHAT_W = 280;
/** Dragging the chat this far below its minimum closes it (pill returns). */
const CHAT_CLOSE_SLACK = 60;

export class LectureApp extends HTMLElement {
  private manifest: LectureManifest | undefined;
  private revision: RevisionKind = "recorded";
  private sync!: FollowSync;
  private player = new YouTubeController();
  private viewer: PdfViewer | undefined;
  private assistant: AssistantPanel | undefined;
  private selectionPopover: SelectionPopover | undefined;
  private miniPlayer: MiniPlayer | undefined;
  private slideIndex: SlideIndex = { entries: [], total: 0, byStateId: new Map() };
  private revisedIds = new Set<string>();
  private currentTimeMs = 0;
  private videoCueKey: string | undefined;
  private nonSlideKind: string | undefined;
  private lastSlideStateId: string | undefined;
  private debugTrace: QaDebugTraceView | undefined;
  private revisionRequest = 0;
  private urlStateReady = false;
  private searchDebounce: number | undefined;
  private scrollSettleTimer: number | undefined;
  private tocThumbnailObserver: IntersectionObserver | undefined;
  private hintResizeObserver: ResizeObserver | undefined;
  private playbackRate = 1;
  private speedReadbackTimer: number | undefined;
  private readonly portraitQuery = window.matchMedia("(orientation: portrait)");
  private readonly layoutListener = () => this.placeSupplements();
  private layoutMetricsFrame: number | undefined;
  private readonly layoutMetricsListener = () => {
    if (this.layoutMetricsFrame !== undefined) window.cancelAnimationFrame(this.layoutMetricsFrame);
    this.layoutMetricsFrame = window.requestAnimationFrame(() => {
      this.layoutMetricsFrame = undefined;
      this.refreshHintTruncation();
      this.clampColumns();
    });
  };
  private readonly popStateHandler = () => {
    if (this.urlStateReady) void this.applyUrlState();
  };

  connectedCallback(): void {
    // has-modern-lecture is also set server-side; has-lecture-app gates the
    // viewport-locked landscape shell on a successful upgrade.
    document.body.classList.add("has-modern-lecture", "has-lecture-app");
    const adopt = (selector: string): HTMLElement | undefined => {
      const node = this.querySelector<HTMLElement>(selector);
      node?.remove();
      return node ?? undefined;
    };
    const heading = adopt("[data-lecture-heading]");
    const introduction = adopt("[data-lecture-introduction]");
    const supplements = adopt("[data-lecture-supplements]");
    const downloads = adopt("[data-lecture-downloads]");
    const sectionNav = adopt("[data-lecture-nav]");
    this.replaceChildren(template.content.cloneNode(true));
    if (heading) {
      const host = this.element<HTMLElement>(".lecture-heading-host");
      host.append(heading);
      host.hidden = false;
    }
    const below = this.element<HTMLElement>(".media-below");
    for (const node of [introduction, supplements, downloads, sectionNav]) {
      if (node) below.append(node);
    }
    below.hidden = below.childElementCount === 0;
    this.debugTrace = undefined;
    const instance = ++lectureInstance;
    const slidePanel = this.element<HTMLElement>(".slide-panel");
    slidePanel.id = `i2ml-lecture-slides-${instance}`;
    this.querySelectorAll<HTMLButtonElement>("[data-revision]").forEach((tab) => {
      tab.id = `i2ml-revision-${tab.dataset.revision}-${instance}`;
      tab.setAttribute("aria-controls", slidePanel.id);
    });
    if (this.dataset.qaDebug === "true") this.debugTrace = new QaDebugTraceView();
    this.viewer = new PdfViewer(
      this.element(".slide-scroll"),
      (state) => this.selectSlide(state.id, { scrollIntoView: false }),
      (state) => this.playFromSlide(state.id, { resume: true })
    );
    this.sync = new FollowSync({
      lowerHalfVisibleFraction: (stateId) => this.viewer?.lowerHalfVisibleFraction(stateId),
      distanceFromTopPosition: (stateId) => this.viewer?.distanceFromTopPosition(stateId),
      scrollToTopPosition: (stateId, behavior) =>
        this.viewer?.scrollToTopPosition(stateId, behavior) ?? Promise.resolve(false),
      stateChanged: () => this.applySyncState()
    });
    this.assistant = new AssistantPanel(
      this.element(".assistant-region"),
      {
        lectureId: () => this.manifest?.lecture_id ?? this.dataset.lectureId ?? "",
        lectureTitle: () => this.manifest?.title ?? document.title,
        contentRevision: () => this.manifest?.content_revision ?? "",
        hasVideo: () => this.hasControllableVideo(),
        expandedChanged: () => window.requestAnimationFrame(() => this.clampColumns()),
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
    this.bindResizers();
    this.placeSupplements();
    window.requestAnimationFrame(() => this.clampColumns());
    this.portraitQuery.addEventListener?.("change", this.layoutListener);
    window.addEventListener("resize", this.layoutMetricsListener);
    window.addEventListener("popstate", this.popStateHandler);
    void this.load();
  }

  disconnectedCallback(): void {
    this.portraitQuery.removeEventListener?.("change", this.layoutListener);
    window.removeEventListener("resize", this.layoutMetricsListener);
    if (this.layoutMetricsFrame !== undefined) window.cancelAnimationFrame(this.layoutMetricsFrame);
    if (this.scrollSettleTimer !== undefined) window.clearTimeout(this.scrollSettleTimer);
    if (this.speedReadbackTimer !== undefined) window.clearTimeout(this.speedReadbackTimer);
    window.removeEventListener("popstate", this.popStateHandler);
    this.player.destroy();
    this.viewer?.destroy();
    this.selectionPopover?.destroy();
    this.miniPlayer?.destroy();
    this.assistant?.destroy();
    this.tocThumbnailObserver?.disconnect();
    this.hintResizeObserver?.disconnect();
    this.hintResizeObserver = undefined;
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
      if (requestedSlide) this.revision = requestedSlide.revision;
      await this.showRevision(this.revision);
      let mediaReady = false;
      try {
        await this.mountPresentation(requestedUrlState.timeMs);
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
        // The video is cued at this time via playerVars (mountPresentation);
        // seeking + pausing an unstarted player would leave a black box.
        this.currentTimeMs = requestedUrlState.timeMs;
        this.updateTimeDisplay();
        this.onVideoTime(requestedUrlState.timeMs);
      }
      if (requestedSlide) {
        this.selectSlide(requestedSlide.pageStateId, {
          scrollIntoView: true,
          behavior: "instant"
        });
        // Re-pin once the neighbourhood has rendered: the instant scroll above
        // was computed against placeholder slide heights.
        void this.viewer?.restoreStripAnchor({
          stateId: this.sync.selectedStateId ?? requestedSlide.pageStateId,
          stripIndex: 0,
          fraction: 0
        });
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
   * Keeps the below-video content (description, quiz, downloads, chapter
   * navigation) under the video in the landscape column layout, but after the
   * slide strip in the portrait and slide-only layouts.
   */
  private placeSupplements(): void {
    const below = this.element<HTMLElement>(".media-below");
    const main = this.element<HTMLElement>(".lecture-main");
    const media = this.element<HTMLElement>(".media-panel");
    const stackAfterSlides = this.portraitQuery.matches || main.classList.contains("is-slide-only");
    const target = stackAfterSlides ? main : media;
    if (below.parentElement !== target) target.append(below);
  }

  private async mountPresentation(startTimeMs?: number): Promise<void> {
    if (!this.manifest) return;
    const presentation = this.manifest.presentation;
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
        (state) => {
          this.refreshPlayToggle(state);
          this.updateTimeDisplay();
        },
        startTimeMs !== undefined ? startTimeMs / 1000 : undefined
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
    this.element<HTMLElement>(".media-panel").classList.add("is-slide-only");
    this.element<HTMLElement>(".lecture-main").classList.add("is-slide-only");
    // The shell-level marker keeps the assistant a floating sheet: there is
    // no column split to dock into on slide-only pages.
    this.element<HTMLElement>(".lecture-shell").classList.add("is-slide-only");
    this.element<HTMLElement>(".video-dock").hidden = true;
    this.element<HTMLElement>(".video-statusbar").hidden = true;
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
    this.placeSupplements();
  }

  /**
   * Loads a revision, preserving the follow state and the scroll state: the
   * video slide and the selection are re-mapped, and the strip is restored so
   * the top-position line cuts the same slide at the same height fraction as
   * before (taken at the target of any in-flight scroll animation). A slide
   * stuck at the top position stays stuck, pinned exactly. An explicit
   * `anchorStateId` (citation into the other revision) wins instead.
   */
  private async showRevision(revision: RevisionKind, anchorStateId?: string): Promise<void> {
    if (!this.manifest || !this.viewer) return;
    const asset = this.manifest.revisions[revision];
    if (!asset) return;
    const request = ++this.revisionRequest;
    const previousSelected = this.sync.selectedStateId;
    const previousExplicit = this.sync.explicitSelectionId;
    const stripAnchor = anchorStateId ? undefined : this.viewer.captureStripAnchor();
    const wasStuck = this.sync.stuck;
    this.revision = revision;
    for (const tab of this.querySelectorAll<HTMLButtonElement>("[data-revision]")) {
      const selected = tab.dataset.revision === revision;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.hidden = tab.dataset.revision === "recorded" && !this.manifest.revisions.recorded;
      if (selected) this.element<HTMLElement>(".slide-panel").setAttribute("aria-labelledby", tab.id);
    }
    this.renderRevisionHint();
    this.renderDownloads(asset);
    try {
      await this.viewer.load(asset);
    } catch (error) {
      // A PDF render failure (unsupported browser, broken download) must not
      // take down the lecture: fall back to the structured slide text.
      if (request !== this.revisionRequest) return;
      await this.viewer.load(undefined, asset.page_states);
      this.status(
        "Slide images could not be rendered in this browser, so the slide text is shown instead. " +
        "Use the PDF download for the original layout." +
        (error instanceof Error && error.message ? ` (${error.message})` : "")
      );
    }
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
    const mappedSelected = previousSelected
      ? pageStateIdForRevision(this.manifest, previousSelected, revision)
      : undefined;
    const mappedVideo = this.videoCueStateId();
    this.sync.rebind(mappedVideo, mappedSelected, {
      keepStuck: wasStuck && mappedVideo !== undefined,
      // The explicit selection maps through its own id, not the derived one.
      explicitSelectionId: previousExplicit
        ? pageStateIdForRevision(this.manifest, previousExplicit, revision)
        : undefined
    });
    if (this.manifest.presentation.mode !== "video_lecture" && !this.sync.selectedStateId) {
      const first = asset.page_states[0];
      if (first) this.sync.onSelect(first.id, { scrollIntoView: false });
    }
    this.refreshVideoCue();
    this.renderToc();
    if (anchorStateId) {
      const mapped = pageStateIdForRevision(this.manifest, anchorStateId, revision) ?? anchorStateId;
      void this.viewer.restoreStripAnchor({ stateId: mapped, stripIndex: 0, fraction: 0 });
    } else if (this.sync.stuck && this.sync.videoStateId) {
      // Freshly read: a cue advance during the reload moves the pin along.
      void this.viewer.restoreStripAnchor({
        stateId: this.sync.videoStateId,
        stripIndex: stripAnchor?.stripIndex ?? 0,
        fraction: 0
      });
    } else if (stripAnchor) {
      void this.viewer.restoreStripAnchor({
        ...stripAnchor,
        stateId: stripAnchor.stateId
          ? pageStateIdForRevision(this.manifest, stripAnchor.stateId, revision)
          : undefined
      });
    } else {
      const fallback = this.sync.selectedStateId ?? mappedVideo;
      if (fallback) {
        void this.viewer.restoreStripAnchor({ stateId: fallback, stripIndex: 0, fraction: 0 });
      }
    }
    this.updateSyncUi();
  }

  private async switchRevision(revision: RevisionKind): Promise<void> {
    if (!this.manifest || revision === this.revision || !this.manifest.revisions[revision]) return;
    await this.showRevision(revision);
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
    } else if (this.revision === "recorded") {
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
    this.refreshHintTruncation();
  }

  /**
   * The truncated hint expands to a wrapped overlay on hover. Whether it IS
   * truncated depends on the current column width, so it is re-measured on
   * every hint resize (chat toggling, divider drags, window resizes).
   */
  private refreshHintTruncation(): void {
    const hint = this.querySelector<HTMLElement>(".revision-hint");
    if (!hint) return;
    this.hintResizeObserver ??= (() => {
      const observer = new ResizeObserver(() => this.refreshHintTruncation());
      observer.observe(hint);
      return observer;
    })();
    hint.dataset.full = hint.textContent ?? "";
    hint.classList.toggle("is-truncated", hint.scrollWidth > hint.clientWidth + 1);
  }

  /** Slide PDF downloads in the below-video area and the slide-list header. */
  private renderDownloads(asset: RevisionAsset): void {
    const available = asset.decks.filter((deck) => deck.download_url);
    const links = (compact: boolean) =>
      available.map((deck, index) => {
        const link = document.createElement("a");
        link.href = deck.download_url!;
        link.className = compact ? "toc-download-link" : "lecture-download-link";
        const deckLabel = deck.order || index + 1;
        link.textContent = compact
          ? available.length === 1 ? "Download PDF" : `Deck ${deckLabel} PDF`
          : available.length === 1 ? "Download slides (PDF)" : `Download deck ${deckLabel} (PDF)`;
        return link;
      });
    const block = this.querySelector<HTMLElement>("[data-lecture-downloads]");
    if (block) {
      const target = block.querySelector<HTMLElement>(".lecture-downloads-links") ?? block;
      target.replaceChildren(...links(false));
      block.hidden = available.length === 0;
    }
    this.element<HTMLElement>(".toc-downloads").replaceChildren(...links(true));
  }

  private onVideoTime(timeMs: number): void {
    this.currentTimeMs = timeMs;
    this.updateTimeDisplay();
    if (!this.manifest) return;
    const cue = cueAt(this.manifest.cues, timeMs);
    this.refreshVideoCue();
    let target: string | undefined;
    if (!cue || cue.state_kind === "non_slide") {
      this.nonSlideKind = cue?.non_slide_kind ?? cue?.state ?? "unmapped";
    } else {
      target = this.cueStateForRevision(cuePageStateIds(cue, this.revision));
      this.nonSlideKind = target ? undefined : "unmapped_slide";
    }
    if (target !== this.sync.videoStateId) {
      if (target && this.sync.following) this.status("");
      else if (!target && this.nonSlideKind === "unmapped_slide" && this.sync.following) {
        this.status("This video segment has no reviewed slide mapping for the selected revision.");
      }
    }
    this.sync.onVideoSlide(target);
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

  /** All follow-state changes funnel through here (FollowSync host hook). */
  private applySyncState(): void {
    const selected = this.sync.selectedStateId;
    if (selected) this.lastSlideStateId = selected;
    this.viewer?.setActive(selected);
    this.updateSyncUi();
    this.replaceUrlState();
  }

  /** Explicit selection: strip card, drawer row, search hit, citation, URL. */
  private selectSlide(
    pageStateId: string,
    options: { scrollIntoView: boolean; focus?: boolean; behavior?: StripScrollBehavior }
  ): void {
    const page = this.currentAsset()?.page_states.find(
      (item) => item.id === pageStateId || item.aliases.includes(pageStateId)
    );
    if (!page) return;
    this.sync.onSelect(page.id, {
      scrollIntoView: options.scrollIntoView,
      ...(options.behavior ? { behavior: options.behavior } : {})
    });
    if (options.focus) this.viewer?.focusSlide(page.id);
  }

  /**
   * Seeks the video to a slide's nearest occurrence and plays from there.
   * `resume` (the slide's floating play pill) turns following back on without
   * scrolling or sticking the strip.
   */
  private playFromSlide(stateId: string | undefined, options: { resume?: boolean } = {}): void {
    if (!this.manifest || !this.hasControllableVideo() || !stateId) return;
    const cue = nearestOccurrence(this.manifest.cues, stateId, this.currentTimeMs);
    if (!cue) return this.status("This slide has no video occurrence.");
    const targetTime = cue.stable_at_ms ?? cue.start_ms;
    this.currentTimeMs = targetTime;
    this.player.seek(targetTime, true);
    const mapped = this.cueStateForRevision(cuePageStateIds(cue, this.revision)) ?? stateId;
    this.nonSlideKind = undefined;
    this.sync.onPlayFrom(mapped, options.resume ? { resume: true } : {});
    this.updateTimeDisplay();
    this.refreshVideoCue();
  }

  private seekFromCitation(timeMs: number): void {
    if (!this.hasControllableVideo()) return;
    this.currentTimeMs = timeMs;
    this.player.seek(timeMs, true);
    this.updateTimeDisplay();
    this.onVideoTime(timeMs);
  }

  /**
   * Transport controls: cue-level jumps with plain scrubbing semantics — the
   * play state is untouched, slides follow only while auto-follow is on, and
   * stuck-vs-animated strip behaviour is the same as for natural playback.
   */
  private jumpSlide(which: "previous" | "current" | "next"): void {
    if (!this.manifest || !this.hasControllableVideo()) return;
    const cue = slideCueNavigation(this.manifest.cues, this.currentTimeMs)[which];
    if (!cue) return;
    const targetTime = cue.stable_at_ms ?? cue.start_ms;
    this.currentTimeMs = targetTime;
    this.player.scrub(targetTime);
    this.updateTimeDisplay();
    this.onVideoTime(targetTime);
  }

  private togglePlayback(): void {
    if (!this.hasControllableVideo()) return;
    if (this.player.playerState() === PLAYER_STATE.PLAYING) this.player.pause();
    else this.player.play();
  }

  private refreshPlayToggle(state: number): void {
    const button = this.querySelector<HTMLButtonElement>("[data-action=toggle-play]");
    if (!button) return;
    const playing = state === PLAYER_STATE.PLAYING;
    button.classList.toggle("is-playing", playing);
    const label = playing ? "Pause" : "Play";
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  /**
   * A continuous speed slider, 0.5×–2× in 0.05 steps (linear). 2× is the
   * ceiling of the YouTube IFrame API — faster playback is a Premium-only
   * feature of YouTube's own player and not exposed to embeds.
   */
  private buildSpeedMenu(): void {
    const menu = this.element<HTMLElement>(".speed-menu");
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "speed-slider";
    slider.min = "0.5";
    slider.max = "2";
    slider.step = "0.05";
    slider.value = String(this.playbackRate);
    slider.setAttribute("aria-label", "Playback speed");
    slider.addEventListener("input", () => this.applyPlaybackRate(Number(slider.value)));
    const readout = document.createElement("output");
    readout.className = "speed-readout";
    readout.textContent = `${this.playbackRate.toFixed(2)}×`;
    menu.replaceChildren(slider, readout);
  }

  private applyPlaybackRate(rate: number): void {
    this.reflectPlaybackRate(rate);
    this.player.setPlaybackRate(rate);
    // The player may snap the suggestion (older embeds round to quarter
    // steps); reflect the rate that actually took effect.
    if (this.speedReadbackTimer !== undefined) window.clearTimeout(this.speedReadbackTimer);
    this.speedReadbackTimer = window.setTimeout(() => {
      this.speedReadbackTimer = undefined;
      const effective = this.player.playbackRate();
      if (effective !== undefined && Math.abs(effective - this.playbackRate) > 0.005) {
        this.reflectPlaybackRate(effective);
      }
    }, 250);
  }

  private reflectPlaybackRate(rate: number): void {
    const rounded = Number(rate.toFixed(2));
    this.playbackRate = rounded;
    // Always two decimals ("1.00×", "1.20×"): a changing digit count makes
    // the readout jitter while dragging.
    const label = `${rounded.toFixed(2)}×`;
    const slider = this.querySelector<HTMLInputElement>(".speed-slider");
    if (slider) slider.value = String(rounded);
    const readout = this.querySelector<HTMLElement>(".speed-readout");
    if (readout) readout.textContent = label;
    const value = this.element<HTMLElement>(".speed-value");
    // While the slider popup is open the badge keeps its (fixed-width) spot
    // even at 1× — appearing or disappearing mid-drag would move the
    // popup's anchor and with it the slider under the pointer.
    value.hidden = rounded === 1 && this.element<HTMLElement>(".speed-menu").hidden;
    value.textContent = label;
    const trigger = this.element<HTMLButtonElement>("[data-action=playback-speed]");
    const title = rounded === 1 ? "Playback speed" : `Playback speed · ${label}`;
    trigger.title = title;
    trigger.setAttribute("aria-label", title);
  }

  private setSpeedMenuOpen(open: boolean): void {
    this.element<HTMLElement>(".speed-menu").hidden = !open;
    this.element<HTMLButtonElement>("[data-action=playback-speed]").setAttribute(
      "aria-expanded",
      String(open)
    );
    this.reflectPlaybackRate(this.playbackRate);
  }

  private bindControls(): void {
    const scroll = this.element<HTMLElement>(".slide-scroll");
    const manualKeys = new Set([
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "
    ]);
    // User input takes over from any in-flight programmatic strip animation.
    let stripInputAt = -Infinity;
    const takeOver = () => {
      stripInputAt = performance.now();
      this.viewer?.cancelProgrammaticScroll();
    };
    scroll.addEventListener("wheel", takeOver, { passive: true });
    scroll.addEventListener("touchstart", takeOver, { passive: true });
    scroll.addEventListener("pointerdown", takeOver);
    scroll.addEventListener("keydown", (event) => {
      // Keyboard scrolling also works with a slide (a descendant) focused.
      if (manualKeys.has(event.key) && scroll.contains(event.target as Node)) takeOver();
    });
    // Scrolls not caused by our own animations count as user scrolling.
    scroll.addEventListener(
      "scroll",
      () => {
        if (this.viewer?.scrollActive()) return;
        // The line anchor follows scrolls the user actually sees — direct
        // input and, during normal viewing, layout shifts (lazy renders
        // growing placeholder slides, browser scroll anchoring). While a
        // resize re-anchoring settles, scroll events are the browser's own
        // adjustments and must not overwrite the anchor being enforced —
        // regardless of how recent the last input was (a resize can land
        // mid-gesture). Real input still takes over instantly through the
        // wheel/touch/pointer/key listeners themselves.
        if (!this.viewer?.resizeSettling()) {
          if (performance.now() - stripInputAt < 1500) this.viewer?.cancelProgrammaticScroll();
          this.viewer?.noteUserScroll();
        }
        this.sync.onUserScroll();
        if (this.scrollSettleTimer !== undefined) window.clearTimeout(this.scrollSettleTimer);
        this.scrollSettleTimer = window.setTimeout(() => {
          this.scrollSettleTimer = undefined;
          this.sync.onUserScrollSettled();
        }, 160);
      },
      { passive: true }
    );
    this.action("prev-slide", () => this.jumpSlide("previous"));
    this.action("slide-start", () => this.jumpSlide("current"));
    this.action("next-slide", () => this.jumpSlide("next"));
    this.action("toggle-play", () => this.togglePlayback());
    this.action("playback-speed", () =>
      this.setSpeedMenuOpen(Boolean(this.element<HTMLElement>(".speed-menu").hidden))
    );
    this.buildSpeedMenu();
    document.addEventListener("pointerdown", (event) => {
      const menu = this.querySelector<HTMLElement>(".speed-menu");
      if (!menu || menu.hidden) return;
      const target = event.target as Node;
      if (!menu.contains(target) && !this.element("[data-action=playback-speed]").contains(target)) {
        this.setSpeedMenuOpen(false);
      }
    });
    this.element<HTMLElement>(".speed-wrap").addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || this.element<HTMLElement>(".speed-menu").hidden) return;
      event.stopPropagation();
      this.setSpeedMenuOpen(false);
      this.element<HTMLButtonElement>("[data-action=playback-speed]").focus();
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
    this.action("resume-follow", () => this.sync.onResumeButton());
    this.action("follow-pill", () => this.sync.onFollowPill());
    this.action("toggle-toc", () =>
      this.setTocOpen(Boolean(this.element<HTMLElement>(".toc-drawer").hidden))
    );
    this.action("close-toc", () => this.setTocOpen(false, true));
    document.addEventListener("pointerdown", (event) => {
      const target = event.target as Node;
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

  /** Drag handling for the landscape column dividers and the pull handle. */
  private bindResizers(): void {
    for (const resizer of this.querySelectorAll<HTMLElement>(".col-resizer")) {
      resizer.addEventListener("pointerdown", (event) => this.startColumnDrag(event, resizer));
    }
    // The window's right edge pulls the closed chat out: nothing happens
    // until the drag reaches the minimum chat width, then it opens live.
    const pull = this.querySelector<HTMLElement>(".chat-pull-handle");
    pull?.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.assistant?.isOpen) return;
      this.startChatWidthDrag(event, pull, 0);
    });
  }

  private startColumnDrag(event: PointerEvent, resizer: HTMLElement): void {
    if (event.button !== 0) return;
    const shell = this.element<HTMLElement>(".lecture-shell");
    if (resizer.dataset.resizer === "assistant") {
      if (!shell.classList.contains("assistant-open")) return;
      const startChat = this.element<HTMLElement>(".assistant-region").getBoundingClientRect().width;
      this.startChatWidthDrag(event, resizer, startChat);
      return;
    }
    event.preventDefault();
    resizer.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const slides = this.element<HTMLElement>(".slide-panel");
    const region = this.element<HTMLElement>(".assistant-region");
    const startSlides = slides.getBoundingClientRect().width;
    const shellWidth = shell.clientWidth;
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const docked =
        shell.classList.contains("assistant-open") &&
        !shell.classList.contains("chat-drag-closed");
      const chatWidth = docked ? region.getBoundingClientRect().width + 6 : 0;
      const { media: minMedia, slides: minSlides } = this.minColumnWidths(docked, shellWidth);
      const available = shellWidth - 6 - chatWidth;
      const width = Math.min(
        Math.max(startSlides - dx, minSlides),
        Math.max(minSlides, available - minMedia)
      );
      // The px widths become the fr weights: the drag lands exactly where
      // the pointer is, and later chat resizes scale both columns
      // proportionally to this ratio.
      shell.style.setProperty("--lect-media-fr", `${Math.round(available - width)}fr`);
      shell.style.setProperty("--lect-slides-fr", `${Math.round(width)}fr`);
    };
    const finish = (endEvent: PointerEvent) => {
      resizer.releasePointerCapture?.(endEvent.pointerId);
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", finish);
      resizer.removeEventListener("pointercancel", finish);
      this.clampColumns();
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", finish);
    resizer.addEventListener("pointercancel", finish);
  }

  /** Widest the docked chat may get while the other columns keep their minimums. */
  private maxChatWidth(shellWidth: number): number {
    const slideOnly = this.querySelector<HTMLElement>(".lecture-shell")
      ?.classList.contains("is-slide-only");
    if (slideOnly) return Math.max(MIN_CHAT_W, shellWidth - 6 - MIN_MAIN_SLIDE_ONLY);
    return Math.max(MIN_CHAT_W, shellWidth - 12 - MIN_MEDIA_DOCKED - MIN_SLIDES_DOCKED);
  }

  /** Effective column minimums; larger when the chat is not docked. */
  private minColumnWidths(chatDocked: boolean, shellWidth: number): {
    media: number;
    slides: number;
  } {
    if (chatDocked) return { media: MIN_MEDIA_DOCKED, slides: MIN_SLIDES_DOCKED };
    return {
      media: Math.min(MIN_MEDIA_SOLO, Math.floor(shellWidth * 0.34)),
      slides: Math.min(MIN_SLIDES_SOLO, Math.floor(shellWidth * 0.32))
    };
  }

  /**
   * Shared chat-width drag for the chat divider (open) and the right-edge
   * pull handle (closed). Below the minimum minus some slack the chat
   * collapses live (the pill returns) but the gesture stays hot, so pulling
   * back re-opens it; releasing while collapsed closes it for real.
   */
  private startChatWidthDrag(event: PointerEvent, handle: HTMLElement, startChat: number): void {
    const shell = this.element<HTMLElement>(".lecture-shell");
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    shell.classList.add("chat-dragging");
    const startX = event.clientX;
    const shellWidth = shell.clientWidth;
    const move = (moveEvent: PointerEvent) => {
      const desired = startChat + (startX - moveEvent.clientX);
      if (desired >= MIN_CHAT_W) {
        if (!this.assistant?.isOpen) this.assistant?.open(false);
        shell.classList.remove("chat-drag-closed");
        // The content columns share the remaining space proportionally (their
        // fr weights); the grid's minmax() enforces their minimums.
        const max = this.maxChatWidth(shellWidth);
        shell.style.setProperty("--lect-chat-w", `${Math.round(Math.min(desired, max))}px`);
      } else if (desired < MIN_CHAT_W - CHAT_CLOSE_SLACK) {
        if (this.assistant?.isOpen) {
          shell.classList.add("chat-drag-closed");
          shell.style.setProperty("--lect-chat-w", "0px");
        }
      } else if (this.assistant?.isOpen && !shell.classList.contains("chat-drag-closed")) {
        // Dead zone under the minimum: the open chat resists at MIN width.
        shell.style.setProperty("--lect-chat-w", `${MIN_CHAT_W}px`);
      }
    };
    const finish = (endEvent: PointerEvent) => {
      handle.releasePointerCapture?.(endEvent.pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      shell.classList.remove("chat-dragging");
      if (shell.classList.contains("chat-drag-closed")) {
        shell.classList.remove("chat-drag-closed");
        shell.style.removeProperty("--lect-chat-w");
        this.assistant?.close();
      }
      this.clampColumns();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  /**
   * The media/slides minimums are enforced by the grid's minmax() itself;
   * the only thing to re-clamp (on window resize or chat open) is a docked
   * chat width that no longer leaves room for the other minimums.
   */
  private clampColumns(): void {
    const shell = this.querySelector<HTMLElement>(".lecture-shell");
    if (!shell || this.portraitQuery.matches) return;
    const shellWidth = shell.clientWidth;
    if (!shellWidth) return;
    const chatDocked =
      shell.classList.contains("assistant-open") &&
      !shell.classList.contains("chat-drag-closed") &&
      window.matchMedia("(min-width: 1000px)").matches;
    if (!chatDocked) return;
    const chatWidth = this.element<HTMLElement>(".assistant-region").getBoundingClientRect().width;
    const max = this.maxChatWidth(shellWidth);
    if (chatWidth > max + 1) shell.style.setProperty("--lect-chat-w", `${Math.round(max)}px`);
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
          this.selectSlide(hit.entry.state.id, { scrollIntoView: true, focus: true });
        });
        return button;
      })
    );
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
      // Selecting from the list keeps the list open (markers update in place).
      button.addEventListener("click", () => {
        this.selectSlide(entry.state.id, { scrollIntoView: true });
      });
      item.append(button);
      // "Play from here" appears on the hovered/focused row only (CSS).
      if (this.hasControllableVideo() && entry.timeMs !== undefined) {
        const play = document.createElement("button");
        play.type = "button";
        play.className = "toc-play";
        play.textContent = "▶ Play from here";
        // Playing keeps the list open, exactly like selecting does.
        play.addEventListener("click", (event) => {
          event.stopPropagation();
          this.playFromSlide(entry.state.id);
        });
        item.append(play);
      }
      rows.push(item);
      this.tocThumbnailObserver.observe(button);
    }
    list.replaceChildren(...rows);
    this.decorateToc();
  }

  private decorateToc(): void {
    const drawer = this.querySelector<HTMLElement>(".toc-drawer");
    if (!drawer || drawer.hidden) return;
    const videoStateId = this.sync.videoStateId;
    const selectedStateId = this.sync.selectedStateId;
    for (const button of drawer.querySelectorAll<HTMLElement>(".toc-list button[data-state-id]")) {
      const stateId = button.dataset.stateId;
      const isVideo = Boolean(videoStateId && stateId === videoStateId);
      const isSelected = Boolean(stateId && stateId === selectedStateId);
      button.classList.toggle("is-video-current", isVideo);
      button.classList.toggle("is-viewing", isSelected);
      const marker = button.querySelector<HTMLElement>(".toc-marker");
      if (marker) {
        marker.textContent = isSelected && isVideo
          ? "— video · selected"
          : isVideo
            ? "— video"
            : isSelected
              ? "— selected"
              : "";
      }
    }
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
    const following = this.sync.following;
    const pill = this.element<HTMLElement>(".follow-pill");
    pill.dataset.followState = following ? "following" : "paused";
    const nowViewing = this.element<HTMLElement>(".now-viewing");
    nowViewing.replaceChildren();
    if (this.hasControllableVideo()) {
      const videoEntry = this.sync.videoStateId
        ? this.slideIndex.byStateId.get(this.sync.videoStateId)
        : undefined;
      const selectedEntry = this.sync.selectedStateId
        ? this.slideIndex.byStateId.get(this.sync.selectedStateId)
        : undefined;
      if (following) {
        if (videoEntry) {
          nowViewing.append(
            "Now: ",
            strong(`Slide ${videoEntry.position}`),
            ` — ${videoEntry.title}`
          );
        } else {
          const kind = this.nonSlideKind;
          nowViewing.append(kind ? `Now: ${humanize(kind)} (no slide)` : "");
        }
      } else {
        const videoText = videoEntry ? `slide ${videoEntry.position}` : "no slide";
        nowViewing.append("Video: ", strong(videoText));
        if (selectedEntry) {
          nowViewing.append(" · selected ", strong(`slide ${selectedEntry.position}`));
        }
      }
    }
    // The floating play pill is only offered once the user explicitly
    // selected a slide (even the one currently playing); never by default.
    const stateId = this.sync.selectedStateId;
    const explicitSelected = Boolean(
      this.hasControllableVideo() && stateId && stateId === this.sync.explicitSelectionId
    );
    const hasOccurrence = Boolean(
      explicitSelected &&
      this.manifest &&
      stateId &&
      nearestOccurrence(this.manifest.cues, stateId, this.currentTimeMs)
    );
    this.viewer?.setPlayCta(explicitSelected ? stateId : undefined, { disabled: !hasOccurrence });
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
    // Best-effort: quote the slide's mined text matching the selection (PDF
    // text-layer extraction differs from the mined text in spacing and the
    // like); when nothing matches, the raw selection still goes along — the
    // model can reconstruct what it is about.
    const matched = matchSelectionToSlideText(text, teaching.text) ?? text;
    const entry = this.slideIndex.byStateId.get(stateId) ??
      this.slideIndex.byStateId.get(teachingId);
    this.assistant.setSelection(
      { text: matched.slice(0, 2000), page_state_id: teachingId },
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
    if (targetRevision !== this.revision) await this.showRevision(targetRevision, targetId);
    this.selectSlide(targetId, { scrollIntoView: true, focus: true });
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
    this.selectSlide(fallback.id, { scrollIntoView: true });
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
    if (!teachingId || !teaching) {
      this.assistant?.setSelection(undefined);
      return undefined;
    }
    const matched = matchSelectionToSlideText(selection.text, teaching.text) ?? selection.text;
    return { text: matched.slice(0, 2000), page_state_id: teachingId };
  }

  private async prepareQuestion(selection: ChatSelection | undefined): Promise<
    { pageStateIds: string[]; selection?: ChatSelection } | undefined
  > {
    if (!this.manifest) return undefined;
    const contextSource = this.sync.selectedStateId ??
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

  private currentAsset() {
    return this.manifest?.revisions[this.revision];
  }

  private videoCueStateId(): string | undefined {
    if (!this.manifest || this.manifest.presentation.mode !== "video_lecture") return undefined;
    const cue = cueAt(this.manifest.cues, this.currentTimeMs);
    return cue && cue.state_kind === "slide"
      ? this.cueStateForRevision(cuePageStateIds(cue, this.revision))
      : undefined;
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
    // Same shell marker as the slide-only mount path: the chat must dock
    // against the single flowing column, not the video grid.
    this.element<HTMLElement>(".lecture-shell").classList.add("is-slide-only");
    this.element<HTMLElement>(".video-statusbar").hidden = true;
    const dock = this.element<HTMLElement>(".video-dock");
    dock.hidden = true;
    this.element<HTMLElement>(".video-container").replaceChildren();
    this.miniPlayer?.destroy();
    this.miniPlayer = undefined;
    this.placeSupplements();
    if (!this.sync.selectedStateId) {
      const first = this.currentAsset()?.page_states[0];
      if (first) this.sync.onSelect(first.id, { scrollIntoView: false });
    }
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
      const state = this.player.playerState();
      // seekTo+pause on a player that never started leaves a black box
      // (iteration 3); an unstarted player only gets its UI state updated.
      if (state === PLAYER_STATE.PLAYING) this.player.scrub(requested.timeMs);
      else if (state === PLAYER_STATE.PAUSED || state === PLAYER_STATE.ENDED) {
        this.player.seek(requested.timeMs, false);
      }
      this.onVideoTime(requested.timeMs);
    }
    const target = requested.slideId ? this.resolveUrlSlide(requested.slideId) : undefined;
    if (target) {
      if (target.revision !== this.revision) await this.showRevision(target.revision, target.pageStateId);
      this.selectSlide(target.pageStateId, { scrollIntoView: true, focus: true });
    }
    this.replaceUrlState();
  }

  private replaceUrlState(): void {
    if (!this.urlStateReady || !this.manifest) return;
    const url = new URL(window.location.href);
    url.searchParams.set("lecture", this.manifest.lecture_id);
    const selected = this.sync.selectedStateId;
    if (selected) url.searchParams.set("slide", selected);
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
