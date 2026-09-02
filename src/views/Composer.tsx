import { useMemo, useRef, useState } from "react";
import { useConvex, useMutation } from "convex/react";
import { AlertCircle, ArrowDown, ArrowUp, CalendarClock, ImagePlus, Info, Link2, Send, X } from "lucide-react";
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

const CHANNEL_LABEL: Record<Channel, string> = { facebook: "Facebook", instagram: "Instagram" };

export default function Composer({ sessionToken, profiles, initialChannel, onDone, onCancel }: Props) {
  const convex = useConvex();
  const createPost = useMutation(api.posts.create);
  const removeMedia = useMutation(api.media.remove);
  const fileInput = useRef<HTMLInputElement>(null);

  const [profileId, setProfileId] = useState<Id<"profiles">>(profiles[0]._id);
  const profile = profiles.find((p) => p._id === profileId) ?? profiles[0];
  const igAvailable = !!profile.igUsername;

  // The composer is built around one primary channel; the other is an opt-in
  // cross-post whose caption starts as a copy of the primary one.
  const primary: Channel = initialChannel === "instagram" && !igAvailable ? "facebook" : initialChannel;
  const secondary: Channel = primary === "facebook" ? "instagram" : "facebook";
  const secondaryAvailable = secondary === "facebook" || igAvailable;

  const [crossPost, setCrossPost] = useState(false);
  const [media, setMedia] = useState<LocalMedia[]>([]);
  const [uploading, setUploading] = useState(0);
  const [caption, setCaption] = useState("");
  const [firstComment, setFirstComment] = useState("");
  // While "linked", the cross-post copy tracks the primary text; the first edit unlinks it.
  const [crossCaption, setCrossCaption] = useState("");
  const [captionLinked, setCaptionLinked] = useState(true);
  const [crossComment, setCrossComment] = useState("");
  const [commentLinked, setCommentLinked] = useState(true);
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

  const facebook = primary === "facebook" || (crossPost && secondary === "facebook");
  const instagram = primary === "instagram" || (crossPost && secondary === "instagram");
  const secondaryCaption = captionLinked ? caption : crossCaption;
  const secondaryComment = commentLinked ? firstComment : crossComment;
  const textFor = (channel: Channel) => (channel === primary ? caption : secondaryCaption);
  const commentFor = (channel: Channel) => (channel === primary ? firstComment : secondaryComment);
  const igText = instagram ? textFor("instagram") : "";
  const igComment = instagram ? commentFor("instagram") : "";

  const videos = media.filter((m) => m.kind === "video").length;
  const igFormat = media.length > 1 ? "carousel" : videos === 1 ? "reel" : media.length === 1 ? "image" : null;
  const fbMixed = media.length > 1 && videos > 0;
  const hashtags = (igText.match(/#\w/g) ?? []).length;
  const mentions = (igText.match(/@\w/g) ?? []).length;
  const singleVideo = media.length === 1 && media[0].kind === "video";
  const portraitVideo = singleVideo && isPortrait(media[0]);

  const problems = useMemo(() => {
    const list: string[] = [];
    if (media.length === 0) list.push("Add a photo or video.");
    if (media.length > 10) list.push("At most 10 items per post.");
    if (facebook && fbMixed) list.push("Facebook multi-item posts can only contain photos.");
    if (instagram) {
      if (igText.length > IG_CAPTION_MAX) list.push(`Instagram captions are limited to ${IG_CAPTION_MAX} characters.`);
      if (hashtags > 30) list.push("Instagram allows at most 30 hashtags.");
      if (mentions > 20) list.push("Instagram allows at most 20 @mentions.");
      if (collaboratorList(collaborators).length > 3) list.push("At most 3 collaborators.");
      if (igComment.length > IG_CAPTION_MAX) list.push(`Instagram comments are limited to ${IG_CAPTION_MAX} characters.`);
    }
    if (mode === "schedule" && fromLocalInputValue(when) < openedAt + 60_000) list.push("Schedule at least a minute from now.");
    return list;
  }, [facebook, instagram, media, fbMixed, igText, igComment, hashtags, mentions, collaborators, mode, when, openedAt]);

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
        // Only the cross-posted channel can differ from the primary caption.
        fbCaption: facebook && secondary === "facebook" && crossPost ? secondaryCaption : undefined,
        igCaption: instagram && secondary === "instagram" && crossPost ? secondaryCaption : undefined,
        fbFirstComment: facebook ? commentFor("facebook") : undefined,
        igFirstComment: instagram ? commentFor("instagram") : undefined,
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

  const channelName = (channel: Channel) =>
    channel === "facebook" ? `Facebook · ${profile.pageName}` : `Instagram · @${profile.igUsername ?? ""}`;

  /** Caption + first comment + per-network options for one channel. */
  function channelFields(channel: Channel) {
    const isSecondary = channel === secondary;
    const text = textFor(channel);
    const comment = commentFor(channel);
    const setText = isSecondary
      ? (value: string) => {
          setCaptionLinked(false);
          setCrossCaption(value);
        }
      : setCaption;
    const setComment = isSecondary
      ? (value: string) => {
          setCommentLinked(false);
          setCrossComment(value);
        }
      : setFirstComment;
    const linked = isSecondary && captionLinked;

    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`caption-${channel}`}>Caption</Label>
            <div className="flex items-center gap-3">
              {isSecondary && !linked && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                  onClick={() => setCaptionLinked(true)}
                >
                  <Link2 className="size-3" /> Match {CHANNEL_LABEL[primary]}
                </button>
              )}
              {channel === "instagram" && (
                <span className={`text-xs ${text.length > IG_CAPTION_MAX ? "text-destructive" : "text-muted-foreground"}`}>
                  {text.length}/{IG_CAPTION_MAX} · {hashtags}/30 # · {mentions}/20 @
                </span>
              )}
            </div>
          </div>
          <Textarea
            id={`caption-${channel}`}
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={isSecondary ? `Caption for ${CHANNEL_LABEL[channel]}…` : "Write your caption…"}
          />
          {isSecondary && linked && (
            <p className="text-muted-foreground text-xs">Copied from {CHANNEL_LABEL[primary]} — edit it here to write a separate caption.</p>
          )}
        </div>

        {channel === "instagram" ? instagramOptions() : facebookOptions()}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`comment-${channel}`}>First comment</Label>
            {isSecondary && !commentLinked && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                onClick={() => setCommentLinked(true)}
              >
                <Link2 className="size-3" /> Match {CHANNEL_LABEL[primary]}
              </button>
            )}
          </div>
          <Textarea
            id={`comment-${channel}`}
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional — posted as a comment right after publishing. Good place for a link."
          />
          <p className="text-muted-foreground text-xs">
            Added to the {CHANNEL_LABEL[channel]} post immediately after it publishes, so links stay out of the caption.
          </p>
        </div>
      </div>
    );
  }

  function instagramOptions() {
    return (
      <div className="space-y-4">
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
        {igFormat !== "reel" && altTextField()}
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
    );
  }

  function facebookOptions() {
    return (
      <div className="space-y-4">
        {/* Alt text is shared with Instagram; show it here only when Instagram isn't in the post. */}
        {!instagram && media.length === 1 && !singleVideo && altTextField()}
        {singleVideo && (
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="fbreel">Publish as a Facebook Reel</Label>
              <p className="text-muted-foreground text-xs">{portraitVideo ? "Vertical video — good fit for Reels." : "Reels need 9:16 video, 3–90 s."}</p>
            </div>
            <Switch id="fbreel" checked={fbAsReel} onCheckedChange={setFbAsReel} />
          </div>
        )}
        {!singleVideo && media.length <= 1 && instagram && (
          <p className="text-muted-foreground text-xs">No extra Facebook options for this post — the caption and first comment above are all it needs.</p>
        )}
      </div>
    );
  }

  function altTextField() {
    return (
      <div className="space-y-2">
        <Label htmlFor="alt">Alt text</Label>
        <Input id="alt" value={altText} onChange={(e) => setAltText(e.target.value)} maxLength={1000} placeholder="Describe the image for accessibility" />
      </div>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-3xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-2xl">
          {primary === "facebook" ? <FacebookIcon className="size-5" /> : <InstagramIcon className="size-5" />}
          New {CHANNEL_LABEL[primary]} post
        </CardTitle>
        <CardDescription>Posting to {channelName(primary)}. Cross-post to {CHANNEL_LABEL[secondary]} at the bottom.</CardDescription>
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

        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            {primary === "facebook" ? <FacebookIcon className="size-4" /> : <InstagramIcon className="size-4" />}
            {channelName(primary)}
          </div>
          {channelFields(primary)}
        </div>

        <div className="space-y-4 rounded-md border p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              {secondary === "facebook" ? <FacebookIcon className="size-4" /> : <InstagramIcon className="size-4" />}
              Cross-post to {CHANNEL_LABEL[secondary]}
            </div>
            <Switch
              id="crosspost"
              checked={crossPost}
              disabled={!secondaryAvailable}
              onCheckedChange={setCrossPost}
              aria-label={`Cross-post to ${CHANNEL_LABEL[secondary]}`}
            />
          </div>
          {!secondaryAvailable ? (
            <p className="text-muted-foreground text-xs">This Page has no linked Instagram account.</p>
          ) : crossPost ? (
            <>
              <p className="text-muted-foreground text-xs">Also publishing to {channelName(secondary)}.</p>
              <Separator />
              {channelFields(secondary)}
            </>
          ) : (
            <p className="text-muted-foreground text-xs">Publish the same media to {channelName(secondary)} with its own caption.</p>
          )}
        </div>

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
        <div className="flex items-center gap-3">
          <div className="bg-muted inline-flex items-center gap-1 rounded-lg p-1" role="group" aria-label="When to publish">
            <Button
              type="button"
              size="sm"
              variant={mode === "now" ? "default" : "ghost"}
              className={mode === "now" ? "shadow-sm" : "text-muted-foreground hover:bg-background"}
              aria-pressed={mode === "now"}
              onClick={() => setMode("now")}
            >
              <Send /> Post now
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "schedule" ? "default" : "ghost"}
              className={mode === "schedule" ? "shadow-sm" : "text-muted-foreground hover:bg-background"}
              aria-pressed={mode === "schedule"}
              onClick={() => setMode("schedule")}
            >
              <CalendarClock /> Schedule
            </Button>
          </div>
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
