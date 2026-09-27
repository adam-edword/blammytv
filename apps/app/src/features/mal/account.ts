import { malDisconnect } from "./client";
import { forgetMal, MAL_SYNCED } from "./store";

/** Forget MAL on this device: the session, the counts, their ticks. Your
 * list on MAL is not touched. */
export async function signOutOfMal(): Promise<void> {
  await malDisconnect().catch(() => {});
  forgetMal();
  window.dispatchEvent(new Event(MAL_SYNCED));
}
