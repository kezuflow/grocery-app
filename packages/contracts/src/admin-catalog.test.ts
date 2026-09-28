import { expect, it } from "vitest";
import {
  catalogStatuses,
  adminProductMediaMaxBytes,
  adminProductMediaMimeTypes,
} from "./admin-catalog";

it("publishes the closed catalog status vocabulary", () => {
  expect(catalogStatuses).toEqual(["active", "inactive"]);
});

it("publishes bounded Product media types and size", () => {
  expect(adminProductMediaMimeTypes).toEqual(["image/jpeg", "image/png", "image/webp"]);
  expect(adminProductMediaMaxBytes).toBe(5_242_880);
});
