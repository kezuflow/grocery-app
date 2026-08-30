import type { RpcResult } from "./common";
import type { Capability } from "./admin-foundation";

export type AuthRequest = {
  method: string;
  url: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
};

export type AuthResponse = {
  status: number;
  headers: ReadonlyArray<readonly [string, string]>;
  body: string;
};

export type AuthContextRequest = {
  headers: Readonly<Record<string, string>>;
  requestId: string;
};

export type AuthenticatedPrincipal = {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
};

export type Scope =
  | { kind: "global" }
  | { kind: "market"; marketId: string }
  | { kind: "location"; locationId: string };

export type ApplicationContext = {
  authenticated: boolean;
  principal: AuthenticatedPrincipal | null;
  capabilities: ReadonlyArray<Capability>;
  scopes: ReadonlyArray<Scope>;
};

export type AuthenticatedRequest = import("./common").RequestMeta & {
  headers: Readonly<Record<string, string>>;
};

export type AuthService = {
  auth(request: AuthRequest): Promise<AuthResponse>;
  getApplicationContext(request: AuthContextRequest): Promise<RpcResult<ApplicationContext>>;
};
