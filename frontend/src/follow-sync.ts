/**
 * Follow/selection state machine for the slide strip, per the agreed rules:
 *
 * - The video slide (green) and the selected slide (blue) are separate.
 *   The selection mirrors the video while following or while paused by
 *   scrolling; only an explicit selection of a different slide detaches it.
 * - Scrolling never changes the selection. It pauses following only once the
 *   lower half of the video slide is entirely out of view, and resumes it
 *   (without scrolling) once part of that lower half is scrolled back in.
 *   Selecting the video slide also resumes; the video catching up to a
 *   selected slide does not.
 * - "Stuck" means the video slide sits in the strip's top position and was
 *   never scrolled away since the strip put it there. While stuck, cue
 *   advances jump instantly; otherwise they re-stick with an animation.
 *   Small scrolls bounce back (the top position is sticky); scrolling more
 *   than `unstickPx` releases it.
 */

export type FollowPauseReason = "scroll" | "selection";
export type StripScrollBehavior = "instant" | "smooth";

export interface FollowSyncHost {
  /**
   * Fraction (0..1) of the slide's lower half currently visible in the strip
   * viewport, or undefined when the slide is not in the strip.
   */
  lowerHalfVisibleFraction(stateId: string): number | undefined;
  /** Signed px distance of the strip from the slide's top position. */
  distanceFromTopPosition(stateId: string): number | undefined;
  /**
   * Scroll the strip so the slide sits at the top position. Resolves true
   * when the scroll settled at the target without user interruption.
   */
  scrollToTopPosition(stateId: string, behavior: StripScrollBehavior): Promise<boolean>;
  /** Follow state, selection, or video slide changed; refresh the UI. */
  stateChanged(): void;
}

export class FollowSync {
  videoStateId: string | undefined;
  pauseReason: FollowPauseReason | undefined;
  stuck = false;
  /** The slide the user last selected explicitly (clicks only, never derived). */
  explicitSelectionId: string | undefined;
  private manualSelectionId: string | undefined;
  /**
   * The most recent actual video slide: during non-slide cues (interludes)
   * the scroll geometry keeps working against it, so the user can still
   * pause by scrolling away or unstick the strip while nothing is mapped.
   */
  private lastVideoStateId: string | undefined;
  private stickToken = 0;

  constructor(
    private readonly host: FollowSyncHost,
    private readonly unstickPx = 120
  ) {}

  get following(): boolean {
    return this.pauseReason === undefined;
  }

  /** The blue selection: mirrors the video unless paused by a selection. */
  get selectedStateId(): string | undefined {
    return this.pauseReason === "selection" ? this.manualSelectionId : this.videoStateId;
  }

  /** The video reached a (possibly undefined) slide through playback. */
  onVideoSlide(stateId: string | undefined): void {
    if (stateId === this.videoStateId) return;
    this.videoStateId = stateId;
    if (stateId !== undefined) this.lastVideoStateId = stateId;
    if (this.following && stateId !== undefined) {
      if (this.stuck) void this.host.scrollToTopPosition(stateId, "instant");
      else this.stick(stateId);
    }
    this.host.stateChanged();
  }

  /**
   * The video was explicitly sent to a slide ("Play from here", the slide's
   * play pill, or the drawer's play button). With `resume` (the on-slide play
   * pill) following turns on unconditionally — in place, without scrolling or
   * sticking; the next cue change scrolls per the normal rules. Without it,
   * following resumes only when the pause came from scrolling and the slide's
   * lower half is entirely visible — the same effect as scrolling the playing
   * slide fully into view.
   */
  onPlayFrom(stateId: string, options: { resume?: boolean } = {}): void {
    const wasFollowing = this.following;
    const previous = this.videoStateId;
    this.videoStateId = stateId;
    this.lastVideoStateId = stateId;
    // Playing consumes the explicit selection: the play pill disappears until
    // the user selects a slide again.
    this.explicitSelectionId = undefined;
    if (options.resume) {
      this.pauseReason = undefined;
      this.manualSelectionId = undefined;
      // Resuming in place must not scroll; `stuck` survives only when the
      // slide at the top position is still the one now playing.
      this.stuck = this.stuck && stateId === previous;
    } else if (wasFollowing) {
      if (stateId !== previous) {
        if (this.stuck) void this.host.scrollToTopPosition(stateId, "instant");
        else this.stick(stateId);
      }
    } else if (this.pauseReason === "scroll") {
      const fraction = this.host.lowerHalfVisibleFraction(stateId);
      if (fraction !== undefined && fraction >= 0.999) this.pauseReason = undefined;
    }
    this.host.stateChanged();
  }

