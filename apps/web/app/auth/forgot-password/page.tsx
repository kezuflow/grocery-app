import { AuthForm } from "../auth-form";
import { AuthPage } from "../auth-page";

export default function ForgotPasswordPage() {
  return (
    <AuthPage title="Reset your password">
      <AuthForm mode="forgot" />
    </AuthPage>
  );
}
