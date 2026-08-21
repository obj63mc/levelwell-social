import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { clearSessionToken, useSessionToken } from "@/lib/session";
import { Skeleton } from "@/components/ui/skeleton";
import ConnectMeta from "@/views/ConnectMeta";
import Dashboard from "@/views/Dashboard";

export default function App() {
  const sessionToken = useSessionToken();
  const status = useQuery(api.profiles.connectionStatus, sessionToken ? { sessionToken } : "skip");
  const stale = sessionToken !== null && status !== undefined && !status.connected;

  // A revoked/unknown token: forget it so the Connect screen shows.
  useEffect(() => {
    if (stale) clearSessionToken();
  }, [stale]);

  if (!sessionToken || stale) return <ConnectMeta />;
  if (status === undefined) {
    return (
      <main className="flex min-h-svh items-center justify-center p-8">
        <div className="w-full max-w-xl space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </main>
    );
  }
  return <Dashboard status={status} sessionToken={sessionToken} />;
}
