import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy
} from "pdfjs-dist";
import workerUrl from "./pdf-worker?worker&url";
import "pdfjs-dist/web/pdf_viewer.css";

import type { StripScrollBehavior } from "./follow-sync";
import type { PageState, RevisionAsset, RevisionDeckAsset } from "./types";

GlobalWorkerOptions.workerSrc = workerUrl;

interface DocumentHandle {
  loadingTask: PDFDocumentLoadingTask;
  document?: PDFDocumentProxy;
}

/**
 * The strip's "top position": a stuck slide sits this many px below the top
 * edge of the scroller; the gap between slides is half of it, so a slide in
 * the top position shows a sliver of its predecessor above it.
 */
export const STRIP_TOP_GAP = 16;

/**
 * Where the strip's "top-position line" (STRIP_TOP_GAP below the scroller's
 * top edge) cuts the strip: the slide it goes through and the fraction of
 * that slide's height above the line. Captured before a revision switch and
 * restored after, so the strip keeps its place even when slide heights
 * differ between revisions (4:3 vs 16:9). The fraction can be slightly
 * negative (line in the gap above the slide) or above 1 (line in the tail
 * spacer after the last slide).
 */
export interface StripAnchor {
  /** Page state id of the anchor slide; the caller re-maps it across revisions. */
  stateId: string | undefined;
  /** 0-based strip index, the fallback when the id has no counterpart. */
  stripIndex: number;
  fraction: number;
}

let viewerInstance = 0;

export class PdfViewer {
  private readonly documents = new Map<string, DocumentHandle>();
  private readonly elementStates = new Map<HTMLElement, PageState>();
  private observer: IntersectionObserver | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private readonly renderTasks = new Map<string, Promise<void>>();
  private readonly thumbnails = new Map<string, string>();
  private resizeFrame: number | undefined;
  private observedWidth = 0;
  private observedHeight = 0;
  private observedClientWidth = 0;
  private observedClientHeight = 0;
  private generation = 0;
  private animationToken = 0;
  private animationActive = false;
  private animationTarget: number | undefined;
  /**
   * The maintained top-position-line anchor: where the line currently sits,
   * updated on user scrolls and programmatic placements. When the container
   * resizes (column drag, window resize, orientation switch), the strip is
   * re-placed so the line keeps cutting the same slide at the same fraction.
   */
  private lineAnchor: StripAnchor | undefined;
  private resizeSettleUntil = 0;
  private aspectPublished = false;
  private descriptionIndex = 0;
  private readonly descriptionPrefix = `lecture-slide-description-${++viewerInstance}`;
  private readonly videoChip = createVideoChip();
  private readonly tailSpacer = createTailSpacer();
  private readonly playCta = createPlayCta();
  private playCtaState: PageState | undefined;

  constructor(
    private readonly container: HTMLElement,
    private readonly onSelect: (state: PageState) => void,
    onPlayFromSlide?: (state: PageState) => void
  ) {
    // Selection handlers skip clicks that land on buttons, so the pill's own
    // click never doubles as a slide (re)selection.
    this.playCta.addEventListener("click", () => {
      if (this.playCtaState && !this.playCta.disabled) onPlayFromSlide?.(this.playCtaState);
    });
  }

  async load(asset: RevisionAsset): Promise<void>;
  async load(pdfUrl: string | undefined, states: PageState[]): Promise<void>;
  async load(
    assetOrPdfUrl: RevisionAsset | string | undefined,
    legacyStates: PageState[] = []
  ): Promise<void> {
    this.destroy();
    this.container.replaceChildren();
    // A new document may have a different page aspect (4:3 vs 16:9).
    this.aspectPublished = false;
    const generation = this.generation;
    const asset = typeof assetOrPdfUrl === "object" && assetOrPdfUrl !== null
      ? assetOrPdfUrl
      : this.legacyAsset(assetOrPdfUrl, legacyStates);
    this.createObserver();
    this.createResizeObserver();

    for (const [index, deck] of asset.decks.entries()) {
      if (generation !== this.generation) return;
      if (deck.pdf_url) await this.loadPdfDeck(deck, index, generation);
      else this.renderStructuredFallback(deck.page_states, deck.order);
    }

    if (asset.decks.length === 0) this.renderStructuredFallback(asset.page_states, 1);
    if (generation === this.generation) {
      this.applyStripNumbers();
      this.updateTailSpacer();
    }
  }

