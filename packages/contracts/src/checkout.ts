import type { RpcResult } from "./common";
import type {
  AuthenticatedRequest,
  CartView,
  CheckoutEligibilityRequest,
  CheckoutEligibilityView,
  CreateCustomerAddressRequest,
  CustomerAddressView,
  SetCartItemRequest,
  UpdateCustomerAddressRequest,
} from "./index";

/**
 * Canonical checkout target port. Commitment lives behind
 * `createAttempt`/`createPayment`/`recoverCommitment`; the sandbox-only
 * The retired sandbox commitment path has no representation here.
 */
export type CheckoutService = {
  evaluateCheckout(
    request: CheckoutEligibilityRequest,
  ): Promise<RpcResult<CheckoutEligibilityView>>;
  getCart(request: AuthenticatedRequest): Promise<RpcResult<CartView>>;
  setCartItem(request: SetCartItemRequest): Promise<RpcResult<CartView>>;
  createCustomerAddress(
    request: CreateCustomerAddressRequest,
  ): Promise<RpcResult<CustomerAddressView>>;
  listCustomerAddresses(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<ReadonlyArray<CustomerAddressView>>>;
  updateCustomerAddress(
    request: UpdateCustomerAddressRequest,
  ): Promise<RpcResult<CustomerAddressView>>;
};
