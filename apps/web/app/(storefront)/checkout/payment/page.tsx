import { PayMongoPayment } from "../../../../components/payments/paymongo-payment";

export default function CheckoutPaymentPage() {
  return (
    <>
      <PayMongoPayment
        storageKey="freshmarkets.checkoutPaymentAction"
        title="Complete payment"
        description="Complete the PayMongo method you selected at checkout. FreshMarkets confirms the order only after the signed provider event arrives."
        returnPath="/orders?payment=return"
        donePath="/orders?payment=submitted"
        backPath="/orders?payment=return"
      />
    </>
  );
}
