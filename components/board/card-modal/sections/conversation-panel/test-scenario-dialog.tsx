import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Terminal } from "lucide-react";

export interface DialogScenario {
  text: string;
  group: string;
  selected: boolean;
}

interface TestScenarioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Snapshot of scenarios taken when the dialog was opened; re-applied each time `open` transitions to true. */
  initialScenarios: DialogScenario[];
  /** Invoked with the user-selected scenario texts when "Generate" is clicked. */
  onGenerate: (selectedTexts: string[]) => Promise<void> | void;
}

export function TestScenarioDialog({
  open,
  onOpenChange,
  initialScenarios,
  onGenerate,
}: TestScenarioDialogProps) {
  const [scenarios, setScenarios] = useState<DialogScenario[]>(initialScenarios);

  // Reset the local scenario list whenever the dialog is (re-)opened so the
  // parent can reflect a fresh parse of the card's current testScenarios HTML.
  useEffect(() => {
    if (open) setScenarios(initialScenarios);
  }, [open, initialScenarios]);

  const toggle = (index: number) => {
    setScenarios((prev) =>
      prev.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item)),
    );
  };

  const selectAll = () => setScenarios((prev) => prev.map((item) => ({ ...item, selected: true })));
  const selectNone = () => setScenarios((prev) => prev.map((item) => ({ ...item, selected: false })));

  const selectedCount = scenarios.filter((s) => s.selected).length;

  const handleGenerate = async () => {
    const selectedTexts = scenarios.filter((s) => s.selected).map((s) => s.text);
    if (selectedTexts.length === 0) return;
    await onGenerate(selectedTexts);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Test Scenarios</DialogTitle>
          <DialogDescription>Choose which scenarios to generate tests for.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1 max-h-[300px] overflow-y-auto py-2">
          {scenarios.map((scenario, index) => {
            const prevGroup = index > 0 ? scenarios[index - 1].group : "";
            const showGroup = scenario.group && scenario.group !== prevGroup;
            return (
              <div key={index}>
                {showGroup && (
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2 pt-2 pb-1">
                    {scenario.group}
                  </div>
                )}
                <label className="flex items-start gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scenario.selected}
                    onChange={() => toggle(index)}
                    className="mt-0.5 accent-ink"
                  />
                  <span className="text-sm">{scenario.text}</span>
                </label>
              </div>
            );
          })}
        </div>
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={selectAll} className="text-xs h-7">
              Select All
            </Button>
            <Button variant="ghost" size="sm" onClick={selectNone} className="text-xs h-7">
              Clear
            </Button>
          </div>
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={selectedCount === 0}
            className="bg-ink text-background hover:bg-ink/90 border border-ink"
          >
            <Terminal className="w-3.5 h-3.5 mr-1.5" />
            Generate ({selectedCount})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
