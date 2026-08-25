"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useKanbanStore } from "@/lib/store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Check,
  FileText,
  Info,
  Terminal,
} from "lucide-react";
import { BasicInfoFields } from "./project-form/basic-info-fields";
import { cn } from "@/lib/utils";

interface AddProjectModalProps {
  onClose: () => void;
}

interface NarrativeData {
  storyBehindThis: string;
  problem: string;
  targetUsers: string;
  coreFeatures: string;
  nonGoals: string;
  techStack: string;
  successMetrics: string;
}

type NarrativeMode = "create" | "existing" | "skip" | "skill";

// Step 1: basics, step 2: how to describe the project, step 3: the interview
// (only reached when the user chose to write the narrative with AI).
type Step = 1 | 2 | 3;

interface Question {
  key: keyof NarrativeData;
  title: string;
  /** Shorter label for the question list on the left. */
  short?: string;
  placeholder: string;
  help: string;
}

const QUESTIONS: Question[] = [
  {
    key: "storyBehindThis",
    title: "Story Behind This",
    placeholder: "Why are you building this? What's your motivation?",
    help: "What happened that made you start? A sentence or two is plenty.",
  },
  {
    key: "problem",
    title: "Problem",
    placeholder: "What problem does this solve?",
    help: "Who feels it, and how do they cope with it today?",
  },
  {
    key: "targetUsers",
    title: "Target Users",
    placeholder: "Who will use this?",
    help: "Name a person, not a market: “a consultant who records client calls”.",
  },
  {
    key: "coreFeatures",
    title: "Core Features",
    placeholder: "3–5 main features",
    help: "One line each. Verbs help: transcribes, summarises, exports.",
  },
  {
    key: "nonGoals",
    title: "Non-Goals (Out of Scope)",
    short: "Non-Goals",
    placeholder: "What will this NOT do?",
    help: "The things you'll be tempted to add. Saying no here saves a sprint later.",
  },
  {
    key: "techStack",
    title: "Tech Stack",
    placeholder: "Technologies being used",
    help: "Languages, frameworks, services — including the ones you're unsure about.",
  },
  {
    key: "successMetrics",
    title: "Success Metrics",
    placeholder: "How will you measure success?",
    help: "One number you'd check in three months.",
  },
];

const MODE_OPTIONS: {
  value: NarrativeMode;
  title: string;
  description: string;
  icon?: ReactNode;
}[] = [
  {
    value: "create",
    title: "Write it with AI",
    description: "Answer seven short questions; AI drafts docs/product-narrative.md",
  },
  {
    value: "existing",
    title: "Use an existing file",
    description: "Point at a README or spec you already have",
  },
  {
    value: "skill",
    title: "Interview in the terminal",
    description: "Opens /product-narrative for a guided conversation",
    icon: <Terminal className="h-3.5 w-3.5 text-muted-foreground" />,
  },
  {
    value: "skip",
    title: "Skip for now",
    description: "Evaluations will be thinner until a narrative exists",
  },
];

