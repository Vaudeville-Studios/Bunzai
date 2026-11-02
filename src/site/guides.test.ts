/** Guide URLs resolve to stable, non-colliding slugs. */
import { expect, test } from "bun:test";
import { guideSlug } from "./guides";
import { sitePages } from "./pages";

test("former guide URLs map to stable, non-colliding slugs", () => {
  expect(guideSlug("docs/guide/lorebooks.md")).toBe("lorebooks");
  expect(guideSlug("docs/guide/platforms/risu.md")).toBe("platforms-risu");
  expect(guideSlug("docs/guide/README.md")).toBe("index");
  expect(guideSlug("docs/guide/platforms/README.md")).toBe("platforms");
  expect(guideSlug("docs/reference/ui.md")).toBeNull();
});

test("former guide URLs remain useful redirects into the canonical Docs route", () => {
  const pages = sitePages([{ slug: "getting-started", id: "guide/getting-started", title: "Get started", summary: "Install Bunzai." }]);
  const redirect = pages.find((page) => page.path === "guides/getting-started.html")!.html;
  expect(redirect).toContain('href="/Bunzai/docs/guide/getting-started.html"');
  expect(redirect).toContain('location.replace("/Bunzai/docs/guide/getting-started.html"+location.hash)');
});
