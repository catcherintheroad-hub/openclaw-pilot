export class PilotError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "PilotError";
  }
}
