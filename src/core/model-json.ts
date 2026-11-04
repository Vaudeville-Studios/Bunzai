/** Reading one structured answer out of a model reply, shared by every feature that asks a model for JSON. */
/** The JSON object in a model's text: the whole text, a fenced block, or the outermost braces. */
export function extractObject(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  for (const candidate of [body, body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1)]) {
    try { return JSON.parse(candidate); } catch { /* try the next shape */ }
  }
  return undefined;
}
