"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CustomerProfileView, CustomerSupportNotePage } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import type { useAdminCommand } from "./use-admin-command";
import { ListPageSection } from "./admin-shell";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Checkbox } from "../ui/checkbox";
const failure = z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) });
const profileResult = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({
      customerId: z.string(),
      preferredLanguage: z.string().nullable(),
      promotionalEmails: z.boolean(),
      version: z.number().int().positive(),
    }),
  }),
  failure,
]);
const notesResult = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({
      items: z.array(
        z.object({
          noteId: z.string(),
          customerId: z.string(),
          authorStaffId: z.string(),
          authorDisplayName: z.string(),
          body: z.string(),
          createdAt: z.string(),
        }),
      ),
      nextCursor: z.string().nullable(),
    }),
  }),
  failure,
]);

export function CustomerSupportPanel({
  customerId,
  command,
  onChanged,
}: {
  customerId: string;
  command: ReturnType<typeof useAdminCommand>;
  onChanged: () => void;
}) {
  const [profile, setProfile] = useState<CustomerProfileView | null>(null);
  const [notes, setNotes] = useState<CustomerSupportNotePage | null>(null);
  const [language, setLanguage] = useState("");
  const [promotions, setPromotions] = useState(false);
  const [reason, setReason] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const base = `/api/admin/customers/${encodeURIComponent(customerId)}`;
  const load = useCallback(
    async (cursor?: string) => {
      const current = ++generation.current;
      setLoading(true);
      setError(null);
      try {
        const [profileResponse, notesResponse] = await Promise.all([
          fetch(`${base}/profile`),
          fetch(
            `${base}/notes?${new URLSearchParams({ limit: "10", ...(cursor ? { cursor } : {}) })}`,
          ),
        ]);
        const [nextProfile, nextNotes] = await Promise.all([
          profileResponse.json().then((value) => profileResult.parse(value)),
          notesResponse.json().then((value) => notesResult.parse(value)),
        ]);
        if (current !== generation.current) return;
        if (!nextProfile.ok) {
          setError(nextProfile.error.message);
          return;
        }
        if (!nextNotes.ok) {
          setError(nextNotes.error.message);
          return;
        }
        if (!cursor) {
          setProfile(nextProfile.value);
          setLanguage(nextProfile.value.preferredLanguage ?? "");
          setPromotions(nextProfile.value.promotionalEmails);
        }
        setNotes((previous) =>
          cursor && previous?.nextCursor === cursor
            ? {
                items: [...previous.items, ...nextNotes.value.items],
                nextCursor: nextNotes.value.nextCursor,
              }
            : nextNotes.value,
        );
      } catch {
        if (current === generation.current)
          setError("Customer preferences and support notes could not be loaded.");
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [base],
  );
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  const disabled = loading || command.busy || command.uncertain;
  return (
    <>
      <ListPageSection
        title="Customer preferences"
        description="Application preferences only. Identity and delivery contact details have their own workflows."
      >
        <div className="space-y-4 p-5">
          {error ? (
            <div role="alert">
              <p>{error}</p>
              <Button disabled={disabled} onClick={() => void load()}>
                Retry customer details
              </Button>
            </div>
          ) : null}
          {loading ? <p role="status">Loading preferences and notes…</p> : null}
          {profile && !error ? (
            <fieldset disabled={disabled} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="support-language">Preferred language</label>
                <Input
                  id="support-language"
                  maxLength={80}
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                />
              </div>
              <div className="flex items-center gap-3">
                <Checkbox
                  id="support-promotions"
                  checked={promotions}
                  onCheckedChange={(value) => setPromotions(value === true)}
                />
                <label htmlFor="support-promotions">Receive promotional emails</label>
              </div>
              <p className="text-sm">
                Transaction updates always send. Record the customer's requested preference and your
                reason.
              </p>
              <div className="space-y-2">
                <label htmlFor="profile-change-reason">Preference change reason</label>
                <Textarea
                  id="profile-change-reason"
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <Button
                disabled={!reason.trim()}
                onClick={async () => {
                  if (
                    await command.run("customer-profile", `${base}/profile`, {
                      preferredLanguage: language.trim() || null,
                      promotionalEmails: promotions,
                      reason: reason.trim(),
                      expectedVersion: profile.version,
                    })
                  )
                    onChanged();
                }}
              >
                Save customer preferences
              </Button>
            </fieldset>
          ) : null}
        </div>
      </ListPageSection>
      <ListPageSection
        title="Support notes"
        description="Private staff notes. Corrections are new notes; saved notes cannot be edited or deleted."
      >
        <div className="space-y-5 p-5">
          <fieldset disabled={disabled || !!error} className="space-y-3">
            <label htmlFor="customer-support-note">New support note</label>
            <Textarea
              id="customer-support-note"
              maxLength={2000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
            <Button
              disabled={!body.trim()}
              onClick={async () => {
                if (await command.run("customer-note", `${base}/notes`, { body: body.trim() }))
                  onChanged();
              }}
            >
              Add support note
            </Button>
          </fieldset>
          {notes?.items.length === 0 ? <p>No support notes yet.</p> : null}
          {notes?.items.map((note) => (
            <article key={note.noteId} className="space-y-2 border-t pt-4">
              <p className="whitespace-pre-wrap break-words">{note.body}</p>
              <p className="flex flex-wrap gap-3 text-sm">
                <time dateTime={note.createdAt}>
                  {new Date(note.createdAt).toLocaleString("en-PH")}
                </time>
                <span>{note.authorDisplayName}</span>
              </p>
            </article>
          ))}
          {notes?.nextCursor ? (
            <Button disabled={disabled} onClick={() => void load(notes.nextCursor ?? undefined)}>
              Load more support notes
            </Button>
          ) : null}
        </div>
      </ListPageSection>
    </>
  );
}
