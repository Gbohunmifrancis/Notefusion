"use client";

import { usePathId } from "@/hooks/usePathId";

import { BlogEditorView } from "./BlogEditorView";

/** `/blog/new` starts a post; `/blog/{id}` edits one. The id is read from the address and handed down as a string. */
export default function BlogPostPage() {
  const id = usePathId("/blog/");
  if (!id) return null;
  return <BlogEditorView id={id === "new" ? null : id} />;
}
