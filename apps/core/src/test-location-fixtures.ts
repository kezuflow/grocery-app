import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { z } from "@freshmarkets/validation";
export async function locationManager(scope: "global" | "location" = "global", manage = true) {
  const id = crypto.randomUUID();
  const response = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({
      name: "Location manager",
      email: `locations-${id}@example.com`,
      password: "correct-horse-battery-staple",
    }),
  });
  const { user } = z.object({ user: z.object({ id: z.string() }) }).parse(await response.json());
  let cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(user.id),
    env.DB.prepare(
      "INSERT INTO staff_identity(id,auth_user_id,display_name,status,created_at,updated_at) VALUES (?,?,'Location manager','active',?,?)",
    ).bind(id, user.id, now, now),
    env.DB.prepare("INSERT INTO role(id,code,name,created_at) VALUES (?,?,'Locations',?)").bind(
      id,
      `locations-${id}`,
      now,
    ),
    env.DB.prepare("INSERT INTO staff_role(staff_id,role_id) VALUES (?,?)").bind(id, id),
    env.DB.prepare(
      "INSERT INTO staff_scope(id,staff_id,scope_kind,location_id) VALUES (?,?,?,?)",
    ).bind(id, id, scope, scope === "global" ? null : "location-cebu-central"),
    env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='locations.read' OR (code='locations.manage' AND ?=1)",
    ).bind(id, manage ? 1 : 0),
  ]);
  if (!cookie) {
    const signedIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({
        email: `locations-${id}@example.com`,
        password: "correct-horse-battery-staple",
      }),
    });
    cookie = signedIn.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
  }
  expect(cookie.length).toBeGreaterThan(0);
  return { id, headers: { cookie } };
}
