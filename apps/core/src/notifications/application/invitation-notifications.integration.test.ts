import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import { z } from "@freshmarkets/validation";
import { deliverNotificationById } from "./deliver-notifications";
import {
  publishNotificationOutbox,
  consumeNotificationBatch,
  type NotificationQueueMessage,
} from "./notification-queue";
import type { TransactionalEmail } from "../infrastructure/email-delivery-port";
const core = exports.default;
const origin = "https://core.example.invalid";
async function account(email: string) {
  const response = await SELF.fetch(`${origin}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      name: "Invitation recipient",
      email,
      password: "correct-horse-battery-staple",
    }),
  });
  expect(response.status).toBeLessThan(400);
  const user = z.object({ user: z.object({ id: z.string() }) }).parse(await response.json()).user;
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(user.id).run();
  const signed = await SELF.fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
  });
  expect(signed.status).toBeLessThan(400);
  return {
    headers: {
      cookie: signed.headers
        .getSetCookie()
        .map((value) => value.split(";", 1)[0])
        .join("; "),
    },
    requestId: crypto.randomUUID(),
    userId: user.id,
  };
}
let ownerIdentity: Promise<Awaited<ReturnType<typeof account>>> | undefined;
function owner() {
  return (ownerIdentity ??= (async () => {
    const identity = await account("initial-admin@example.com");
    expect(
      await core.completeInitialAdministratorSetup({
        ...identity,
        expectedVersion: 0,
        idempotencyKey: "invitation-notification-owner",
      }),
    ).toMatchObject({ ok: true });
    return identity;
  })());
}
async function invite(
  kind: "staff" | "customer",
  email = `invite-${crypto.randomUUID()}@example.com`,
) {
  const administrator = await owner();
  const command = {
    headers: administrator.headers,
    requestId: crypto.randomUUID(),
    email,
    idempotencyKey: crypto.randomUUID(),
  };
  const result =
    kind === "staff"
      ? await core.inviteAdminStaff({
          ...command,
          displayName: "Invited operator",
          roleIds: ["role_operations_viewer"],
          scopes: [{ kind: "location", locationId: "location-cebu-central" }],
        })
      : await core.inviteCustomer(command);
  if (!result.ok) throw new Error(`Invitation failed: ${result.error.code}`);
  const row = await env.DB.prepare(
    `SELECT id,customer_id,status FROM notification_outbox WHERE ${kind === "staff" ? "staff_invitation_id" : "customer_invitation_id"}=?`,
  )
    .bind(result.value.invitationId)
    .first<{ id: string; customer_id: string | null; status: string }>();
  if (!row) throw new Error("Missing invitation notification");
  expect(row.customer_id).toBeNull();
  return { administrator, invitation: result.value, outboxId: row.id, command };
}
describe("invitation notification workflow", () => {
  it.each(["staff", "customer"] as const)(
    "publishes %s invitation intent and reaches verified acceptance",
    async (kind) => {
      const email = `recipient-${crypto.randomUUID()}@example.com`;
      const recipient = await account(email);
      const f = await invite(kind, email);
      expect(
        await env.DB.prepare("SELECT count(*) count FROM customer WHERE auth_user_id=?")
          .bind(recipient.userId)
          .first(),
      ).toEqual({ count: 0 });
      const queued: NotificationQueueMessage[] = [];
      await publishNotificationOutbox(
        env.DB,
        {
          async send(message) {
            queued.push(message);
          },
        },
        Date.now(),
      );
      expect(queued).toContainEqual({ outboxId: f.outboxId });
      const sent: TransactionalEmail[] = [];
      let acknowledged = 0;
      const batch: MessageBatch<NotificationQueueMessage> = {
        queue: "test-notifications",
        metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
        messages: [
          {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            body: { outboxId: f.outboxId },
            attempts: 1,
            ack() {
              acknowledged++;
            },
            retry() {
              throw new Error("Unexpected retry");
            },
          },
        ],
        ackAll() {
          throw new Error("Use per-message acknowledgement");
        },
        retryAll() {
          throw new Error("Unexpected batch retry");
        },
      };
      await consumeNotificationBatch(
        env.DB,
        {
          async send(message) {
            sent.push(message);
            return { ok: true };
          },
        },
        batch,
        Date.now(),
        "https://freshmarkets.example",
      );
      await consumeNotificationBatch(
        env.DB,
        {
          async send() {
            throw new Error("Duplicate email");
          },
        },
        batch,
        Date.now(),
        "https://freshmarkets.example",
      );
      expect(acknowledged).toBe(2);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.text).toContain(
        `https://freshmarkets.example/${kind === "staff" ? "staff-invitation" : "customer-invitation"}`,
      );
      expect(sent[0]?.text).toContain("verify your email");
      expect(sent[0]?.html).not.toContain("token=");
      const acceptance = {
        headers: recipient.headers,
        requestId: crypto.randomUUID(),
        invitationId: f.invitation.invitationId,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      };
      expect(
        await (kind === "staff"
          ? core.acceptStaffInvitation(acceptance)
          : core.acceptCustomerInvitation(acceptance)),
      ).toMatchObject({ ok: true });
      const page =
        kind === "staff"
          ? await core.listAdminStaffInvitations({
              headers: f.administrator.headers,
              requestId: crypto.randomUUID(),
              limit: 100,
            })
          : await core.listCustomerInvitations({
              headers: f.administrator.headers,
              requestId: crypto.randomUUID(),
              limit: 100,
            });
      expect(page).toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([
            expect.objectContaining({
              invitationId: f.invitation.invitationId,
              status: "ACCEPTED",
              emailStatus: "ACCEPTED",
            }),
          ]),
        },
      });
    },
  );
  it.each(["staff", "customer"] as const)(
    "rolls back a missing %s notification intent and recovers the same command",
    async (kind) => {
      const administrator = await owner();
      const email = `rollback-${crypto.randomUUID()}@example.com`;
      const command = {
        headers: administrator.headers,
        requestId: crypto.randomUUID(),
        email,
        idempotencyKey: crypto.randomUUID(),
      };
      const run = () =>
        kind === "staff"
          ? core.inviteAdminStaff({
              ...command,
              displayName: "Operator",
              roleIds: ["role_operations_viewer"],
              scopes: [{ kind: "location", locationId: "location-cebu-central" }],
            })
          : core.inviteCustomer(command);
      await env.DB.exec(
        "CREATE TRIGGER ignore_invitation_notification BEFORE INSERT ON notification_outbox BEGIN SELECT RAISE(IGNORE); END;",
      );
      try {
        expect(await run()).toMatchObject({ ok: false });
        expect(
          await env.DB.prepare(
            `SELECT count(*) count FROM ${kind === "staff" ? "staff_invitation" : "customer_invitation"} WHERE email_normalized=?`,
          )
            .bind(email)
            .first(),
        ).toEqual({ count: 0 });
        expect(
          await env.DB.prepare(
            "SELECT count(*) count FROM idempotency_records WHERE idempotency_key=?",
          )
            .bind(command.idempotencyKey)
            .first(),
        ).toEqual({ count: 0 });
      } finally {
        await env.DB.exec("DROP TRIGGER ignore_invitation_notification");
      }
      const saved = await run();
      expect(saved).toMatchObject({ ok: true });
      expect(await run()).toEqual(saved);
      expect(
        await env.DB.prepare(
          "SELECT count(*) count FROM notification_outbox WHERE recipient_snapshot=?",
        )
          .bind(email)
          .first(),
      ).toEqual({ count: 1 });
    },
  );
  it.each(["staff", "customer"] as const)(
    "cancels pending %s mail with revocation",
    async (kind) => {
      const f = await invite(kind);
      const request = {
        headers: f.administrator.headers,
        requestId: crypto.randomUUID(),
        invitationId: f.invitation.invitationId,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
        reason: "Wrong recipient",
      };
      expect(
        await (kind === "staff"
          ? core.revokeAdminStaffInvitation(request)
          : core.revokeCustomerInvitation(request)),
      ).toMatchObject({ ok: true });
      expect(
        await deliverNotificationById(
          env.DB,
          {
            async send() {
              throw new Error("Revoked mail must not send");
            },
          },
          f.outboxId,
          Date.now(),
          "https://freshmarkets.example",
        ),
      ).toBe("TERMINAL");
      expect(
        await env.DB.prepare("SELECT status FROM notification_outbox WHERE id=?")
          .bind(f.outboxId)
          .first(),
      ).toEqual({ status: "CANCELED" });
    },
  );
  it.each([-1, 0, 1])("honors exact invitation expiry at offset %i", async (offset) => {
    const f = await invite("customer");
    let sends = 0;
    const result = await deliverNotificationById(
      env.DB,
      {
        async send() {
          sends++;
          return { ok: true };
        },
      },
      f.outboxId,
      Date.parse(f.invitation.expiresAt) + offset,
      "https://freshmarkets.example",
    );
    expect(result).toBe(offset < 0 ? "SENT" : "TERMINAL");
    expect(sends).toBe(offset < 0 ? 1 : 0);
  });
  it.each(["staff", "customer"] as const)(
    "rolls back %s revocation when pending mail cancellation is suppressed",
    async (kind) => {
      const f = await invite(kind);
      const request = {
        headers: f.administrator.headers,
        requestId: crypto.randomUUID(),
        invitationId: f.invitation.invitationId,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
        reason: "Incorrect recipient",
      };
      const run = () =>
        kind === "staff"
          ? core.revokeAdminStaffInvitation(request)
          : core.revokeCustomerInvitation(request);
      await env.DB.exec(
        "CREATE TRIGGER ignore_mail_cancel BEFORE UPDATE ON notification_outbox WHEN NEW.status='CANCELED' BEGIN SELECT RAISE(IGNORE); END;",
      );
      try {
        expect(await run()).toMatchObject({ ok: false });
        expect(
          await env.DB.prepare(
            `SELECT status,version FROM ${kind === "staff" ? "staff_invitation" : "customer_invitation"} WHERE id=?`,
          )
            .bind(f.invitation.invitationId)
            .first(),
        ).toEqual({ status: "PENDING", version: 1 });
      } finally {
        await env.DB.exec("DROP TRIGGER ignore_mail_cancel");
      }
      const result = await run();
      expect(result).toMatchObject({ ok: true });
      expect(await run()).toEqual(result);
      expect(
        await env.DB.prepare("SELECT status FROM notification_outbox WHERE id=?")
          .bind(f.outboxId)
          .first(),
      ).toEqual({ status: "CANCELED" });
    },
  );
  it.each(["staff", "customer"] as const)(
    "does not send %s invitation mail after verified acceptance",
    async (kind) => {
      const email = `accepted-${crypto.randomUUID()}@example.com`;
      const identity = await account(email);
      const f = await invite(kind, email);
      const command = {
        headers: identity.headers,
        requestId: crypto.randomUUID(),
        invitationId: f.invitation.invitationId,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      };
      expect(
        await (kind === "staff"
          ? core.acceptStaffInvitation(command)
          : core.acceptCustomerInvitation(command)),
      ).toMatchObject({ ok: true });
      let sends = 0;
      expect(
        await deliverNotificationById(
          env.DB,
          {
            async send() {
              sends++;
              return { ok: true };
            },
          },
          f.outboxId,
          Date.now(),
          "https://freshmarkets.example",
        ),
      ).toBe("TERMINAL");
      expect(sends).toBe(0);
    },
  );
});