  /** True while a programmatic strip animation is in flight. */
  scrollActive(): boolean {
    return this.animationActive;
  }

  /** User input takes over: abandon any in-flight programmatic animation. */
  cancelProgrammaticScroll(): void {
    this.animationToken += 1;
    this.animationActive = false;
    this.animationTarget = undefined;
  }

  /** A user scroll moved the strip: the line anchor follows it. */
  noteUserScroll(): void {
    this.lineAnchor = this.captureStripAnchor();
  }

  /**
   * True while resize re-placements are settling. Layout-shift scroll events
   * (lazy renders, browser scroll anchoring) should refresh the line anchor
   * during normal viewing — they track what the user actually sees — but not
   * while the strip is being re-anchored after a resize, where they would
   * overwrite the anchor being enforced. The size comparison covers the
   * window between the resize layout (whose scroll-anchoring adjustment
   * fires a scroll event immediately) and the ResizeObserver callback.
   */
  resizeSettling(): boolean {
    return (
      performance.now() < this.resizeSettleUntil ||
      Math.abs(this.container.clientWidth - this.observedClientWidth) >= 1 ||
      Math.abs(this.container.clientHeight - this.observedClientHeight) >= 1
    );
  }

  /**
   * Captures the current strip position as a top-position-line anchor. While
   * a programmatic scroll is in flight, the anchor is taken at its target
   * position, not at the mid-flight offset.
   */
  captureStripAnchor(): StripAnchor | undefined {
    const sections = this.stripSections();
    if (sections.length === 0) return undefined;
    const containerRect = this.container.getBoundingClientRect();
    const scrollTop = this.container.scrollTop;
    const line = (this.animationTarget ?? scrollTop) + STRIP_TOP_GAP;
    let index = sections.length - 1;
    for (let i = 0; i < sections.length; i += 1) {
      const rect = sections[i]!.getBoundingClientRect();
      const bottom = scrollTop + (rect.bottom - containerRect.top);
      if (bottom > line) {
        index = i;
        break;
      }
    }
    const rect = sections[index]!.getBoundingClientRect();
    const top = scrollTop + (rect.top - containerRect.top);
    return {
      stateId: sections[index]!.dataset.pageStateId,
      stripIndex: index,
      fraction: (line - top) / Math.max(rect.height, 1)
    };
  }

  /**
   * Restores a strip anchor: places the line instantly, then renders the
   * anchor's neighbourhood (placeholder slides are a fixed min-height until
   * their page renders, which would shift the target) and places it again.
   * A user scroll in between wins and cancels the second placement.
   */
  async restoreStripAnchor(anchor: StripAnchor): Promise<void> {
    const generation = this.generation;
    const sections = this.stripSections();
    if (sections.length === 0) return;
    const section =
      (anchor.stateId ? this.sectionFor(anchor.stateId) : undefined) ??
      sections[Math.max(0, Math.min(anchor.stripIndex, sections.length - 1))]!;
    this.placeLineThrough(section, anchor.fraction);
    const token = this.animationToken;
    const index = sections.indexOf(section);
    const neighbourhood = sections
      .slice(Math.max(0, index - 2), index + 2)
      .map((neighbour) => this.renderPage(neighbour));
    await Promise.allSettled(neighbourhood);
    // Always let a real frame pass: the rough placement may have been
    // clamped against a scrollHeight that did not include the freshly
    // updated tail spacer yet (structured slides render synchronously, so
    // the render wait alone does not leave the current task).
    await nextFrame();
    if (generation !== this.generation || token !== this.animationToken) return;
    this.updateTailSpacer();
    this.placeLineThrough(section, anchor.fraction);
  }

