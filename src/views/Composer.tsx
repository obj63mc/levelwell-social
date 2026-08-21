import { useMemo, useRef, useState } from "react";
import { useConvex, useMutation } from "convex/react";
import { AlertCircle, ArrowDown, ArrowUp, CalendarClock, ImagePlus, Info, Send, X } from "lucide-react";
import { FacebookIcon, InstagramIcon } from "@/components/icons";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ACCEPT, fromLocalInputValue, isPortrait, toLocalInputValue, uploadMedia, type LocalMedia } from "@/lib/media";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ProfileSummary } from "@/views/Dashboard";

export type Channel = "facebook" | "instagram";

type Props = {
  sessionToken: string;
  profiles: ProfileSummary[];
  initialChannel: Channel;
  onDone: () => void;
  onCancel: () => void;
};

const IG_CAPTION_MAX = 2200;

export default function Composer({ sessionToken, profiles, initialChannel, onDone, onCancel }: Props) {
  const convex = useConvex();
  const createPost = useMutation(api.posts.create);
  const removeMedia = useMutation(api.media.remove);
  const fileInput = useRef<HTMLInputElement>(null);

  const [profileId, setProfileId] = useState<Id<"profiles">>(profiles[0]._id);
  const profile = profiles.find((p) => p._id === profileId) ?? profiles[0];
  const igAvailable = !!profile.igUsername;
  const [facebook, setFacebook] = useState(initialChannel === "facebook");
  const [instagram, setInstagram] = useState(initialChannel === "instagram" && igAvailable);
  const [media, setMedia] = useState<LocalMedia[]>([]);
  const [uploading, setUploading] = useState(0);
  const [caption, setCaption] = useState("");
  const [collaborators, setCollaborators] = useState("");
  const [userTags, setUserTags] = useState("");
  const [altText, setAltText] = useState("");
  const [shareToFeed, setShareToFeed] = useState(true);
  const [fbAsReel, setFbAsReel] = useState(false);
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [when, setWhen] = useState(() => toLocalInputValue(Date.now() + 60 * 60_000));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Captured once per mount: "now" for validation/min-date without impure reads during render.
  const [openedAt] = useState(() => Date.now());

  const videos = media.filter((m) => m.kind === "video").length;
  const igFormat = media.length > 1 ? "carousel" : videos === 1 ? "reel" : media.length === 1 ? "image" : null;
  const fbMixed = media.length > 1 && videos > 0;
  const hashtags = (caption.match(/#\w/g) ?? []).length;
  const mentions = (caption.match(/@\w/g) ?? []).length;
  const singleVideo = media.length === 1 && media[0].kind === "video";
  const portraitVideo = singleVideo && isPortrait(media[0]);

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!facebook && !instagram) list.push("Pick at least one channel.");
    if (media.length === 0) list.push("Add a photo or video.");
    if (media.length > 10) list.push("At most 10 items per post.");
    if (facebook && fbMixed) list.push("Facebook multi-item posts can only contain photos.");
    if (instagram) {
      if (caption.length > IG_CAPTION_MAX) list.push(`Instagram captions are limited to ${IG_CAPTION_MAX} characters.`);
      if (hashtags > 30) list.push("Instagram allows at most 30 hashtags.");
      if (mentions > 20) list.push("Instagram allows at most 20 @mentions.");
      if (collaboratorList(collaborators).length > 3) list.push("At most 3 collaborators.");
    }
    if (mode === "schedule" && fromLocalInputValue(when) < openedAt + 60_000) list.push("Schedule at least a minute from now.");
    return list;
  }, [facebook, instagram, media, fbMixed, caption, hashtags, mentions, collaborators, mode, when, openedAt]);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading((n) => n + files.length);
    for (const file of Array.from(files)) {
      try {
        const item = await uploadMedia(convex, sessionToken, profileId, file);
        setMedia((list) => [...list, item]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  function move(index: number, delta: number) {
    setMedia((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function remove(item: LocalMedia) {
    setMedia((list) => list.filter((m) => m.mediaId !== item.mediaId));
    await removeMedia({ sessionToken, mediaId: item.mediaId }).catch(() => undefined);
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      await createPost({
        sessionToken,
        profileId,
        caption,
        mediaIds: media.map((m) => m.mediaId),
        targets: { facebook, instagram },
        ig: {
          collaborators: collaboratorList(collaborators),
          userTags: collaboratorList(userTags).map((username) => ({ username })),
          shareToFeed: igFormat === "reel" ? shareToFeed : undefined,
          altText: altText || undefined,
        },
        fbAsReel: singleVideo ? fbAsReel : undefined,
        scheduledAt: mode === "schedule" ? fromLocalInputValue(when) : undefined,
      });
      onDone();
    } catch (e) {
      setError(describe(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-3xl">
      <CardHeader>
        <CardTitle className="text-2xl">New post</CardTitle>
        <CardDescription>One asset set and caption, published to the channels you pick.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {profiles.length > 1 && (
          <div className="space-y-2">
            <Label htmlFor="page">Page</Label>
            <select
              id="page"
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              value={profileId}
              onChange={(e) => {
                setProfileId(e.target.value as Id<"profiles">);
                setMedia([]);
              }}
            >
              {profiles.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.pageName}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-2">
          <Label>Channels</Label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={facebook ? "default" : "outline"} onClick={() => setFacebook((v) => !v)} aria-pressed={facebook}>
              <FacebookIcon /> Facebook · {profile.pageName}
            </Button>
            <Button
              type="button"
              variant={instagram ? "default" : "outline"}
              disabled={!igAvailable}
              onClick={() => setInstagram((v) => !v)}
              aria-pressed={instagram}
            >
              <InstagramIcon /> {igAvailable ? `Instagram · @${profile.igUsername}` : "No Instagram linked"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Media</Label>
            <div className="flex items-center gap-2">
              {igFormat && instagram && (
                <Badge variant="secondary">
                  <InstagramIcon /> {igFormat === "carousel" ? `Carousel ${media.length}/10` : igFormat === "reel" ? "Reel" : "Photo"}
                </Badge>
              )}
              {facebook && media.length > 0 && (
                <Badge variant="secondary">
                  <FacebookIcon /> {media.length > 1 ? "Photo set" : singleVideo ? (fbAsReel ? "Reel" : "Video") : "Photo"}
                </Badge>
              )}
            </div>
          </div>
          <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => void addFiles(e.target.files)} />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {media.map((m, i) => (
              <div key={m.mediaId} className="bg-muted group relative aspect-square overflow-hidden rounded-md">
                {m.kind === "image" ? (
                  <img src={m.url} alt="" className="size-full object-cover" />
                ) : (
                  <video src={m.url} className="size-full object-cover" muted />
                )}
                <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button size="icon-xs" variant="ghost" className="text-white" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move earlier">
                    <ArrowUp />
                  </Button>
                  <Button size="icon-xs" variant="ghost" className="text-white" onClick={() => move(i, 1)} disabled={i === media.length - 1} aria-label="Move later">
                    <ArrowDown />
                  </Button>
                  <Button size="icon-xs" variant="ghost" className="text-white" onClick={() => void remove(m)} aria-label="Remove">
                    <X />
                  </Button>
                </div>
                {m.kind === "video" && <Badge className="absolute top-1 left-1">Video</Badge>}
              </div>
            ))}
            {uploading > 0 && (
              <div className="bg-muted flex aspect-square items-center justify-center rounded-md">
                <Spinner />
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="text-muted-foreground hover:bg-muted/50 flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs"
            >
              <ImagePlus className="size-5" /> Add
            </button>
          </div>
          <p className="text-muted-foreground text-xs">JPEG or PNG (converted to JPEG), MP4 or MOV. One video publishes as a Reel on Instagram; 2–10 items become a carousel.</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="caption">Caption</Label>
            {instagram && (
              <span className={`text-xs ${caption.length > IG_CAPTION_MAX ? "text-destructive" : "text-muted-foreground"}`}>
                {caption.length}/{IG_CAPTION_MAX} · {hashtags}/30 # · {mentions}/20 @
              </span>
            )}
          </div>
          <Textarea id="caption" rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write your caption…" />
        </div>

        {instagram && (
          <div className="space-y-4 rounded-md border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <InstagramIcon className="size-4" /> Instagram options
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="collab">Collaborators (up to 3)</Label>
                <Input id="collab" value={collaborators} onChange={(e) => setCollaborators(e.target.value)} placeholder="username, username" />
                <p className="text-muted-foreground text-xs">They get an invite to accept in Instagram.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tags">Tag people</Label>
                <Input id="tags" value={userTags} onChange={(e) => setUserTags(e.target.value)} placeholder="username, username" />
                <p className="text-muted-foreground text-xs">Tags are placed at the image centre for now.</p>
              </div>
            </div>
            {igFormat !== "reel" && (
              <div className="space-y-2">
                <Label htmlFor="alt">Alt text</Label>
                <Input id="alt" value={altText} onChange={(e) => setAltText(e.target.value)} maxLength={1000} placeholder="Describe the image for accessibility" />
              </div>
            )}
            {igFormat === "reel" && (
              <div className="flex items-center justify-between">
                <Label htmlFor="feed">Also show the Reel in the Feed</Label>
                <Switch id="feed" checked={shareToFeed} onCheckedChange={setShareToFeed} />
              </div>
            )}
            {videos > 0 && (
              <Alert>
                <Info />
                <AlertTitle>Audio</AlertTitle>
                <AlertDescription>Meta's API can't add trending or licensed audio — include any music in the video file itself.</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {facebook && singleVideo && (
          <div className="flex items-center justify-between rounded-md border p-4">
            <div>
              <Label htmlFor="fbreel">Publish as a Facebook Reel</Label>
              <p className="text-muted-foreground text-xs">{portraitVideo ? "Vertical video — good fit for Reels." : "Reels need 9:16 video, 3–90 s."}</p>
            </div>
            <Switch id="fbreel" checked={fbAsReel} onCheckedChange={setFbAsReel} />
          </div>
        )}

        {(error || problems.length > 0) && (
          <Alert variant={error ? "destructive" : "default"}>
            <AlertCircle />
            <AlertTitle>{error ? "Couldn't create the post" : "Before you post"}</AlertTitle>
            <AlertDescription>
              {error ?? (
                <ul className="list-disc pl-4">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
      <Separator />
      <CardFooter className="flex flex-wrap items-center justify-between gap-4 pt-6">
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant={mode === "now" ? "secondary" : "ghost"} onClick={() => setMode("now")}>
            Post now
          </Button>
          <Button type="button" size="sm" variant={mode === "schedule" ? "secondary" : "ghost"} onClick={() => setMode("schedule")}>
            Schedule
          </Button>
          {mode === "schedule" && (
            <Input type="datetime-local" className="w-auto" value={when} min={toLocalInputValue(openedAt + 5 * 60_000)} onChange={(e) => setWhen(e.target.value)} />
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting || uploading > 0 || problems.length > 0}>
            {submitting ? <Spinner /> : mode === "now" ? <Send /> : <CalendarClock />}
            {mode === "now" ? "Post now" : "Schedule"}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function collaboratorList(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/^@/, ""))
    .filter(Boolean);
}

function describe(e: unknown): string {
  if (e && typeof e === "object" && "data" in e && typeof e.data === "string") return e.data;
  return e instanceof Error ? e.message : String(e);
}
