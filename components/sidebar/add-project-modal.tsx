"use client";

import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Folder, ArrowLeft, ArrowRight, AlertTriangle, Info, FileText, Terminal } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";

interface AddProjectModalProps {
  onClose: () => void;
}

const PRESET_COLORS = [
  "#5e6ad2", // Indigo (default)
  "#ef4444", // Red
  "#f97316", // Orange
  "#eab308", // Yellow
  "#22c55e", // Green
  "#06b6d4", // Cyan
  "#3b82f6", // Blue
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#6b7280", // Gray
];

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

export function AddProjectModal({ onClose }: AddProjectModalProps) {
  const { addProject } = useKanbanStore();

  // Step state (1 = Basic Info, 2 = Narrative)
  const [step, setStep] = useState(1);

  // Step 1 fields
  const [name, setName] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [idPrefix, setIdPrefix] = useState("");
  const [color, setColor] = useState("#5e6ad2");

  // Step 2 fields (narrative)
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

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPickingFolder, setIsPickingFolder] = useState(false);

  const handleFolderPick = async () => {
    setIsPickingFolder(true);
    try {
      const response = await fetch("/api/folder-picker");
      const data = await response.json();
      if (data.path) {
        setFolderPath(data.path);
      }
    } catch (error) {
      console.error("Failed to pick folder:", error);
    } finally {
      setIsPickingFolder(false);
    }
  };

  const handleNameChange = (value: string) => {
    setName(value);
    // Auto-generate prefix from name if not manually set
    if (!idPrefix || idPrefix === name.replace(/[^a-zA-Z0-9]/g, "").substring(0, 3).toUpperCase()) {
      setIdPrefix(value.replace(/[^a-zA-Z0-9]/g, "").substring(0, 3).toUpperCase());
    }
  };

  const handleNext = () => {
    setStep(2);
  };

  const handleBack = () => {
    setStep(1);
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

  const hasNarrativeContent = () => {
    return Object.values(narrative).some((v) => v.trim() !== "");
  };

  const updateNarrative = (field: keyof NarrativeData, value: string) => {
    setNarrative((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? "Add New Project" : "Product Narrative"}
          </DialogTitle>
          {step === 2 && (
            <DialogDescription>
              Help AI understand your project better (optional)
            </DialogDescription>
          )}
        </DialogHeader>

        {step === 1 ? (
          // Step 1: Basic Info
          <div className="grid gap-4 py-4">
            {/* Project Name */}
            <div className="grid gap-2">
              <label htmlFor="name" className="text-sm font-medium">
                Project Name
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="My Project"
                autoFocus
              />
            </div>

            {/* Folder Path */}
            <div className="grid gap-2">
              <label htmlFor="folderPath" className="text-sm font-medium">
                Folder Path
              </label>
              <div className="flex gap-2">
                <Input
                  id="folderPath"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="/Users/username/projects/my-project"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleFolderPick}
                  disabled={isPickingFolder}
                  title="Browse folders"
                >
                  <Folder className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Full path to the project directory
              </p>
            </div>

            {/* ID Prefix and Color */}
            <div className="grid grid-cols-2 gap-4">
              {/* ID Prefix */}
              <div className="grid gap-2">
                <label htmlFor="idPrefix" className="text-sm font-medium">
                  ID Prefix
                </label>
                <Input
                  id="idPrefix"
                  value={idPrefix}
                  onChange={(e) => setIdPrefix(e.target.value.toUpperCase().slice(0, 5))}
                  placeholder="PRJ"
                  maxLength={5}
                />
              </div>

              {/* Color */}
              <div className="grid gap-2">
                <label className="text-sm font-medium">Color</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2 h-10"
                    >
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-muted-foreground text-xs font-mono">
                        {color}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-2">
                    <div className="grid grid-cols-5 gap-2">
                      {PRESET_COLORS.map((presetColor) => (
                        <button
                          key={presetColor}
                          className={`w-7 h-7 rounded-md transition-all ${
                            color === presetColor
                              ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                              : "hover:scale-110"
                          }`}
                          style={{ backgroundColor: presetColor }}
                          onClick={() => setColor(presetColor)}
                        />
                      ))}
                    </div>
                    {/* Custom color input */}
                    <div className="mt-2 pt-2 border-t">
                      <Input
                        type="text"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        placeholder="#000000"
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Task IDs: {idPrefix || "PRJ"}-1, {idPrefix || "PRJ"}-2...
            </p>
          </div>
        ) : (
          // Step 2: Narrative
          <div className="grid gap-4 py-4">
            {/* CLAUDE.md Warning */}
            <Alert className="bg-blue-500/10 border-blue-500/30">
              <Info className="h-4 w-4 text-blue-500" />
              <AlertDescription className="text-sm">
                For better AI evaluations, your project should have a CLAUDE.md file.
                You can create one with <code className="px-1 py-0.5 bg-muted rounded text-xs">claude /init</code>
              </AlertDescription>
            </Alert>

            {/* Narrative Mode Selection */}
            <div className="space-y-3">
              {/* Option 1: Create with AI */}
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="narrativeMode"
                  value="create"
                  checked={narrativeMode === "create"}
                  onChange={() => setNarrativeMode("create")}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">Create with AI</div>
                  <div className="text-xs text-muted-foreground">Fill form below, AI generates narrative file</div>
                </div>
              </label>

              {/* Option 2: Use existing file */}
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="narrativeMode"
                  value="existing"
                  checked={narrativeMode === "existing"}
                  onChange={() => setNarrativeMode("existing")}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">Use existing file</div>
                  <div className="text-xs text-muted-foreground">Reference an existing doc (README, spec, etc.)</div>
                  {narrativeMode === "existing" && (
                    <div className="flex gap-2 mt-2">
                      <Input
                        value={existingNarrativePath}
                        onChange={(e) => setExistingNarrativePath(e.target.value)}
                        placeholder="README.md"
                        className="flex-1 h-8 text-sm"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        title="Browse files"
                        onClick={async () => {
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
                          }
                        }}
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                  {narrativeMode === "existing" && (
                    <div className="text-xs text-muted-foreground mt-1">Relative to project folder</div>
                  )}
                </div>
              </label>

              {/* Option 3: Create with Skill (Interactive) */}
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="narrativeMode"
                  value="skill"
                  checked={narrativeMode === "skill"}
                  onChange={() => setNarrativeMode("skill")}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">Create with Skill (Interactive)</span>
                    <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="text-xs text-muted-foreground">Opens terminal with /product-narrative skill for guided interview</div>
                </div>
              </label>

              {/* Option 4: Skip */}
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="narrativeMode"
                  value="skip"
                  checked={narrativeMode === "skip"}
                  onChange={() => setNarrativeMode("skip")}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">Skip</div>
                  <div className="text-xs text-muted-foreground">Use default path (docs/product-narrative.md)</div>
                </div>
              </label>
            </div>

            {/* Create with AI form fields - only show when "create" is selected */}
            {narrativeMode === "create" && (
              <div className="space-y-4 pt-2 border-t">
                {/* Story Behind This */}
                <div className="grid gap-2">
                  <label className="text-sm font-medium">
                    Story Behind This
                  </label>
                  <Textarea
                    value={narrative.storyBehindThis}
                    onChange={(e) => updateNarrative("storyBehindThis", e.target.value)}
                    placeholder="Why are you building this? What's your motivation?"
                    rows={2}
                  />
                </div>

                {/* Problem */}
                <div className="grid gap-2">
                  <label className="text-sm font-medium">
                    Problem
                  </label>
                  <Textarea
                    value={narrative.problem}
                    onChange={(e) => updateNarrative("problem", e.target.value)}
                    placeholder="What problem does this solve?"
                    rows={2}
                  />
                </div>

                {/* Target Users */}
                <div className="grid gap-2">
                  <label className="text-sm font-medium">
                    Target Users
                  </label>
                  <Textarea
                    value={narrative.targetUsers}
                    onChange={(e) => updateNarrative("targetUsers", e.target.value)}
                    placeholder="Who will use this?"
                    rows={2}
                  />
                </div>

                {/* Core Features */}
                <div className="grid gap-2">
                  <label className="text-sm font-medium">
                    Core Features
                  </label>
                  <Textarea
                    value={narrative.coreFeatures}
                    onChange={(e) => updateNarrative("coreFeatures", e.target.value)}
                    placeholder="3-5 main features"
                    rows={2}
                  />
                </div>

                {/* Non-Goals */}
                <div className="grid gap-2">
                  <label className="text-sm font-medium">
                    Non-Goals (Out of Scope)
                  </label>
                  <Textarea
                    value={narrative.nonGoals}
                    onChange={(e) => updateNarrative("nonGoals", e.target.value)}
                    placeholder="What will this NOT do?"
                    rows={2}
                  />
                </div>

                {/* Tech Stack */}
                <div className="grid gap-2">
                  <label className="text-sm font-medium">
                    Tech Stack
                  </label>
                  <Textarea
                    value={narrative.techStack}
                    onChange={(e) => updateNarrative("techStack", e.target.value)}
                    placeholder="Technologies being used"
                    rows={2}
                  />
                </div>

                {/* Success Metrics */}
                <div className="grid gap-2">
                  <label className="text-sm font-medium">
                    Success Metrics
                  </label>
                  <Textarea
                    value={narrative.successMetrics}
                    onChange={(e) => updateNarrative("successMetrics", e.target.value)}
                    placeholder="How will you measure success?"
                    rows={2}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={handleNext}
                disabled={!name.trim() || !folderPath.trim()}
              >
                Next
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={handleBack} className="mr-auto">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={handleCreateProject}
                disabled={isSubmitting || (narrativeMode === "existing" && !existingNarrativePath.trim())}
              >
                {isSubmitting
                  ? (narrativeMode === "create" && hasNarrativeContent() ? "AI generating narrative..." : "Creating...")
                  : (narrativeMode === "skill" ? "Create & Open Terminal" : "Create Project")}
              </Button>
            </>
          )}
        </DialogFooter>

        {/* Skip warning */}
        {step === 2 && narrativeMode === "skip" && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            <AlertTriangle className="inline h-3 w-3 mr-1" />
            Without a narrative file, AI evaluations may be limited
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
