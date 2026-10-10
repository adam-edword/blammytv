import { EYEBROW } from "../../ui/eyebrow";
import { MalSection } from "./MalSection";
import { TraktSection } from "./TraktSection";

/**
 * Accounts: who you are. Accounts elsewhere that follow what you watch
 * (plans 015, 021). AIOStreams' sign-in, and the sync that rides on it,
 * lives with its source on the Sources page (plan 024).
 */
export function AccountsPage() {
  return (
    <>
      <h3 className={`settings__group ${EYEBROW}`}>Accounts</h3>
      <section className="settings-section">
        <TraktSection />
        <MalSection />
      </section>
    </>
  );
}
