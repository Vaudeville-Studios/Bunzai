/** Purpose: verify the host-owned effect review renders bounded semantic details without guest markup. */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EffectReview } from "./effect-review";

test("effect review renders host-projected values as text, never markup", () => {
  const html = renderToStaticMarkup(<EffectReview value={{ changed: ["name", "description"], destination: "https://example.test/send", label: "<script>bad()</script>" }} />);
  expect(html).toContain("changed"); expect(html).toContain("https://example.test/send");
  expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;"); expect(html).not.toContain("<script>");
});
