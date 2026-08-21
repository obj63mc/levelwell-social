import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";
import ConnectMeta from "@/views/ConnectMeta";
import Dashboard from "@/views/Dashboard";

export default function App() {
  const status = useQuery(api.profiles.connectionStatus, {});

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
  if (!status.connected) return <ConnectMeta />;
  return <Dashboard status={status} />;
}
