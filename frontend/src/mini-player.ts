/**
 * Docks the inline video as a floating, draggable mini-player once it scrolls
 * out of the viewport in the stacked (narrow) layout, per the agreed design.
 * The YouTube iframe itself never moves in the DOM, so playback continues.
 */
export class MiniPlayer {
  private observer: IntersectionObserver | undefined;
  private dismissed = false;
  private docked = false;
  private dragPointer: number | undefined;
  private dragStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 };
  private offset = { x: 0, y: 0 };
  private readonly layoutQuery = window.matchMedia("(max-width: 1149.98px)");
  private readonly layoutListener = () => this.onLayoutChange();
  private readonly resizeListener = () => {
    if (this.docked) this.applyOffset();
  };

  constructor(
    private readonly dock: HTMLElement,
    private readonly frame: HTMLElement,
    private readonly bar: HTMLElement
  ) {
    this.bar.querySelector("[data-action=mini-expand]")?.addEventListener("click", () => {
      this.undock();
      this.dismissed = false;
      const behavior: ScrollBehavior = matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth";
      this.dock.scrollIntoView({ behavior, block: "center" });
    });
    this.bar.querySelector("[data-action=mini-close]")?.addEventListener("click", () => {
      this.undock();
      this.dismissed = true;
    });
    this.bar.addEventListener("pointerdown", (event) => this.onDragStart(event));
    this.bar.addEventListener("pointermove", (event) => this.onDragMove(event));
    for (const type of ["pointerup", "pointercancel"] as const) {
      this.bar.addEventListener(type, (event) => this.onDragEnd(event));
    }
    this.layoutQuery.addEventListener?.("change", this.layoutListener);
    window.addEventListener("resize", this.resizeListener);
    this.observe();
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.layoutQuery.removeEventListener?.("change", this.layoutListener);
    window.removeEventListener("resize", this.resizeListener);
    this.undock();
  }

  private observe(): void {
    if (typeof IntersectionObserver !== "function") return;
    this.observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        if (entry.isIntersecting) {
          this.dismissed = false;
          this.undock();
          return;
        }
        if (this.layoutQuery.matches && !this.dismissed) this.dockIt();
      },
      { threshold: 0 }
    );
    this.observer.observe(this.dock);
  }

  private onLayoutChange(): void {
    if (!this.layoutQuery.matches) this.undock();
  }

  private dockIt(): void {
    if (this.docked) return;
    this.docked = true;
    this.dock.style.minHeight = `${this.frame.offsetHeight}px`;
    this.frame.classList.add("is-docked");
    this.bar.hidden = false;
    this.applyOffset();
  }

  private undock(): void {
    if (!this.docked) return;
    this.docked = false;
    this.frame.classList.remove("is-docked");
    this.frame.style.removeProperty("--mini-shift-x");
    this.frame.style.removeProperty("--mini-shift-y");
    this.dock.style.minHeight = "";
    this.bar.hidden = true;
  }

  private onDragStart(event: PointerEvent): void {
    if (!this.docked || (event.target as HTMLElement).closest("button")) return;
    this.dragPointer = event.pointerId;
    this.dragStart = {
      x: event.clientX,
      y: event.clientY,
      offsetX: this.offset.x,
      offsetY: this.offset.y
    };
    this.bar.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  private onDragMove(event: PointerEvent): void {
    if (this.dragPointer !== event.pointerId) return;
    this.offset = {
      x: this.dragStart.offsetX + (event.clientX - this.dragStart.x),
      y: this.dragStart.offsetY + (event.clientY - this.dragStart.y)
    };
    this.applyOffset();
  }

  private onDragEnd(event: PointerEvent): void {
    if (this.dragPointer !== event.pointerId) return;
    this.dragPointer = undefined;
    this.bar.releasePointerCapture?.(event.pointerId);
  }

  private applyOffset(): void {
    const rect = this.frame.getBoundingClientRect();
    const width = rect.width || 300;
    const height = rect.height || 200;
    const maxRight = Math.max(0, window.innerWidth - width - 8);
    const maxUp = Math.max(0, window.innerHeight - height - 8);
    this.offset = {
      x: Math.min(Math.max(this.offset.x, 0), maxRight),
      y: Math.max(Math.min(this.offset.y, 0), -maxUp)
    };
    this.frame.style.setProperty("--mini-shift-x", `${Math.round(this.offset.x)}px`);
    this.frame.style.setProperty("--mini-shift-y", `${Math.round(this.offset.y)}px`);
  }
}
