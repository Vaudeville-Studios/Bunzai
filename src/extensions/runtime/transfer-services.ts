/** Exact-scope canonical reads for trusted transfer handlers; entities never reach guest code. */
import type { ContentKind } from "../../entities/capabilities/types";
import { parseCanonicalEntity } from "../../entities/runtime-schema";
import type { ContentStore } from "../../stage/contracts/content-store";
import type { ResourceRef } from "../contracts/operation";
import type { ExtensionTransferServices } from "../operations/transfers/_services";

export function createExtensionTransferServices(store: ContentStore): ExtensionTransferServices {
  return {
    async readCanonical(kind: ContentKind, id: string, scope: readonly ResourceRef[]) {
      if (!scope.some((resource) => resource.kind === kind && resource.id === id)) return null;
      const stored = await store.read(kind, id);
      if (!stored) return null;
      const entity = parseCanonicalEntity(stored.entity);
      return entity.kind === kind && entity.id === id ? entity : null;
    },
  };
}
