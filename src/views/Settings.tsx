import { useEffect, useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

type Site = { id: string; name: string; collections: { id: string; name: string }[] };
type Field = { slug: string; name: string; type: string; required: boolean; refCollectionId?: string };

// Which Webflow field types may back each of our four inputs. Mirrors FIELD_TYPES
// in convex/webflow.ts; saving re-checks it server-side.
const ALLOWED: Record<Slot, string[]> = {
  name: ["PlainText"],
  postCopy: ["PlainText", "RichText"],
  blogRef: ["Reference"],
  link: ["Link"],
};
type Slot = "name" | "postCopy" | "blogRef" | "link";
const SLOT_LABEL: Record<Slot, string> = {
  name: "Name",
  postCopy: "Post Copy",
  blogRef: "Blog Post reference",
  link: "Link",
};

function ago(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function Settings({ sessionToken, onBack }: { sessionToken: string; onBack: () => void }) {
  const status = useQuery(api.webflow.status, { sessionToken });
  const discover = useAction(api.webflow.discover);
  const describeCollection = useAction(api.webflow.describeCollection);
  const saveConfig = useAction(api.webflow.saveConfig);
  const refresh = useAction(api.webflow.refreshBlogPosts);

  const [sites, setSites] = useState<Site[] | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  // Keyed by collection so "which fields am I showing" is derived, never a
  // second piece of state that can disagree with `collectionId`.
  const [loaded, setLoaded] = useState<{ collectionId: string; fields: Field[] } | null>(null);
  const [mapping, setMapping] = useState<Record<Slot, string | null>>({ name: null, postCopy: null, blogRef: null, link: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "refresh">(null);
  const [saved, setSaved] = useState(false);

  // Discover sites + collections once, seeding the form from the saved config.
  useEffect(() => {
    if (!status?.enabled || sites) return;
    let live = true;
    discover({ sessionToken })
      .then((res) => {
        if (!live) return;
        setSites(res.sites);
        setSiteId(status.config?.siteId ?? (res.sites.length === 1 ? res.sites[0].id : null));
        if (status.config) {
          setCollectionId(status.config.collectionId);
          setMapping(status.config.fields);
        }
      })
      .catch((e) => live && setError(describe(e)));
    return () => {
      live = false;
    };
  }, [status, sites, discover, sessionToken]);

  // Load the chosen collection's fields whenever it changes.
  useEffect(() => {
    if (!collectionId) return;
    let live = true;
    describeCollection({ sessionToken, collectionId })
      .then((res) => live && setLoaded({ collectionId, fields: res.fields }))
      .catch((e) => live && setError(describe(e)));
    return () => {
      live = false;
    };
  }, [collectionId, describeCollection, sessionToken]);

  const site = sites?.find((s) => s.id === siteId) ?? null;
  const fields = loaded?.collectionId === collectionId ? loaded.fields : null;
  const loadingSites = status?.enabled === true && sites === null;
  const loadingFields = collectionId !== null && fields === null;
  const blogCollectionName = useMemo(() => {
    const ref = fields?.find((f) => f.slug === mapping.blogRef);
    if (!ref?.refCollectionId) return null;
    return site?.collections.find((c) => c.id === ref.refCollectionId)?.name ?? "linked collection";
  }, [fields, mapping.blogRef, site]);

  const complete = siteId && collectionId && (Object.keys(ALLOWED) as Slot[]).every((k) => mapping[k]);

  async function save() {
    if (!complete || !site) return;
    setError(null);
    setSaved(false);
    setBusy("save");
    try {
      await saveConfig({
        sessionToken,
        siteId: site.id,
        siteName: site.name,
        collectionId,
        fields: mapping as Record<Slot, string>,
      });
      setSaved(true);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function syncNow(full: boolean) {
    setError(null);
    setBusy("refresh");
    try {
      await refresh({ sessionToken, full });
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  if (status === undefined) {
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Webflow</CardTitle>
            <CardDescription>
              Mirror each social post into a Webflow CMS collection.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft /> Back
          </Button>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="space-y-6 pt-6">
        {!status.enabled ? (
          <Alert>
            <AlertCircle />
            <AlertTitle>Webflow is turned off</AlertTitle>
            <AlertDescription>
              Set a site token on this deployment to turn it on:
              <code className="bg-muted mt-2 block rounded px-2 py-1 text-xs">npx convex env set WEBFLOW_SITE_TOKEN &lt;token&gt;</code>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Site token detected</Badge>
              {status.config && <Badge variant="outline">{status.config.collectionName}</Badge>}
            </div>

            {loadingSites ? (
              <div className="flex items-center gap-2 text-sm">
                <Spinner /> Reading your Webflow site…
              </div>
            ) : (
              sites && (
                <>
                  {sites.length > 1 && (
                    <div className="space-y-2">
                      <Label>Site</Label>
                      <Select value={siteId} onValueChange={(v) => { setSiteId(v); setCollectionId(null); }}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a site" />
                        </SelectTrigger>
                        <SelectContent>
                          {sites.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Target collection</Label>
                    <Select value={collectionId} onValueChange={(v) => { setCollectionId(v); setMapping({ name: null, postCopy: null, blogRef: null, link: null }); }}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose the collection posts are added to" />
                      </SelectTrigger>
                      <SelectContent>
                        {(site?.collections ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {loadingFields ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Spinner /> Reading collection fields…
                    </div>
                  ) : (
                    fields && (
                      <div className="space-y-4">
                        <div className="text-sm font-medium">Field mapping</div>
                        {(Object.keys(ALLOWED) as Slot[]).map((slot) => {
                          const options = fields.filter((f) => ALLOWED[slot].includes(f.type));
                          return (
                            <div key={slot} className="space-y-2">
                              <Label>{SLOT_LABEL[slot]}</Label>
                              <Select
                                value={mapping[slot]}
                                onValueChange={(v) => setMapping((m) => ({ ...m, [slot]: v }))}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={options.length ? `Choose a ${ALLOWED[slot].join(" or ")} field` : `No ${ALLOWED[slot].join("/")} field on this collection`} />
                                </SelectTrigger>
                                <SelectContent>
                                  {options.map((f) => (
                                    <SelectItem key={f.slug} value={f.slug}>{f.name}{f.required ? " (required)" : ""}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })}
                        {blogCollectionName && (
                          <p className="text-muted-foreground text-xs">
                            Blog posts come from <strong>{blogCollectionName}</strong>, derived from the reference field above.
                          </p>
                        )}
                        <Button onClick={() => void save()} disabled={!complete || busy !== null}>
                          {busy === "save" ? <Spinner /> : null} Save mapping
                        </Button>
                        {saved && <p className="text-muted-foreground text-xs">Saved.</p>}
                      </div>
                    )
                  )}
                </>
              )
            )}

            {status.config && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="text-sm font-medium">Blog posts</div>
                  <p className="text-muted-foreground text-xs">
                    {status.blogCount.toLocaleString()} blog post{status.blogCount === 1 ? "" : "s"}
                    {status.blogSyncedAt ? ` · last checked ${ago(status.blogSyncedAt)}` : " · never checked"}. Checked automatically once a day.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => void syncNow(false)} disabled={busy !== null}>
                      {busy === "refresh" ? <Spinner /> : <RefreshCw />} Refresh
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void syncNow(true)} disabled={busy !== null}>
                      Re-sync all
                    </Button>
                  </div>
                  {status.blogSyncError && (
                    <Alert variant="destructive">
                      <AlertCircle />
                      <AlertTitle>Last sync failed</AlertTitle>
                      <AlertDescription>{status.blogSyncError}</AlertDescription>
                    </Alert>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Webflow error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function describe(e: unknown): string {
  if (e && typeof e === "object" && "data" in e && typeof e.data === "string") return e.data;
  return e instanceof Error ? e.message : String(e);
}
