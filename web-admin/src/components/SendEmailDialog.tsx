"use client";

import React, { useEffect, useState } from "react";
import {
  Mail,
  Loader2,
  Sparkles,
  Eye,
  Edit3,
  ExternalLink,
  Search,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/client";
import { getUsers, sendUserEmail, type SendUserEmailPayload } from "@/api/endpoints";
import type { AdminUserRow } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/Badge";
import { BrandMark } from "@/components/BrandMark";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface SendEmailTarget {
  id: string;
  fullName: string;
  email: string;
  profilePictureUrl?: string | null | undefined;
  role?: string | undefined;
}

interface SendEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetUser?: SendEmailTarget | null;
  onSuccess?: () => void;
}

interface TemplatePreset {
  id: string;
  name: string;
  subject: string;
  heading: string;
  body: string;
  ctaText: string;
  ctaUrl: string;
}

const TEMPLATES: TemplatePreset[] = [
  {
    id: "custom",
    name: "Custom (Blank)",
    subject: "",
    heading: "",
    body: "",
    ctaText: "",
    ctaUrl: "",
  },
  {
    id: "welcome",
    name: "Welcome & Onboarding Assistance",
    subject: "Welcome to NoteFusion — We're here to help",
    heading: "Getting the Most from NoteFusion",
    body: "Hello,\n\nThank you for choosing NoteFusion. Whether you are transcribing live choir rehearsals, extracting solfa notation from audio recordings, or composing music, we want to ensure you have a seamless experience.\n\nIf you ever run into any questions or would like personalized assistance, feel free to reply directly to our team.",
    ctaText: "Open NoteFusion",
    ctaUrl: "https://notefusion.app",
  },
  {
    id: "pro_gift",
    name: "Pro Access Gift Notification",
    subject: "You've been gifted NoteFusion Pro! 🎁",
    heading: "Enjoy NoteFusion Pro on Us",
    body: "Great news!\n\nAn administrator has gifted your account with full NoteFusion Pro access. You can now transcribe without trial restrictions, export high-fidelity staff and solfa scores, and access priority cloud processing.\n\nYour Pro perks are ready and waiting in your account.",
    ctaText: "Explore NoteFusion Pro",
    ctaUrl: "https://notefusion.app",
  },
  {
    id: "subscription_update",
    name: "Subscription & Billing Follow-up",
    subject: "Important update regarding your NoteFusion subscription",
    heading: "Subscription Notice",
    body: "Hello,\n\nWe are following up regarding your NoteFusion account and subscription status.\n\nPlease review your active plan and settings in the app to make sure everything is configured just the way you like it. If you need any reconciliation or invoice assistance, our support team is at your disposal.",
    ctaText: "Manage Your Account",
    ctaUrl: "https://notefusion.app",
  },
  {
    id: "maintenance",
    name: "Important Service & Product Notice",
    subject: "Notice regarding NoteFusion services and updates",
    heading: "Important NoteFusion Update",
    body: "Hello,\n\nWe are reaching out to let you know about upcoming improvements and service updates to the NoteFusion transcription engine.\n\nPlease verify that your mobile app is updated to the latest version to continue enjoying fast, accurate transcriptions.",
    ctaText: "Check Latest Version",
    ctaUrl: "https://notefusion.app",
  },
];

