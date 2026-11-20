import { describe, expect, it } from "vitest";
import { normalizeProxyHost } from "./network";

describe("normalizeProxyHost", () => {
  it("accepts bare hosts, base URLs, ports and localhost", () => {
    expect(normalizeProxyHost("ghfast.top")).toBe("ghfast.top");
    expect(normalizeProxyHost("https://ghfast.top")).toBe("https://ghfast.top");
    expect(normalizeProxyHost(" https://ghfast.top/ ")).toBe(
      "https://ghfast.top",
    );
    expect(normalizeProxyHost("http://localhost:8080")).toBe(
      "http://localhost:8080",
    );
    expect(normalizeProxyHost("localhost")).toBe("localhost");
    expect(normalizeProxyHost("127.0.0.1:9000")).toBe("127.0.0.1:9000");
  });

  it("rejects blank, malformed and single-label input", () => {
    expect(normalizeProxyHost("")).toBeNull();
    expect(normalizeProxyHost("   ")).toBeNull();
    expect(normalizeProxyHost("gh fast.top")).toBeNull();
    expect(normalizeProxyHost("mirror")).toBeNull();
    expect(normalizeProxyHost("javascript:alert(1)")).toBeNull();
  });
});
