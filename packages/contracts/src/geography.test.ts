import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  AddressComponents,
  AddressSearchCandidate,
  AddressSearchRequest,
  CoordinateConfirmationSource,
  DeliveryInstructions,
} from "./geography";
import type {
  CreateCustomerAddressRequest,
  CustomerAddressView,
  ServiceabilityResult,
  UpdateCustomerAddressRequest,
} from "./index";
import type { RequestMeta } from "./common";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() =>
    Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Type extends true> = Type;

type ExpectedAddressComponents = {
  addressLine1: string;
  addressLine2: string | null;
  barangay: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
};

describe("provider-neutral geography contracts", () => {
  it("keeps serviceability as a purpose-built result", () => {
    const result: ServiceabilityResult = {
      serviceable: false,
      reason: "OUTSIDE_SERVICE_AREA",
      coordinate: { latitude: 10, longitude: 123 },
      market: null,
      serviceArea: null,
      deliveryZone: null,
      fulfillmentEligibility: { eligible: false, candidateCount: 0 },
      resolutionChanged: false,
      evaluatedAt: new Date(0).toISOString(),
    };

    expect(result).not.toHaveProperty("polygonGeoJson");
    expect(result).not.toHaveProperty("databaseRow");
  });

  it("compiles the public geography and Core binding surface", () => {
    const compilerPath = fileURLToPath(
      new URL("../node_modules/typescript/bin/tsc", import.meta.url),
    );
    const result = spawnSync(
      process.execPath,
      [compilerPath, "--noEmit", "--pretty", "false"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });

  it("exposes the exact address search request and candidate shapes", () => {
    type RequestShape = Expect<
      Equal<
        AddressSearchRequest,
        RequestMeta & {
          query: string;
          proximity?: { latitude: number; longitude: number };
        }
      >
    >;
    type CandidateShape = Expect<
      Equal<
        AddressSearchCandidate,
        {
          candidateKey: string;
          displayAddress: string;
          coordinate: { latitude: number; longitude: number };
          components: ExpectedAddressComponents;
          accuracy: string | null;
        }
      >
    >;

    const request: AddressSearchRequest = {
      requestId: "req-search-1",
      query: "Ayala Center Cebu",
      proximity: { latitude: 10.3173, longitude: 123.9058 },
    };
    const candidate: AddressSearchCandidate = {
      candidateKey: "candidate-session-key",
      displayAddress: "Ayala Center Cebu, Cebu City, Philippines",
      coordinate: { latitude: 10.3173, longitude: 123.9058 },
      components: {
        addressLine1: "Ayala Center Cebu",
        addressLine2: null,
        barangay: "Luz",
        city: "Cebu City",
        region: "Central Visayas",
        postalCode: "6000",
        countryCode: "PH",
      },
      accuracy: "rooftop",
    };

    expect(request.query).toBe("Ayala Center Cebu");
    expect(candidate.components.countryCode).toBe("PH");
    void (true as RequestShape);
    void (true as CandidateShape);
  });

  it("keeps confirmation provenance and delivery instructions closed and structured", () => {
    type ConfirmationShape = Expect<
      Equal<CoordinateConfirmationSource, "GEOCODER" | "USER_PIN" | "DEVICE_LOCATION">
    >;
    type InstructionShape = Expect<
      Equal<
        DeliveryInstructions,
        {
          buildingUnit: string | null;
          landmark: string | null;
          gateGuard: string | null;
          deliveryNote: string | null;
          recipientInstruction: string | null;
        }
      >
    >;

    const source: CoordinateConfirmationSource = "DEVICE_LOCATION";
    const instructions: DeliveryInstructions = {
      buildingUnit: "Unit 4B",
      landmark: "Across the public market",
      gateGuard: null,
      deliveryNote: "Call on arrival",
      recipientInstruction: "Ask for Ana",
    };

    expect(source).toBe("DEVICE_LOCATION");
    expect(instructions.buildingUnit).toBe("Unit 4B");
    void (true as ConfirmationShape);
    void (true as InstructionShape);
  });

  it("uses structured address data on create, update, and customer views", () => {
    type UpdateShape = Expect<
      Equal<
        Pick<
          UpdateCustomerAddressRequest,
          "components" | "confirmationSource" | "instructions" | "addressJson"
        >,
        {
          components?: AddressComponents;
          confirmationSource?: CoordinateConfirmationSource;
          instructions?: DeliveryInstructions;
          addressJson?: string;
        }
      >
    >;
    type ViewShape = Expect<
      Equal<
        Pick<
          CustomerAddressView,
          "phone" | "components" | "confirmationSource" | "confirmedAt" | "instructions"
        >,
        {
          phone: string;
          components: AddressComponents;
          confirmationSource: CoordinateConfirmationSource | null;
          confirmedAt: string | null;
          instructions: DeliveryInstructions;
        }
      >
    >;

    const structuredCreate = {
      requestId: "req-create-structured",
      headers: { cookie: "session=opaque" },
      label: "Home",
      recipient: "Ana",
      phone: "+639171234567",
      latitude: 10.3173,
      longitude: 123.9058,
      components: {
        addressLine1: "Ayala Center Cebu",
        addressLine2: null,
        barangay: "Luz",
        city: "Cebu City",
        region: "Central Visayas",
        postalCode: "6000",
        countryCode: "PH",
      },
      confirmationSource: "USER_PIN",
      instructions: {
        buildingUnit: null,
        landmark: null,
        gateGuard: null,
        deliveryNote: null,
        recipientInstruction: null,
      },
    } satisfies CreateCustomerAddressRequest;
    const legacyCreate = {
      requestId: "req-create-legacy",
      headers: { cookie: "session=opaque" },
      label: "Home",
      recipient: "Ana",
      phone: "+639171234567",
      latitude: 10.3173,
      longitude: 123.9058,
      addressJson: "{\"line1\":\"Cebu City\"}",
    } satisfies CreateCustomerAddressRequest;

    expect(structuredCreate).not.toHaveProperty("addressJson");
    expect(legacyCreate.addressJson).toContain("Cebu City");
    void (true as UpdateShape);
    void (true as ViewShape);
  });
});
