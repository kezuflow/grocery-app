// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAdminPagination } from "./admin-controls";

let root: Root | null = null;

function PaginationProbe({ scope, advance }: { scope: string; advance: boolean }) {
  const pagination = useAdminPagination(scope);
  useEffect(() => {
    if (advance && pagination.pageNumber === 1) pagination.next(`cursor-for-${scope}`);
  }, [advance, pagination, scope]);
  return (
    <output data-cursor={pagination.cursor ?? "first"} data-page={pagination.pageNumber}>
      {scope}
    </output>
  );
}

describe("useAdminPagination", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
  });

  it("does not carry an opaque cursor or page number into a new scope", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => root?.render(<PaginationProbe scope="location-a" advance />));
    expect(container.querySelector("output")?.dataset).toMatchObject({
      cursor: "cursor-for-location-a",
      page: "2",
    });

    await act(async () => root?.render(<PaginationProbe scope="location-b" advance={false} />));
    expect(container.querySelector("output")?.dataset).toMatchObject({
      cursor: "first",
      page: "1",
    });
  });
});
