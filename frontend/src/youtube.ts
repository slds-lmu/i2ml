type PlayerStateHandler = (state: number) => void;

interface YouTubePlayer {
  destroy(): void;
  getCurrentTime(): number;
  getDuration?(): number;
  getPlayerState(): number;
  pauseVideo(): void;
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate?(suggestedRate: number): void;
  getPlaybackRate?(): number;
}

/** Stable YouTube IFrame API player states used by the lecture UI. */
export const PLAYER_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2 } as const;

interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      host: string;
      videoId: string;
      playerVars: Record<string, string | number>;
      events: { onReady: () => void; onStateChange: (event: { data: number }) => void };
    }
  ) => YouTubePlayer;
  PlayerState: { PLAYING: number };
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeApi> | undefined;

export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
      else reject(new Error("YouTube API initialized without a player"));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.referrerPolicy = "strict-origin-when-cross-origin";
    script.onerror = () => reject(new Error("YouTube API failed to load"));
    document.head.append(script);
  });
  return apiPromise;
}

export class YouTubeController {
  private player: YouTubePlayer | undefined;
  private timer: number | undefined;
  private readonly timeHandlers = new Set<(timeMs: number) => void>();

  constructor(private readonly readyTimeoutMs = 10_000) {}

  /**
   * Mounts the player; `startSeconds` cues the video at that position via
   * playerVars, so the poster and play button stay visible (seeking an
   * unstarted player and pausing it leaves a black, uncontrollable box).
   */
  async mount(
    element: HTMLElement,
    videoId: string,
    onState: PlayerStateHandler,
    startSeconds?: number
  ): Promise<void> {
    const api = await withTimeout(
      loadYouTubeApi(),
      this.readyTimeoutMs,
      "YouTube API did not become ready"
    );
    // The IFrame API REPLACES the element it is given. Hand it a throwaway
    // child so the styled container (and its sizing) always survives and the
    // resulting iframe stays inside it.
    const target = document.createElement("div");
    element.replaceChildren(target);
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        try {
          this.player?.destroy();
        } catch {
          // A partially initialized third-party player may not be destroyable.
        }
        this.player = undefined;
        reject(new Error("YouTube player did not become ready"));
      }, this.readyTimeoutMs);
      try {
        this.player = new api.Player(target, {
          host: "https://www.youtube-nocookie.com",
          videoId,
          playerVars: {
            enablejsapi: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0,
            ...(startSeconds !== undefined && startSeconds > 0
              ? { start: Math.floor(startSeconds) }
              : {})
          },
          events: {
            onReady: () => {
              window.clearTimeout(timeout);
              resolve();
            },
            onStateChange: ({ data }) => {
              onState(data);
              this.stopPolling();
              this.emitTime();
              if (data === api.PlayerState.PLAYING) {
                this.timer = window.setInterval(() => this.emitTime(), 250);
              }
            }
          }
        });
      } catch (error) {
        window.clearTimeout(timeout);
        reject(error);
      }
    });
  }

  onTime(handler: (timeMs: number) => void): () => void {
    this.timeHandlers.add(handler);
    return () => this.timeHandlers.delete(handler);
  }

  currentTimeMs(): number {
    return Math.round((this.player?.getCurrentTime() ?? 0) * 1000);
  }

  /** Video length in milliseconds; 0 while the player has no metadata yet. */
  durationMs(): number {
    const seconds = this.player?.getDuration?.() ?? 0;
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
  }

  playerState(): number | undefined {
    return this.player?.getPlayerState();
  }

  seek(timeMs: number, play: boolean): void {
    this.player?.seekTo(timeMs / 1000, true);
    if (play) this.player?.playVideo();
    else this.player?.pauseVideo();
  }

  /** Seeks without touching the play state — like scrubbing the player bar. */
  scrub(timeMs: number): void {
    this.player?.seekTo(timeMs / 1000, true);
  }

  play(): void {
    this.player?.playVideo();
  }

  pause(): void {
    this.player?.pauseVideo();
  }

  /** Suggests a playback rate; the player may snap it to a supported value. */
  setPlaybackRate(rate: number): void {
    this.player?.setPlaybackRate?.(rate);
  }

  /** The rate the player actually runs at (it may have snapped a suggestion). */
  playbackRate(): number | undefined {
    const rate = this.player?.getPlaybackRate?.();
    return typeof rate === "number" && Number.isFinite(rate) ? rate : undefined;
  }

  destroy(): void {
    this.stopPolling();
    this.player?.destroy();
    this.player = undefined;
  }

  private emitTime(): void {
    const time = this.currentTimeMs();
    this.timeHandlers.forEach((handler) => handler(time));
  }

  private stopPolling(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}
