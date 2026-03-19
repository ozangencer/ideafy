import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { BackupScheduler } from "@/components/backup-scheduler";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={100} skipDelayDuration={0}>
      <BackupScheduler />
      {children}
      <Toaster />
      <SonnerToaster position="top-center" />
    </TooltipProvider>
  );
}
