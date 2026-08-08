import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";

import type { PageState, RevisionAsset, RevisionDeckAsset } from "./types";

GlobalWorkerOptions.workerSrc = workerUrl;

interface DocumentHandle {
  loadingTask: PDFDocumentLoadingTask;
  document?: PDFDocumentProxy;
}

let viewerInstance = 0;

export class PdfViewer {
  private readonly documents = new Map<string, DocumentHandle>();
  private readonly elementStates = new Map<HTMLElement, PageState>();
  private readonly visibleRatios = new Map<HTMLElement, number>();
  private observer: IntersectionObserver | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private readonly renderTasks = new Map<string, Promise<void>>();
  private resizeFrame: number | undefined;
  private observedWidth = 0;
  private generation = 0;
  private descriptionIndex = 0;
  private readonly descriptionPrefix = `lecture-slide-description-${++viewerInstance}`;

  constructor(
    private readonly container: HTMLElement,
    private readonly onVisible: (state: PageState) => void
  ) {}

  async load(asset: RevisionAsset): Promise<void>;
  async load(pdfUrl: string | undefined, states: PageState[]): Promise<void>;
  async load(
    assetOrPdfUrl: RevisionAsset | string | undefined,
    legacyStates: PageState[] = []
  ): Promise<void> {
    this.destroy();
    this.container.replaceChildren();
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
  }

  scrollTo(pageStateId: string, behavior: ScrollBehavior, focus = false): void {
    const state = this.stateForId(pageStateId);
    const target = [...this.elementStates].find(([, candidate]) => candidate === state)?.[0];
    if (typeof target?.scrollIntoView === "function") {
      target.scrollIntoView({ behavior, block: "center" });
    }
    if (focus) target?.focus({ preventScroll: true });
  }

  setActive(pageStateId: string | undefined): void {
    const activeState = pageStateId ? this.stateForId(pageStateId) : undefined;
    for (const [page, state] of this.elementStates) {
      const active = Boolean(activeState && state === activeState);
      page.classList.toggle("is-active", active);
      page.setAttribute("aria-current", active ? "true" : "false");
    }
  }

  async prepareForPrint(): Promise<void> {
    const pages = [...this.container.querySelectorAll<HTMLElement>(
      ".pdf-page[data-document-key][data-asset-page]"
    )];
    await Promise.all(pages.map((page) => this.renderPage(page)));
  }

  destroy(): void {
    this.generation += 1;
    this.observer?.disconnect();
    this.observer = undefined;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    if (this.resizeFrame !== undefined) window.cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = undefined;
    this.observedWidth = 0;
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
    this.visibleRatios.clear();
    this.renderTasks.clear();
  }

  private createObserver(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          this.visibleRatios.set(element, entry.isIntersecting ? entry.intersectionRatio : 0);
          if (entry.isIntersecting && element.dataset.documentKey && element.dataset.assetPage) {
            void this.renderPage(element);
          }
        }
        const visible = [...this.visibleRatios]
          .filter(([, ratio]) => ratio > 0)
          .sort((left, right) => right[1] - left[1])[0]?.[0];
        const state = visible ? this.elementStates.get(visible) : undefined;
        if (state) this.onVisible(state);
      },
      { root: this.container, threshold: [0.1, 0.5, 0.8] }
    );
  }

  private createResizeObserver(): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      const width = entries.find((entry) => entry.target === this.container)?.contentRect.width;
      if (!width || Math.abs(width - this.observedWidth) < 1) return;
      this.observedWidth = width;
      if (this.resizeFrame !== undefined) window.cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = window.requestAnimationFrame(() => {
        this.resizeFrame = undefined;
        void this.reflowRenderedPages().catch(() => undefined);
      });
    });
    this.resizeObserver.observe(this.container);
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
      }
      section.tabIndex = 0;
      section.setAttribute(
        "aria-label",
        assetLabel(deck.order, state?.page ?? page)
      );
      const loading = document.createElement("div");
      loading.className = "pdf-page-loading";
      loading.setAttribute("aria-live", "polite");
      loading.textContent = `Loading ${assetLabel(deck.order, state?.page ?? page).toLowerCase()}…`;
      section.append(loading);
      this.appendLongDescription(section, state);
      this.container.append(section);
      this.observer?.observe(section);
    }
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
      const baseViewport = page.getViewport({ scale: 1 });
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
      const description = section.querySelector<HTMLElement>(".lecture-long-description");
      section.replaceChildren(canvas, text, ...(description ? [description] : []));
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
      const heading = document.createElement("h3");
      heading.textContent = assetLabel(deckOrder, state.page);
      const content = document.createElement("p");
      content.textContent = state.text || state.markdown || "Structured slide text unavailable.";
      section.append(heading, content);
      this.appendLongDescription(section, state);
      section.addEventListener("focus", () => this.onVisible(state));
      this.elementStates.set(section, state);
      this.container.append(section);
      this.observer?.observe(section);
    }
  }

  private stateForId(pageStateId: string): PageState | undefined {
    return [...this.elementStates.values()].find(
      (state) => state.id === pageStateId || state.aliases.includes(pageStateId)
    );
  }

  private renderKey(section: HTMLElement): string {
    return `${section.dataset.documentKey ?? ""}:${section.dataset.assetPage ?? ""}`;
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

function assetLabel(deckOrder: number, page: number): string {
  return deckOrder > 1 ? `Deck ${deckOrder}, slide ${page}` : `Slide ${page}`;
}
