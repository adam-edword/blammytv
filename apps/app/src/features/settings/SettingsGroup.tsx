import type { ReactNode } from "react";
import { EYEBROW } from "../../ui/eyebrow";
import { useClassic } from "../classic/useClassic";

/**
 * A run of settings under its heading. Default and the other packs: the
 * eyebrow heading and the run as its siblings, exactly the markup the pages
 * had. Classic (plan 035): a group box, the etched frame a Windows 2000
 * property sheet draws, with the title in its top edge.
 */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  const classic = useClassic();
  if (!classic)
    return (
      <>
        <h3 className={`settings__group ${EYEBROW}`}>{title}</h3>
        {children}
      </>
    );
  return (
    <fieldset className="cl-group">
      <legend className="cl-group__title">{title}</legend>
      {children}
    </fieldset>
  );
}
