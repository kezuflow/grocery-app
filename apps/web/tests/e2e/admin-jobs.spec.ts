import { executeAdminE2eSql, expect, test } from "./admin-authenticated-fixture";

test("authorized Admin opens scheduled job failures from Overview", async ({ adminPage }) => {
  const jobName = `audit-test-${crypto.randomUUID()}`;
  const now = Date.now();
  executeAdminE2eSql(`INSERT INTO scheduled_job_run
    (id,job_name,cron_expression,status,affected_count,error_code,detail,started_at,finished_at)
    VALUES ('${crypto.randomUUID()}','${jobName}','* * * * *','FAILED',NULL,
      'SCHEDULED_JOB_ERROR',NULL,${now},${now});`);

  await adminPage.goto("/admin");
  await adminPage.getByRole("link", { name: "View runs" }).click();
  await expect(adminPage.getByRole("heading", { name: "Scheduled jobs" })).toBeVisible();
  const row = adminPage.getByRole("row", { name: new RegExp(jobName) });
  await expect(row).toContainText("FAILED");
  await expect(row).toContainText("SCHEDULED_JOB_ERROR");
});
