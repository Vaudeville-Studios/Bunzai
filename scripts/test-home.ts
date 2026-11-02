/** Owns temporary test BUNZAI_HOME changes and restoration of the prior value. */
export function useTestBunzaiHome(home: string): () => void {
  const previous = process.env["BUNZAI_HOME"];
  process.env["BUNZAI_HOME"] = home;
  return () => {
    if (previous === undefined) delete process.env["BUNZAI_HOME"];
    else process.env["BUNZAI_HOME"] = previous;
  };
}
