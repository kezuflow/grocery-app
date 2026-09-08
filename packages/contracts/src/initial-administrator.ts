import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";

export type InitialAdministratorSetupView =
  | { state: "UNAVAILABLE" }
  | { state: "VERIFY_EMAIL" }
  | { state: "READY"; expectedVersion: 0 }
  | { state: "COMPLETED"; staffId: string };

export type CompleteInitialAdministratorSetupRequest = AuthenticatedRequest & {
  expectedVersion: 0;
  idempotencyKey: string;
};

export type InitialAdministratorService = {
  getInitialAdministratorSetup(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<InitialAdministratorSetupView>>;
  completeInitialAdministratorSetup(
    request: CompleteInitialAdministratorSetupRequest,
  ): Promise<RpcResult<{ staffId: string }>>;
};
