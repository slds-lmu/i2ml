import {
  clampMini,
  moveMini,
  resizeMini,
  type MiniAnchor,
  type MiniRect,
  type MiniViewport
} from "./mini-geometry";

type ResizeEdge = "left" | "right" | "top" | "top-left" | "top-right";

/**
 * Fraction of the video that must be visible for it to count as on-screen:
 * at 0.5 the mini-player appears exactly when the video's midpoint scrolls
 * out and disappears when it scrolls back in.
 */
export const MINI_DOCK_RATIO = 0.5;

interface DragGesture {
  kind: "drag";
  pointerId: number;
  startX: number;
  startY: number;
  startRect: MiniRect;
}

interface ResizeGesture {
  kind: "resize";
  pointerId: number;
  edge: ResizeEdge;
  startX: number;
  startY: number;
  startRect: MiniRect;
}

interface PinchGesture {
  kind: "pinch";
  startDistance: number;
  startRect: MiniRect;
}

/**
 * Docks the inline video as a floating, draggable, resizable mini-player once
 * more than half of it scrolls out of the viewport in the portrait (stacked)
 * layout — it floats when the video's midpoint leaves the screen and returns
 * at the same point on the way back. The video area keeps a fixed 16:9 ratio
 * (the drag bar below is extra); resizing—edge drag or two-finger pinch on
 * the bar/edges—keeps the window inside the viewport, growing downwards near
 * the top of the screen and upwards near the bottom. The YouTube iframe
 * itself never moves in the DOM, so playback continues.
 */
export class MiniPlayer {
  private observer: IntersectionObserver | undefined;
  private dismissed = false;
  private docked = false;
  private rect: MiniRect = { left: 12, top: 99_999, width: 320 };
  private gesture: DragGesture | ResizeGesture | PinchGesture | undefined;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private readonly handles: HTMLElement[] = [];
  private readonly layoutQuery = window.matchMedia("(orientation: portrait)");
  private readonly layoutListener = () => this.onLayoutChange();
  private readonly resizeListener = () => {
    if (this.docked) this.applyRect(clampMini(this.rect, this.barHeight(), viewport()));
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
    this.createHandles();
    this.frame.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.frame.addEventListener("pointermove", (event) => this.onPointerMove(event));
    for (const type of ["pointerup", "pointercancel"] as const) {
      this.frame.addEventListener(type, (event) => this.onPointerEnd(event));
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
    for (const handle of this.handles) handle.remove();
    this.handles.length = 0;
  }

  private createHandles(): void {
    const edges: ResizeEdge[] = ["left", "right", "top", "top-left", "top-right"];
    for (const edge of edges) {
      const handle = document.createElement("div");
      handle.className = "mini-resize";
      handle.dataset.miniEdge = edge;
      handle.setAttribute("aria-hidden", "true");
      this.frame.append(handle);
      this.handles.push(handle);
    }
  }

  private observe(): void {
    if (typeof IntersectionObserver !== "function") return;
    this.observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        // The video counts as on-screen while its middle is visible. In the
        // stacked layout it only ever exits vertically, so the area ratio is
        // exactly the midpoint test — and it is the same in both directions,
        // so the player floats and returns at the same scroll position.
        if (entry.intersectionRatio >= MINI_DOCK_RATIO) {
          this.dismissed = false;
          this.undock();
          return;
        }
        if (this.layoutQuery.matches && !this.dismissed) this.dockIt();
      },
      { threshold: [MINI_DOCK_RATIO] }
    );
    this.observer.observe(this.dock);
  }

  private onLayoutChange(): void {
    if (!this.layoutQuery.matches) this.undock();
  }

  private barHeight(): number {
    return this.bar.offsetHeight || 28;
  }

  private dockIt(): void {
    if (this.docked) return;
    this.docked = true;
    this.dock.style.minHeight = `${this.frame.offsetHeight}px`;
    this.frame.classList.add("is-docked");
    this.bar.hidden = false;
    this.applyRect(clampMini(this.rect, this.barHeight(), viewport()));
  }

  private undock(): void {
    if (!this.docked) return;
    this.docked = false;
    this.gesture = undefined;
    this.pointers.clear();
    this.frame.classList.remove("is-docked");
    this.frame.style.removeProperty("left");
    this.frame.style.removeProperty("top");
    this.frame.style.removeProperty("width");
    this.dock.style.minHeight = "";
    this.bar.hidden = true;
  }

  private applyRect(rect: MiniRect): void {
    this.rect = rect;
    this.frame.style.left = `${Math.round(rect.left)}px`;
    this.frame.style.top = `${Math.round(rect.top)}px`;
    this.frame.style.width = `${Math.round(rect.width)}px`;
  }

  private onPointerDown(event: PointerEvent): void {
    if (!this.docked || (event.target as HTMLElement).closest("button")) return;
    const edge = (event.target as HTMLElement).closest<HTMLElement>("[data-mini-edge]")
      ?.dataset.miniEdge as ResizeEdge | undefined;
    const onBar = Boolean((event.target as HTMLElement).closest(".mini-player-bar"));
    if (!edge && !onBar) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.frame.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    if (this.pointers.size === 2) {
      const [first, second] = [...this.pointers.values()];
      this.gesture = {
        kind: "pinch",
        startDistance: Math.max(1, distance(first!, second!)),
        startRect: this.rect
      };
      return;
    }
    this.gesture = edge
      ? {
          kind: "resize",
          pointerId: event.pointerId,
          edge,
          startX: event.clientX,
          startY: event.clientY,
          startRect: this.rect
        }
      : {
          kind: "drag",
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startRect: this.rect
        };
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId) || !this.gesture) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const bar = this.barHeight();
    const view = viewport();
    if (this.gesture.kind === "pinch") {
      if (this.pointers.size < 2) return;
      const [first, second] = [...this.pointers.values()];
      const scale = distance(first!, second!) / this.gesture.startDistance;
      this.applyRect(
        resizeMini(this.gesture.startRect, this.gesture.startRect.width * scale, "center", bar, view)
      );
      return;
    }
    if (this.gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - this.gesture.startX;
    const dy = event.clientY - this.gesture.startY;
    if (this.gesture.kind === "drag") {
      this.applyRect(moveMini(this.gesture.startRect, dx, dy, bar, view));
      return;
    }
    const { edge, startRect } = this.gesture;
    let widthDelta = 0;
    let anchor: MiniAnchor = "center";
    if (edge.includes("right")) {
      widthDelta += dx;
      anchor = "left";
    } else if (edge.includes("left")) {
      widthDelta -= dx;
      anchor = "right";
    }
    if (edge.includes("top")) widthDelta += (-dy * 16) / 9;
    this.applyRect(resizeMini(startRect, startRect.width + widthDelta, anchor, bar, view));
  }

  private onPointerEnd(event: PointerEvent): void {
    if (!this.pointers.delete(event.pointerId)) return;
    this.frame.releasePointerCapture?.(event.pointerId);
    if (this.gesture?.kind === "pinch") {
      // Fall back to a fresh gesture for the remaining finger, if any.
      this.gesture = undefined;
      this.pointers.clear();
      return;
    }
    if (this.gesture && this.gesture.pointerId === event.pointerId) this.gesture = undefined;
  }
}

function viewport(): MiniViewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
