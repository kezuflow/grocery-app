import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

beforeEach(async () => {
  await applyD1Migrations(
    env.DB,
    JSON.parse((env as unknown as { TEST_MIGRATIONS: string }).TEST_MIGRATIONS) as Parameters<
      typeof applyD1Migrations
    >[1],
  );
});
