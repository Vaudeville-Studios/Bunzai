/** Authenticated Table Read routes share one narrow lifecycle owner without exposing library management to remote devices. */
import type { StateStore } from "../stage/contracts/state-store";
import type { StudioStoreLike } from "../studio/contracts";
import { libraryStateFor, requireState } from "../studio/library-content";
import { connect } from "../kit/providers/scene-connect";
import { TableReadService } from "../studio/table-read/service";
import type { TableReadConnect } from "../studio/table-read/generate";
import { mutationSchema, TABLE_READ_LIMITS } from "../core/table-read/schema";
import { err, json, readJsonObject, refuseForeignSite, studioErr } from "./server-security";

export interface TableReadRouteOwner {
  handle(req: Request, path: string, studio: StudioStoreLike): Promise<Response | null>;
  close(): Promise<void>;
}

/** Explicitly composed once for all listeners; a restore retires its previous StateStore runtime. */
export function createTableReadRouteOwner(deps: { stateFor?: typeof libraryStateFor; connect?: TableReadConnect; now?: () => number; id?: () => string } = {}): TableReadRouteOwner {
  const stateFor = deps.stateFor ?? libraryStateFor;
  let current: { state: StateStore; service: TableReadService } | null = null;
  const closing = new Set<Promise<void>>();
  let closed = false;
  return {
    async handle(req, path, studio) {
      if (path !== "/api/table-read") return null;
      if (closed) return err("The Studio is closing.", 503);
      if (req.method !== "GET" && req.method !== "POST") return err("method not allowed", 405);
      const foreign = refuseForeignSite(req);
      if (foreign) return foreign;
      try {
        const root = studio.studioPath();
        const state = requireState(stateFor(root));
        if (current?.state !== state) {
          if (current) {
            const done = current.service.close();
            closing.add(done);
            void done.finally(() => closing.delete(done));
          }
          current = { state, service: new TableReadService({ state, studio, connect: deps.connect ?? connect, now: deps.now ?? Date.now, id: deps.id ?? (() => crypto.randomUUID()), isCurrent: () => stateFor(root) === state }) };
        }
        const service = current.service;
        if (req.method === "GET") return json(await service.read());
        const body = await readJsonObject(req, TABLE_READ_LIMITS.request);
        if (!body.ok) return body.response;
        const input = mutationSchema.safeParse(body.value);
        if (!input.success) return err("This interview action is incomplete or too large. Reload the Table Read and try again.", 400);
        return json(await service.change(input.data, req.signal));
      } catch (error) { return studioErr(error); }
    },
    async close() {
      closed = true;
      if (current) await current.service.close();
      await Promise.allSettled([...closing]);
    },
  };
}
