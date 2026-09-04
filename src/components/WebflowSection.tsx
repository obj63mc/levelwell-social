import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Combobox, ComboboxClear, ComboboxContent, ComboboxEmpty, ComboboxIcon, ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { BlogRef, WebflowDraft } from "@/lib/webflow";

type Props = {
  sessionToken: string;
  draft: WebflowDraft;
  onChange: (next: WebflowDraft) => void;
};

export default function WebflowSection({ sessionToken, draft, onChange }: Props) {
  const status = useQuery(api.webflow.status, { sessionToken });
  const [query, setQuery] = useState("");
  // Reads our own mirror of the collection, so typing here never calls Webflow.
  const results = useQuery(
    api.webflow.searchBlogPosts,
    status?.config ? { sessionToken, q: query, limit: 20 } : "skip",
  );

  if (!status?.enabled) return null;

  const set = (patch: Partial<WebflowDraft>) => onChange({ ...draft, ...patch });
  const configured = status.config !== null;
  const items: BlogRef[] = (results ?? []).map((r) => ({ value: r.itemId, label: r.name }));

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-medium">Webflow</div>
        <Switch
          id="webflow"
          checked={draft.on}
          disabled={!configured}
          onCheckedChange={(on) => set({ on })}
          aria-label="Also add this post to Webflow"
        />
      </div>

      {!configured ? (
        <p className="text-muted-foreground text-xs">
          Finish setting up Webflow in Settings to add posts to the CMS.
        </p>
      ) : !draft.on ? (
        <p className="text-muted-foreground text-xs">
          Also add an item to the {status.config?.collectionName} collection on {status.config?.siteName}.
        </p>
      ) : (
        <>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="wf-name">Name</Label>
            <Input
              id="wf-name"
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Name for the CMS item"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="wf-copy">Post Copy{status.config?.postCopyRequired ? "" : " (optional)"}</Label>
            <Textarea
              id="wf-copy"
              rows={3}
              value={draft.postCopy}
              onChange={(e) => set({ postCopy: e.target.value })}
              placeholder="Describe what you're linking to…"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="wf-blog">Blog Post</Label>
            {/* filter={null}: the results are already filtered by the Convex query. */}
            <Combobox<BlogRef>
              items={items}
              filter={null}
              value={draft.blog}
              onValueChange={(blog) => set({ blog })}
              inputValue={query}
              onInputValueChange={setQuery}
            >
              <ComboboxInputGroup>
                <ComboboxInput id="wf-blog" placeholder="Search blog posts…" />
                {draft.blog && <ComboboxClear />}
                <ComboboxIcon />
              </ComboboxInputGroup>
              <ComboboxContent>
                <ComboboxEmpty>
                  {results === undefined ? "Loading…" : status.blogCount === 0 ? "No blog posts synced yet." : "No matches."}
                </ComboboxEmpty>
                <ComboboxList>
                  {(item: BlogRef) => (
                    <ComboboxItem key={item.value} value={item}>
                      {item.label}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wf-link">Link</Label>
            <Input
              id="wf-link"
              type="url"
              value={draft.link}
              onChange={(e) => set({ link: e.target.value })}
              placeholder="https://…"
            />
          </div>

          <p className="text-muted-foreground text-xs">Select Blog Post or provide link to another page.</p>
        </>
      )}
    </div>
  );
}
