import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarClock, ChevronDown, ChevronRight, RotateCcw, TriangleAlert, XCircle } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { FacebookIcon, InstagramIcon } from "@/components/icons";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/media";
import { STATUS_LABEL } from "@/lib/posts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Post = FunctionReturnType<typeof api.posts.listActive>[number];

const needsAttention = (post: Post) => post.status === "failed" || post.status === "partially_failed";

export default function Queue({ sessionToken, profileId }: { sessionToken: string; profileId: Id<"profiles"> }) {
  // null = follow the data: open when something failed, collapsed otherwise.
  const [open, setOpen] = useState<boolean | null>(null);
  const posts = useQuery(api.posts.listActive, { sessionToken, profileId });

  if (posts === undefined) return <Skeleton className="h-24 w-full" />;
  const problems = posts.filter(needsAttention).length;
  const upcoming = posts.length - problems;
  const expanded = open ?? problems > 0;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="flex items-center gap-2 text-left"
          aria-expanded={expanded}
          onClick={() => setOpen(!expanded)}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <CardTitle>Queue</CardTitle>
          {problems > 0 && (
            <Badge variant="destructive">
              <TriangleAlert /> {problems} need{problems === 1 ? "s" : ""} attention
            </Badge>
          )}
          <Badge variant="secondary">{upcoming} upcoming</Badge>
        </button>
      </CardHeader>
      {expanded && (
        <CardContent className="divide-y">
          {posts.length === 0 ? (
            <CardDescription>Nothing scheduled. Use the buttons above to create a post.</CardDescription>
          ) : (
            posts.map((post) => <Row key={post._id} post={post} sessionToken={sessionToken} />)
          )}
        </CardContent>
      )}
    </Card>
  );
}

function Row({ post, sessionToken }: { post: Post; sessionToken: string }) {
  const cancel = useMutation(api.posts.cancel);
  const retry = useMutation(api.posts.retry);
  const reschedule = useMutation(api.posts.reschedule);
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(() => toLocalInputValue(post.scheduledAt));
  const [error, setError] = useState<string | null>(null);
  const thumb = post.media[0];

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      setEditing(false);
    } catch (e) {
      setError(e && typeof e === "object" && "data" in e && typeof e.data === "string" ? e.data : e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex gap-4 py-4 first:pt-0 last:pb-0">
      <div className="bg-muted size-16 shrink-0 overflow-hidden rounded-md">
        {thumb?.url && (thumb.kind === "image" ? <img src={thumb.url} alt="" className="size-full object-cover" /> : <video src={thumb.url} className="size-full object-cover" muted />)}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={post.status === "failed" || post.status === "partially_failed" ? "destructive" : post.status === "published" ? "default" : "secondary"}>
            {STATUS_LABEL[post.status]}
          </Badge>
          {post.targets.facebook && (
            <Badge variant="outline" title={post.facebook?.error}>
              <FacebookIcon /> {post.facebook?.status ?? "pending"}
            </Badge>
          )}
          {post.targets.instagram && (
            <Badge variant="outline" title={post.instagram?.error}>
              <InstagramIcon /> {post.instagram?.status ?? "pending"}
            </Badge>
          )}
          <span className="text-muted-foreground text-xs">
            {new Date(post.scheduledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </span>
        </div>
        <p className="truncate text-sm">{post.caption || <span className="text-muted-foreground">No caption</span>}</p>
        {(post.lastError || error) && <p className="text-destructive text-xs">{error ?? post.lastError}</p>}
        {[post.facebook?.commentError, post.instagram?.commentError].filter(Boolean).map((message) => (
          <p key={message} className="text-muted-foreground text-xs">
            {message}
          </p>
        ))}
        {editing && (
          <div className="flex items-center gap-2 pt-1">
            <Input type="datetime-local" className="w-auto" value={when} onChange={(e) => setWhen(e.target.value)} />
            <Button size="sm" onClick={() => void act(() => reschedule({ sessionToken, postId: post._id, scheduledAt: fromLocalInputValue(when) }))}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-start gap-1">
        {post.status === "scheduled" && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
              <CalendarClock /> Reschedule
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void act(() => cancel({ sessionToken, postId: post._id }))}>
              <XCircle /> Cancel
            </Button>
          </>
        )}
        {(post.status === "failed" || post.status === "partially_failed") && (
          <Button size="sm" variant="ghost" onClick={() => void act(() => retry({ sessionToken, postId: post._id }))}>
            <RotateCcw /> Retry
          </Button>
        )}
      </div>
    </div>
  );
}