  /**
   * Scrolls only the strip container (never the page) so the slide sits at
   * the top position. Resolves true when it settled at the target.
   */
  scrollToTopPosition(pageStateId: string, behavior: StripScrollBehavior): Promise<boolean> {
    const target = this.topPositionScrollTop(pageStateId);
    if (target === undefined) return Promise.resolve(false);
    return this.animateScrollTo(target, behavior);
  }

  focusSlide(pageStateId: string): void {
    this.sectionFor(pageStateId)?.focus({ preventScroll: true });
  }

  /** Fraction (0..1) of the slide's lower half visible in the strip viewport. */
  lowerHalfVisibleFraction(pageStateId: string): number | undefined {
    const section = this.sectionFor(pageStateId);
    if (!section) return undefined;
    const containerRect = this.container.getBoundingClientRect();
    const rect = section.getBoundingClientRect();
    const half = rect.height / 2;
    if (half <= 0) return undefined;
    const lowerTop = rect.top + half;
    const visible = Math.min(rect.bottom, containerRect.bottom) - Math.max(lowerTop, containerRect.top);
    return Math.min(1, Math.max(0, visible / half));
  }

  /** Signed px distance of the strip from the slide's top position. */
  distanceFromTopPosition(pageStateId: string): number | undefined {
    const target = this.topPositionScrollTop(pageStateId);
    return target === undefined ? undefined : this.container.scrollTop - target;
  }

  /** Blue selection highlight (explicit selection; mirrors video on follow). */
  setActive(pageStateId: string | undefined): void {
    const activeState = pageStateId ? this.stateForId(pageStateId) : undefined;
    for (const [page, state] of this.elementStates) {
      const active = Boolean(activeState && state === activeState);
      page.classList.toggle("is-active", active);
      page.setAttribute("aria-current", active ? "true" : "false");
    }
  }

  /**
   * Marks the slide currently shown in the video (green highlight and chip),
   * independent of the selected slide. The chip carries the timestamp.
   */
  setVideoCurrent(pageStateId: string | undefined, label?: string): void {
    const section = pageStateId ? this.sectionFor(pageStateId) : undefined;
    for (const [page] of this.elementStates) {
      page.classList.toggle("is-video-current", page === section);
    }
    if (!section) {
      this.videoChip.remove();
      return;
    }
    this.videoChip.querySelector("span")!.textContent = label ?? "Current";
    if (this.videoChip.parentElement !== section) section.prepend(this.videoChip);
  }

  /**
   * Floating "Play from start of this slide" pill on the explicitly selected
   * slide: it starts at the slide's horizontal middle and straddles the
   * slide's bottom edge (the edge cuts the pill at half the pill's height).
   * Pass `undefined` to remove it.
   */
  setPlayCta(pageStateId: string | undefined, options: { disabled?: boolean } = {}): void {
    const section = pageStateId ? this.sectionFor(pageStateId) : undefined;
    const state = section ? this.elementStates.get(section) : undefined;
    if (!section || !state) {
      this.playCtaState = undefined;
      this.playCta.remove();
      return;
    }
    this.playCtaState = state;
    this.playCta.disabled = Boolean(options.disabled);
    if (options.disabled) this.playCta.title = "This slide has no video occurrence.";
    else this.playCta.removeAttribute("title");
    if (this.playCta.parentElement !== section) section.append(this.playCta);
  }

