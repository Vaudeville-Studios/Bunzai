/** Structured failures shared by the extension service and its local HTTP boundary. */
import { ExtensionOperationError, type ExtensionErrorCode } from "../contracts/errors";

export { ExtensionOperationError as ExtensionServiceError } from "../contracts/errors";

export const serviceError = (code: ExtensionErrorCode, message: string): never => { throw new ExtensionOperationError(code, message); };
