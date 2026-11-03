/** Small presentation decisions for the Table Read, keeping stale network answers out of a newer draft. */
import type { TableReadSession, TableReadView } from "../../../core/table-read/schema";

export const TEMPO_COPY = [
  { value: "cold-read", title: "Cold Read", subtitle: "A few good questions. A character ready to play.", detail: "About five questions, with room for a little more." },
  { value: "deep-dive", title: "Deep Dive", subtitle: "Follow the interesting answers. Find their voice.", detail: "A longer conversation that follows what still needs an answer." },
  { value: "rapid-fire", title: "Rapid Fire", subtitle: "Trust your first instinct. Keep the choices coming.", detail: "90 seconds of quick picks. The clock starts after the questions are ready." },
] as const;

/** A slow response from an earlier request cannot replace a later accepted revision. */
export const newerView = (current: TableReadView | null, incoming: TableReadView): TableReadView =>
  current && current.revision > incoming.revision ? current : incoming;

export const secondsRemaining = (deadline: number, now: number): number => Math.max(0, Math.ceil((deadline - now) / 1000));

export const rapidChoicesComplete = (session: TableReadSession): boolean => session.settings.tempo === "rapid-fire" && session.deadline !== null && session.question === null && session.deck.length === 0;
