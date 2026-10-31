/** One bounded token grammar for manifest contribution identifiers and host invocation. */
import { z } from "zod";

export const CONTRIBUTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
export const contributionIdSchema = z.string().regex(CONTRIBUTION_ID_PATTERN);
