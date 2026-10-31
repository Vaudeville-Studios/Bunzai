/** Structured failures shared by the extension service and its local HTTP boundary. */
import { type ExtensionErrorCode } from "../contracts/errors";

export class ExtensionServiceError extends Error {
  constructor(readonly code: ExtensionErrorCode, message: string) { super(message); this.name = "ExtensionServiceError"; }
}

export const serviceError = (code: ExtensionErrorCode, message: string): never => { throw new ExtensionServiceError(code, message); };
