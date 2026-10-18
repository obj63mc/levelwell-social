import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Plus, StickyNote, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { STATUS_LABEL } from "@/lib/posts";

type Post = FunctionReturnType<typeof api.posts.listRange>[number];
type Note = FunctionReturnType<typeof api.notes.listRange>[number];
type Selection = { kind: "post"; id: Id<"posts"> } | { kind: "note"; id: Id<"notes"> } | { kind: "newNote"; date: string };

const CELLS = 42; // 6 weeks — a fixed height so the card doesn't jump between months
const MAX_CHIPS = 2;
const NOTE_PREVIEW_WORDS = 5;

// Calendar arithmetic stays in local time: adding days as milliseconds drifts an
// hour across a DST boundary and would move posts onto the wrong day.
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Doubles as a note's `date`, so it must be the zero-padded YYYY-MM-DD the backend stores.
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDayKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const preview = (body: string) => body.split(/\s+/).slice(0, NOTE_PREVIEW_WORDS).join(" ");

// Month navigation re-subscribes and briefly yields undefined; keep the last
// result on screen so the grid doesn't flash empty on every arrow click.
function useLatest<T>(value: T | undefined): T | null {
  const [cached, setCached] = useState<T | null>(null);
  if (value !== undefined && value !== cached) setCached(value);
  return value ?? cached;
}

function bucketByDay<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

export default function Calendar({ sessionToken, profileId }: { sessionToken: string; profileId: Id<"profiles"> }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const detail = useRef<HTMLDivElement>(null);

  // Weeks start Sunday, so getDay() is the offset back to the grid's first cell.
  const gridStart = useMemo(() => addDays(startOfMonth(month), -startOfMonth(month).getDay()), [month]);
  const days = useMemo(() => Array.from({ length: CELLS }, (_, i) => addDays(gridStart, i)), [gridStart]);

  const gridEnd = addDays(gridStart, CELLS);
  const visible = useLatest(
    useQuery(api.posts.listRange, { sessionToken, profileId, start: gridStart.getTime(), end: gridEnd.getTime() }),
  );
  const notes = useLatest(useQuery(api.notes.listRange, { sessionToken, profileId, start: dayKey(gridStart), end: dayKey(gridEnd) }));

  const byDay = useMemo(() => {
    const map = bucketByDay(visible ?? [], (post) => dayKey(new Date(post.scheduledAt)));
    for (const list of map.values()) list.sort((a, b) => a.scheduledAt - b.scheduledAt);
    return map;
  }, [visible]);
  const notesByDay = useMemo(() => bucketByDay(notes ?? [], (note) => note.date), [notes]);

  const selectedPost = selection?.kind === "post" ? (visible?.find((p) => p._id === selection.id) ?? null) : null;
  const selectedNote = selection?.kind === "note" ? (notes?.find((n) => n._id === selection.id) ?? null) : null;
  const newNoteDate = selection?.kind === "newNote" ? selection.date : null;
  const hasDetail = selectedPost !== null || selectedNote !== null || newNoteDate !== null;
  useEffect(() => {
    if (hasDetail) detail.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [hasDetail, selection]);

  function goto(next: Date) {
    setMonth(next);
    setSelection(null);
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
                // Notes first, then posts, as one list so the overflow counts both.
                const items = [
                  ...(notesByDay.get(key) ?? []).map((note) => ({ kind: "note" as const, note })),
                  ...(byDay.get(key) ?? []).map((post) => ({ kind: "post" as const, post })),
                ];
                const expanded = expandedDay === key;
                const shown = expanded ? items : items.slice(0, MAX_CHIPS);
                return (
                  <div key={key} className={cn("group bg-card min-h-24 space-y-1 p-1", day.getMonth() !== month.getMonth() && "bg-muted/40")}>
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        aria-label="Add note"
                        title="Add note"
                        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2"
                        onClick={() => setSelection({ kind: "newNote", date: key })}
                      >
                        <Plus className="size-4" />
                      </button>
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
                    {shown.map((item) =>
                      item.kind === "note" ? (
                        <NoteChip
                          key={item.note._id}
                          note={item.note}
                          selected={selection?.kind === "note" && selection.id === item.note._id}
                          onSelect={() => setSelection({ kind: "note", id: item.note._id })}
                        />
                      ) : (
                        <Chip
                          key={item.post._id}
                          post={item.post}
                          selected={selection?.kind === "post" && selection.id === item.post._id}
                          onSelect={() => setSelection({ kind: "post", id: item.post._id })}
                        />
                      ),
                    )}
                    {!expanded && items.length > MAX_CHIPS && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground w-full px-1 text-left text-xs"
                        onClick={() => setExpandedDay(key)}
                      >
                        +{items.length - MAX_CHIPS} more
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {byDay.size === 0 && notesByDay.size === 0 && <p className="text-muted-foreground mt-3 text-sm">Nothing on the calendar this month.</p>}
          </>
        )}

        {hasDetail && (
          <div ref={detail}>
            <Separator className="my-4" />
            {selectedPost ? (
              <Detail post={selectedPost} onClose={() => setSelection(null)} />
            ) : (
              <NoteEditor
                // Remount per note so the textarea starts from that note's text.
                key={selectedNote?._id ?? `new-${newNoteDate}`}
                sessionToken={sessionToken}
                profileId={profileId}
                note={selectedNote}
                date={selectedNote?.date ?? newNoteDate!}
                onSaved={(id) => setSelection({ kind: "note", id })}
                onClose={() => setSelection(null)}
              />
            )}
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

function NoteChip({ note, selected, onSelect }: { note: Note; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={note.body}
      className={cn(
        "bg-note/20 text-foreground hover:bg-note/35 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs",
        selected && "ring-ring ring-2",
      )}
    >
      <StickyNote className="size-3 shrink-0" />
      <span className="truncate">{preview(note.body)}</span>
    </button>
  );
}

function NoteEditor({
  sessionToken,
  profileId,
  note,
  date,
  onSaved,
  onClose,
}: {
  sessionToken: string;
  profileId: Id<"profiles">;
  note: Note | null;
  date: string;
  onSaved: (id: Id<"notes">) => void;
  onClose: () => void;
}) {
  const create = useMutation(api.notes.create);
  const update = useMutation(api.notes.update);
  const remove = useMutation(api.notes.remove);
  const [body, setBody] = useState(note?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e && typeof e === "object" && "data" in e && typeof e.data === "string" ? e.data : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    act(async () => {
      if (note) await update({ sessionToken, noteId: note._id, body });
      else onSaved(await create({ sessionToken, profileId, date, body }));
    });

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <StickyNote className="text-note size-4" />
          {parseDayKey(date).toLocaleDateString(undefined, { dateStyle: "full" })}
        </div>
        <Textarea autoFocus value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a note for this day…" className="min-h-24" />
        {error && <p className="text-destructive text-xs">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy || !body.trim() || body === note?.body} onClick={() => void save()}>
            Save
          </Button>
          {note && (
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void act(async () => {
                await remove({ sessionToken, noteId: note._id });
                onClose();
              })}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
        <X />
      </Button>
    </div>
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
