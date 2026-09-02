import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CustomerAccessStatusBadge,
  MembershipStatusBadge,
  PrivacyRequestStatusBadge,
} from "./customer-status-badges";

describe("customer administration status badges", () => {
  it("uses the shared success pill for active customer states", () => {
    const customer = renderToStaticMarkup(<CustomerAccessStatusBadge status="active" />);
    const membership = renderToStaticMarkup(<MembershipStatusBadge status="ACTIVE" />);

    expect(customer).toContain("fm-admin-status-success");
    expect(membership).toContain("fm-admin-status-success");
  });

  it("keeps exceptional and empty membership states visually explicit", () => {
    expect(renderToStaticMarkup(<MembershipStatusBadge status="PAST_DUE" />)).toContain(
      "fm-admin-status-danger",
    );
    expect(renderToStaticMarkup(<MembershipStatusBadge status={null} />)).toContain(
      "No membership",
    );
  });

  it("maps privacy lifecycle states to the shared pill vocabulary", () => {
    expect(renderToStaticMarkup(<PrivacyRequestStatusBadge status="PROCESSING" />)).toContain(
      "fm-admin-status-warning",
    );
    expect(renderToStaticMarkup(<PrivacyRequestStatusBadge status="COMPLETED" />)).toContain(
      "fm-admin-status-success",
    );
  });
});
