import type { Metadata } from "next";

import { UserDetailView } from "./UserDetailView";

export const metadata: Metadata = { title: "Account · NoteFusion Admin" };

/**
 * The account's id is in the path, so this shell awaits it and hands the view a plain string —
 * nothing downstream has to cope with a missing param.
 *
 * The title stays generic. Naming the account in it would mean fetching the account here, and every
 * request this console makes carries a bearer token out of the operator's browser storage, which a
 * server component cannot read.
 */
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UserDetailView id={id} />;
}
