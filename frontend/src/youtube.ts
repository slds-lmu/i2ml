type PlayerStateHandler = (state: number) => void;

interface YouTubePlayer {
  destroy(): void;
  getCurrentTime(): number;
  getDuration?(): number;
  getPlayerState(): number;
  pauseVideo(): void;
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
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

  async mount(element: HTMLElement, videoId: string, onState: PlayerStateHandler): Promise<void> {
    const api = await withTimeout(
      loadYouTubeApi(),
      this.readyTimeoutMs,
      "YouTube API did not become ready"
    );
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
        this.player = new api.Player(element, {
          host: "https://www.youtube-nocookie.com",
          videoId,
          playerVars: {
            enablejsapi: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0
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
