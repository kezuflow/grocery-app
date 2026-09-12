import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { seedTestInstantOrder } from "../test-commerce-fixtures";
import { createCoreRpcContext } from "./context";
import { createOrdersRpc } from "./orders-rpc";
it("authenticates real sessions and ignores a supplied customer ID", async () => {
  const rpc = createOrdersRpc(createCoreRpcContext(env));
  expect(await rpc.listCustomerNotifications({ requestId: "notices", headers: {} })).toMatchObject({
    ok: false,
    error: { code: "UNAUTHENTICATED" },
  });
  const email = `notice-${crypto.randomUUID()}@example.com`;
  const signup = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({
      name: "Notice test",
      email,
      password: "correct-horse-battery-staple",
    }),
  });
  expect(signup.status).toBeLessThan(400);
  const payload = (await signup.json()) as { user: { id: string } };
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(payload.user.id).run();
  const signin = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
  });
  expect(signin.status).toBeLessThan(400);
  const cookie = signin.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  const otherOrder = crypto.randomUUID();
  await seedTestInstantOrder(env.DB, otherOrder);
  await env.DB.prepare("UPDATE grocery_order SET committed_at=1 WHERE id=?").bind(otherOrder).run();
  const forged = {
    requestId: "notices",
    headers: { cookie },
    customerId: `customer-${otherOrder}`,
  };
  expect(await rpc.listCustomerNotifications(forged)).toMatchObject({
    ok: true,
    value: { items: [], hasMore: false },
  });
});
