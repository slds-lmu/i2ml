import { vi } from "vitest";

// pdfjs-dist 6 targets Node 22, while the project's browser build is currently
// verified from Node 20. Its module initialization only needs this constructor
// so it can install an iterator helper during DOM-only unit tests.
if (!("Iterator" in globalThis)) {
  Object.defineProperty(globalThis, "Iterator", {
    configurable: true,
    value: class IteratorStub {}
  });
}
if (!("DOMMatrix" in globalThis)) {
  Object.defineProperty(globalThis, "DOMMatrix", {
    configurable: true,
    value: class DOMMatrixStub {}
  });
}

class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0];
  disconnect = vi.fn();
  observe = vi.fn();
  takeRecords = vi.fn(() => []);
  unobserve = vi.fn();
}

class ResizeObserverStub implements ResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn()
}));
if (!globalThis.CSS) vi.stubGlobal("CSS", {});
if (!globalThis.CSS.escape) globalThis.CSS.escape = (value: string) => value.replace(/[^\w-]/g, "\\$&");