  /** Adds a "revised after recording" style badge to the given page states. */
  setRevisionBadges(pageStateIds: ReadonlySet<string>, label: string): void {
    for (const [section, state] of this.elementStates) {
      let badge = section.querySelector<HTMLElement>(".slide-revision-badge");
      const wanted = pageStateIds.has(state.id);
      if (wanted && !badge) {
        badge = document.createElement("span");
        badge.className = "slide-revision-badge";
        badge.textContent = label;
        section.append(badge);
      } else if (!wanted && badge) {
        badge.remove();
      }
    }
  }

  /** Low-resolution page snapshot for TOC rows; cached per page state. */
  async thumbnail(pageStateId: string, width = 96): Promise<string | undefined> {
    const cached = this.thumbnails.get(pageStateId);
    if (cached) return cached;
    const section = this.sectionFor(pageStateId);
    const documentKey = section?.dataset.documentKey;
    const pageNumber = Number(section?.dataset.assetPage);
    const pdfDocument = documentKey ? this.documents.get(documentKey)?.document : undefined;
    if (!section || !pdfDocument || !pageNumber) return undefined;
    const generation = this.generation;
    try {
      const page = await pdfDocument.getPage(pageNumber);
      if (generation !== this.generation) return undefined;
      const baseViewport = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / baseViewport.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      if (generation !== this.generation) return undefined;
      const url = canvas.toDataURL("image/png");
      this.thumbnails.set(pageStateId, url);
      return url;
    } catch {
      return undefined;
    }
  }

  destroy(): void {
    this.generation += 1;
    this.cancelProgrammaticScroll();
    this.lineAnchor = undefined;
    this.observer?.disconnect();
    this.observer = undefined;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    if (this.resizeFrame !== undefined) window.cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = undefined;
    this.observedWidth = 0;
    this.observedHeight = 0;
    this.observedClientWidth = 0;
    this.observedClientHeight = 0;
    this.videoChip.remove();
    this.playCta.remove();
    this.playCtaState = undefined;
    for (const handle of this.documents.values()) {
      if (handle.document) {
        void handle.document
          .cleanup()
          .catch(() => undefined)
          .finally(() => handle.loadingTask.destroy().catch(() => undefined));
      } else {
        void handle.loadingTask.destroy().catch(() => undefined);
      }
    }
    this.documents.clear();
    this.elementStates.clear();
    this.renderTasks.clear();
    this.thumbnails.clear();
  }

  /** Scroll offset that puts the slide's top at the top position. */
  private topPositionScrollTop(pageStateId: string): number | undefined {
    const section = this.sectionFor(pageStateId);
    if (!section) return undefined;
    const containerRect = this.container.getBoundingClientRect();
    const rect = section.getBoundingClientRect();
    const raw = this.container.scrollTop + (rect.top - containerRect.top) - STRIP_TOP_GAP;
    const max = Math.max(0, this.container.scrollHeight - this.container.clientHeight);
    return Math.min(Math.max(0, raw), max);
  }

  /** Instantly scrolls so the top-position line cuts the slide at `fraction`. */
  private placeLineThrough(section: HTMLElement, fraction: number): void {
    const containerRect = this.container.getBoundingClientRect();
    const rect = section.getBoundingClientRect();
    const top = this.container.scrollTop + (rect.top - containerRect.top);
    const raw = top + fraction * rect.height - STRIP_TOP_GAP;
    const max = Math.max(0, this.container.scrollHeight - this.container.clientHeight);
    void this.animateScrollTo(Math.min(Math.max(0, raw), max), "instant");
  }

  private stripSections(): HTMLElement[] {
    return [...this.container.querySelectorAll<HTMLElement>(".pdf-page, .structured-slide")];
  }

