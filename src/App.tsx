import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Button } from "@/components/ui/button";

export default function App() {
  const ping = useQuery(api.system.ping);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">LevelWell Social</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Tauri v2 · React · shadcn/ui · Convex
        </p>
      </div>
      <Button onClick={() => window.location.reload()}>Reload</Button>
      <p className="text-muted-foreground font-mono text-xs">
        {ping === undefined
          ? "Connecting to Convex…"
          : `Convex connected · server time ${new Date(ping.serverTime).toLocaleTimeString()}`}
      </p>
    </main>
  );
}
