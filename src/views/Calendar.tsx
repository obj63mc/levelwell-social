import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { FacebookIcon, InstagramIcon } from "@/components/icons";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { openExternal } from "@/lib/external";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_LABEL } from "@/lib/posts";

type Post = FunctionReturnType<typeof api.posts.listRange>[number];

const CELLS = 42; // 6 weeks — a fixed height so the card doesn't jump between months
const MAX_CHIPS = 2;

// Calendar arithmetic stays in local time: adding days as milliseconds drifts an
// hour across a DST boundary and would move posts onto the wrong day.
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export default function Calendar({ sessionToken, profileId }: { sessionToken: string; profileId: Id<"profiles"> }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedId, setSelectedId] = useState<Id<"posts"> | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const detail = useRef<HTMLDivElement>(null);

  // Weeks start Sunday, so getDay() is the offset back to the grid's first cell.
  const gridStart = useMemo(() => addDays(startOfMonth(month), -startOfMonth(month).getDay()), [month]);
  const days = useMemo(() => Array.from({ length: CELLS }, (_, i) => addDays(gridStart, i)), [gridStart]);

  const posts = useQuery(api.posts.listRange, {
    sessionToken,
    profileId,
    start: gridStart.getTime(),
    end: addDays(gridStart, CELLS).getTime(),
  });
  // Month navigation re-subscribes and briefly yields undefined; keep the last
  // result on screen so the grid doesn't flash empty on every arrow click.
  const [cached, setCached] = useState<Post[] | null>(null);
  if (posts !== undefined && posts !== cached) setCached(posts);
  const visible = posts ?? cached;

  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const post of visible ?? []) {
      const key = dayKey(new Date(post.scheduledAt));
      const list = map.get(key);
      if (list) list.push(post);
      else map.set(key, [post]);
    }
    for (const list of map.values()) list.sort((a, b) => a.scheduledAt - b.scheduledAt);
    return map;
  }, [visible]);

  const selected = visible?.find((p) => p._id === selectedId) ?? null;
  useEffect(() => {
    if (selected) detail.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  function goto(next: Date) {
    setMonth(next);
    setSelectedId(null);
    setExpandedDay(null);
  }

  const todayKey = dayKey(new Date());
  const thisMonth = startOfMonth(new Date()).getTime() === month.getTime();

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="size-4" /> Calendar
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => goto(addMonths(month, -1))}>
            <ChevronLeft />
          </Button>
          <span className="min-w-40 text-center text-sm font-medium">
            {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => goto(addMonths(month, 1))}>
            <ChevronRight />
          </Button>
          <Button variant="outline" size="sm" className="ml-2" disabled={thisMonth} onClick={() => goto(startOfMonth(new Date()))}>
            Today
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {visible === null ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <>
            <div className="text-muted-foreground mb-1 grid grid-cols-7 text-xs">
              {days.slice(0, 7).map((d) => (
                <div key={d.getDay()} className="px-1 py-1 font-medium">
                  {d.toLocaleDateString(undefined, { weekday: "short" })}
                </div>
              ))}
            </div>
            <div className="bg-border grid grid-cols-7 gap-px overflow-hidden rounded-md border">
              {days.map((day) => {
                const key = dayKey(day);
                const list = byDay.get(key) ?? [];
                const expanded = expandedDay === key;
                const shown = expanded ? list : list.slice(0, MAX_CHIPS);
                return (
                  <div key={key} className={cn("bg-card min-h-24 space-y-1 p-1", day.getMonth() !== month.getMonth() && "bg-muted/40")}>
                    <div className="flex justify-end">
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full text-xs",
                          day.getMonth() !== month.getMonth() && "text-muted-foreground",
                          key === todayKey && "bg-primary text-primary-foreground font-medium",
                        )}
                      >
                        {day.getDate()}
                      </span>
                    </div>
                    {shown.map((post) => (
                      <Chip key={post._id} post={post} selected={post._id === selectedId} onSelect={() => setSelectedId(post._id)} />
                    ))}
                    {!expanded && list.length > MAX_CHIPS && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground w-full px-1 text-left text-xs"
                        onClick={() => setExpandedDay(key)}
                      >
                        +{list.length - MAX_CHIPS} more
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {byDay.size === 0 && <p className="text-muted-foreground mt-3 text-sm">No posts this month.</p>}
          </>
        )}

        {selected && (
          <div ref={detail}>
            <Separator className="my-4" />
            <Detail post={selected} onClose={() => setSelectedId(null)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function chipTint(status: Post["status"]): string {
  if (status === "published") return "bg-teal/15 text-foreground hover:bg-teal/25";
  if (status === "failed" || status === "partially_failed") return "bg-destructive/15 text-foreground hover:bg-destructive/25";
  if (status === "canceled") return "text-muted-foreground line-through";
  return "bg-primary/10 text-foreground hover:bg-primary/20";
}

function Chip({ post, selected, onSelect }: { post: Post; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={post.caption || "No caption"}
      className={cn(
        "flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs",
        chipTint(post.status),
        selected && "ring-ring ring-2",
      )}
    >
      {post.targets.facebook && <FacebookIcon className="size-3 shrink-0" />}
      {post.targets.instagram && <InstagramIcon className="size-3 shrink-0" />}
      <span className="truncate">{time(post.scheduledAt)}</span>
    </button>
  );
}

function Detail({ post, onClose }: { post: Post; onClose: () => void }) {
  const thumb = post.media[0];
  const links = [
    { channel: "facebook" as const, label: "Open on Facebook", icon: <FacebookIcon />, state: post.facebook },
    { channel: "instagram" as const, label: "Open on Instagram", icon: <InstagramIcon />, state: post.instagram },
  ].filter((l) => post.targets[l.channel]);

  return (
    <div className="flex gap-4">
      <div className="bg-muted size-20 shrink-0 overflow-hidden rounded-md">
        {thumb?.url &&
          (thumb.kind === "image" ? (
            <img src={thumb.url} alt="" className="size-full object-cover" />
          ) : (
            <video src={thumb.url} className="size-full object-cover" muted />
          ))}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={post.status === "failed" || post.status === "partially_failed" ? "destructive" : post.status === "published" ? "default" : "secondary"}>
            {STATUS_LABEL[post.status]}
          </Badge>
          {links.map((l) => (
            <Badge key={l.channel} variant="outline" title={l.state?.error}>
              {l.icon} {l.state?.status ?? "pending"}
            </Badge>
          ))}
          {post.demo && <Badge variant="secondary">Demo</Badge>}
          <span className="text-muted-foreground text-xs">
            {new Date(post.scheduledAt).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })}
          </span>
        </div>

        <p className="text-sm whitespace-pre-wrap">{post.caption || <span className="text-muted-foreground">No caption</span>}</p>
        {post.igCaption && (
          <p className="text-muted-foreground text-xs whitespace-pre-wrap">
            <InstagramIcon className="mr-1 inline size-3" />
            {post.igCaption}
          </p>
        )}
        {post.fbCaption && (
          <p className="text-muted-foreground text-xs whitespace-pre-wrap">
            <FacebookIcon className="mr-1 inline size-3" />
            {post.fbCaption}
          </p>
        )}
        {(post.fbFirstComment || post.igFirstComment) && (
          <p className="text-muted-foreground text-xs whitespace-pre-wrap">
            <span className="font-medium">First comment: </span>
            {post.fbFirstComment ?? post.igFirstComment}
          </p>
        )}
        {post.lastError && <p className="text-destructive text-xs">{post.lastError}</p>}

        <div className="flex flex-wrap gap-2 pt-1">
          {links.map((l) =>
            l.state?.permalink ? (
              <Button key={l.channel} variant="outline" size="sm" onClick={() => void openExternal(l.state!.permalink!)}>
                {l.icon} {l.label} <ExternalLink />
              </Button>
            ) : l.state?.status === "published" ? (
              <span key={l.channel} className="text-muted-foreground text-xs">
                No link recorded for {l.channel === "facebook" ? "Facebook" : "Instagram"}.
              </span>
            ) : null,
          )}
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
        <X />
      </Button>
    </div>
  );
}
