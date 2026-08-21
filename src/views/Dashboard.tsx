import { useState } from "react";
import { useMutation } from "convex/react";
import { CalendarDays, TriangleAlert, Unplug } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { FacebookIcon, InstagramIcon } from "@/components/icons";
import { api } from "../../convex/_generated/api";
import { clearSessionToken } from "@/lib/session";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Composer, { type Channel } from "@/views/Composer";
import Queue from "@/views/Queue";

export type ConnectionStatus = FunctionReturnType<typeof api.profiles.connectionStatus>;
export type ProfileSummary = ConnectionStatus["profiles"][number];

export default function Dashboard({ status, sessionToken }: { status: ConnectionStatus; sessionToken: string }) {
  const disconnect = useMutation(api.meta.oauth.disconnect);
  const connection = status.connection!;
  const primary = status.profiles[0];
  const [composing, setComposing] = useState<Channel | null>(null);

  async function end() {
    try {
      await disconnect({ sessionToken });
    } finally {
      clearSessionToken();
    }
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-6xl flex-col gap-6 p-8">
      <header className="flex items-center justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account"
            className="focus-visible:ring-ring rounded-full outline-none focus-visible:ring-2"
          >
            <Avatar className="size-10">
              <AvatarImage src={primary?.pagePictureUrl} alt="" />
              <AvatarFallback>{(primary?.pageName ?? connection.metaUserName).slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {status.profiles.map((p) => (
              <DropdownMenuLabel key={p._id} className="flex items-center gap-3 font-normal">
                <Avatar className="size-9">
                  <AvatarImage src={p.pagePictureUrl} alt="" />
                  <AvatarFallback>{p.pageName.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.pageName}</div>
                  <div className="text-muted-foreground truncate text-xs">{p.pageCategory ?? "Facebook Page"}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
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
                  </div>
                </div>
              </DropdownMenuLabel>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              Connected as {connection.metaUserName} on Facebook
            </DropdownMenuLabel>
            <DropdownMenuItem variant="destructive" onClick={() => void end()}>
              <Unplug /> Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {composing ? (
        <Composer
          sessionToken={sessionToken}
          profiles={status.profiles}
          initialChannel={composing}
          onDone={() => setComposing(null)}
          onCancel={() => setComposing(null)}
        />
      ) : (
        <>
          <section aria-label="Quick post" className="grid gap-4 sm:grid-cols-2">
            <Button size="lg" className="h-16 text-base" onClick={() => setComposing("facebook")} disabled={!primary}>
              <FacebookIcon className="size-5" /> Post to Facebook
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="h-16 text-base"
              onClick={() => setComposing("instagram")}
              disabled={!primary?.igUsername}
            >
              <InstagramIcon className="size-5" /> Post to Instagram
            </Button>
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="size-4" /> Calendar
              </CardTitle>
              <CardDescription>
                Month view of scheduled posts — Facebook and Instagram icons per day, linking to each post. Coming once
                posts are flowing (see plans/UI.md).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border-muted-foreground/30 text-muted-foreground flex h-40 items-center justify-center rounded-lg border border-dashed text-sm">
                Calendar placeholder
              </div>
            </CardContent>
          </Card>

          {primary && <Queue sessionToken={sessionToken} profileId={primary._id} />}
        </>
      )}
    </main>
  );
}
