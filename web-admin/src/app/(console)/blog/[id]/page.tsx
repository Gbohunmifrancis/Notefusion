import type { Metadata } from "next";

import { BlogEditorView } from "./BlogEditorView";

export const metadata: Metadata = { title: "Blog post · NoteFusion Admin" };

/** `/blog/new` starts a post; `/blog/{id}` edits one. The id is awaited here and handed down as a string. */
export default async function BlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BlogEditorView id={id === "new" ? null : id} />;
}
