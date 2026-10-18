import { describe, expect, test } from "bun:test";
import { DEFAULT_IMAGE_SIZE, parseImageSize, resolveImageSize } from "../src/store.js";

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
