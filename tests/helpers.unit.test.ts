import { describe, expect, it } from "vitest";
import {
  clampInt,
  mockEnabled,
  sanitizeAvatarUrl,
  sanitizeUserText,
  shouldAcceptMockAuth,
  FLOW_COOKIE,
} from "../src/security";
import {
  affiliationUserIds,
  companyFromAffiliation,
  parseAuthIntent,
} from "../src/x-oauth";

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

describe("sanitizeUserText", () => {
  it("strips HTML/script markup so it cannot execute", () => {
    // Tag contents remain as inert plain text (client uses createTextNode)
    expect(sanitizeUserText("<script>alert(1)</script>hi", 200)).toBe(
      "alert(1) hi",
    );
    expect(sanitizeUserText("hello <b>world</b>", 200)).toBe("hello world");
    expect(sanitizeUserText("a <img onerror=x> b", 200)).toBe("a b");
  });

  it("strips URLs and link forms", () => {
    expect(
      sanitizeUserText("see https://evil.com/phish now", 200),
    ).toBe("see now");
    expect(sanitizeUserText("go www.spam.example/x", 200)).toBe("go");
    expect(
      sanitizeUserText("click [here](https://evil.com)", 200),
    ).toBe("click here");
    // Scheme removed; leftover is inert text
    expect(sanitizeUserText("javascript:alert(1)", 200)).toBe("alert(1)");
  });

  it("keeps normal prose and newlines", () => {
    expect(sanitizeUserText("Ship fast.\n\nPrice fairly.", 200)).toBe(
      "Ship fast.\n\nPrice fairly.",
    );
  });

  it("enforces max length", () => {
    expect(sanitizeUserText("abcdef", 3)).toBe("abc");
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

describe("parseAuthIntent", () => {
  it("only accepts edit when explicitly requested", () => {
    expect(parseAuthIntent("edit")).toBe("edit");
    expect(parseAuthIntent("sign")).toBe("sign");
    expect(parseAuthIntent("DELETE")).toBe("sign");
    expect(parseAuthIntent(undefined)).toBe("sign");
  });
});

describe("companyFromAffiliation", () => {
  it("returns null when there is no affiliation", () => {
    expect(companyFromAffiliation(null)).toEqual({
      company: null,
      companyHandle: null,
    });
    expect(companyFromAffiliation(undefined, [])).toEqual({
      company: null,
      companyHandle: null,
    });
  });

  it("uses expanded org account name and handle", () => {
    expect(
      companyFromAffiliation(
        { user_id: ["123"], description: "fallback" },
        [{ id: "123", name: "OpenAI", username: "OpenAI" }],
      ),
    ).toEqual({ company: "OpenAI", companyHandle: "OpenAI" });
  });

  it("accepts legacy single user_id string", () => {
    expect(affiliationUserIds("99")).toEqual(["99"]);
    expect(
      companyFromAffiliation(
        { user_id: "99" },
        [{ id: "99", name: "xAI", username: "xai" }],
      ),
    ).toEqual({ company: "xAI", companyHandle: "xai" });
  });

  it("falls back to affiliation description", () => {
    expect(
      companyFromAffiliation({ description: "  Anthropic  ", user_id: [] }),
    ).toEqual({ company: "Anthropic", companyHandle: null });
  });
});
