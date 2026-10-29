"use client";

import { usePathId } from "@/hooks/usePathId";

import { UserDetailView } from "./UserDetailView";

/**
 * The account's id is in the path: read from the address (one static page serves every id) and handed to the view as a
 * plain string, nothing until it is known. The title stays generic (layout.tsx).
 */
export default function UserDetailPage() {
  const id = usePathId("/users/");
  return id ? <UserDetailView id={id} /> : null;
}
