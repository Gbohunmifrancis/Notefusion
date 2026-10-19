"use client";

import { useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useId, useState } from "react";

import { getPasskeys } from "@/api/endpoints";
import type { Passkey } from "@/api/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { offersPasskey, unlockWithPasskey, unlockWithPassword } from "@/lib/consoleUnlock";

export type IdentityMethod = "passkey" | "password";

export interface IdentityCheck {
  /** The account's passkeys, once read (the same query as Settings › Passkeys). */
  passkeys: readonly Passkey[] | undefined;
  /** False when the browser can't, or the account has no passkey: the password is the only way. */
  canPasskey: boolean;
  method: IdentityMethod;
  /** Set by the admin's own choice ("Use your password", "Use a passkey instead"). */
  chosen: boolean;
  choose: (method: IdentityMethod) => void;
  password: string;
  setPassword: (password: string) => void;
  /** True when `confirm` has what it needs: a passkey to ask for, or a password typed. */
  ready: boolean;
  /** Proves it is the admin the chosen way. Throws as the ceremony or the server refused. */
  confirm: () => Promise<void>;
  reset: () => void;
}

/**
 * The state behind every "confirm it's you": the lock, the confirm dialog, the confirmation prompt
 * and adding a passkey. A passkey first when there is one; the password otherwise or on request.
 */
export function useIdentityCheck(active: boolean): IdentityCheck {
  const passkeys = useQuery({
    queryKey: ["passkeys"],
    queryFn: ({ signal }) => getPasskeys(signal),
    enabled: active,
  });
  const [choice, setChoice] = useState<IdentityMethod | null>(null);
  const [password, setPassword] = useState("");

  const canPasskey = offersPasskey(passkeys.data);
  const method = choice ?? (canPasskey ? "passkey" : "password");

  return {
    passkeys: passkeys.data,
    canPasskey,
    method,
    chosen: choice !== null,
    choose: setChoice,
    password,
    setPassword,
    ready: method === "passkey" || password.length > 0,
    confirm: () => (method === "passkey" ? unlockWithPasskey() : unlockWithPassword(password)),
    reset: () => {
      setChoice(null);
      setPassword("");
    },
  };
}

/**
 * The confirm dialog's last step (board i-console-lock, frame 3): a note that the browser will ask
 * for the passkey, or the password field.
 */
export function IdentityFields({ check, disabled }: { check: IdentityCheck; disabled?: boolean }) {
  const passwordId = useId();

  if (check.method === "passkey") {
    return (
      <p className="flex items-start gap-2 rounded-[8px] bg-muted px-3 py-2.5 dark:bg-background text-[12.5px] leading-[1.45] text-muted-foreground">
        <KeyRound size={15} className="mt-[2px] shrink-0" aria-hidden="true" />
        <span>
          Your browser will ask for your passkey to confirm.{" "}
          <button
            type="button"
            onClick={() => check.choose("password")}
            disabled={disabled}
            className="text-brand hover:underline disabled:opacity-50"
          >
            Use password instead
          </button>
        </span>
      </p>
    );
  }

  return (
    <div>
      <Label htmlFor={passwordId} className="text-xs text-muted-foreground">
        Your password
      </Label>
      <Input
        id={passwordId}
        type="password"
        autoComplete="current-password"
        autoFocus={check.chosen}
        value={check.password}
        onChange={(event) => check.setPassword(event.target.value)}
        disabled={disabled}
        className="mt-1.5 text-[13px]"
      />
      {check.canPasskey && (
        <button
          type="button"
          onClick={() => check.choose("passkey")}
          disabled={disabled}
          className="mt-2 text-[12.5px] text-brand hover:underline disabled:opacity-50"
        >
          Use a passkey instead
        </button>
      )}
    </div>
  );
}
