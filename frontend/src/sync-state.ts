export type SyncMode = "follow" | "explore";

export class SyncState {
  mode: SyncMode = "follow";
  activePageStateId: string | undefined;
  activeNonSlideKind: string | undefined;
  private programmaticScrollDepth = 0;

  activatePage(pageStateId: string): void {
    this.activePageStateId = pageStateId;
    this.activeNonSlideKind = undefined;
  }

  activateNonSlide(kind = "unmapped"): void {
    this.activePageStateId = undefined;
    this.activeNonSlideKind = kind;
  }

  manualIntent(): void {
    if (this.programmaticScrollDepth === 0) this.mode = "explore";
  }

  follow(): void {
    this.mode = "follow";
  }

  explore(): void {
    this.mode = "explore";
  }

  withProgrammaticScroll(callback: () => void): void {
    this.programmaticScrollDepth += 1;
    try {
      callback();
    } finally {
      queueMicrotask(() => {
        this.programmaticScrollDepth = Math.max(0, this.programmaticScrollDepth - 1);
      });
    }
  }
}
