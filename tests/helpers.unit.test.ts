import { describe, expect, it } from "vitest";
import {
  clampInt,
  mockEnabled,
  sanitizeAvatarUrl,
  shouldAcceptMockAuth,
  FLOW_COOKIE,
} from "../src/security";

describe("clampInt", () => {
  it("rejects negative limit bypass and non-integers", () => {
    expect(clampInt("-1", 50, 1, 200)).toBe(1);
    expect(clampInt("999", 50, 1, 200)).toBe(200);
    expect(clampInt("NaN", 50, 1, 200)).toBe(50);
    expect(clampInt("40.5", 50, 1, 200)).toBe(50);
    expect(clampInt("40", 50, 1, 200)).toBe(40);
    expect(clampInt(undefined, 50, 1, 200)).toBe(50);
  });
});

describe("sanitizeAvatarUrl", () => {
  it("allows only https twimg hosts", () => {
    expect(
      sanitizeAvatarUrl("https://pbs.twimg.com/profile_images/x.jpg"),
    ).toBe("https://pbs.twimg.com/profile_images/x.jpg");
    expect(sanitizeAvatarUrl("http://pbs.twimg.com/x.jpg")).toBeNull();
    expect(sanitizeAvatarUrl("https://evil.com/x.jpg")).toBeNull();
    expect(sanitizeAvatarUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("mock auth policy", () => {
  it("rejects mock when X_DEV_MOCK is not 1", () => {
    expect(shouldAcceptMockAuth({ X_DEV_MOCK: "0" }, "mock", undefined)).toBe(
      false,
    );
    expect(shouldAcceptMockAuth({ X_DEV_MOCK: "0" }, "abc", "1")).toBe(false);
    expect(shouldAcceptMockAuth({}, "mock", "1")).toBe(false);
    expect(shouldAcceptMockAuth({ X_DEV_MOCK: "1" }, "mock", undefined)).toBe(
      true,
    );
    expect(mockEnabled({ X_DEV_MOCK: "0" })).toBe(false);
  });
});

describe("flow cookie", () => {
  it("uses a namespaced cookie name", () => {
    expect(FLOW_COOKIE.startsWith("dptf_")).toBe(true);
  });
});
