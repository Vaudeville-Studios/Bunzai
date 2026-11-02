/**
 * The SQL the SQLite ChatStore writes about a message's versions, in
 * one place: which swipes are live, where the next one goes, and how a message points at its current
 * one. The memory store gets the same answers from `memory/chat-records.ts` (`livePositions`,
 * `ordinalOf`); the shared contract suites hold the two together.
 */
import type { Generation } from "../../contracts/chat-store";

type Param = string | number | null;

/** The slice of the store kit these helpers need; chat-store.ts and the turn commit both can hand it over. */
export interface SwipeSqlKit {
  one<T>(sql: string, ...params: Param[]): T | null;
  run(sql: string, ...params: Param[]): number;
  insertSwipe(messageId: string, position: number, content: string, generation: Generation | undefined, createdAt: number): number;
}

/** An uncut timestamp predicate shared by message and swipe rows (rule 32); other visibility checks remain caller-owned. */
export const LIVE = "cut_at IS NULL";
/** The same uncut timestamp predicate on an alias, for joins and subqueries. */
export const liveOf = (alias: string): string => `${alias}.${LIVE}`;

/** How many of a message's versions are live: one `?` for the message id. */
export const LIVE_COUNT_SQL = `SELECT count(*) AS n FROM swipes WHERE message_id = ? AND ${LIVE}`;

/** The live versions of a message that sit before `position`, as a scalar subquery on a swipes-like alias. */
export const liveBefore = (alias: string, position: string): string =>
  `(SELECT count(*) FROM swipes x WHERE x.message_id = ${alias}.message_id AND ${liveOf("x")} AND x.position < ${position})`;

/** Where a message's next version goes: past the highest position ever used, because a purge leaves gaps (rule 32). */
export const nextPosition = (k: Pick<SwipeSqlKit, "one">, messageId: string): number =>
  k.one<{ n: number }>("SELECT coalesce(max(position) + 1, 0) AS n FROM swipes WHERE message_id = ?", messageId)!.n;

/** Points a message at the version stored at `position`. The caller bumps the branch. */
export const setCurrentSwipe = (k: Pick<SwipeSqlKit, "run">, messageId: string, position: number): number =>
  k.run("UPDATE messages SET current_swipe = ? WHERE id = ?", position, messageId);

/** Adds a version after the last one and makes it the message's current one; returns its position. The caller bumps the branch. */
export function appendSwipe(k: SwipeSqlKit, messageId: string, content: string, generation: Generation | undefined, createdAt: number): number {
  const position = nextPosition(k, messageId);
  k.insertSwipe(messageId, position, content, generation, createdAt);
  setCurrentSwipe(k, messageId, position);
  return position;
}
