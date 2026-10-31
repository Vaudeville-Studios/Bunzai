/** Shared write-condition predicate for the synchronous in-memory document backend. */
import type { DocumentRow, WriteCondition } from "../../contracts/content-store";

export function conditionHolds(current: DocumentRow | undefined, retired: boolean, condition: WriteCondition): boolean {
  switch (condition.when) {
    case "absent": return current === undefined && !retired;
    case "writeId": return current !== undefined && current.writeId === condition.expected;
    case "always": return true;
  }
}
