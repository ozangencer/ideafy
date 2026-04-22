import type { MetadataRoute } from "next";
import {
  getBrandAssetPath,
  readProductNameFromPackageJson,
  resolveBrandVariant,
} from "@/lib/branding";

export default function manifest(): MetadataRoute.Manifest {
  const variant = resolveBrandVariant({
    envVariant:
      process.env.IDEAFY_BRAND_VARIANT ?? process.env.NEXT_PUBLIC_IDEAFY_BRAND_VARIANT,
    productName: readProductNameFromPackageJson(),
  });

  return {
    name: "ideafy",
    short_name: "ideafy",
    description: "Development workflow management for solo founders",
    start_url: "/",
    display: "standalone",
    background_color: "#0d0d0d",
    theme_color: variant === "personal" ? "#4DA3FF" : "#f59e0b",
    icons: [
      {
        src: getBrandAssetPath("/favicon-48x48.png", variant),
        sizes: "48x48",
        type: "image/png",
      },
      {
        src: getBrandAssetPath("/favicon-96x96.png", variant),
        sizes: "96x96",
        type: "image/png",
      },
      {
        src: getBrandAssetPath("/icon-192.png", variant),
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: getBrandAssetPath("/icon-512.png", variant),
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: getBrandAssetPath("/icon-512.png", variant),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
