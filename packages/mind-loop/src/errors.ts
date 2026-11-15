/** A failure of the mind loop. The message is fixed text, never a server body; `reason` names the stop reason. */
export class MindError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string = 'error') {
    super(message);
    this.reason = reason;
  }
}
