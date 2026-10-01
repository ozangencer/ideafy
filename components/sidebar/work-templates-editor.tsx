"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import type { WorkTemplate } from "@/lib/types";
import { newWorkTemplateId } from "@/lib/work-templates";
import { useKanbanStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Radix Select cannot carry an empty value, so "no skill" needs a stand-in.
const NO_SKILL = "__none__";

interface WorkTemplatesEditorProps {
  value: WorkTemplate[];
  onChange: (templates: WorkTemplate[]) => void;
}

/**
 * The list a Work card's Generate run picks its template from. Edited in place
 * and saved with the rest of Settings; the server drops rows left without a
 * name and brings back the default Output template if the list ends up empty.
 */
export function WorkTemplatesEditor({ value, onChange }: WorkTemplatesEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const skills = useKanbanStore((s) => s.skills);
  const fetchSkills = useKanbanStore((s) => s.fetchSkills);

  useEffect(() => {
    if (isOpen && skills.length === 0) void fetchSkills();
  }, [isOpen, skills.length, fetchSkills]);

  const update = (id: string, patch: Partial<WorkTemplate>) =>
    onChange(value.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const add = () =>
    onChange([
      ...value,
      { id: newWorkTemplateId(), name: "", skill: null, promptPreset: "", outputExt: ".md" },
    ]);

  const remove = (id: string) => onChange(value.filter((t) => t.id !== id));

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded py-1 text-left transition-colors hover:text-foreground">
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
            isOpen ? "rotate-90" : ""
          }`}
        />
        <span className="text-sm font-medium">Work templates</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {value.length} template{value.length === 1 ? "" : "s"}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="pl-5 pt-1 text-xs text-muted-foreground">
          What Generate produces on a Work card. Each template can call a skill, add standing
          instructions and name the file type to save. A card without a template uses the first one.
        </p>
        <div className="grid gap-2 pl-5 pt-2">
          {value.map((template) => {
            // A skill that was uninstalled stays selectable, so saving does not
            // silently clear it.
            const skillOptions =
              template.skill && !skills.includes(template.skill) ? [template.skill, ...skills] : skills;
            return (
              <div key={template.id} className="grid gap-1.5 rounded-md border border-border p-2">
                <div className="flex items-center gap-1.5">
                  <Input
                    aria-label="Template name"
                    value={template.name}
                    onChange={(e) => update(template.id, { name: e.target.value })}
                    placeholder="Name (e.g. Meeting minutes)"
                    className="h-8 flex-1 min-w-0 text-sm"
                  />
                  <Input
                    aria-label="Output file type"
                    value={template.outputExt}
                    onChange={(e) => update(template.id, { outputExt: e.target.value })}
                    placeholder=".md"
                    className="h-8 w-20 text-sm font-mono"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => remove(template.id)}
                    title="Remove template"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Select
                  value={template.skill ?? NO_SKILL}
                  onValueChange={(skill) =>
                    update(template.id, { skill: skill === NO_SKILL ? null : skill })
                  }
                >
                  <SelectTrigger className="h-8 text-sm" aria-label="Skill">
                    <SelectValue placeholder="Skill" />
                  </SelectTrigger>
                  <SelectContent className="z-[70] max-h-72">
                    <SelectItem value={NO_SKILL}>No skill</SelectItem>
                    {skillOptions.map((skill) => (
                      <SelectItem key={skill} value={skill}>
                        {skill}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  aria-label="Prompt preset"
                  value={template.promptPreset}
                  onChange={(e) => update(template.id, { promptPreset: e.target.value })}
                  placeholder="Standing instructions for every run (optional)"
                  className="min-h-[56px] text-sm"
                />
              </div>
            );
          })}
          <Button type="button" variant="outline" size="sm" className="justify-self-start gap-1.5" onClick={add}>
            <Plus className="h-3.5 w-3.5" />
            Add template
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
