import { OttoSpotlight } from "./OttoSpotlight";
import { OttoModalHost } from "./OttoModalHost";
import { Senvia2Guide } from "./Senvia2Guide";

// Single mount point for Otto's visual layer (spotlight tours + managed modals).
// Otto no longer opens itself or floats: onboarding lives in the dashboard card
// (OttoDashboardSetup). The chat opens only on user action (sidebar entry, or a
// setup task that routes through Otto).
export function OttoOnboardingUI() {
  return (
    <>
      <OttoSpotlight />
      <OttoModalHost />
      <Senvia2Guide />
    </>
  );
}
