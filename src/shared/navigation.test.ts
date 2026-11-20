import { describe, expect, it } from "vitest";
import { isAllowedAppNavigation, isAllowedExternalUrl } from "./navigation";

const DEV = "http://localhost:5173/";
const PACKAGED = "file:///opt/app/resources/app.asar/out/renderer/index.html";

describe("isAllowedAppNavigation", () => {
  it("admits the exact dev document including query/hash variants", () => {
    expect(isAllowedAppNavigation("http://localhost:5173/", [DEV])).toBe(true);
    expect(isAllowedAppNavigation("http://localhost:5173/?x=1#y", [DEV])).toBe(
      true,
    );
  });

  it("rejects a different path, origin or scheme", () => {
    expect(isAllowedAppNavigation("http://localhost:5173/evil", [DEV])).toBe(
      false,
    );
    expect(isAllowedAppNavigation("http://localhost:5174/", [DEV])).toBe(false);
    expect(isAllowedAppNavigation("https://evil.example/", [DEV])).toBe(false);
    expect(isAllowedAppNavigation("file:///etc/passwd", [DEV])).toBe(false);
  });

  it("only admits the bundled file when packaged", () => {
    expect(isAllowedAppNavigation(PACKAGED, [PACKAGED])).toBe(true);
    expect(
      isAllowedAppNavigation(
        "file:///opt/app/resources/app.asar/out/renderer/welcome.html",
        [PACKAGED],
      ),
    ).toBe(false);
    expect(isAllowedAppNavigation("file:///etc/passwd", [PACKAGED])).toBe(
      false,
    );
  });

  it("rejects javascript/data/about and malformed URLs", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "about:blank",
      "not a url",
      "",
    ]) {
      expect(isAllowedAppNavigation(bad, [DEV])).toBe(false);
      expect(isAllowedExternalUrl(bad)).toBe(false);
    }
  });
});

describe("isAllowedExternalUrl", () => {
  it("admits http, https and local file URLs", () => {
    expect(isAllowedExternalUrl("https://example.com/a")).toBe(true);
    expect(isAllowedExternalUrl("http://127.0.0.1:8080/x")).toBe(true);
    expect(isAllowedExternalUrl("file:///tmp/panel.html")).toBe(true);
  });

  it("rejects privileged and non-web schemes", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "chrome://settings",
      "devtools://devtools",
      "vbscript:msgbox",
    ]) {
      expect(isAllowedExternalUrl(bad)).toBe(false);
    }
  });
});
