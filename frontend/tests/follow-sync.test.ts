import { describe, expect, it, vi } from "vitest";

import { FollowSync, type FollowSyncHost, type StripScrollBehavior } from "../src/follow-sync";

interface HostFixture extends FollowSyncHost {
  fractions: Map<string, number>;
  distances: Map<string, number>;
  scrollCalls: { id: string; behavior: StripScrollBehavior }[];
  nextSettle: () => Promise<boolean>;
  stateChanges: number;
}

function makeHost(): HostFixture {
  const host: HostFixture = {
    fractions: new Map(),
    distances: new Map(),
    scrollCalls: [],
    nextSettle: () => Promise.resolve(true),
    stateChanges: 0,
    lowerHalfVisibleFraction: (id) => host.fractions.get(id),
    distanceFromTopPosition: (id) => host.distances.get(id),
    scrollToTopPosition: (id, behavior) => {
      host.scrollCalls.push({ id, behavior });
      return host.nextSettle();
    },
    stateChanged: () => {
      host.stateChanges += 1;
    }
  };
  return host;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("FollowSync — follow, selection, and stickiness rules", () => {
  it("sticks the first slide with an animation, then jumps instantly while stuck", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);

    sync.onVideoSlide("s1");
    expect(host.scrollCalls).toEqual([{ id: "s1", behavior: "smooth" }]);
    expect(sync.stuck).toBe(false);
    await flush();
    expect(sync.stuck).toBe(true);

    sync.onVideoSlide("s2");
    expect(host.scrollCalls[1]).toEqual({ id: "s2", behavior: "instant" });
    expect(sync.stuck).toBe(true);
  });

  it("mirrors the selection to the video slide while following", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s3");
    await flush();
    expect(sync.selectedStateId).toBe("s3");
    expect(sync.following).toBe(true);
  });

  it("bounces back from small scrolls but unsticks beyond the threshold", async () => {
    const host = makeHost();
    const sync = new FollowSync(host, 120);
    sync.onVideoSlide("s1");
    await flush();
    expect(sync.stuck).toBe(true);
    host.fractions.set("s1", 1);

    // Small scroll: still stuck, and the settle bounces back with an animation.
    host.distances.set("s1", 60);
    sync.onUserScroll();
    expect(sync.stuck).toBe(true);
    const callsBefore = host.scrollCalls.length;
    sync.onUserScrollSettled();
    expect(host.scrollCalls[callsBefore]).toEqual({ id: "s1", behavior: "smooth" });
    expect(sync.stuck).toBe(true);

    // Decisive scroll: unstuck, no bounce.
    host.distances.set("s1", 200);
    sync.onUserScroll();
    expect(sync.stuck).toBe(false);
    const afterUnstick = host.scrollCalls.length;
    sync.onUserScrollSettled();
    expect(host.scrollCalls.length).toBe(afterUnstick);
    expect(sync.following).toBe(true);
  });

  it("pauses only when the video slide's lower half is entirely out of view", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();

    host.distances.set("s1", 500);
    host.fractions.set("s1", 0.4);
    sync.onUserScroll();
    expect(sync.following).toBe(true);

    host.fractions.set("s1", 0);
    sync.onUserScroll();
    expect(sync.following).toBe(false);
    expect(sync.pauseReason).toBe("scroll");
    expect(sync.stuck).toBe(false);
  });

  it("resumes without scrolling once part of the lower half is scrolled back in", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();
    host.distances.set("s1", 500);
    host.fractions.set("s1", 0);
    sync.onUserScroll();
    expect(sync.pauseReason).toBe("scroll");

    const calls = host.scrollCalls.length;
    host.fractions.set("s1", 0.2);
    sync.onUserScroll();
    expect(sync.following).toBe(true);
    // Resuming by scrolling back must not scroll the strip.
    expect(host.scrollCalls.length).toBe(calls);
    expect(sync.stuck).toBe(false);

    // The next cue change force-scrolls again — animated, since unstuck.
    sync.onVideoSlide("s2");
    expect(host.scrollCalls.at(-1)).toEqual({ id: "s2", behavior: "smooth" });
  });

  it("moves the selection with the video while paused by scrolling, without scrolling", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();
    host.distances.set("s1", 500);
    host.fractions.set("s1", 0);
    sync.onUserScroll();
    const calls = host.scrollCalls.length;

    sync.onVideoSlide("s2");
    expect(sync.selectedStateId).toBe("s2");
    expect(sync.pauseReason).toBe("scroll");
    expect(host.scrollCalls.length).toBe(calls);
  });

  it("pauses via selection; scrolling can then never resume", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();

    sync.onSelect("s5", { scrollIntoView: false });
    expect(sync.pauseReason).toBe("selection");
    expect(sync.selectedStateId).toBe("s5");

    host.fractions.set("s1", 1);
    sync.onUserScroll();
    expect(sync.pauseReason).toBe("selection");
  });

  it("selecting the video slide resumes in place; a strip click never scrolls", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();
    sync.onSelect("s5", { scrollIntoView: false });

    const calls = host.scrollCalls.length;
    sync.onSelect("s1", { scrollIntoView: false });
    expect(sync.following).toBe(true);
    expect(sync.selectedStateId).toBe("s1");
    expect(host.scrollCalls.length).toBe(calls);
  });

  it("does not resume when the video catches up to the selected slide", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();
    sync.onSelect("s5", { scrollIntoView: false });

    sync.onVideoSlide("s5");
    expect(sync.pauseReason).toBe("selection");
    expect(sync.selectedStateId).toBe("s5");
    expect(sync.videoStateId).toBe("s5");
  });

  it("play-from-here resumes only when paused by scrolling and fully visible", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();
    host.distances.set("s1", 500);
    host.fractions.set("s1", 0);
    sync.onUserScroll();
    expect(sync.pauseReason).toBe("scroll");

    // Partially visible: stays paused.
    host.fractions.set("s7", 0.6);
    sync.onPlayFrom("s7");
    expect(sync.pauseReason).toBe("scroll");

    // Fully visible: resumes in place, no scroll.
    const calls = host.scrollCalls.length;
    host.fractions.set("s8", 1);
    sync.onPlayFrom("s8");
    expect(sync.following).toBe(true);
    expect(host.scrollCalls.length).toBe(calls);

    // Paused by selection: play-from-here never resumes.
    sync.onSelect("s2", { scrollIntoView: false });
    host.fractions.set("s9", 1);
    sync.onPlayFrom("s9");
    expect(sync.pauseReason).toBe("selection");
  });

  it("play-from-here while following force-scrolls per the stuck rules", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();
    expect(sync.stuck).toBe(true);

    sync.onPlayFrom("s4");
    expect(host.scrollCalls.at(-1)).toEqual({ id: "s4", behavior: "instant" });

    // Unstick, then play-from: animated.
    host.distances.set("s4", 400);
    host.fractions.set("s4", 1);
    sync.onUserScroll();
    expect(sync.stuck).toBe(false);
    sync.onPlayFrom("s6");
    expect(host.scrollCalls.at(-1)).toEqual({ id: "s6", behavior: "smooth" });
  });

  it("the play pill's resume option turns following on in place, without scrolling", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();
    // Pause by selecting a different slide — the pill's normal situation.
    sync.onSelect("s2", { scrollIntoView: false });
    expect(sync.following).toBe(false);
    expect(sync.explicitSelectionId).toBe("s2");

    const calls = host.scrollCalls.length;
    sync.onPlayFrom("s2", { resume: true });
    expect(sync.following).toBe(true);
    expect(sync.videoStateId).toBe("s2");
    expect(sync.selectedStateId).toBe("s2");
    // In place: nothing scrolled, nothing stuck.
    expect(host.scrollCalls.length).toBe(calls);
    expect(sync.stuck).toBe(false);
    await flush();
    expect(sync.stuck).toBe(false);
    // Playing consumed the explicit selection: the pill disappears.
    expect(sync.explicitSelectionId).toBeUndefined();
  });

  it("resume also lifts a scroll pause without scrolling back", () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    host.distances.set("s1", 500);
    host.fractions.set("s1", 0);
    sync.onUserScroll();
    expect(sync.pauseReason).toBe("scroll");

    // Fraction 0: the non-resume path would stay paused; resume never does.
    const calls = host.scrollCalls.length;
    sync.onPlayFrom("s1", { resume: true });
    expect(sync.following).toBe(true);
    expect(host.scrollCalls.length).toBe(calls);
  });

  it("resume keeps `stuck` only while the played slide is the one at the top", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();
    expect(sync.stuck).toBe(true);

    // Selecting the playing slide keeps following; playing it from the start
    // moves nothing, so the strip stays stuck.
    sync.onSelect("s1", { scrollIntoView: false });
    expect(sync.following).toBe(true);
    sync.onPlayFrom("s1", { resume: true });
    expect(sync.stuck).toBe(true);
    expect(sync.following).toBe(true);

    // A different slide drops `stuck` but still must not scroll (unlike the
    // non-resume path, which would force-scroll instantly while stuck).
    const calls = host.scrollCalls.length;
    sync.onPlayFrom("s2", { resume: true });
    expect(sync.stuck).toBe(false);
    expect(sync.following).toBe(true);
    expect(host.scrollCalls.length).toBe(calls);
  });

  it("the resume button re-sticks with an animation", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();
    host.distances.set("s1", 500);
    host.fractions.set("s1", 0);
    sync.onUserScroll();

    sync.onResumeButton();
    expect(sync.following).toBe(true);
    expect(host.scrollCalls.at(-1)).toEqual({ id: "s1", behavior: "smooth" });
    await flush();
    expect(sync.stuck).toBe(true);
  });

  it("clicking the pill while following re-sticks only when unstuck", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();

    const calls = host.scrollCalls.length;
    sync.onFollowPill();
    expect(host.scrollCalls.length).toBe(calls); // already stuck: nothing to do

    host.distances.set("s1", 300);
    host.fractions.set("s1", 1);
    sync.onUserScroll();
    expect(sync.stuck).toBe(false);
    sync.onFollowPill();
    expect(host.scrollCalls.at(-1)).toEqual({ id: "s1", behavior: "smooth" });
    await flush();
    expect(sync.stuck).toBe(true);
  });

  it("an interrupted stick animation does not mark the slide as stuck", async () => {
    const host = makeHost();
    let resolveSettle: (settled: boolean) => void = () => undefined;
    host.nextSettle = () => new Promise<boolean>((resolve) => {
      resolveSettle = resolve;
    });
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    sync.onUserScroll(); // user takes over mid-animation
    resolveSettle(true);
    await flush();
    expect(sync.stuck).toBe(false);
  });

  it("selecting from the drawer scrolls with an animation but never sticks a non-video slide", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();

    sync.onSelect("s9", { scrollIntoView: true });
    expect(sync.pauseReason).toBe("selection");
    expect(host.scrollCalls.at(-1)).toEqual({ id: "s9", behavior: "smooth" });
    await flush();
    expect(sync.stuck).toBe(false);
  });

  it("selecting the video slide from the drawer resumes and re-sticks", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();
    sync.onSelect("s9", { scrollIntoView: false });

    sync.onSelect("s1", { scrollIntoView: true });
    expect(sync.following).toBe(true);
    expect(host.scrollCalls.at(-1)).toEqual({ id: "s1", behavior: "smooth" });
    await flush();
    expect(sync.stuck).toBe(true);
  });

  it("rebind maps ids, keeps the pause mode, and never scrolls", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();
    sync.onSelect("s5", { scrollIntoView: false });
    const calls = host.scrollCalls.length;

    sync.rebind("t1", "t5");
    expect(sync.videoStateId).toBe("t1");
    expect(sync.selectedStateId).toBe("t5");
    expect(sync.pauseReason).toBe("selection");
    expect(sync.stuck).toBe(false);
    expect(host.scrollCalls.length).toBe(calls);

    // A selection that does not exist in the new revision falls back to follow.
    sync.rebind("t1", undefined);
    expect(sync.following).toBe(true);
    expect(sync.selectedStateId).toBe("t1");
  });

  it("rebind keeps a stuck slide stuck only when asked and still following", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();
    expect(sync.stuck).toBe(true);
    const calls = host.scrollCalls.length;

    // The revision switch preserves the pin; the caller re-places the strip.
    sync.rebind("t1", "t1", { keepStuck: true });
    expect(sync.stuck).toBe(true);
    expect(host.scrollCalls.length).toBe(calls);

    // Still stuck: the next cue advance jumps instantly, no animation.
    sync.onVideoSlide("t2");
    expect(host.scrollCalls.at(-1)).toEqual({ id: "t2", behavior: "instant" });

    // Without keepStuck the pin is dropped as before.
    sync.rebind("u2", "u2");
    expect(sync.stuck).toBe(false);

    // keepStuck cannot pin without a video slide in the new revision…
    sync.onVideoSlide("u5");
    await flush();
    expect(sync.stuck).toBe(true);
    sync.rebind(undefined, undefined, { keepStuck: true });
    expect(sync.stuck).toBe(false);

    // …and not while paused by a selection either.
    sync.onVideoSlide("u3");
    await flush();
    sync.onSelect("u9", { scrollIntoView: false });
    sync.rebind("v3", "v9", { keepStuck: true });
    expect(sync.pauseReason).toBe("selection");
    expect(sync.stuck).toBe(false);
  });

  it("maps the explicit selection through its own id on rebind", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();
    sync.onSelect("s1", { scrollIntoView: false });
    sync.onVideoSlide("s2");
    expect(sync.explicitSelectionId).toBe("s1");
    expect(sync.selectedStateId).toBe("s2");

    // The revision switch maps the explicit id separately; mapping the
    // derived selection onto it would resurrect the play button.
    sync.rebind("t2", "t2", { explicitSelectionId: "t1" });
    expect(sync.explicitSelectionId).toBe("t1");
    expect(sync.selectedStateId).toBe("t2");

    // Without a mapped counterpart the explicit selection is dropped.
    sync.rebind("u2", "u2", {});
    expect(sync.explicitSelectionId).toBeUndefined();
  });

  it("keeps scroll geometry alive during non-slide interludes", async () => {
    const host = makeHost();
    const sync = new FollowSync(host, 120);
    sync.onVideoSlide("s1");
    await flush();
    expect(sync.stuck).toBe(true);

    // Interlude: no mapped slide, but the last video slide anchors geometry,
    // so a decisive scroll still unsticks and pauses following.
    sync.onVideoSlide(undefined);
    host.distances.set("s1", 800);
    host.fractions.set("s1", 0);
    sync.onUserScroll();
    expect(sync.stuck).toBe(false);
    expect(sync.pauseReason).toBe("scroll");

    // Scrolling the slide's lower half back in resumes during the interlude.
    host.fractions.set("s1", 0.5);
    sync.onUserScroll();
    expect(sync.following).toBe(true);
  });

  it("tracks the explicit selection separately from the derived one", async () => {
    const host = makeHost();
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    await flush();
    // Nothing was clicked yet: no explicit selection, although s1 is selected.
    expect(sync.selectedStateId).toBe("s1");
    expect(sync.explicitSelectionId).toBeUndefined();

    // Clicking the playing slide makes it explicit (play button may appear).
    sync.onSelect("s1", { scrollIntoView: false });
    expect(sync.explicitSelectionId).toBe("s1");
    expect(sync.selectedStateId).toBe("s1");

    // Once the video moves on, the mirrored selection is no longer explicit.
    sync.onVideoSlide("s2");
    expect(sync.selectedStateId).toBe("s2");
    expect(sync.explicitSelectionId).toBe("s1");

    // Playing from a slide consumes the explicit selection (the play button
    // disappears until the user selects a slide again).
    sync.onSelect("s3", { scrollIntoView: false });
    expect(sync.explicitSelectionId).toBe("s3");
    sync.onPlayFrom("s3");
    expect(sync.explicitSelectionId).toBeUndefined();
  });

  it("notifies the host on every meaningful change", () => {
    const host = makeHost();
    const spy = vi.spyOn(host, "stateChanged");
    const sync = new FollowSync(host);
    sync.onVideoSlide("s1");
    sync.onSelect("s2", { scrollIntoView: false });
    sync.onResumeButton();
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
