/**
 * Minimal polyfills for the newest JavaScript features that the pinned
 * pdfjs-dist 6 build assumes (it targets very recent engines). Students'
 * browsers are often a year or more behind, so the lecture bundle installs
 * these guarded shims before pdf.js evaluates — both on the main thread
 * (imported first from index.ts) and inside the PDF worker (pdf-worker.ts).
 *
 * Covered, only when missing (the complete modern-API surface of the pinned
 * build, found by grepping pdf.mjs and pdf.worker.mjs):
 * - globalThis.Iterator bound to the real %IteratorPrototype% intrinsic
 *   (pdf.js patches Iterator.prototype.join at module init);
 * - Map/WeakMap getOrInsert and getOrInsertComputed (map-upsert proposal);
 * - Promise.try and Promise.withResolvers;
 * - Uint8Array toHex/toBase64 and Uint8Array.fromBase64;
 * - Math.sumPrecise;
 * - Set.prototype.intersection.
 * Float16Array is feature-detected by pdf.js itself and needs no shim.
 */

type UpsertMap = Map<unknown, unknown> | WeakMap<object, unknown>;

function define(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, {
    value,
    writable: true,
    enumerable: false,
    configurable: true
  });
}

export function installRuntimeCompat(scope: typeof globalThis = globalThis): void {
  const globals = scope as unknown as Record<string, unknown>;
  if (typeof globals["Iterator"] === "undefined") {
    const iteratorPrototype = Object.getPrototypeOf(
      Object.getPrototypeOf([][Symbol.iterator]())
    ) as object;
    const IteratorShim = function Iterator(this: unknown) {
      throw new TypeError("Iterator is not directly constructable");
    };
    IteratorShim.prototype = iteratorPrototype;
    define(scope, "Iterator", IteratorShim);
  }

  for (const constructor of [scope.Map, scope.WeakMap]) {
    const prototype = constructor?.prototype as (UpsertMap & Record<string, unknown>) | undefined;
    if (!prototype) continue;
    if (typeof prototype["getOrInsert"] !== "function") {
      define(prototype, "getOrInsert", function getOrInsert(
        this: UpsertMap,
        key: never,
        defaultValue: unknown
      ) {
        if (this.has(key)) return this.get(key);
        this.set(key, defaultValue);
        return defaultValue;
      });
    }
    if (typeof prototype["getOrInsertComputed"] !== "function") {
      define(prototype, "getOrInsertComputed", function getOrInsertComputed(
        this: UpsertMap,
        key: never,
        callback: (key: unknown) => unknown
      ) {
        if (typeof callback !== "function") {
          throw new TypeError("getOrInsertComputed expects a callback function");
        }
        if (this.has(key)) return this.get(key);
        const value = callback(key);
        this.set(key, value);
        return value;
      });
    }
  }

  const promiseConstructor = scope.Promise as PromiseConstructor & Record<string, unknown>;
  if (typeof promiseConstructor["try"] !== "function") {
    define(promiseConstructor, "try", function promiseTry(
      this: PromiseConstructor | undefined,
      callback: (...args: unknown[]) => unknown,
      ...args: unknown[]
    ) {
      const Constructor = typeof this === "function" ? this : promiseConstructor;
      return new Constructor((resolve) => {
        resolve(callback(...args));
      });
    });
  }
  if (typeof promiseConstructor["withResolvers"] !== "function") {
    define(promiseConstructor, "withResolvers", function withResolvers(
      this: PromiseConstructor | undefined
    ) {
      const Constructor = typeof this === "function" ? this : promiseConstructor;
      let resolve!: (value: unknown) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Constructor((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    });
  }

  const uint8Prototype = scope.Uint8Array.prototype as unknown as Record<string, unknown>;
  if (typeof uint8Prototype["toHex"] !== "function") {
    define(uint8Prototype, "toHex", function toHex(this: Uint8Array) {
      let output = "";
      for (const byte of this) output += byte.toString(16).padStart(2, "0");
      return output;
    });
  }
  if (typeof uint8Prototype["toBase64"] !== "function") {
    define(uint8Prototype, "toBase64", function toBase64(
      this: Uint8Array,
      options?: { alphabet?: string; omitPadding?: boolean }
    ) {
      let binary = "";
      for (const byte of this) binary += String.fromCharCode(byte);
      let encoded = scope.btoa(binary);
      if (options?.alphabet === "base64url") {
        encoded = encoded.replace(/\+/g, "-").replace(/\//g, "_");
      }
      if (options?.omitPadding) encoded = encoded.replace(/=+$/, "");
      return encoded;
    });
  }
  const uint8Constructor = scope.Uint8Array as unknown as Record<string, unknown>;
  if (typeof uint8Constructor["fromBase64"] !== "function") {
    define(scope.Uint8Array, "fromBase64", function fromBase64(
      encoded: string,
      options?: { alphabet?: string }
    ) {
      const normalized = options?.alphabet === "base64url"
        ? encoded.replace(/-/g, "+").replace(/_/g, "/")
        : encoded;
      const binary = scope.atob(normalized);
      const bytes = new scope.Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    });
  }

  const mathRecord = scope.Math as unknown as Record<string, unknown>;
  if (typeof mathRecord["sumPrecise"] !== "function") {
    define(scope.Math, "sumPrecise", function sumPrecise(values: Iterable<number>) {
      // Neumaier-compensated summation; empty input yields -0 per the proposal.
      let sum = -0;
      let compensation = 0;
      let any = false;
      for (const value of values) {
        if (typeof value !== "number") {
          throw new TypeError("Math.sumPrecise expects only numbers");
        }
        any = true;
        const candidate = sum + value;
        compensation += Math.abs(sum) >= Math.abs(value)
          ? sum - candidate + value
          : value - candidate + sum;
        sum = candidate;
      }
      return any ? sum + compensation : -0;
    });
  }

  const setPrototype = scope.Set.prototype as unknown as Record<string, unknown>;
  if (typeof setPrototype["intersection"] !== "function") {
    define(setPrototype, "intersection", function intersection(
      this: Set<unknown>,
      other: { has(value: unknown): boolean }
    ) {
      const result = new scope.Set<unknown>();
      for (const value of this) {
        if (other.has(value)) result.add(value);
      }
      return result;
    });
  }
}

installRuntimeCompat();
