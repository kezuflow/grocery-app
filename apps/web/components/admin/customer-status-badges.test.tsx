import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CustomerAccessStatusBadge,
  MembershipStatusBadge,
  PrivacyRequestStatusBadge,
} from "./customer-status-badges";

describe("customer administration status badges", () => {
  it("uses the stock secondary badge for active customer states", () => {
    const customer = renderToStaticMarkup(<CustomerAccessStatusBadge status="active" />);
    const membership = renderToStaticMarkup(<MembershipStatusBadge status="ACTIVE" />);

    expect(customer).toContain('data-variant="secondary"');
    expect(membership).toContain('data-variant="secondary"');
  });

  it("keeps exceptional and empty membership states visually explicit", () => {
    expect(renderToStaticMarkup(<MembershipStatusBadge status="PAST_DUE" />)).toContain(
      'data-variant="destructive"',
    );
    expect(renderToStaticMarkup(<MembershipStatusBadge status={null} />)).toContain(
      "No membership",
    );
  });

  it("maps privacy lifecycle states to stock badge variants", () => {
    expect(renderToStaticMarkup(<PrivacyRequestStatusBadge status="PROCESSING" />)).toContain(
      'data-variant="outline"',
    );
    expect(renderToStaticMarkup(<PrivacyRequestStatusBadge status="COMPLETED" />)).toContain(
      'data-variant="secondary"',
    );
  });
});
