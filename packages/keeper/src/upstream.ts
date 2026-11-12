/**
 * The hook point of SC-167 (pulling upstream changes into the player). Called once per run,
 * before the push step. SC-167 fills it in; until then there is nothing to pull.
 */
export async function fetchUpstream(): Promise<null> {
  return null;
}
