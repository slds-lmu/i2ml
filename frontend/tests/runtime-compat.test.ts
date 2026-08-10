import { afterAll, describe, expect, it } from "vitest";

import { installRuntimeCompat } from "../src/runtime-compat";

type Mutable = Record<string, unknown>;

const globalRecord = globalThis as unknown as Mutable;
const mapProto = Map.prototype as unknown as Mutable;
const weakMapProto = WeakMap.prototype as unknown as Mutable;
const promiseRecord = Promise as unknown as Mutable;
const uint8Proto = Uint8Array.prototype as unknown as Mutable;
const uint8Record = Uint8Array as unknown as Mutable;
const mathRecord = Math as unknown as Mutable;
const setProto = Set.prototype as unknown as Mutable;

const removable = [
  [globalRecord, "Iterator"],
  [mapProto, "getOrInsert"],
  [mapProto, "getOrInsertComputed"],
  [weakMapProto, "getOrInsert"],
  [weakMapProto, "getOrInsertComputed"],
  [promiseRecord, "try"],
  [promiseRecord, "withResolvers"],
  [uint8Proto, "toHex"],
  [uint8Proto, "toBase64"],
  [uint8Record, "fromBase64"],
  [mathRecord, "sumPrecise"],
  [setProto, "intersection"]
] as const;

const saved = removable.map(([target, name]) => [target, name, target[name]] as const);

function removeAll(): void {
  for (const [target, name] of removable) delete target[name];
}

afterAll(() => {
  for (const [target, name, value] of saved) {
    if (value === undefined) delete target[name];
    else target[name] = value;
  }
});

describe("runtime compatibility shims for pdf.js 6", () => {
  it("provides map upsert helpers with insert-once semantics", () => {
    removeAll();
    installRuntimeCompat();

    const map = new Map<string, number[]>() as Map<string, number[]> & {
      getOrInsert(key: string, value: number[]): number[];
      getOrInsertComputed(key: string, callback: (key: string) => number[]): number[];
    };
    const inserted = map.getOrInsert("a", [1]);
    expect(inserted).toEqual([1]);
    expect(map.getOrInsert("a", [2])).toBe(inserted);

    let calls = 0;
    const computed = map.getOrInsertComputed("b", (key) => {
      calls += 1;
      expect(key).toBe("b");
      return [3];
    });
    expect(computed).toEqual([3]);
    expect(map.getOrInsertComputed("b", () => [4])).toBe(computed);
    expect(calls).toBe(1);
    expect(() =>
      (map as unknown as { getOrInsertComputed(key: string, cb: unknown): unknown })
        .getOrInsertComputed("c", "not a function")
    ).toThrow(TypeError);

    const weak = new WeakMap<object, string>() as WeakMap<object, string> & {
      getOrInsertComputed(key: object, callback: () => string): string;
    };
    const key = {};
    expect(weak.getOrInsertComputed(key, () => "x")).toBe("x");
    expect(weak.getOrInsertComputed(key, () => "y")).toBe("x");
  });

  it("binds a global Iterator to the real intrinsic so pdf.js can patch it", () => {
    removeAll();
    installRuntimeCompat();

    const iterator = globalRecord["Iterator"] as { prototype: Mutable };
    expect(typeof iterator).toBe("function");
    // pdf.js does: Iterator.prototype.join = ... — verify that reaches native iterators.
    iterator.prototype["testJoin"] = function (this: Iterable<unknown>) {
      return [...this].join("-");
    };
    const nativeIterator = ["a", "b"][Symbol.iterator]() as unknown as Mutable;
    expect((nativeIterator["testJoin"] as () => string).call(nativeIterator)).toBe("a-b");
    delete iterator.prototype["testJoin"];
  });

  it("provides Promise.try capturing synchronous throws as rejections", async () => {
    removeAll();
    installRuntimeCompat();

    const promiseTry = promiseRecord["try"] as (
      callback: (...args: unknown[]) => unknown,
      ...args: unknown[]
    ) => Promise<unknown>;
    await expect(promiseTry.call(Promise, (value: unknown) => value, 7)).resolves.toBe(7);
    await expect(
      promiseTry.call(Promise, () => {
        throw new Error("sync failure");
      })
    ).rejects.toThrow("sync failure");
  });

  it("provides Uint8Array hex and base64 conversions", () => {
    removeAll();
    installRuntimeCompat();

    const bytes = new Uint8Array([0, 15, 255, 66]) as Uint8Array & {
      toHex(): string;
      toBase64(options?: { alphabet?: string; omitPadding?: boolean }): string;
    };
    expect(bytes.toHex()).toBe("000fff42");
    expect(bytes.toBase64()).toBe("AA//Qg==");
    expect(bytes.toBase64({ alphabet: "base64url", omitPadding: true })).toBe("AA__Qg");
    const fromBase64 = (Uint8Array as unknown as {
      fromBase64(encoded: string, options?: { alphabet?: string }): Uint8Array;
    }).fromBase64;
    expect([...fromBase64("AA//Qg==")]).toEqual([0, 15, 255, 66]);
    expect([...fromBase64("AA__Qg", { alphabet: "base64url" })]).toEqual([0, 15, 255, 66]);
  });

  it("provides Math.sumPrecise, Promise.withResolvers, and Set.intersection", async () => {
    removeAll();
    installRuntimeCompat();

    const sumPrecise = mathRecord["sumPrecise"] as (values: Iterable<number>) => number;
    expect(sumPrecise([1e100, 1, -1e100])).toBe(1);
    expect(Object.is(sumPrecise([]), -0)).toBe(true);

    const withResolvers = promiseRecord["withResolvers"] as () => {
      promise: Promise<unknown>;
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
    };
    const deferred = withResolvers.call(Promise);
    deferred.resolve("done");
    await expect(deferred.promise).resolves.toBe("done");

    const set = new Set([1, 2, 3]) as Set<number> & {
      intersection(other: Set<number>): Set<number>;
    };
    expect([...set.intersection(new Set([2, 3, 4]))]).toEqual([2, 3]);
  });

  it("does not replace native implementations when present", () => {
    removeAll();
    const marker = () => "native";
    mapProto["getOrInsertComputed"] = marker;
    installRuntimeCompat();
    expect(mapProto["getOrInsertComputed"]).toBe(marker);
  });
});
