/**
 * Aborts every controller currently tracked for an in-flight chat generation.
 * Used before restarting the inference backend (e.g. on model switch) so a
 * live stream fails via the clean AbortError path instead of erroring out
 * mid-message when the server process underneath it is killed/restarted.
 */
export function abortAll(controllers: Map<string, AbortController>): void {
  for (const controller of controllers.values()) {
    controller.abort()
  }
}
