import { Segmented, type SegOption } from "../../ui/Segmented";
import { KIND_WORD, type XtKind } from "./keys";

const OPTIONS: ReadonlyArray<SegOption<XtKind>> = [
  { key: "movie", label: KIND_WORD.movie },
  { key: "series", label: KIND_WORD.series },
];

/** Movies or Shows, for the views that pick folders (plan 028). Not drawn when
 * only one of them has folders to pick from: there is nothing to switch. */
export function KindSegmented({
  kinds,
  value,
  onChange,
  size,
}: {
  kinds: readonly XtKind[];
  value: XtKind;
  onChange: (kind: XtKind) => void;
  size?: "md" | "sm";
}) {
  if (kinds.length < 2) return null;
  return <Segmented options={OPTIONS} value={value} onChange={onChange} size={size} label="Folder Type" />;
}
