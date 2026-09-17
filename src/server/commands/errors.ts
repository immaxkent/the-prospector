/** Expected command failures. The UI shows `message`; `code` is stable for tests and clients. */
export type CommandErrorCode = "not_found" | "conflict" | "invalid" | "demo_read_only";

export class CommandError extends Error {
  constructor(
    readonly code: CommandErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new CommandError("not_found", `${what} not found`);
export const conflict = (message: string) => new CommandError("conflict", message);
export const invalid = (message: string) => new CommandError("invalid", message);
