"use client";

import { useRef, useState } from "react";
import { Download, Upload, HardDrive, MoreVertical, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useKanbanStore } from "@/lib/store";

interface NotificationState {
  type: "success" | "error";
  title: string;
  message: string;
}

export function BackupMenu() {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { fetchCards, fetchProjects, fetchSettings } = useKanbanStore();

  const showNotification = (type: "success" | "error", title: string, message: string) => {
    setNotification({ type, title, message });
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch("/api/backup/export");
      if (!response.ok) throw new Error("Export failed");

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get("Content-Disposition");
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || "ideafy-export.json";

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Export failed:", error);
      showNotification("error", "Export Failed", "Failed to export data. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      setShowImportDialog(true);
    }
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleImportConfirm = async () => {
    if (!importFile) return;

    setIsImporting(true);
    try {
      const content = await importFile.text();
      const data = JSON.parse(content);

      const response = await fetch("/api/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Import failed");
      }

      const result = await response.json();
      console.log("Import successful:", result);

      // Refresh the data
      await fetchCards();
      await fetchProjects();
      await fetchSettings();

      setShowImportDialog(false);
      setImportFile(null);

      showNotification(
        "success",
        "Import Successful",
        `Imported ${result.imported.cards} cards, ${result.imported.projects} projects, ${result.imported.settings} settings. Pre-import backup: ${result.preImportBackup}`
      );
    } catch (error) {
      console.error("Import failed:", error);
      setShowImportDialog(false);
      setImportFile(null);
      showNotification(
        "error",
        "Import Failed",
        error instanceof Error ? error.message : "Unknown error occurred"
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleManualBackup = async () => {
    try {
      const response = await fetch("/api/backup", { method: "POST" });
      if (!response.ok) throw new Error("Backup failed");
      const data = await response.json();
      console.log("Manual backup created:", data);
      showNotification(
        "success",
        "Backup Created",
        `Backup saved as ${data.backup.filename}`
      );
    } catch (error) {
      console.error("Backup failed:", error);
      showNotification("error", "Backup Failed", "Failed to create backup. Please try again.");
    }
  };

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".json"
        className="hidden"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreVertical className="h-4 w-4" />
            <span className="sr-only">Backup menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleExport} disabled={isExporting}>
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "Exporting..." : "Export JSON"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleImportClick} disabled={isImporting}>
            <Upload className="mr-2 h-4 w-4" />
            {isImporting ? "Importing..." : "Import JSON"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleManualBackup}>
            <HardDrive className="mr-2 h-4 w-4" />
            Create Backup
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Import Confirmation Dialog */}
      <AlertDialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import Data?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This will replace all existing data with the imported data.
                  A backup will be created automatically before the import.
                </p>
                <p className="text-foreground font-medium">
                  File: {importFile?.name}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isImporting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleImportConfirm}
              disabled={isImporting}
            >
              {isImporting ? "Importing..." : "Import"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Notification Dialog */}
      <AlertDialog open={notification !== null} onOpenChange={() => setNotification(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {notification?.type === "success" ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <XCircle className="h-5 w-5 text-red-500" />
              )}
              {notification?.title}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {notification?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setNotification(null)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
