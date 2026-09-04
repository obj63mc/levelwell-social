import { useMemo } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "@/App";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useDeployment, type Deployment } from "@/lib/deployment";
import { SiteUrlContext } from "@/lib/site-url";
import SetupDeployment from "@/views/SetupDeployment";

function ConfiguredApp({ deployment }: { deployment: Deployment }) {
  // One client per deployment URL: a client per render would leak WebSockets.
  const convex = useMemo(() => new ConvexReactClient(deployment.convexUrl), [deployment.convexUrl]);
  return (
    <ConvexProvider client={convex}>
      <SiteUrlContext value={deployment.siteUrl}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </SiteUrlContext>
    </ConvexProvider>
  );
}

/** No deployment configured yet — a fresh download — means setup comes first. */
export default function Root() {
  const deployment = useDeployment();
  if (!deployment) return <SetupDeployment />;
  // Remount on a deployment swap so no query state survives it.
  return <ConfiguredApp key={deployment.convexUrl} deployment={deployment} />;
}
