import { parseEnvironment } from "./environment";

export const mobileEnvironment = parseEnvironment({
  variant: process.env.EXPO_PUBLIC_APP_VARIANT,
  backendOrigin: process.env.EXPO_PUBLIC_BACKEND_ORIGIN,
});
