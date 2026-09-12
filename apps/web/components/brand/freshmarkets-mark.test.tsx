import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FreshMarketsMark } from "./freshmarkets-mark";

describe("FreshMarketsMark", () => {
  it("renders the shared brand asset as a decorative fixed-size image", () => {
    const markup = renderToStaticMarkup(<FreshMarketsMark className="size-7" />);

    expect(markup).toContain('src="/brand/freshmarkets-mark.png"');
    expect(markup).toContain('alt=""');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('width="32"');
    expect(markup).toContain('height="32"');
    expect(markup).toContain("size-7");
  });
});
