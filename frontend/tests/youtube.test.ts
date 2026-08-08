import { describe, expect, it, vi } from "vitest";

import { YouTubeController } from "../src/youtube";

describe("YouTube controller", () => {
  it("pauses after setting a time even when the player was already playing", async () => {
    const seekTo = vi.fn();
    const pauseVideo = vi.fn();
    const playVideo = vi.fn();
    const destroy = vi.fn();
    class Player {
      constructor(
        _element: HTMLElement,
        options: { events: { onReady: () => void } }
      ) {
        options.events.onReady();
      }

      destroy = destroy;
      getCurrentTime = () => 0;
      getPlayerState = () => 1;
      pauseVideo = pauseVideo;
      playVideo = playVideo;
      seekTo = seekTo;
    }
    window.YT = {
      Player,
      PlayerState: { PLAYING: 1 }
    };
    const controller = new YouTubeController();
    await controller.mount(document.createElement("div"), "video-id", () => undefined);

    controller.seek(1250, false);

    expect(seekTo).toHaveBeenCalledWith(1.25, true);
    expect(pauseVideo).toHaveBeenCalledOnce();
    expect(playVideo).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("fails within a bound and destroys a player that never becomes ready", async () => {
    const destroy = vi.fn();
    class Player {
      destroy = destroy;
      getCurrentTime = () => 0;
      getPlayerState = () => 0;
      pauseVideo = vi.fn();
      playVideo = vi.fn();
      seekTo = vi.fn();
    }
    window.YT = {
      Player,
      PlayerState: { PLAYING: 1 }
    };
    const controller = new YouTubeController(10);

    await expect(
      controller.mount(document.createElement("div"), "video-id", () => undefined)
    ).rejects.toThrow("YouTube player did not become ready");
    expect(destroy).toHaveBeenCalledOnce();
  });
});
