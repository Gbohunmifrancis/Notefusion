/**
 * The browser half of passkeys: WebAuthn JSON (what the API sends and wants back, bytes as
 * base64url) ⇄ the ArrayBuffers `navigator.credentials` speaks, plus plain sentences for the ways a
 * ceremony can fail. Converted by hand rather than through `PublicKeyCredential.parse…FromJSON`,
 * which not every browser the console runs in has yet.
 */

import { ApiError } from "@/api/client";

/** WebAuthn options as JSON: opaque here apart from the byte fields converted below. */
export type WebAuthnJson = Record<string, unknown>;

export function base64UrlToBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function bufferToBase64Url(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** True where the browser has WebAuthn at all. False during a server render. */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

/** True where passkeys can be offered in the email field's autofill (conditional mediation). */
export async function conditionalMediationAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  const check = (
    PublicKeyCredential as unknown as { isConditionalMediationAvailable?: () => Promise<boolean> }
  ).isConditionalMediationAvailable;
  if (typeof check !== "function") return false;
  try {
    return await check.call(PublicKeyCredential);
  } catch {
    return false;
  }
}

interface DescriptorJson {
  id: string;
  type?: string;
  transports?: string[];
}

function descriptors(list: unknown): PublicKeyCredentialDescriptor[] {
  if (!Array.isArray(list)) return [];
  return (list as DescriptorJson[]).map((entry) => ({
    type: "public-key",
    id: base64UrlToBuffer(entry.id),
    ...(entry.transports ? { transports: entry.transports as AuthenticatorTransport[] } : {}),
  }));
}

/** The API's creation options → what `navigator.credentials.create({ publicKey })` takes. */
export function toCreationOptions(json: WebAuthnJson): PublicKeyCredentialCreationOptions {
  const user = json.user as { id: string; name: string; displayName: string };
  const options = {
    ...json,
    challenge: base64UrlToBuffer(json.challenge as string),
    user: { ...user, id: base64UrlToBuffer(user.id) },
    excludeCredentials: descriptors(json.excludeCredentials),
  } as PublicKeyCredentialCreationOptions;
  // Empty lists the server sends as `[]` mean "none"; some browsers reject an empty hints list.
  delete (options as { hints?: unknown }).hints;
  return options;
}

/** The API's assertion options → what `navigator.credentials.get({ publicKey })` takes. */
export function toRequestOptions(json: WebAuthnJson): PublicKeyCredentialRequestOptions {
  const options = {
    ...json,
    challenge: base64UrlToBuffer(json.challenge as string),
    allowCredentials: descriptors(json.allowCredentials),
  } as PublicKeyCredentialRequestOptions;
  delete (options as { hints?: unknown }).hints;
  return options;
}

/** A new credential (from `create`) as the JSON the API's register route takes. */
export function registrationToJson(credential: PublicKeyCredential): WebAuthnJson {
  const response = credential.response as AuthenticatorAttestationResponse;
  const transports =
    typeof response.getTransports === "function" ? response.getTransports() : [];
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: bufferToBase64Url(response.attestationObject),
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      transports,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

/** An assertion (from `get`) as the JSON the API's login route takes. */
export function assertionToJson(credential: PublicKeyCredential): WebAuthnJson {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      signature: bufferToBase64Url(response.signature),
      ...(response.userHandle ? { userHandle: bufferToBase64Url(response.userHandle) } : {}),
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

/** True for the failures that mean "the person closed the prompt" — nothing to report. */
export function isPasskeyCancel(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * A plain sentence for a failed ceremony. Server refusals already are one (the API writes them
 * for this reader); browser exceptions never reach the screen as their own text.
 */
export function passkeyErrorMessage(error: unknown, action: "add" | "sign-in"): string {
  if (error instanceof ApiError) {
    if (error.code === "NETWORK" || error.code === "RATE_LIMITED") return error.message;
    if (error.code !== "UNKNOWN" && error.message) return error.message;
    return action === "add"
      ? "We couldn't save that passkey. Try again."
      : "We couldn't sign you in with that passkey. Try again, or use your password.";
  }
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
        return action === "add"
          ? "The passkey wasn't created. The request was cancelled or timed out."
          : "No passkey was used. The request was cancelled or timed out.";
      case "InvalidStateError":
        return "This device already has a passkey for your account.";
      case "SecurityError":
        return "Passkeys can't be used on this address.";
      case "NotSupportedError":
        return "This browser or device can't create a passkey.";
    }
  }
  if (error instanceof TypeError) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  return action === "add"
    ? "Your browser couldn't create the passkey. Try again."
    : "Your browser couldn't use the passkey. Try again, or use your password.";
}

/** A starting name for a new passkey, from the browser and device: "Chrome on macOS". */
export function defaultPasskeyName(): string {
  if (typeof navigator === "undefined") return "Passkey";
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua) || /CriOS\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  if (browser && device) return `${browser} on ${device}`;
  return browser ?? device ?? "Passkey";
}
