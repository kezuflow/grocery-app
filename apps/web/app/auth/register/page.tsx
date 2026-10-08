import { AuthForm } from "../auth-form";
import { AuthPage } from "../auth-page";

export default function RegisterPage() {
  return (
    <AuthPage title="Create your account">
      <AuthForm mode="register" />
    </AuthPage>
  );
}
