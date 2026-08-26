import type { RpcResult } from "./common";
import type { ApplicationContext, AuthContextRequest, AuthRequest, AuthResponse } from "./index";

export type AuthService = {
  auth(request: AuthRequest): Promise<AuthResponse>;
  getApplicationContext(request: AuthContextRequest): Promise<RpcResult<ApplicationContext>>;
};