  /**
   * An explicit selection (strip card click, drawer row, search hit,
   * citation). Selecting the video slide resumes following; anything else
   * pauses with reason "selection".
   */
  onSelect(
    stateId: string,
    options: { scrollIntoView: boolean; behavior?: StripScrollBehavior } = { scrollIntoView: false }
  ): void {
    const behavior = options.behavior ?? "smooth";
    this.explicitSelectionId = stateId;
    if (stateId === this.videoStateId) {
      this.pauseReason = undefined;
      this.manualSelectionId = undefined;
      if (options.scrollIntoView) this.stick(stateId, behavior);
      // Resuming in place must not scroll; the next cue change will.
    } else {
      this.pauseReason = "selection";
      this.manualSelectionId = stateId;
      this.stuck = false;
      if (options.scrollIntoView) {
        this.stickToken += 1;
        void this.host.scrollToTopPosition(stateId, behavior);
      }
    }
    this.host.stateChanged();
  }

  /** A user-driven strip scroll is happening (fires repeatedly). */
  onUserScroll(): void {
    this.stickToken += 1;
    // During interludes the geometry falls back to the last actual video
    // slide, so scrolling can still pause/unstick between slide cues.
    const anchorId = this.videoStateId ?? this.lastVideoStateId;
    if (anchorId === undefined) return;
    if (this.following) {
      if (this.stuck) {
        const distance = this.host.distanceFromTopPosition(anchorId);
        if (distance !== undefined && Math.abs(distance) > this.unstickPx) this.stuck = false;
      }
      const fraction = this.host.lowerHalfVisibleFraction(anchorId);
      if (fraction !== undefined && fraction <= 0) {
        this.pauseReason = "scroll";
        this.stuck = false;
        this.host.stateChanged();
      }
    } else if (this.pauseReason === "scroll") {
      const fraction = this.host.lowerHalfVisibleFraction(anchorId);
      if (fraction !== undefined && fraction > 0) {
        this.pauseReason = undefined;
        this.host.stateChanged();
      }
    }
  }

  /** The user's scroll gesture settled. Small offsets bounce back when stuck. */
  onUserScrollSettled(): void {
    const anchorId = this.videoStateId ?? this.lastVideoStateId;
    if (!this.stuck || anchorId === undefined) return;
    const distance = this.host.distanceFromTopPosition(anchorId);
    if (distance === undefined || Math.abs(distance) < 2) return;
    if (Math.abs(distance) <= this.unstickPx) {
      void this.host.scrollToTopPosition(anchorId, "smooth");
    } else {
      this.stuck = false;
    }
  }

  /** The explicit "Resume following" button: resume and re-stick, animated. */
  onResumeButton(): void {
    this.pauseReason = undefined;
    this.manualSelectionId = undefined;
    if (this.videoStateId !== undefined) this.stick(this.videoStateId);
    this.host.stateChanged();
  }

  /** Clicking the pill while following re-sticks the current slide. */
  onFollowPill(): void {
    if (!this.following || this.videoStateId === undefined || this.stuck) return;
    this.stick(this.videoStateId);
  }

  /**
   * Rebind after a revision switch or reload: ids changed, geometry is fresh,
   * nothing should scroll or animate as a side effect. With `keepStuck`, a
   * slide stuck at the top position stays stuck — the caller is responsible
   * for pinning the mapped slide back to the exact top position.
   * `explicitSelectionId` is the mapped counterpart of the user's explicit
   * selection (its OWN id, not the derived selection — mapping it onto the
   * mirrored video slide would resurrect the play-from-selected button).
   */
  rebind(
    videoStateId: string | undefined,
    selectedStateId: string | undefined,
    options: { keepStuck?: boolean; explicitSelectionId?: string | undefined } = {}
  ): void {
    this.videoStateId = videoStateId;
    this.lastVideoStateId = videoStateId;
    if (this.pauseReason === "selection") {
      this.manualSelectionId = selectedStateId;
      if (selectedStateId === undefined) this.pauseReason = undefined;
    }
    this.explicitSelectionId = options.explicitSelectionId;
    this.stuck = Boolean(options.keepStuck) && this.following && videoStateId !== undefined;
    this.stickToken += 1;
    this.host.stateChanged();
  }

  /** Animated stick; marks `stuck` only when it settles uninterrupted. */
  private stick(stateId: string, behavior: StripScrollBehavior = "smooth"): void {
    const token = ++this.stickToken;
    void this.host.scrollToTopPosition(stateId, behavior).then((settled) => {
      if (
        settled &&
        token === this.stickToken &&
        this.following &&
        this.videoStateId === stateId
      ) {
        this.stuck = true;
        this.host.stateChanged();
      }
    });
  }
}
