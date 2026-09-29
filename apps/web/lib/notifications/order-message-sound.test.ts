import { expect, it } from "vitest";
import { isIncomingOrderMessage, newOrderMessageSoundIdentities } from "./order-message-sound";

it("classifies acknowledgement for Customer only and preserves each new message identity", () => {
  expect(isIncomingOrderMessage("ADMIN", "CUSTOMER")).toBe(true);
  expect(isIncomingOrderMessage("ADMIN", "AUTOMATION")).toBe(false);
  expect(isIncomingOrderMessage("CUSTOMER", "ADMIN")).toBe(true);
  expect(isIncomingOrderMessage("CUSTOMER", "AUTOMATION")).toBe(true);
  expect(isIncomingOrderMessage("CUSTOMER", "CUSTOMER")).toBe(false);
  expect(newOrderMessageSoundIdentities("order-1", [1, 3, 5], 1)).toEqual([
    "message:order-1:3",
    "message:order-1:5",
  ]);
});
