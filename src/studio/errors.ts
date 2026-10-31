/**
 * Typed studio errors with safe user-facing messages (never absolute paths).
 */
import { hasErrorName } from "../core/guards";

export class StudioValidationError extends Error {
  readonly code = "studio_validation" as const;
  constructor(message: string) {
    super(message);
    this.name = "StudioValidationError";
  }
}

/** A chat from this source is already a scene (ChatStore rule 33); `chatId` is the scene that holds it. */
export class ChatAlreadyImportedError extends StudioValidationError {
  constructor(readonly chatId: string, message = "this chat is already in your scenes.") {
    super(message);
    this.name = "ChatAlreadyImportedError";
  }
}

export class StudioNotFoundError extends Error {
  readonly code = "studio_not_found" as const;
  constructor(message = "not found") {
    super(message);
    this.name = "StudioNotFoundError";
  }
}

/** Stable machine code: a scene whose character was deleted before the scene froze a copy of it. */
export const CAST_MISSING_CODE = "cast_missing" as const;

/** The scene cannot open or preview because its character is gone and it holds no frozen copy (only pre-migration-22 rows). */
export class SceneCastMissingError extends Error {
  readonly code = CAST_MISSING_CODE;
  constructor(message = "This scene's character was deleted, so it cannot open.") {
    super(message);
    this.name = "SceneCastMissingError";
  }
}

export const isSceneCastMissingError = (e: unknown): e is SceneCastMissingError =>
  e instanceof SceneCastMissingError || hasErrorName(e, "SceneCastMissingError");

export type StudioDamageReason =
  | "unreadable-json"
  | "part-unreadable"
  | "schema-mismatch"
  | "kind-mismatch"
  | "id-mismatch"
  /**
   * The filename cannot be a studio id, so the file cannot be addressed at all.
   *
   * Its own reason because it is not damage in the same sense: the JSON may be perfect. A file
   * called `Aegir Main.json` is simply not reachable through an API whose ids forbid spaces. It
   * still has to be REPORTED, which is the whole point of the entry - the inventory used to skip
   * these silently, so a folder of 147 files listed 3 and said nothing about the other 144.
   */
  | "unusable-filename"
  /**
   * A list read's own row could not be opened at all (`DamagedDataError` or `SyntaxError` on its
   * identity or meta cell - never its body, which the other reasons already name): the backend
   * quarantined it rather than losing every other row beside it (rule 25's shape,
   * applied to the content store). `id` is the row's opaque stored key,
   * not its real id: that is exactly the cell that failed to open.
   */
  | "id-unreadable";

export class StudioReadError extends Error {
  readonly code = "studio_read" as const;
  constructor(
    message = "could not read file",
    readonly reason?: StudioDamageReason,
  ) {
    super(message);
    this.name = "StudioReadError";
  }
}

/** Stable machine code of a refusal that is only about timing: the same request will succeed shortly. */
export const STUDIO_BUSY_CODE = "studio_busy" as const;

/** The library is busy opening other pieces (its bounded cold-read lane is full). Retryable: nothing is wrong with the piece. */
export class StudioBusyError extends Error {
  readonly code = STUDIO_BUSY_CODE;
  constructor(message = "the library is busy opening other pieces, try again in a moment") {
    super(message);
    this.name = "StudioBusyError";
  }
}

export const isStudioBusyError = (e: unknown): e is StudioBusyError =>
  e instanceof StudioBusyError || hasErrorName(e, "StudioBusyError");

export const isStudioValidationError = (e: unknown): e is StudioValidationError =>
  e instanceof StudioValidationError || hasErrorName(e, "StudioValidationError");

export const isStudioNotFoundError = (e: unknown): e is StudioNotFoundError =>
  e instanceof StudioNotFoundError || hasErrorName(e, "StudioNotFoundError");

export const isStudioReadError = (e: unknown): e is StudioReadError =>
  e instanceof StudioReadError || hasErrorName(e, "StudioReadError");

/**
 * The library is locked: nothing can be read or written until it is
 * unlocked, and the Studio shows the stage door. It carries the keyring's error name, so
 * `isLibraryLocked` recognizes both without the Studio importing the Stage.
 */
export class StudioLockedError extends Error {
  readonly code = "studio_locked" as const;
  constructor(message = "the library is locked") {
    super(message);
    this.name = "LockedError";
  }
}

export const isLibraryLocked = (e: unknown): boolean =>
  hasErrorName(e, "LockedError");

export class StudioWriteError extends Error {
  readonly code = "studio_write" as const;
  constructor(message = "could not write file", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StudioWriteError";
  }
}

export class StudioConflictError extends Error {
  readonly code = "studio_conflict" as const;
  constructor(message = "file already exists") {
    super(message);
    this.name = "StudioConflictError";
  }
}

export class NoConnectionError extends StudioConflictError {
  constructor(message = "this scene has no connection; pick one in the AI wing") {
    super(message);
    this.name = "NoConnectionError";
  }
}

export const isStudioWriteError = (error: unknown): error is StudioWriteError =>
  error instanceof StudioWriteError || hasErrorName(error, "StudioWriteError");

export const isStudioConflictError = (error: unknown): error is StudioConflictError =>
  error instanceof StudioConflictError || hasErrorName(error, "StudioConflictError");
