/** Shared source contract for operation identifiers across catalog, packages, grants and stores. */
import { z } from "zod";

export const OPERATION_ID_PATTERN = /^[a-z][A-Za-z0-9-]*(?:\.[a-z][A-Za-z0-9-]*)+$/;
export const operationIdSchema = z.string().min(3).max(160).regex(OPERATION_ID_PATTERN);
export const isOperationId = (value: string): boolean => operationIdSchema.safeParse(value).success;
