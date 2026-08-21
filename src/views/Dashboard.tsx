import { useMutation } from "convex/react";
import { CalendarDays, TriangleAlert, Unplug } from "lucide-react";
import { InstagramIcon } from "@/components/icons";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ConnectionStatus = FunctionReturnType<typeof api.profiles.connectionStatus>;

export default function Dashboard({ status }: { status: ConnectionStatus }) {
  const disconnect = useMutation(api.meta.oauth.disconnect);
  const connection = status.connection!;

  return (
    <main className="mx-auto flex min-h-svh max-w-6xl flex-col gap-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">Connected as {connection.metaUserName} on Facebook</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void disconnect({ connectionId: connection._id })}>
          <Unplug /> Disconnect
        </Button>
      </header>

      <section aria-label="Connected profiles" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {status.profiles.map((p) => (
          <Card key={p._id} size="sm">
            <CardHeader className="flex-row items-center gap-3">
              <Avatar className="size-10">
                <AvatarImage src={p.pagePictureUrl} alt="" />
                <AvatarFallback>{p.pageName.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <CardTitle className="truncate">{p.pageName}</CardTitle>
                <CardDescription className="truncate">{p.pageCategory ?? "Facebook Page"}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              {p.igUsername ? (
                <Badge variant="secondary">
                  <InstagramIcon /> @{p.igUsername}
                </Badge>
              ) : (
                <Badge variant="outline">No Instagram linked</Badge>
              )}
              {p.status === "needs_reconnect" && (
                <Badge variant="destructive">
                  <TriangleAlert /> Needs reconnect
                </Badge>
              )}
              {!p.webhookSubscribed && <Badge variant="outline">Webhook not subscribed</Badge>}
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="flex-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="size-4" /> Calendar
          </CardTitle>
          <CardDescription>
            Month view of scheduled posts — Facebook and Instagram icons per day, linking to each post. Designed in the
            next UI session (see plans/UI.md).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border-muted-foreground/30 text-muted-foreground flex h-64 items-center justify-center rounded-lg border border-dashed text-sm">
            Calendar placeholder
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
