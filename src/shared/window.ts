// Zoom arithmetic on time windows, shared by the host (which builds the zoomed timeline) and the
// webview (which previews it while the host works).
import type { TimeWindow } from './protocol';

/** Zooming in stops here: below it, a column holds a request or two. */
export const MIN_WINDOW_MS = 30 * 60_000;

/** A window kept within the range and at least `MIN_WINDOW_MS` long, its length kept if it fits. */
export function clampWindow(window: TimeWindow, extent: TimeWindow): TimeWindow {
  const span = Math.min(Math.max(window.to - window.from, MIN_WINDOW_MS), extent.to - extent.from);
  const from = Math.min(Math.max(window.from, extent.from), extent.to - span);
  return { from, to: from + span };
}

/** The window `factor` times as long, with `center` staying where it is on screen. */
export function scaleWindow(window: TimeWindow, factor: number, center: number): TimeWindow {
  return {
    from: center - (center - window.from) * factor,
    to: center + (window.to - center) * factor,
  };
}

export function shiftWindow(window: TimeWindow, by: number): TimeWindow {
  return { from: window.from + by, to: window.to + by };
}

/** Whether the window shows all of the range, so there is nothing to zoom out to. */
export function coversExtent(window: TimeWindow, extent: TimeWindow): boolean {
  return window.from <= extent.from && window.to >= extent.to;
}
