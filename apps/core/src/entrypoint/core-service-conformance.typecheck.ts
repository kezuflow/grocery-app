import type { CoreServiceBinding } from "@freshmarkets/contracts";
import type { CoreEntrypoint } from "../index";

type Expect<Type extends true> = Type;

export type CoreEntrypointImplementsBinding = Expect<
  CoreEntrypoint extends CoreServiceBinding ? true : false
>;
