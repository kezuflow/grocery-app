import { describe, expect, it } from "vitest";
import { requestMetaSchema } from "./index";

describe("request metadata validation", () => {
  it("accepts valid request metadata", () => {
    expect(requestMetaSchema.parse({ requestId: "request-1" })).toEqual({
      requestId: "request-1",
    });
  });

  it("rejects an empty request identifier", () => {
    expect(() => requestMetaSchema.parse({ requestId: "" })).toThrow();
  });
});
