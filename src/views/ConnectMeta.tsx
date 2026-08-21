import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AlertCircle, CheckCircle2, ExternalLink } from "lucide-react";
import { FacebookIcon, InstagramIcon } from "@/components/icons";
import { api } from "../../convex/_generated/api";
import { openExternal } from "@/lib/external";
import { setSessionToken } from "@/lib/session";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

const STEPS = [
  "Click “Continue with Facebook”. Your default browser opens Meta’s login.",
  "Sign in and choose the Facebook Pages and Instagram accounts LevelWell Social may manage. Keep every permission checked.",
  "Come back here — the app updates automatically once Meta confirms.",
];

export default function ConnectMeta() {
  const start = useMutation(api.meta.oauth.start);
  const claimSession = useMutation(api.meta.oauth.claimSession);
  const [attempt, setAttempt] = useState<{ state: string; url: string } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const status = useQuery(api.meta.oauth.status, attempt ? { state: attempt.state } : "skip");

  const completed = status?.status === "completed";
  const waiting = attempt !== null && !localError && (status === undefined || status?.status === "pending" || status?.status === "in_progress" || completed);
  const failed = status?.status === "failed" ? (status.error ?? "Connection failed.") : localError;

  // Meta confirmed in the browser: claim this app's session exactly once.
  // Storing the token flips the App gate to the Dashboard.
  useEffect(() => {
    if (!completed || !attempt) return;
    const state = attempt.state;
    claimSession({ state })
      .then(({ sessionToken }) => setSessionToken(sessionToken))
      .catch((e: unknown) => {
        setLocalError(e instanceof Error ? e.message : String(e));
        setAttempt(null);
      });
  }, [completed, attempt, claimSession]);

  async function begin() {
    setLocalError(null);
    try {
      const next = await start({});
      setAttempt(next);
      await openExternal(next.url);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
      setAttempt(null);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-8">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <FacebookIcon className="size-5" />
            <InstagramIcon className="size-5" />
          </div>
          <CardTitle className="text-2xl">Connect your Meta accounts</CardTitle>
          <CardDescription>
            LevelWell Social posts to Facebook Pages and Instagram through Meta. Link them once — tokens are stored
            securely on the server, never on this Mac.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <CheckCircle2 />
            <AlertTitle>Before you start</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                <li>Each Instagram account is a Professional account linked to a Facebook Page you admin.</li>
                <li>Your Facebook account has a role (admin or tester) on the LevelWell Social Meta app.</li>
              </ul>
            </AlertDescription>
          </Alert>

          <ol className="space-y-3">
            {STEPS.map((text, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                  {i + 1}
                </span>
                <span className="leading-6">{text}</span>
              </li>
            ))}
          </ol>

          {failed && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Connection failed</AlertTitle>
              <AlertDescription>{failed}</AlertDescription>
            </Alert>
          )}
        </CardContent>
        <Separator />
        <CardFooter className="flex items-center justify-between gap-4 pt-6">
          {waiting ? (
            <>
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Spinner />
                {completed ? "Finishing up…" : "Waiting for Facebook… finish in your browser."}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { if (attempt) void openExternal(attempt.url); }}>
                  <ExternalLink /> Open again
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setAttempt(null)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-muted-foreground text-xs">Opens facebook.com in your browser.</p>
              <Button onClick={() => void begin()}>
                <FacebookIcon /> {failed ? "Try again" : "Continue with Facebook"}
              </Button>
            </>
          )}
        </CardFooter>
      </Card>
    </main>
  );
}
