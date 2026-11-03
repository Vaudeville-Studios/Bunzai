/** The Table Read app's revisioned authoring API; all model and persistence authority stays on the host. */
import type { TableReadMutation, TableReadView } from "../core/table-read/schema";

export interface TableReadApi {
  getTableRead(): Promise<TableReadView>;
  changeTableRead(input: TableReadMutation, signal?: AbortSignal): Promise<TableReadView>;
}
