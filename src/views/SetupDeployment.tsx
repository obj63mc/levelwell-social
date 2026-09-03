import { useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { AlertCircle, Server } from "lucide-react";
import { api } from "../../convex/_generated/api";
import {
  isWrongKind,
  normalizeConvexUrl,
  setDeployment,
  siteUrlFor,
  type Deployment,
} from "@/lib/deployment";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

const PROBE_TIMEOUT_MS = 10_000;

/** Reaches the deployment to prove it exists and runs this app's backend. */
async function probe(convexUrl: string): Promise<string | null> {
  const client = new ConvexHttpClient(convexUrl);
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), PROBE_TIMEOUT_MS),
  );
  try {
    await Promise.race([client.query(api.system.ping, {}), timeout]);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/could not find public function|Could not find function/i.test(message)) {
      return "That deployment is reachable, but the LevelWell Social backend isn’t deployed to it. Run `npx convex deploy` against it first.";
    }
    if (message === "timeout") return "That deployment didn’t respond in time. Check the URL and your connection.";
    return "Couldn’t reach that deployment. Check the URL and your connection.";
  }
}

export default function SetupDeployment({
  initial,
  title = "Connect to your Convex deployment",
  onCancel,
}: {
  initial?: Deployment;
  title?: string;
  onCancel?: () => void;
}) {
  const [cloud, setCloud] = useState(initial?.convexUrl ?? "");
  const [site, setSite] = useState(initial?.siteUrl ?? "");
  // Once the site field is hand-edited it stops tracking the deployment field.
  const [siteTouched, setSiteTouched] = useState(initial !== undefined);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  function editCloud(value: string) {
    setCloud(value);
    if (!siteTouched) setSite(siteUrlFor(value));
  }

  async function submit() {
    setCloudError(null);
    setSiteError(null);
    setError(null);

    const convexUrl = normalizeConvexUrl(cloud, "cloud");
    const siteUrl = normalizeConvexUrl(site, "site");
    if (!convexUrl) {
      setCloudError(
        isWrongKind(cloud, "cloud")
          ? "That’s the HTTP actions URL. This field wants the .convex.cloud one."
          : "Enter a deployment URL ending in .convex.cloud",
      );
    }
    if (!siteUrl) {
      setSiteError(
        isWrongKind(site, "site")
          ? "That’s the deployment URL. This field wants the .convex.site one."
          : "Enter an HTTP actions URL ending in .convex.site",
      );
    }
    if (!convexUrl || !siteUrl) return;

    setChecking(true);
    const failure = await probe(convexUrl);
    setChecking(false);
    if (failure) {
      setError(failure);
      return;
    }
    setDeployment({ convexUrl, siteUrl });
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-8">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <div className="text-muted-foreground mb-2">
            <Server className="size-5" />
          </div>
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription>
            LevelWell Social runs on a Convex backend you host yourself — nothing is shared with anyone else. Deploy the
            backend with <code className="font-mono text-xs">npx convex deploy</code>, then paste the two URLs it prints.
            Setup instructions are in the project README.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form
            id="deployment-form"
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="convex-url">Deployment URL</Label>
              <Input
                id="convex-url"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                placeholder="https://<deployment>.convex.cloud"
                value={cloud}
                onChange={(e) => editCloud(e.target.value)}
                aria-invalid={cloudError !== null}
                aria-describedby="convex-url-hint"
              />
              <p id="convex-url-hint" className="text-muted-foreground text-xs">
                {cloudError ?? "Functions and realtime updates. Ends in .convex.cloud."}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="site-url">HTTP actions URL</Label>
              <Input
                id="site-url"
                spellCheck={false}
                autoComplete="off"
                placeholder="https://<deployment>.convex.site"
                value={site}
                onChange={(e) => {
                  setSiteTouched(true);
                  setSite(e.target.value);
                }}
                aria-invalid={siteError !== null}
                aria-describedby="site-url-hint"
              />
              <p id="site-url-hint" className="text-muted-foreground text-xs">
                {siteError ?? "The Facebook OAuth callback and Meta webhooks. Usually the same name on .convex.site."}
              </p>
            </div>
          </form>

          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Couldn’t connect</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
        <Separator />
        <CardFooter className="flex items-center justify-between gap-4 pt-6">
          <p className="text-muted-foreground text-xs">Stored on this Mac only. You can change it later.</p>
          <div className="flex gap-2">
            {onCancel && (
              <Button variant="ghost" type="button" onClick={onCancel} disabled={checking}>
                Cancel
              </Button>
            )}
            <Button type="submit" form="deployment-form" disabled={checking}>
              {checking ? (
                <>
                  <Spinner /> Checking…
                </>
              ) : (
                "Continue"
              )}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </main>
  );
}