function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export function AddProjectModal({ onClose }: AddProjectModalProps) {
  const { addProject } = useKanbanStore();

  const [step, setStep] = useState<Step>(1);

  // Step 1 fields
  const [name, setName] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [idPrefix, setIdPrefix] = useState("");
  const [color, setColor] = useState("#5e6ad2");

  // Step 2 / 3 fields (narrative)
  const [narrativeMode, setNarrativeMode] = useState<NarrativeMode>("create");
  const [existingNarrativePath, setExistingNarrativePath] = useState("");
  const [narrative, setNarrative] = useState<NarrativeData>({
    storyBehindThis: "",
    problem: "",
    targetUsers: "",
    coreFeatures: "",
    nonGoals: "",
    techStack: "",
    successMetrics: "",
  });
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPickingNarrativeFile, setIsPickingNarrativeFile] = useState(false);

  // The interview step only exists when the narrative is written with AI.
  const totalSteps = narrativeMode === "create" ? 3 : 2;

  const handleNameChange = (value: string) => {
    setName(value);
    // Auto-generate prefix from name if not manually set
    if (!idPrefix || idPrefix === name.replace(/[^a-zA-Z0-9]/g, "").substring(0, 3).toUpperCase()) {
      setIdPrefix(value.replace(/[^a-zA-Z0-9]/g, "").substring(0, 3).toUpperCase());
    }
  };

  const hasNarrativeContent = () => {
    return Object.values(narrative).some((v) => v.trim() !== "");
  };

  const answeredCount = QUESTIONS.filter((q) => narrative[q.key].trim() !== "").length;

  const updateNarrative = (field: keyof NarrativeData, value: string) => {
    setNarrative((prev) => ({ ...prev, [field]: value }));
  };

  // Put the cursor in the answer box whenever the interview shows a question.
  useEffect(() => {
    if (step === 3) {
      answerRef.current?.focus({ preventScroll: true });
    }
  }, [step, currentQuestion]);

  const goToQuestion = (index: number) => {
    setCurrentQuestion(Math.max(0, Math.min(QUESTIONS.length - 1, index)));
  };

  const handleCreateProject = async () => {
    if (!name.trim() || !folderPath.trim()) return;

    setIsSubmitting(true);
    try {
      // Determine narrativePath based on mode
      let narrativePath: string | null = null;
      if (narrativeMode === "existing" && existingNarrativePath.trim()) {
        narrativePath = existingNarrativePath.trim();
      }
      // If mode is "create" or "skip", narrativePath stays null (use default or skip)

      // Create project
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          folderPath: folderPath.trim(),
          idPrefix: idPrefix.trim() || name.replace(/[^a-zA-Z0-9]/g, "").substring(0, 3).toUpperCase(),
          color,
          isPinned: false,
          narrativePath,
        }),
      });

      const newProject = await response.json();

      // Create narrative if mode is "create" and has content
      if (narrativeMode === "create" && hasNarrativeContent()) {
        await fetch(`/api/projects/${newProject.id}/narrative`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(narrative),
        });
      }

      // Launch skill terminal if mode is "skill"
      if (narrativeMode === "skill") {
        await fetch(`/api/projects/${newProject.id}/narrative-skill`, {
          method: "POST",
        });
      }

      // Refresh projects in store
      useKanbanStore.getState().fetchProjects();

      onClose();
    } catch (error) {
      console.error("Failed to add project:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // What the primary button on step 2 does depends on the chosen mode.
  const stepTwoPrimary = (() => {
    switch (narrativeMode) {
      case "create":
        return { label: "Next: write it", onClick: () => setStep(3), disabled: false, next: true };
      case "existing":
        return {
          label: "Create Project",
          onClick: handleCreateProject,
          disabled: isSubmitting || !existingNarrativePath.trim(),
          next: false,
        };
      case "skill":
        return { label: "Create & Open Terminal", onClick: handleCreateProject, disabled: isSubmitting, next: false };
      default:
        return { label: "Create Project", onClick: handleCreateProject, disabled: isSubmitting, next: false };
    }
  })();

  const question = QUESTIONS[currentQuestion];
  const isLastQuestion = currentQuestion === QUESTIONS.length - 1;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isPickingNarrativeFile) onClose();
      }}
    >
      <DialogContent
        className={cn(
          "flex flex-col",
          step === 3
            ? "sm:max-w-[780px] h-[min(640px,90vh)]"
            : "sm:max-w-[640px] max-h-[90vh]"
        )}
        onPointerDownOutside={(e) => {
          if (isPickingNarrativeFile) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (isPickingNarrativeFile) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isPickingNarrativeFile) e.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0">
          {step > 1 && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3 pr-6">
              <span className="shrink-0 tabular-nums">Step {step} of {totalSteps}</span>
              <Progress value={(step / totalSteps) * 100} className="h-1" />
              <span className="shrink-0 tabular-nums">
                {step === 2 ? "How to describe it" : `${answeredCount} of ${QUESTIONS.length} answered`}
              </span>
            </div>
          )}
          <DialogTitle>
            {step === 1 && "Add New Project"}
            {step === 2 && "How should AI learn about this project?"}
            {step === 3 && `Tell AI about ${name.trim() || "this project"}`}
          </DialogTitle>
          {step === 2 && (
            <DialogDescription>
              Pick one. You can point at a different narrative file later from project settings.
            </DialogDescription>
          )}
          {step === 3 && (
            <DialogDescription>
              Answer what you can. Empty questions are simply left out of the draft.
            </DialogDescription>
          )}
        </DialogHeader>

        {step === 1 && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="grid gap-4 py-4">
              <BasicInfoFields
                name={name}
                onNameChange={handleNameChange}
                folderPath={folderPath}
                onFolderPathChange={setFolderPath}
                idPrefix={idPrefix}
                onIdPrefixChange={setIdPrefix}
                color={color}
                onColorChange={setColor}
                inputIdPrefix=""
                autoFocusName
              />
              <p className="text-xs text-muted-foreground -mt-2">
                Task IDs: {idPrefix || "PRJ"}-1, {idPrefix || "PRJ"}-2...
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="grid gap-4 py-2">
              <RadioGroup
                value={narrativeMode}
                onValueChange={(value) => setNarrativeMode(value as NarrativeMode)}
                className="grid gap-3 sm:grid-cols-2"
              >
                {MODE_OPTIONS.map((option) => (
                  <FieldLabel
                    key={option.value}
                    htmlFor={`narrative-mode-${option.value}`}
                    className="cursor-pointer transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                  >
                    <Field orientation="horizontal" className="!p-3">
                      <RadioGroupItem
                        value={option.value}
                        id={`narrative-mode-${option.value}`}
                        className="mt-0.5"
                      />
                      <FieldContent className="gap-0.5">
                        <FieldTitle>
                          {option.title}
                          {option.icon}
                        </FieldTitle>
                        <FieldDescription className="text-xs">{option.description}</FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>

              {narrativeMode === "existing" && (
                <Field>
                  <FieldLabel htmlFor="existing-narrative-path">Path to the file</FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="existing-narrative-path"
                      value={existingNarrativePath}
                      onChange={(e) => setExistingNarrativePath(e.target.value)}
                      placeholder="README.md"
                      className="flex-1 h-8 text-sm"
                      autoFocus
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={isPickingNarrativeFile}
                      title="Browse files"
                      onClick={async () => {
                        setIsPickingNarrativeFile(true);
                        try {
                          // Pass project folder as default location
                          const url = folderPath
                            ? `/api/file-picker?path=${encodeURIComponent(folderPath)}`
                            : "/api/file-picker";
                          const response = await fetch(url);
                          const data = await response.json();
                          if (data.path && folderPath) {
                            // Make path relative to project folder
                            const relativePath = data.path.startsWith(folderPath)
                              ? data.path.slice(folderPath.length + 1)
                              : data.path;
                            setExistingNarrativePath(relativePath);
                          }
                        } catch (error) {
                          console.error("Failed to pick file:", error);
                        } finally {
                          setIsPickingNarrativeFile(false);
                        }
                      }}
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                  </div>
                  <FieldDescription className="text-xs">Relative to the project folder</FieldDescription>
                </Field>
              )}

              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                {narrativeMode === "skip" ? (
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                ) : (
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                )}
                <span>
                  {narrativeMode === "skip"
                    ? "Without a narrative file, AI evaluations may be limited. "
                    : ""}
                  A CLAUDE.md file in the project folder improves evaluations too &mdash;{" "}
                  <code className="px-1 py-0.5 bg-muted rounded text-[11px]">claude /init</code> creates one.
                </span>
              </p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex-1 min-h-0 grid grid-cols-[200px_1fr] gap-5">
            <nav
              className="flex flex-col gap-0.5 border-r pr-4 overflow-y-auto"
              aria-label="Questions"
            >
              {QUESTIONS.map((q, index) => {
                const answered = narrative[q.key].trim() !== "";
                const active = index === currentQuestion;
                return (
                  <Item
                    key={q.key}
                    asChild
                    size="sm"
                    className={cn(
                      "!px-2.5 !py-2 cursor-pointer text-left",
                      active ? "bg-primary/10 text-primary" : "hover:bg-muted/60"
                    )}
                  >
                    <button
                      type="button"
                      aria-current={active ? "step" : undefined}
                      onClick={() => goToQuestion(index)}
                    >
                      <ItemMedia>
                        <span
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded-full border",
                            answered
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/40"
                          )}
                        >
                          {answered && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                        </span>
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle className={cn("font-normal", active && "font-medium")}>
                          {q.short ?? q.title}
                        </ItemTitle>
                      </ItemContent>
                    </button>
                  </Item>
                );
              })}
            </nav>

            <div className="flex flex-col gap-2 min-h-0">
              <div>
                <label htmlFor={`narrative-${question.key}`} className="text-base font-semibold">
                  {question.title}
                </label>
                <p className="text-xs text-muted-foreground mt-1">{question.help}</p>
              </div>
              <InputGroup className="flex-1 min-h-0 flex-col items-stretch">
                <InputGroupTextarea
                  ref={answerRef}
                  id={`narrative-${question.key}`}
                  value={narrative[question.key]}
                  onChange={(e) => updateNarrative(question.key, e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      if (!isLastQuestion) goToQuestion(currentQuestion + 1);
                    }
                  }}
                  placeholder={question.placeholder}
                  className="flex-1 min-h-0 px-3.5 text-[15px] leading-relaxed"
                />
                <InputGroupAddon align="block-end" className="border-t">
                  <InputGroupText className="tabular-nums">
                    {countWords(narrative[question.key])}{" "}
                    {countWords(narrative[question.key]) === 1 ? "word" : "words"}
                  </InputGroupText>
                  {!isLastQuestion && (
                    <InputGroupText className="ml-auto text-xs">
                      <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">&#8984;&#8629;</kbd>
                      next
                    </InputGroupText>
                  )}
                  {!isLastQuestion && (
                    <InputGroupButton
                      size="sm"
                      variant="default"
                      onClick={() => goToQuestion(currentQuestion + 1)}
                    >
                      Next question
                      <ArrowRight className="h-3.5 w-3.5" />
                    </InputGroupButton>
                  )}
                </InputGroupAddon>
              </InputGroup>
            </div>
          </div>
        )}

        <DialogFooter className="shrink-0 flex-col sm:flex-row gap-2">
          {step === 1 && (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={() => setStep(2)}
                disabled={!name.trim() || !folderPath.trim()}
              >
                Next
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button variant="ghost" onClick={() => setStep(1)} className="mr-auto">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button onClick={stepTwoPrimary.onClick} disabled={stepTwoPrimary.disabled}>
                {isSubmitting ? "Creating..." : stepTwoPrimary.label}
                {stepTwoPrimary.next && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>
            </>
          )}
          {step === 3 && (
            <>
              <Button variant="ghost" onClick={() => setStep(2)} className="mr-auto">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button onClick={handleCreateProject} disabled={isSubmitting}>
                {isSubmitting
                  ? hasNarrativeContent()
                    ? "AI generating narrative..."
                    : "Creating..."
                  : "Create Project"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
