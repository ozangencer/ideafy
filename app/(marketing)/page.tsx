import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { ScreenshotShowcase } from "@/components/landing/screenshot-showcase";
import { ExecutionPipeline } from "@/components/landing/execution-pipeline";
import { Deployment } from "@/components/landing/deployment";
import { CtaFooter } from "@/components/landing/cta-footer";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <ScreenshotShowcase />
      <Features />
      <ExecutionPipeline />
      <Deployment />
      <CtaFooter />
    </>
  );
}
