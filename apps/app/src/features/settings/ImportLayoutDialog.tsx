import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../../components/ui/dialog";

/**
 * Settings → Home → Import Layout (plan 033, phase 3): a box to paste a layout
 * exported from Strand into, Add Rows, and a line saying how many rows were
 * added. Text that is not a Strand layout gets an error under the box and
 * changes nothing. What the rows become is home/strand.ts.
 *
 * The dialog stays up after the rows are added, so the line can be read; the
 * box is emptied, so Add Rows cannot add the same rows twice by accident.
 * One layer, like the other dialogs: Escape closes this and not Settings.
 */
export function ImportLayoutDialog({
  onImport,
}: {
  /** Adds the rows, or null when the text is not a Strand layout. */
  onImport: (text: string) => { added: number; already: number } | null;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const add = () => {
    const out = onImport(text);
    setError(!out);
    setDone(out ? said(out.added, out.already) : null);
    if (out) setText("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setText("");
          setError(false);
          setDone(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" type="button">
          Import Layout
        </Button>
      </DialogTrigger>
      <DialogContent className="grid-cols-[minmax(0,1fr)] gap-3 sm:max-w-lg">
        <DialogHeader className="gap-1.5">
          <DialogTitle>Import Layout</DialogTitle>
          <DialogDescription>Paste a layout exported from Strand.</DialogDescription>
        </DialogHeader>
        <textarea
          className="homerows__paste"
          aria-label="Strand Layout"
          aria-invalid={error || undefined}
          aria-describedby={error ? "homerows-paste-error" : undefined}
          value={text}
          rows={8}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setError(false);
            setDone(null);
          }}
        />
        {error && (
          <p id="homerows-paste-error" className="settings-field__error" role="alert">
            This isn't a layout exported from Strand.
          </p>
        )}
        {done && (
          <p className="xtedit__hint" role="status">
            {done}
          </p>
        )}
        <DialogFooter>
          <Button type="button" disabled={!text.trim()} onClick={add}>
            Add Rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Added 5 rows." and, when Strand listed rows already on Home, how many. */
function said(added: number, already: number): string {
  const rows = (n: number) => `${n} ${n === 1 ? "row" : "rows"}`;
  return `Added ${rows(added)}.${already > 0 ? ` ${already} already on Home.` : ""}`;
}
