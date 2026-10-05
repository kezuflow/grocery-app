import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProviderDeliveryEvidence } from "./provider-delivery-evidence";

const dispatch = {
  provider: "lalamove" as const,
  dispatchId: "dispatch",
  status: "ACTIVE",
  providerStatus: "ALLOCATING",
  providerDeliveryId: "sandbox-order",
  trackingUrl: null,
  version: 1,
};

describe("staff courier evidence", () => {
  it("explains custody review without stopping verified delivery progress", () => {
    const markup = renderToStaticMarkup(
      <ProviderDeliveryEvidence dispatch={{ ...dispatch, custodyReviewRequired: true }} />,
    );
    expect(markup).toContain("Handover remains recorded and delivery progress continues.");
    expect(markup).not.toContain("<button");
  });
  it("shows a signature without requiring a photo and does not expose backend proof flags", () => {
    const backend = {
      ...dispatch,
      missingDeliveryProof: true,
      proofs: [{ kind: "DELIVERY" as const, status: "SIGNED", imageUrls: [] }],
    };
    const markup = renderToStaticMarkup(<ProviderDeliveryEvidence dispatch={backend} />);
    expect(markup).toContain("Delivery proof");
    expect(markup).toContain("SIGNED");
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toMatch(/missing|review required/i);
  });
  it("opens supplied protected evidence with safe new-tab attributes", () => {
    const markup = renderToStaticMarkup(
      <ProviderDeliveryEvidence
        dispatch={{
          ...dispatch,
          proofs: [
            {
              kind: "PICKUP",
              status: "RECEIVED",
              imageUrls: ["https://example.invalid/proof.png"],
            },
          ],
        }}
      />,
    );
    expect(markup).toContain('href="https://example.invalid/proof.png"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });
});
