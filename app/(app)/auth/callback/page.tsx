"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/team/supabase";

export default function AuthCallback() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const handleCallback = async () => {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setStatus("error");
        setErrorMessage("Supabase not configured");
        return;
      }

      // Check if tokens are in hash fragment (implicit flow from Electron)
      const hash = window.location.hash;
      const params = new URLSearchParams(hash.replace("#", ""));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken && refreshToken) {
        // Implicit flow - set session directly
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          setStatus("error");
          setErrorMessage(error.message);
          return;
        }

        // Relay tokens to API for Electron to pick up
        try {
          await fetch("/api/team/auth/token-relay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
          });
        } catch { /* non-critical */ }

        setStatus("success");
        return;
      }

      // PKCE flow - exchange code for session (normal browser OAuth)
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) {
          setStatus("error");
          setErrorMessage(error.message);
          return;
        }

        setStatus("success");
        setTimeout(() => { window.location.href = "/app"; }, 1000);
        return;
      }

      setStatus("error");
      setErrorMessage("No auth code or tokens found");
    };

    handleCallback();
  }, []);

  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="text-center space-y-4">
        {status === "loading" && (
          <>
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-muted-foreground">Signing you in...</p>
          </>
        )}
        {status === "success" && (
          <>
            <p className="text-green-500 font-medium">Signed in successfully</p>
            <p className="text-muted-foreground text-sm">You can close this tab and return to the app.</p>
          </>
        )}
        {status === "error" && (
          <>
            <p className="text-destructive font-medium">Sign in failed</p>
            <p className="text-muted-foreground text-sm">{errorMessage}</p>
            <a href="/app" className="text-sm text-primary hover:underline">
              Go back
            </a>
          </>
        )}
      </div>
    </div>
  );
}
