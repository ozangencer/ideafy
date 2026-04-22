import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { BackupScheduler } from "@/components/backup-scheduler";
import {
  getBrandAssetPath,
  readProductNameFromPackageJson,
  resolveBrandVariant,
} from "@/lib/branding";
import "./globals.css";

const brandVariant = resolveBrandVariant({
  envVariant:
    process.env.IDEAFY_BRAND_VARIANT ?? process.env.NEXT_PUBLIC_IDEAFY_BRAND_VARIANT,
  productName: readProductNameFromPackageJson(),
});

export const metadata: Metadata = {
  title: "ideafy",
  description: "Development workflow management for solo founders",
  icons: {
    icon: [
      { url: getBrandAssetPath("/favicon.ico", brandVariant), sizes: "48x48" },
      {
        url: getBrandAssetPath("/favicon-96x96.png", brandVariant),
        sizes: "96x96",
        type: "image/png",
      },
      {
        url: getBrandAssetPath("/favicon-48x48.png", brandVariant),
        sizes: "48x48",
        type: "image/png",
      },
      {
        url: getBrandAssetPath("/favicon-32x32.png", brandVariant),
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: getBrandAssetPath("/favicon-16x16.png", brandVariant),
        sizes: "16x16",
        type: "image/png",
      },
    ],
    apple: getBrandAssetPath("/apple-touch-icon.png", brandVariant),
  },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <TooltipProvider delayDuration={100} skipDelayDuration={0}>
            <BackupScheduler />
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
