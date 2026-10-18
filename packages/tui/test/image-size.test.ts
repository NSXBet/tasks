import { describe, expect, test } from "bun:test";
import { DEFAULT_IMAGE_SIZE, fittedImageCells, parseImageSize, resolveImageSize } from "../src/store.js";

describe("parseImageSize", () => {
  test("parses WxH with case-insensitive separator", () => {
    expect(parseImageSize("44x18")).toEqual({ width: 44, height: 18 });
    expect(parseImageSize(" 36X14 ")).toEqual({ width: 36, height: 14 });
  });

  test("rejects malformed or non-positive sizes", () => {
    expect(parseImageSize("36")).toBeNull();
    expect(parseImageSize("axb")).toBeNull();
    expect(parseImageSize("0x14")).toBeNull();
    expect(parseImageSize("36x-1")).toBeNull();
  });
});

describe("resolveImageSize", () => {
  test("flag beats config beats default", () => {
    const config = { width: 50, height: 20 };
    const flag = { width: 10, height: 5 };
    expect(resolveImageSize(flag, config)).toEqual(flag);
    expect(resolveImageSize(null, config)).toEqual(config);
    expect(resolveImageSize(null, undefined)).toEqual(DEFAULT_IMAGE_SIZE);
  });
});

describe("fittedImageCells", () => {
  const box = { width: 36, height: 14 };

  test("square source fills height, half-block pixels stay square", () => {
    // 100×100 source: display aspect 2:1 (w/h × cellAspect 2) → 28×14 fills height.
    expect(fittedImageCells(100, 100, box)).toEqual({ width: 28, height: 14 });
  });

  test("16:9 screenshot fits width", () => {
    // 1600×900: display aspect 32:9 ≈ 3.556 → width-limited at 36 → 36×10.125 → 10.
    expect(fittedImageCells(1600, 900, box)).toEqual({ width: 36, height: 10 });
  });

  test("tall portrait source fits height", () => {
    // 100×400: display aspect 0.5 → height-limited at 14 → 7×14.
    expect(fittedImageCells(100, 400, box)).toEqual({ width: 7, height: 14 });
  });

  test("source larger than box clamps, never exceeds", () => {
    const result = fittedImageCells(8000, 4400, box);
    expect(result.width).toBeLessThanOrEqual(box.width);
    expect(result.height).toBeLessThanOrEqual(box.height);
  });

  test("degenerate source yields one cell", () => {
    expect(fittedImageCells(0, 100, box)).toEqual({ width: 1, height: 1 });
  });

  test("tiny source upscales like OpenTUI fit (never below one cell)", () => {
    expect(fittedImageCells(1, 1, box)).toEqual({ width: 28, height: 14 });
    expect(fittedImageCells(4, 4, { width: 36, height: 14 })).toEqual({ width: 28, height: 14 });
  });
});
