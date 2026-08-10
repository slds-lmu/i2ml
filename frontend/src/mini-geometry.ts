/**
 * Pure geometry for the floating mini-player: a 16:9 video area with a drag
 * bar below it (the bar is not part of the aspect ratio). Resizing keeps the
 * ratio and keeps the window inside the viewport: horizontally it grows away
 * from the dragged edge; vertically it grows downwards while the window sits
 * in the upper half of the viewport and upwards in the lower half.
 */

export interface MiniRect {
  left: number;
  top: number;
  width: number;
}

export interface MiniViewport {
  width: number;
  height: number;
}

export type MiniAnchor = "left" | "right" | "center";

export const MINI_MARGIN = 8;
export const MINI_MIN_WIDTH = 180;

/** Total frame height for a given width: 16:9 video plus the control bar. */
export function miniFrameHeight(width: number, barHeight: number): number {
  return (width * 9) / 16 + barHeight;
}

export function maxMiniWidth(viewport: MiniViewport, barHeight: number, margin = MINI_MARGIN): number {
  const byWidth = viewport.width - 2 * margin;
  const byHeight = ((viewport.height - 2 * margin - barHeight) * 16) / 9;
  return Math.max(MINI_MIN_WIDTH, Math.min(byWidth, byHeight));
}

/**
 * Fits the rect into the viewport: the width is clamped into
 * [MINI_MIN_WIDTH, maxMiniWidth] (the default 320px dock must not overflow
 * narrow phones), then the whole frame (video + bar) is shifted inside.
 */
export function clampMini(
  rect: MiniRect,
  barHeight: number,
  viewport: MiniViewport,
  margin = MINI_MARGIN
): MiniRect {
  const width = Math.min(
    Math.max(rect.width, MINI_MIN_WIDTH),
    maxMiniWidth(viewport, barHeight, margin)
  );
  const height = miniFrameHeight(width, barHeight);
  const left = Math.min(Math.max(rect.left, margin), Math.max(margin, viewport.width - width - margin));
  const top = Math.min(Math.max(rect.top, margin), Math.max(margin, viewport.height - height - margin));
  return { left, top, width };
}

export function moveMini(
  rect: MiniRect,
  dx: number,
  dy: number,
  barHeight: number,
  viewport: MiniViewport,
  margin = MINI_MARGIN
): MiniRect {
  return clampMini({ ...rect, left: rect.left + dx, top: rect.top + dy }, barHeight, viewport, margin);
}

/**
 * Resize toward `targetWidth`, anchored horizontally at the given edge
 * (the edge opposite the dragged handle stays put; "center" for pinch and
 * top-edge drags) and vertically per the upper/lower-half rule.
 */
export function resizeMini(
  rect: MiniRect,
  targetWidth: number,
  horizontalAnchor: MiniAnchor,
  barHeight: number,
  viewport: MiniViewport,
  margin = MINI_MARGIN
): MiniRect {
  const width = Math.min(
    Math.max(targetWidth, MINI_MIN_WIDTH),
    maxMiniWidth(viewport, barHeight, margin)
  );
  const oldHeight = miniFrameHeight(rect.width, barHeight);
  const newHeight = miniFrameHeight(width, barHeight);
  let left = rect.left;
  if (horizontalAnchor === "right") left = rect.left + rect.width - width;
  else if (horizontalAnchor === "center") left = rect.left + (rect.width - width) / 2;
  const centerY = rect.top + oldHeight / 2;
  const growDown = centerY <= viewport.height / 2;
  const top = growDown ? rect.top : rect.top + oldHeight - newHeight;
  return clampMini({ left, top, width }, barHeight, viewport, margin);
}