  /**
   * Drives the animation itself (rAF, ease-out) instead of relying on native
   * smooth scrolling: consistent across browsers (Firefox maps desktop
   * "reduce animations" settings onto native smooth scrolling), cancellable
   * by user input, and with a reliable settle signal.
   */
  private animateScrollTo(top: number, behavior: StripScrollBehavior): Promise<boolean> {
    const container = this.container;
    const from = container.scrollTop;
    const token = ++this.animationToken;
    this.animationActive = true;
    this.animationTarget = top;
    // Every placement moves the line anchor to its (eventual) target.
    this.lineAnchor = this.captureStripAnchor();
    // Trailing scroll events are delivered asynchronously; keep the
    // programmatic flag up briefly so they do not read as user scrolls.
    const release = () => {
      if (this.animationToken === token) this.animationTarget = undefined;
      window.setTimeout(() => {
        if (this.animationToken === token) this.animationActive = false;
      }, 120);
    };
    if (
      behavior === "instant" ||
      Math.abs(top - from) < 2 ||
      typeof requestAnimationFrame !== "function"
    ) {
      container.scrollTop = top;
      release();
      return Promise.resolve(true);
    }
    const duration = 320;
    let start: number | undefined;
    return new Promise((resolve) => {
      const step = (now: number) => {
        if (this.animationToken !== token) return resolve(false);
        start ??= now;
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        container.scrollTop = from + (top - from) * eased;
        if (progress >= 1) {
          release();
          resolve(true);
        } else {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    });
  }

  private createObserver(): void {
    // Lazy rendering only; visibility no longer drives the selection.
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          if (entry.isIntersecting && element.dataset.documentKey && element.dataset.assetPage) {
            void this.renderPage(element);
          }
        }
      },
      { root: this.container, rootMargin: "50% 0px", threshold: 0 }
    );
  }

  private createResizeObserver(): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      const rect = entries.find((entry) => entry.target === this.container)?.contentRect;
      if (!rect) return;
      this.observedClientWidth = this.container.clientWidth;
      this.observedClientHeight = this.container.clientHeight;
      if (Math.abs(rect.height - this.observedHeight) >= 1) {
        this.observedHeight = rect.height;
        this.updateTailSpacer();
      }
      const width = rect.width;
      if (!width || Math.abs(width - this.observedWidth) < 1) return;
      const priorWidth = this.observedWidth;
      this.observedWidth = width;
      // Slide heights scale with the width (canvases keep their aspect), so
      // hold the top-position line steady through the resize. The initial
      // observation is not a resize.
      if (priorWidth > 0) this.placeStoredAnchor();
      if (this.resizeFrame !== undefined) window.cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = window.requestAnimationFrame(() => {
        this.resizeFrame = undefined;
        void this.reflowRenderedPages().catch(() => undefined);
      });
    });
    this.resizeObserver.observe(this.container);
  }

  /**
   * Re-places the line at the maintained anchor after a container resize.
   * The stored anchor stays authoritative so repeated resizes (a column
   * drag fires one per frame) cannot accumulate rounding drift. After the
   * anchor's neighbourhood re-renders at the new width (placeholder slides
   * grow to their real height), the line is placed once more.
   */
  private placeStoredAnchor(): void {
    const anchor = this.lineAnchor;
    if (!anchor) return;
    const sections = this.stripSections();
    if (sections.length === 0) return;
    this.resizeSettleUntil = performance.now() + 1500;
    const section =
      (anchor.stateId ? this.sectionFor(anchor.stateId) : undefined) ??
      sections[Math.max(0, Math.min(anchor.stripIndex, sections.length - 1))]!;
    this.updateTailSpacer();
    this.placeLineThrough(section, anchor.fraction);
    this.lineAnchor = anchor;
    const token = this.animationToken;
    const generation = this.generation;
    const index = sections.indexOf(section);
    void Promise.allSettled(
      sections.slice(Math.max(0, index - 2), index + 2).map((neighbour) => this.renderPage(neighbour))
    )
      .then(() => nextFrame())
      .then(() => {
        if (generation !== this.generation || token !== this.animationToken) return;
        this.placeLineThrough(section, anchor.fraction);
        this.lineAnchor = anchor;
      });
  }

  private async reflowRenderedPages(): Promise<void> {
    const generation = this.generation;
    const rendered = [...this.container.querySelectorAll<HTMLElement>(
      ".pdf-page[data-document-key][data-asset-page]"
    )].filter((section) => Boolean(section.querySelector("canvas")));
    const pending = rendered
      .map((section) => this.renderTasks.get(this.renderKey(section)))
      .filter((task): task is Promise<void> => Boolean(task));
    await Promise.allSettled(pending);
    if (generation !== this.generation) return;

    const changed = rendered.filter((section) => {
      const priorWidth = Number(section.dataset.renderWidth);
      const currentWidth = section.clientWidth || this.container.clientWidth;
      return section.isConnected && currentWidth > 0 && Math.abs(currentWidth - priorWidth) >= 1;
    });
    for (const section of changed) this.renderTasks.delete(this.renderKey(section));
    await Promise.all(changed.map((section) => this.renderPage(section)));
    if (generation === this.generation) this.updateTailSpacer();
  }

  private async loadPdfDeck(
    deck: RevisionDeckAsset,
    index: number,
    generation: number
  ): Promise<void> {
    const documentKey = `${index + 1}:${deck.deck_id}`;
    const loadingOptions = { url: deck.pdf_url!, isEvalSupported: false };
    const loadingTask = getDocument(loadingOptions);
    const handle: DocumentHandle = { loadingTask };
    this.documents.set(documentKey, handle);
    let pdfDocument: PDFDocumentProxy;
    try {
      pdfDocument = await loadingTask.promise;
    } catch (error) {
      if (generation !== this.generation) return;
      throw error;
    }
    if (generation !== this.generation) {
      void loadingTask.destroy().catch(() => undefined);
      return;
    }
    handle.document = pdfDocument;
    try {
      // Publish the aspect before any page renders: portrait sizes the strip
      // from it, and the anchor restore needs settled container geometry.
      const first = await pdfDocument.getPage(1);
      if (generation !== this.generation) return;
      const viewport = first.getViewport({ scale: 1 });
      this.publishSlideAspect(viewport.height / viewport.width);
    } catch {
      // Falls back to publishing from the first rendered page.
    }
    const byPage = new Map<number, PageState>();
    for (const state of deck.page_states) {
      const page = state.asset_page ?? state.page;
      if (!byPage.has(page)) byPage.set(page, state);
    }
    for (let page = 1; page <= pdfDocument.numPages; page += 1) {
      const state = byPage.get(page);
      const section = document.createElement("section");
      section.className = "pdf-page";
      section.dataset.documentKey = documentKey;
      section.dataset.assetPage = String(page);
      section.dataset.page = String(state?.page ?? page);
      section.dataset.deckId = state?.deck_id ?? deck.deck_id;
      if (state) {
        section.dataset.pageStateId = state.id;
        this.elementStates.set(section, state);
        this.bindSelection(section, state);
      }
      section.tabIndex = 0;
      section.setAttribute(
        "aria-label",
        assetLabel(deck.order, state?.page ?? page)
      );
      const surface = document.createElement("div");
      surface.className = "pdf-page-surface";
      const loading = document.createElement("div");
      loading.className = "pdf-page-loading";
      loading.setAttribute("aria-live", "polite");
      loading.textContent = `Loading ${assetLabel(deck.order, state?.page ?? page).toLowerCase()}…`;
      surface.append(loading);
      section.append(surface);
      this.appendPageNumber(section);
      this.appendLongDescription(section, state);
      this.container.append(section);
      this.observer?.observe(section);
    }
  }

  /**
   * A slide is selected already on pointer-down for mouse input (so starting
   * a text selection in a different slide selects it too) or with
   * Enter/Space; scrolling never selects. Touch/pen pointer-downs start
   * scroll gestures, so they select on the resulting tap (click) instead — a
   * scroll never produces one.
   */
  private bindSelection(section: HTMLElement, state: PageState): void {
    let pointerType = "mouse";
    section.addEventListener("pointerdown", (event) => {
      pointerType = event.pointerType || "mouse";
      if (event.button !== 0 || pointerType !== "mouse") return;
      const target = event.target as HTMLElement;
      if (target.closest("a, button")) return;
      this.onSelect(state);
    });
    section.addEventListener("click", (event) => {
      if (pointerType === "mouse") return;
      const target = event.target as HTMLElement;
      if (target.closest("a, button")) return;
      this.onSelect(state);
    });
    section.addEventListener("keydown", (event) => {
      if (event.target !== section || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      this.onSelect(state);
    });
  }

  private renderPage(section: HTMLElement): Promise<void> {
    const documentKey = section.dataset.documentKey;
    const pageNumber = Number(section.dataset.assetPage);
    if (!documentKey || !pageNumber) return Promise.resolve();
    const renderKey = this.renderKey(section);
    const pdfDocument = this.documents.get(documentKey)?.document;
    if (!pdfDocument) return Promise.resolve();
    const existing = this.renderTasks.get(renderKey);
    if (existing) return existing;
    const task = this.renderPageContent(section, pdfDocument, renderKey);
    this.renderTasks.set(renderKey, task);
    return task;
  }

  private async renderPageContent(
    section: HTMLElement,
    pdfDocument: PDFDocumentProxy,
    renderKey: string
  ): Promise<void> {
    const generation = this.generation;
    const pageNumber = Number(section.dataset.assetPage);
    try {
      const page = await pdfDocument.getPage(pageNumber);
      if (generation !== this.generation || !section.isConnected) return;
      const surface = section.querySelector<HTMLElement>(".pdf-page-surface") ?? section;
      const baseViewport = page.getViewport({ scale: 1 });
      this.publishSlideAspect(baseViewport.height / baseViewport.width);
      const width = Math.max(section.clientWidth || this.container.clientWidth || 1, 1);
      const scale = width / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas rendering is unavailable");
      const text = document.createElement("div");
      text.className = "textLayer pdf-text-layer";
      // pdf.js positions and sizes the glyph spans through this variable
      // (via --total-scale-factor); without it they keep the page font size
      // and selection highlights drift along the line.
      text.style.setProperty("--scale-factor", String(scale));
      surface.replaceChildren(canvas, text);
      await page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
      }).promise;
      if (generation !== this.generation || !section.isConnected) return;
      const textLayer = new TextLayer({
        textContentSource: await page.getTextContent(),
        container: text,
        viewport
      });
      await textLayer.render();
      section.dataset.renderWidth = String(width);
      this.updateTailSpacer();
    } catch (error) {
      this.renderTasks.delete(renderKey);
      throw error;
    }
  }

  private renderStructuredFallback(states: PageState[], deckOrder: number): void {
    for (const state of states) {
      const section = document.createElement("section");
      section.className = "structured-slide";
      section.dataset.page = String(state.page);
      section.dataset.deckId = state.deck_id;
      section.dataset.pageStateId = state.id;
      section.tabIndex = 0;
      section.setAttribute("aria-label", assetLabel(deckOrder, state.page));
      const surface = document.createElement("div");
      surface.className = "structured-slide-surface";
      const heading = document.createElement("h3");
      heading.textContent = assetLabel(deckOrder, state.page);
      const content = document.createElement("p");
      content.textContent = state.text || state.markdown || "Structured slide text unavailable.";
      surface.append(heading, content);
      section.append(surface);
      this.appendPageNumber(section);
      this.appendLongDescription(section, state);
      this.bindSelection(section, state);
      this.elementStates.set(section, state);
      this.container.append(section);
      this.observer?.observe(section);
    }
  }

  private applyStripNumbers(): void {
    const sections = [...this.container.querySelectorAll<HTMLElement>(
      ".pdf-page, .structured-slide"
    )];
    for (const [index, section] of sections.entries()) {
      const label = section.querySelector<HTMLElement>(".slide-page-num");
      if (label) label.textContent = `${index + 1} / ${sections.length}`;
      section.dataset.stripPosition = String(index + 1);
    }
  }

  /**
   * Keeps enough space after the last slide that it can still reach the top
   * position. A real element with an inline height (not a pseudo-element fed
   * by a CSS variable): custom-property changes on pseudo-elements can lag a
   * style-recalc cycle behind forced layout, which made scrollHeight-clamped
   * placements land on stale maximums right after a revision switch.
   */
  private updateTailSpacer(): void {
    const sections = this.stripSections();
    const last = sections[sections.length - 1];
    if (!last) {
      this.tailSpacer.remove();
      return;
    }
    const tail = Math.max(
      0,
      this.container.clientHeight - last.offsetHeight - STRIP_TOP_GAP - Math.round(STRIP_TOP_GAP / 2)
    );
    this.tailSpacer.style.height = `${tail}px`;
    if (this.container.lastElementChild !== this.tailSpacer) this.container.append(this.tailSpacer);
  }

  private publishSlideAspect(aspect: number): void {
    if (this.aspectPublished || !Number.isFinite(aspect) || aspect <= 0) return;
    this.aspectPublished = true;
    this.container
      .closest<HTMLElement>(".lecture-shell")
      ?.style.setProperty("--lect-slide-aspect", String(Math.round(aspect * 1000) / 1000));
  }

  private sectionFor(pageStateId: string): HTMLElement | undefined {
    const state = this.stateForId(pageStateId);
    return [...this.elementStates].find(([, candidate]) => candidate === state)?.[0];
  }

  private stateForId(pageStateId: string): PageState | undefined {
    return [...this.elementStates.values()].find(
      (state) => state.id === pageStateId || state.aliases.includes(pageStateId)
    );
  }

  private renderKey(section: HTMLElement): string {
    return `${section.dataset.documentKey ?? ""}:${section.dataset.assetPage ?? ""}`;
  }

  private appendPageNumber(section: HTMLElement): void {
    const label = document.createElement("span");
    label.className = "slide-page-num";
    label.setAttribute("aria-hidden", "true");
    section.append(label);
  }

  private appendLongDescription(section: HTMLElement, state: PageState | undefined): void {
    if (!state?.long_description) return;
    const description = document.createElement("div");
    description.id = `${this.descriptionPrefix}-${++this.descriptionIndex}`;
    description.className = "lecture-long-description lecture-visually-hidden";
    description.textContent = state.long_description;
    section.setAttribute("aria-describedby", description.id);
    section.append(description);
  }

  private legacyAsset(pdfUrl: string | undefined, states: PageState[]): RevisionAsset {
    return {
      pdf_url: pdfUrl,
      download_url: pdfUrl,
      page_states: states,
      decks: [{
        deck_id: states[0]?.deck_id ?? "legacy-deck",
        order: 1,
        pdf_url: pdfUrl,
        download_url: pdfUrl,
        page_states: states
      }]
    };
  }
}

function createTailSpacer(): HTMLElement {
  const spacer = document.createElement("div");
  spacer.className = "slide-strip-tail";
  spacer.setAttribute("aria-hidden", "true");
  return spacer;
}

function createPlayCta(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "slide-play-cta";
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "▶";
  const label = document.createElement("span");
  label.className = "slide-play-cta-label";
  label.textContent = "Play from start of this slide";
  button.append(icon, label);
  return button;
}

/** Resolves after one animation frame (or a microtask when rAF is missing). */
function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function createVideoChip(): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "slide-current-chip";
  const label = document.createElement("span");
  chip.append(label);
  return chip;
}

function assetLabel(deckOrder: number, page: number): string {
  return deckOrder > 1 ? `Deck ${deckOrder}, slide ${page}` : `Slide ${page}`;
}
