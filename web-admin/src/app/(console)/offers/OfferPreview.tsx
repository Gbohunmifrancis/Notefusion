"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { getOfferPreview, sendOfferTest, type AdminOffer, type OfferPriceSet } from "@/api/offers";
import { Segmented } from "@/components/Segmented";
import { ErrorView, LoadingView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

import { headlinePrice, offerKeys, toastOfferError } from "./offerLook";

type PreviewSize = "desktop" | "mobile";

/** The widths the email is laid out at: a desktop mail client's reading pane, and a phone. */
const DESKTOP_WIDTH = 680;
const PHONE_WIDTH = 375;
const PHONE_SCALE = 0.8;
const PHONE_HEIGHT = 628;

/**
 * The email as the server would send it (`GET …/preview`, the sender's own renderer), as Grace: free, at the chosen
 * price set; desktop or phone. "Send me a test" mails exactly this to the signed-in admin.
 *
 * The HTML is shown in a sandboxed iframe through `srcdoc`: no scripts, forms, pop-ups or navigation of the console.
 * `allow-same-origin` alone lets the console read the email's height to show it whole; with scripts off, nothing
 * in the email can use it. The frame is held to the light scheme, as most inboxes first show it.
 */
export function OfferPreviewPanel({
  offer,
  priceSet,
  onPriceSet,
  wordsDirty,
}: {
  offer: AdminOffer;
  priceSet: OfferPriceSet;
  onPriceSet: (set: OfferPriceSet) => void;
  /** The words have unsaved changes: the preview and the test are the saved email. */
  wordsDirty: boolean;
}) {
  const { user } = useAuth();
  const [size, setSize] = useState<PreviewSize>("desktop");
  const [testing, setTesting] = useState(false);
  const preview = useQuery({
    queryKey: [...offerKeys.preview(offer.id), priceSet],
    queryFn: ({ signal }) => getOfferPreview(offer.id, priceSet, signal),
    // The other set's email stays up while this one renders, but never another offer's.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === offer.id ? previous : undefined),
  });

  const standard = headlinePrice(offer, "standard");
  const regional = headlinePrice(offer, "regional");

  async function sendTest() {
    setTesting(true);
    try {
      await sendOfferTest(offer.id, priceSet);
      toast.success(`Test sent to ${user?.email ?? "your address"}`, {
        description: `As Grace: free, ${priceSet === "regional" ? "on regional prices" : "UK, standard prices"}.`,
      });
    } catch (caught) {
      toastOfferError(caught, "The test didn't send. Try again.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="nf-panel overflow-hidden lg:sticky lg:top-20" aria-labelledby="offer-preview-title">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
        <div>
          <h2 id="offer-preview-title" className="text-sm font-semibold text-foreground">
            Preview
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            As Grace: free, {priceSet === "regional" ? "on regional prices" : "in the UK"}
          </p>
        </div>
        <Segmented
          label="Preview size"
          value={size}
          onChange={setSize}
          options={[
            { value: "desktop", label: "Desktop" },
            { value: "mobile", label: "Mobile" },
          ]}
        />
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 text-xs text-muted-foreground sm:px-5">
        <span>Prices</span>
        <Segmented
          label="Prices shown"
          value={priceSet}
          onChange={onPriceSet}
          options={[
            { value: "standard", label: standard ? `Standard ${standard}` : "Standard" },
            { value: "regional", label: regional ? `Regional ${regional}` : "Regional" },
          ]}
        />
      </div>
      {preview.data && (
        <p className="truncate border-t border-border px-4 py-2 text-xs sm:px-5" title={`${preview.data.subject} · ${preview.data.preheader}`}>
          <span className="font-medium text-foreground">{preview.data.subject}</span>
          <span className="text-muted-foreground"> · {preview.data.preheader}</span>
        </p>
      )}

      <div className="border-y border-border bg-[#f4f7fc] dark:bg-[#0b0f16]">
        {preview.error && !preview.data ? (
          <ErrorView error={preview.error} onRetry={() => void preview.refetch()} retrying={preview.isFetching} />
        ) : !preview.data ? (
          <LoadingView label="Rendering the email" />
        ) : size === "desktop" ? (
          <DesktopFrame html={preview.data.html} />
        ) : (
          <PhoneFrame html={preview.data.html} />
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2.5 px-4 py-3.5 sm:px-5">
        <Button variant="outline" size="sm" onClick={() => void sendTest()} disabled={testing || wordsDirty}>
          {testing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
          Send me a test
        </Button>
        <span className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
          {wordsDirty
            ? "Save the words first: the preview and the test are the saved email."
            : `To ${user?.email ?? "you"} only, as Grace. It counts toward today's email.`}
        </span>
      </footer>
    </section>
  );
}

const SANDBOX = "allow-same-origin";

/** The email at a desktop reading pane's width, scaled to the panel and shown whole. */
function DesktopFrame({ html }: { html: string }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(398);
  const [height, setHeight] = useState(1330);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function measure() {
    const doc = frame.current?.contentDocument;
    const next = doc?.documentElement?.scrollHeight;
    if (next) setHeight(next);
  }

  function onLoad() {
    measure();
    // The header art arrives after the page: measure again as each picture lands.
    for (const image of Array.from(frame.current?.contentDocument?.images ?? [])) {
      if (!image.complete) image.addEventListener("load", measure, { once: true });
    }
  }

  const scale = Math.min(1, width / DESKTOP_WIDTH);
  return (
    <div ref={box} className="w-full">
      <div className="relative mx-auto overflow-hidden" style={{ width: DESKTOP_WIDTH * scale, height: height * scale }}>
        <iframe
          ref={frame}
          title="The offer email, desktop"
          srcDoc={html}
          sandbox={SANDBOX}
          referrerPolicy="no-referrer"
          scrolling="no"
          onLoad={onLoad}
          style={{
            width: DESKTOP_WIDTH,
            height,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
            border: 0,
            colorScheme: "light",
          }}
        />
      </div>
    </div>
  );
}

/** The same message at a phone's width, in a phone's frame; it scrolls inside the frame. */
function PhoneFrame({ html }: { html: string }) {
  return (
    <div className="py-4">
      <div
        className="relative mx-auto overflow-hidden rounded-[26px] border-[6px] border-[#1e2533] bg-white"
        style={{ width: PHONE_WIDTH * PHONE_SCALE + 12, height: PHONE_HEIGHT + 12 }}
      >
        <iframe
          title="The offer email, phone"
          srcDoc={html}
          sandbox={SANDBOX}
          referrerPolicy="no-referrer"
          style={{
            width: PHONE_WIDTH,
            height: PHONE_HEIGHT / PHONE_SCALE,
            transform: `scale(${PHONE_SCALE})`,
            transformOrigin: "0 0",
            border: 0,
            colorScheme: "light",
          }}
        />
      </div>
    </div>
  );
}
