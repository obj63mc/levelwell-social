import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Server, Settings2, TriangleAlert, Unplug } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { FacebookIcon, InstagramIcon } from "@/components/icons";
import { api } from "../../convex/_generated/api";
import { clearDeployment, useDeployment } from "@/lib/deployment";
import { clearSessionToken } from "@/lib/session";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Calendar from "@/views/Calendar";
import Composer, { type Channel } from "@/views/Composer";
import Queue from "@/views/Queue";
import Settings from "@/views/Settings";

export type ConnectionStatus = FunctionReturnType<typeof api.profiles.connectionStatus>;
export type ProfileSummary = ConnectionStatus["profiles"][number];

export default function Dashboard({ status, sessionToken }: { status: ConnectionStatus; sessionToken: string }) {
  const disconnect = useMutation(api.meta.oauth.disconnect);
  const deployment = useDeployment();
  const connection = status.connection!;
  // Only an active membership may be queried — requirePageAccess refuses the
  // rest — so the landing view must never land on a needs_reconnect Page.
  const primary = status.profiles.find((p) => p.status === "active") ?? status.profiles[0];
  const usable = primary?.status === "active" ? primary : undefined;
  const [composing, setComposing] = useState<Channel | null>(null);
  const [view, setView] = useState<"home" | "settings">("home");
  const webflow = useQuery(api.webflow.status, { sessionToken });

  async function end() {
    try {
      await disconnect({ sessionToken });
    } finally {
      clearSessionToken();
    }
  }

  // A session token is minted by one deployment and meaningless on another, so
  // dropping the deployment drops the session with it.
  function changeDeployment() {
    clearSessionToken();
    clearDeployment();
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
              <div key={p._id} className="flex items-center gap-3 px-1.5 py-2 text-sm">
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
                    {p.missingTasks.length > 0 && (
                      <Badge variant="destructive" title={`Meta granted only partial access to this Page. Missing: ${p.missingTasks.join(", ")}. You need full control of the Page (Page Settings → Page access).`}>
                        <TriangleAlert /> Partial access
                      </Badge>
                    )}
                    {!p.webhookSubscribed && <Badge variant="outline">Webhook not subscribed</Badge>}
                  </div>
                </div>
              </div>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">Connected as {connection.metaUserName} on Facebook</DropdownMenuLabel>
              {deployment && (
                <DropdownMenuLabel className="text-muted-foreground truncate text-xs font-normal">
                  {deployment.convexUrl.replace(/^https:\/\//, "")}
                </DropdownMenuLabel>
              )}
            </DropdownMenuGroup>
            {webflow?.enabled && (
              <DropdownMenuItem onClick={() => { setComposing(null); setView("settings"); }}>
                <Settings2 /> Webflow settings…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={changeDeployment}>
              <Server /> Change Convex deployment…
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => void end()}>
              <Unplug /> Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {view === "settings" ? (
        <Settings sessionToken={sessionToken} onBack={() => setView("home")} />
      ) : composing ? (
        <Composer
          sessionToken={sessionToken}
          // Only Pages the caller may actually act on: the composer defaults to
          // the first entry, and posting to a stale membership is refused.
          profiles={status.profiles.filter((p) => p.status === "active")}
          initialChannel={composing}
          onDone={() => setComposing(null)}
          onCancel={() => setComposing(null)}
        />
      ) : (
        <>
          <section aria-label="Quick post" className="grid gap-4 sm:grid-cols-2">
            <Button size="lg" className="h-16 text-base" onClick={() => setComposing("facebook")} disabled={!usable}>
              <FacebookIcon className="size-5" /> Post to Facebook
            </Button>
            <Button
              size="lg"
              className="bg-teal text-teal-foreground hover:bg-teal/90 h-16 text-base"
              onClick={() => setComposing("instagram")}
              disabled={!usable?.igUsername}
            >
              <InstagramIcon className="size-5" /> Post to Instagram
            </Button>
          </section>

          {usable ? (
            <>
              <Calendar sessionToken={sessionToken} profileId={usable._id} />
              <Queue sessionToken={sessionToken} profileId={usable._id} />
            </>
          ) : (
            <Alert>
              <TriangleAlert />
              <AlertTitle>No Page is connected</AlertTitle>
              <AlertDescription>
                {status.profiles.length === 0
                  ? "No Pages are assigned to this account yet."
                  : "The Pages on this account all need reconnecting. Open the avatar menu to reconnect."}
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </main>
  );
}
