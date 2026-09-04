export type BlogRef = { value: string; label: string };

export type WebflowDraft = {
  on: boolean;
  name: string;
  postCopy: string;
  blog: BlogRef | null;
  link: string;
};

export const emptyWebflowDraft: WebflowDraft = { on: false, name: "", postCopy: "", blog: null, link: "" };

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Whether the composer may submit this draft. Mirrored server-side in posts.create. */
export function webflowProblems(draft: WebflowDraft, postCopyRequired = false): string[] {
  if (!draft.on) return [];
  const list: string[] = [];
  if (!draft.name.trim()) list.push("Give the Webflow item a name.");
  if (postCopyRequired && !draft.postCopy.trim()) list.push("Post Copy is required by this Webflow collection.");
  if (!draft.blog && !draft.link.trim()) list.push("Select a blog post or provide a link for Webflow.");
  if (draft.link.trim() && !isHttpUrl(draft.link.trim())) list.push("The Webflow link must be a full http(s) URL.");
  return list;
}

/** The `webflow` argument for api.posts.create, or undefined when the section is off. */
export function webflowArg(draft: WebflowDraft) {
  if (!draft.on) return undefined;
  return {
    name: draft.name.trim(),
    postCopy: draft.postCopy.trim() || undefined,
    blogItemId: draft.blog?.value,
    blogItemName: draft.blog?.label,
    link: draft.link.trim() || undefined,
  };
}
