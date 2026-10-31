/** Purpose: cap concurrent Terminal regex workers across every extension runtime in this process. */
export function createRegexWorkerAdmission(limit: number) {
  let active = 0;
  return {
    acquire(): (() => void) | null {
      if (active >= limit) return null;
      active += 1;
      let released = false;
      return () => { if (!released) { released = true; active -= 1; } };
    },
    active: () => active,
  };
}

export const terminalRegexWorkerAdmission = createRegexWorkerAdmission(4);
