import { describe, it, expect } from "vitest";
import { splicePageNumbers } from "@/lib/spliceNumbering";

const item = (id, pageCount, excluded = []) => ({ id, pageCount, excludedPages: new Set(excluded) });
const master = (result) => [...result.master.values()];
const range = (result, id) => result.inserts.get(id);

describe("splicePageNumbers", () => {
  it("numbers an untouched master 1..n", () => {
    const r = splicePageNumbers(3, {});
    expect(master(r)).toEqual([1, 2, 3]);
    expect([...r.master.keys()]).toEqual([0, 1, 2]);
  });

  it("gives an insert before the first page the first numbers", () => {
    const r = splicePageNumbers(2, { 0: [item("a", 2)] });
    expect(range(r, "a")).toEqual({ start: 1, end: 2 });
    expect(master(r)).toEqual([3, 4]);
  });

  it("gives an insert after the last page the last numbers", () => {
    const r = splicePageNumbers(2, { 2: [item("a", 1)] });
    expect(master(r)).toEqual([1, 2]);
    expect(range(r, "a")).toEqual({ start: 3, end: 3 });
  });

  it("numbers several files at one gap in queue order", () => {
    const r = splicePageNumbers(1, { 1: [item("a", 2), item("b", 3)] });
    expect(range(r, "a")).toEqual({ start: 2, end: 3 });
    expect(range(r, "b")).toEqual({ start: 4, end: 6 });
  });

  it("an excluded master page does not advance the count", () => {
    const r = splicePageNumbers(3, {}, new Set([2]));
    expect(master(r)).toEqual([1, 2, 2]);
  });

  it("an excluded master page shows the number its successor takes", () => {
    const r = splicePageNumbers(3, { 1: [item("a", 1)] }, new Set([1]));
    // page 1 excluded, insert a, page 2, page 3
    expect(master(r)).toEqual([1, 2, 3]);
    expect(range(r, "a")).toEqual({ start: 1, end: 1 });
  });

  it("a trailing excluded master page shows one past the last page", () => {
    const r = splicePageNumbers(2, {}, new Set([2]));
    expect(master(r)).toEqual([1, 2]);
  });

  it("an insert's excluded pages shorten its range", () => {
    const r = splicePageNumbers(1, { 0: [item("a", 4, [1, 3])] });
    expect(range(r, "a")).toEqual({ start: 1, end: 2 });
    expect(master(r)).toEqual([3]);
  });

  it("an insert with every page excluded has an empty range at the next number", () => {
    const r = splicePageNumbers(1, { 0: [item("a", 2, [1, 2])] });
    expect(range(r, "a")).toEqual({ start: 1, end: 0 });
    expect(master(r)).toEqual([1]);
  });

  it("the last number equals the number of pages exported", () => {
    const inserts = { 0: [item("a", 3, [2])], 2: [item("b", 2)], 4: [item("c", 1, [1])] };
    const excluded = new Set([1, 4]);
    const r = splicePageNumbers(4, inserts, excluded);
    const exported = 4 - excluded.size + (3 - 1) + 2 + 0;
    // order: a (1-2), page 1 excluded, page 2 (3), b (4-5), page 3 (6), page 4 excluded, c empty
    expect(master(r)).toEqual([3, 3, 6, 7]);
    expect(range(r, "b")).toEqual({ start: 4, end: 5 });
    const highest = Math.max(
      ...[...r.master].filter(([i]) => !excluded.has(i + 1)).map(([, n]) => n),
      ...[...r.inserts.values()].map((x) => x.end)
    );
    expect(highest).toBe(exported);
  });

  it("treats a file without an excludedPages set as keeping every page", () => {
    const r = splicePageNumbers(1, { 0: [{ id: "a", pageCount: 2 }] });
    expect(range(r, "a")).toEqual({ start: 1, end: 2 });
  });
});
