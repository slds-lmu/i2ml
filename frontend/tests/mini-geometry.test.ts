import { describe, expect, it } from "vitest";

import {
  MINI_MIN_WIDTH,
  clampMini,
  maxMiniWidth,
  miniFrameHeight,
  moveMini,
  resizeMini
} from "../src/mini-geometry";

const BAR = 28;
const VIEW = { width: 800, height: 600 };

describe("mini-player geometry", () => {
  it("keeps the 16:9 video ratio with the bar as extra height", () => {
    expect(miniFrameHeight(320, BAR)).toBeCloseTo(320 * 9 / 16 + BAR);
  });

  it("anchors the untouched edge when resizing from a side", () => {
    const rect = { left: 100, top: 50, width: 320 };
    const fromRight = resizeMini(rect, 400, "left", BAR, VIEW);
    expect(fromRight.left).toBe(100); // left edge pinned
    expect(fromRight.width).toBe(400);

    const fromLeft = resizeMini(rect, 400, "right", BAR, VIEW);
    expect(fromLeft.left + fromLeft.width).toBeCloseTo(100 + 320); // right edge pinned
    expect(fromLeft.width).toBe(400);

    const pinch = resizeMini(rect, 400, "center", BAR, VIEW);
    expect(pinch.left + pinch.width / 2).toBeCloseTo(100 + 320 / 2); // center pinned
  });

  it("grows downwards near the top of the viewport and upwards near the bottom", () => {
    const nearTop = { left: 100, top: 20, width: 320 };
    const grownDown = resizeMini(nearTop, 420, "left", BAR, VIEW);
    expect(grownDown.top).toBe(20); // top pinned, grows down

    const height = miniFrameHeight(320, BAR);
    const nearBottom = { left: 100, top: VIEW.height - height - 20, width: 320 };
    const grownUp = resizeMini(nearBottom, 420, "left", BAR, VIEW);
    const oldBottom = nearBottom.top + height;
    expect(grownUp.top + miniFrameHeight(420, BAR)).toBeCloseTo(oldBottom); // bottom pinned
  });

  it("clamps size and position into the viewport", () => {
    const rect = { left: 700, top: 500, width: 320 };
    const clamped = clampMini(rect, BAR, VIEW);
    expect(clamped.left + clamped.width).toBeLessThanOrEqual(VIEW.width - 8);
    expect(clamped.top + miniFrameHeight(clamped.width, BAR)).toBeLessThanOrEqual(VIEW.height - 8);
    expect(clamped.left).toBeGreaterThanOrEqual(8);
    expect(clamped.top).toBeGreaterThanOrEqual(8);
  });

  it("clamps the default dock width on viewports narrower than the 320px seed", () => {
    // First dock on a narrow phone (e.g. Galaxy Fold cover screen): the
    // seeded 320px rect must shrink to fit instead of overflowing the edge.
    const clamped = clampMini({ left: 12, top: 99_999, width: 320 }, BAR, {
      width: 280,
      height: 653
    });
    expect(clamped.width).toBe(280 - 16);
    expect(clamped.left).toBe(8);
    expect(clamped.left + clamped.width).toBeLessThanOrEqual(280 - 8);
    // And it never goes below the resize minimum.
    expect(clampMini({ left: 0, top: 0, width: 40 }, BAR, VIEW).width).toBe(MINI_MIN_WIDTH);
  });

  it("enforces the minimum and viewport-derived maximum width", () => {
    const rect = { left: 100, top: 100, width: 320 };
    expect(resizeMini(rect, 40, "left", BAR, VIEW).width).toBe(MINI_MIN_WIDTH);

    const short = { width: 800, height: 300 };
    const grown = resizeMini(rect, 5000, "left", BAR, short);
    expect(grown.width).toBeLessThanOrEqual(maxMiniWidth(short, BAR));
    // Height (video + bar) still fits the short viewport.
    expect(miniFrameHeight(grown.width, BAR)).toBeLessThanOrEqual(short.height - 16);
  });

  it("moves with clamping", () => {
    const rect = { left: 100, top: 100, width: 320 };
    const moved = moveMini(rect, -500, 5000, BAR, VIEW);
    expect(moved.left).toBe(8);
    expect(moved.top + miniFrameHeight(320, BAR)).toBeLessThanOrEqual(VIEW.height - 8);
  });
});
