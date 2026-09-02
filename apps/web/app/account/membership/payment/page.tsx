import { PayMongoCardPayment } from "../../../../components/payments/paymongo-card-payment";
import { StorefrontShell } from "../../../../components/storefront/storefront-shell";

export default function MembershipPaymentPage() {
  return (
    <StorefrontShell>
      <PayMongoCardPayment
        storageKey="freshmarkets.membershipPaymentAction"
        title="Activate paid membership"
        description="Your first payment activates the membership. PayMongo securely tokenizes the card and handles future monthly charges and retries."
        returnPath="/account?membership_payment=return"
        donePath="/account?membership_payment=submitted"
        backPath="/account"
      />
    </StorefrontShell>
  );
}
