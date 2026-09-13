import { PayMongoCardPayment } from "../../../../components/payments/paymongo-card-payment";

export default function CheckoutPaymentPage() {
  return (
    <>
      <PayMongoCardPayment
        storageKey="freshmarkets.checkoutPaymentAction"
        title="Complete payment"
        description="PayMongo securely processes your payment. FreshMarkets confirms the order only after the signed provider event arrives."
        returnPath="/orders?payment=return"
        donePath="/orders?payment=submitted"
        backPath="/checkout"
      />
    </>
  );
}
