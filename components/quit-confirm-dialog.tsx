"use client";

import { useEffect, useRef, useState } from "react";

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

type ElectronQuitAPI = {
  onQuitConfirmRequest?: (cb: () => void) => void;
  sendQuitConfirmResponse?: (confirm: boolean) => void;
};

function getElectronAPI(): ElectronQuitAPI | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { electronAPI?: ElectronQuitAPI }).electronAPI;
}

export function QuitConfirmDialog() {
  const [open, setOpen] = useState(false);
  const respondedRef = useRef(false);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.onQuitConfirmRequest) return;
    api.onQuitConfirmRequest(() => {
      respondedRef.current = false;
      setOpen(true);
    });
  }, []);

  const respond = (confirm: boolean) => {
    if (respondedRef.current) return;
    respondedRef.current = true;
    getElectronAPI()?.sendQuitConfirmResponse?.(confirm);
    setOpen(false);
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !respondedRef.current) respond(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Quit Ideafy?</AlertDialogTitle>
          <AlertDialogDescription>
            Any in-flight Claude sessions and background tasks will stop.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => respond(false)}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => respond(true)}>
            Quit
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
