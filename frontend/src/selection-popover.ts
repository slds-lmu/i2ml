export interface SelectionPopoverHost {
  /** Called with the normalized selected text and the slide section it lives in. */
  onAsk(text: string, slide: HTMLElement): void;
  announce(message: string): void;
}

/**
 * Floating "Ask about this / Copy text" popover shown when the student selects
 * text inside the slide strip. Works for mouse, touch, and keyboard selection.
 */
export class SelectionPopover {
  private debounce: number | undefined;
  private currentSlide: HTMLElement | undefined;
  private currentText = "";
  private readonly selectionListener = () => this.scheduleUpdate();
  private readonly hideListener = () => this.hide();
  private readonly pointerListener = (event: PointerEvent) => {
    if (!this.popover.hidden && !this.popover.contains(event.target as Node)) this.hide();
  };

  constructor(
    private readonly popover: HTMLElement,
    private readonly strip: HTMLElement,
    private readonly host: SelectionPopoverHost
  ) {
    popover.innerHTML = `
      <button type="button" data-action="popover-ask">
        <span class="assistant-pill-icon" aria-hidden="true">?</span> Ask about this
      </button>
      <button type="button" data-action="popover-copy">Copy text</button>`;
    popover.querySelector("[data-action=popover-ask]")!.addEventListener("click", () => {
      if (this.currentSlide && this.currentText) this.host.onAsk(this.currentText, this.currentSlide);
      this.hide();
    });
    popover.querySelector("[data-action=popover-copy]")!.addEventListener("click", () => {
      void this.copy();
    });
    popover.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.hide();
      this.strip.focus();
    });
    document.addEventListener("selectionchange", this.selectionListener);
    document.addEventListener("pointerdown", this.pointerListener);
    strip.addEventListener("scroll", this.hideListener, { passive: true });
  }

  destroy(): void {
    document.removeEventListener("selectionchange", this.selectionListener);
    document.removeEventListener("pointerdown", this.pointerListener);
    this.strip.removeEventListener("scroll", this.hideListener);
    if (this.debounce !== undefined) window.clearTimeout(this.debounce);
    this.hide();
  }

  private scheduleUpdate(): void {
    if (this.debounce !== undefined) window.clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => this.update(), 150);
  }

  private update(): void {
    const selection = window.getSelection();
    const text = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (!selection || selection.isCollapsed || !text || selection.rangeCount === 0) {
      this.hide();
      return;
    }
    const slide = this.slideFor(selection.anchorNode) ?? this.slideFor(selection.focusNode);
    const focusSlide = this.slideFor(selection.focusNode);
    if (!slide || (focusSlide && focusSlide !== slide)) {
      this.hide();
      return;
    }
    const range = selection.getRangeAt(0);
    const rects = range.getClientRects();
    const anchor = rects.length > 0 ? rects[rects.length - 1]! : range.getBoundingClientRect();
    if (anchor.width === 0 && anchor.height === 0) {
      this.hide();
      return;
    }
    this.currentSlide = slide;
    this.currentText = text.slice(0, 2000);
    this.popover.hidden = false;
    const popRect = this.popover.getBoundingClientRect();
    const margin = 8;
    let top = anchor.bottom + margin;
    if (top + popRect.height > window.innerHeight - margin) {
      top = anchor.top - popRect.height - margin;
    }
    // Long selections can end outside the viewport; keep the popover on-screen.
    top = Math.min(Math.max(margin, top), window.innerHeight - popRect.height - margin);
    const left = Math.min(
      Math.max(margin, anchor.right - popRect.width / 2),
      window.innerWidth - popRect.width - margin
    );
    this.popover.style.top = `${Math.round(top)}px`;
    this.popover.style.left = `${Math.round(left)}px`;
  }

  private slideFor(node: Node | null): HTMLElement | undefined {
    if (!node) return undefined;
    const element = node instanceof Element ? node : node.parentElement;
    const slide = element?.closest<HTMLElement>(".pdf-page, .structured-slide") ?? undefined;
    return slide && this.strip.contains(slide) ? slide : undefined;
  }

  private hide(): void {
    this.popover.hidden = true;
    this.currentSlide = undefined;
    this.currentText = "";
  }

  private async copy(): Promise<void> {
    const text = this.currentText;
    this.hide();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.host.announce("Selected slide text copied to the clipboard.");
    } catch {
      const succeeded = document.execCommand("copy");
      this.host.announce(
        succeeded
          ? "Selected slide text copied to the clipboard."
          : "Copying is not available in this browser."
      );
    }
  }
}