export function SendEmailDialog({
  open,
  onOpenChange,
  targetUser: initialTarget,
  onSuccess,
}: SendEmailDialogProps) {
  const [selectedUser, setSelectedUser] = useState<SendEmailTarget | null>(initialTarget ?? null);
  const [userSearch, setUserSearch] = useState("");
  const [searchResults, setSearchResults] = useState<AdminUserRow[]>([]);
  const [searching, setSearching] = useState(false);

  const [activeTab, setActiveTab] = useState<"compose" | "preview">("compose");
  const [templateId, setTemplateId] = useState<string>("custom");
  const [subject, setSubject] = useState("");
  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const [ctaText, setCtaText] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [note, setNote] = useState("");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedUser(initialTarget ?? null);
      setUserSearch("");
      setSearchResults([]);
      setActiveTab("compose");
      setTemplateId("custom");
      setSubject("");
      setHeading("");
      setBody("");
      setCtaText("");
      setCtaUrl("");
      setNote("");
      setError(null);
      setPending(false);
    }
  }, [open, initialTarget]);

  useEffect(() => {
    if (selectedUser || !userSearch.trim() || userSearch.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await getUsers(1, 6, userSearch.trim());
        setSearchResults(res.items);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [userSearch, selectedUser]);

  const handleTemplateChange = (id: string) => {
    setTemplateId(id);
    const tpl = TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    if (tpl.subject) setSubject(tpl.subject);
    if (tpl.heading) setHeading(tpl.heading);
    if (tpl.body) setBody(tpl.body);
    if (tpl.ctaText) setCtaText(tpl.ctaText);
    if (tpl.ctaUrl) setCtaUrl(tpl.ctaUrl);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) {
      setError("Please select a recipient first.");
      return;
    }
    if (!subject.trim()) {
      setError("Email subject is required.");
      return;
    }
    if (!body.trim()) {
      setError("Email body content is required.");
      return;
    }
    if (ctaText.trim() && !ctaUrl.trim()) {
      setError("Please specify a URL for the Call-To-Action button.");
      return;
    }

    setPending(true);
    setError(null);

    const payload: SendUserEmailPayload = {
      subject: subject.trim(),
      heading: heading.trim() || undefined,
      bodyHtml: body.trim(),
      ctaText: ctaText.trim() || undefined,
      ctaUrl: ctaUrl.trim() || undefined,
      note: note.trim() || undefined,
    };

    try {
      await sendUserEmail(selectedUser.id, payload);
      toast.success(`Branded email sent to ${selectedUser.email}`, {
        description: `Subject: "${subject.trim()}"`,
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to send email. Please verify system email settings.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden sm:rounded-xl">
        <form onSubmit={handleSend} className="flex flex-col h-full overflow-hidden">
          <AlertDialogHeader className="border-b border-border/60 px-6 py-4 bg-muted/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10 text-brand dark:bg-brand/20">
                  <Mail className="size-4" />
                </div>
                <div>
                  <AlertDialogTitle className="text-base font-semibold">
                    Send User Email
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-xs text-muted-foreground">
                    Compose a custom email delivered via NoteFusion's branded template.
                  </AlertDialogDescription>
                </div>
              </div>

              <div className="flex items-center rounded-lg border border-border bg-muted/40 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab("compose")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-all ${
                    activeTab === "compose"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Edit3 className="size-3.5" />
                  Compose
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("preview")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-all ${
                    activeTab === "preview"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Eye className="size-3.5" />
                  Live Preview
                </button>
              </div>
            </div>
          </AlertDialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger-deep dark:text-danger">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <div className="flex-1 font-medium">{error}</div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Recipient
              </Label>
              {selectedUser ? (
                <div className="flex items-center justify-between rounded-lg border border-border/80 bg-card p-3">
                  <div className="flex items-center gap-3">
                    <Avatar
                      name={selectedUser.fullName}
                      src={selectedUser.profilePictureUrl ?? null}
                      size={36}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {selectedUser.fullName}
                        </span>
                        {selectedUser.role && (
                          <Badge tone={selectedUser.role === "Admin" ? "blue" : "neutral"}>
                            {selectedUser.role}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{selectedUser.email}</p>
                    </div>
                  </div>
                  {!initialTarget && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedUser(null)}
                      className="h-8 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3.5 mr-1" />
                      Change
                    </Button>
                  )}
                </div>
              ) : (
                <div className="relative space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Search user by name or email address..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      className="pl-9 text-xs"
                    />
                    {searching && (
                      <Loader2 className="absolute right-3 top-2.5 size-4 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {searchResults.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md divide-y divide-border/40">
                      {searchResults.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setSelectedUser({
                              id: u.id,
                              fullName: u.fullName,
                              email: u.email,
                              profilePictureUrl: u.profilePictureUrl,
                              role: u.role,
                            });
                            setUserSearch("");
                            setSearchResults([]);
                          }}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                        >
                          <Avatar name={u.fullName} src={u.profilePictureUrl} size={28} />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground truncate">
                              {u.fullName}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate">{u.email}</p>
                          </div>
                          <Badge tone={u.role === "Admin" ? "blue" : "neutral"}>{u.role}</Badge>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {activeTab === "compose" ? (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg bg-muted/30 p-3 border border-border/50">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-amber-500" />
                    <span className="text-xs font-medium text-foreground">
                      Preset Email Template:
                    </span>
                  </div>
                  <Select value={templateId} onValueChange={handleTemplateChange}>
                    <SelectTrigger className="h-8 w-full sm:w-64 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEMPLATES.map((t) => (
                        <SelectItem key={t.id} value={t.id} className="text-xs">
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">
                      Subject Line <span className="text-danger">*</span>
                    </Label>
                    <Input
                      placeholder="e.g. Important notice regarding your account"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="text-xs"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">
                      Heading Banner <span className="text-muted-foreground text-[11px] font-normal">(Optional)</span>
                    </Label>
                    <Input
                      placeholder="e.g. NoteFusion Update"
                      value={heading}
                      onChange={(e) => setHeading(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium">
                      Message Body <span className="text-danger">*</span>
                    </Label>
                    <span className="text-[11px] text-muted-foreground">
                      Double line breaks render as separate paragraphs
                    </span>
                  </div>
                  <Textarea
                    placeholder="Type your message here..."
                    rows={6}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="text-xs leading-relaxed font-sans"
                    required
                  />
                </div>

                <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
                  <div className="flex items-center gap-1.5">
                    <ExternalLink className="size-3.5 text-brand" />
                    <span className="text-xs font-semibold text-foreground">
                      Call-To-Action Button (Optional)
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Button Label</Label>
                      <Input
                        placeholder="e.g. Open NoteFusion App"
                        value={ctaText}
                        onChange={(e) => setCtaText(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Button Target URL</Label>
                      <Input
                        placeholder="https://notefusion.app"
                        value={ctaUrl}
                        onChange={(e) => setCtaUrl(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Audit Log Note <span className="text-[11px] font-normal">(Recorded in admin trail)</span>
                  </Label>
                  <Input
                    placeholder="e.g. Contacted user regarding membership inquiry"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="text-xs"
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border/80 bg-slate-100 dark:bg-slate-900/60 p-4 sm:p-6">
                <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-mono">From: NoteFusion &lt;noreply@notefusion.app&gt;</span>
                  <span className="font-mono">To: {selectedUser?.email ?? "recipient@domain.com"}</span>
                </div>

                <div className="max-w-xl mx-auto rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
                  <div className="text-center mb-6">
                    <div className="inline-flex items-center justify-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900 mb-2">
                      <BrandMark size={36} className="text-blue-600" />
                    </div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      NoteFusion
                    </h3>
                  </div>

                  <h2 className="text-xl font-bold text-center text-slate-900 dark:text-white mb-6">
                    {heading.trim() || subject.trim() || "NoteFusion Notification"}
                  </h2>

                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">
                    Hello{selectedUser?.fullName ? ` ${selectedUser.fullName.split(" ")[0]}` : ""},
                  </p>

                  <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {body.trim() ? (
                      body
                        .split(/\n\n+/)
                        .map((para, idx) => <p key={idx}>{para}</p>)
                    ) : (
                      <p className="italic text-slate-400 dark:text-slate-500">
                        (Your message body will appear here...)
                      </p>
                    )}
                  </div>

                  {ctaText.trim() && (
                    <div className="my-8 text-center">
                      <span className="inline-block rounded-full px-7 py-3 text-sm font-semibold text-white bg-gradient-to-r from-blue-700 to-blue-500 shadow-md shadow-blue-500/20">
                        {ctaText.trim()}
                      </span>
                    </div>
                  )}

                  <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800 text-center text-[11px] text-slate-400 dark:text-slate-500 space-y-1">
                    <p>Sent by NoteFusion Admin Team • Automated notification</p>
                    <p>© {new Date().getFullYear()} NoteFusion Inc. • notefusion.app</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <AlertDialogFooter className="border-t border-border/60 px-6 py-3 bg-muted/20 flex flex-row items-center justify-between sm:justify-between">
            <div className="text-xs text-muted-foreground">
              {selectedUser ? (
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                  Target: <strong>{selectedUser.email}</strong>
                </span>
              ) : (
                <span className="text-amber-500">Select recipient to send</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <AlertDialogCancel
                type="button"
                disabled={pending}
                onClick={() => onOpenChange(false)}
                className="text-xs h-9"
              >
                Cancel
              </AlertDialogCancel>
              <Button
                type="submit"
                disabled={pending || !selectedUser || !subject.trim() || !body.trim()}
                className="text-xs h-9 gap-1.5"
              >
                {pending ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Sending Email...
                  </>
                ) : (
                  <>
                    <Mail className="size-3.5" />
                    Send Email
                  </>
                )}
              </Button>
            </div>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
