/** Plain-language messages for Supabase Auth errors (codes from the Auth API). */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  const msg = (e as { message?: string } | null)?.message ?? '';
  switch (code) {
    case 'invalid_credentials': return 'Email or password is incorrect.';
    case 'email_not_confirmed': return 'Please confirm your email address first. Check your inbox for the link.';
    case 'over_email_send_rate_limit': return 'Too many emails have been sent. Please wait a while and try again.';
    case 'over_request_rate_limit': return 'Too many attempts. Please wait a few minutes and try again.';
    case 'weak_password': return msg || 'Choose a stronger password.';
    case 'same_password': return 'Choose a password different from your current one.';
    case 'user_already_exists': case 'email_exists': return 'An account with this email already exists. Sign in instead.';
    case 'signup_disabled': return 'New sign-ups are currently closed.';
    case 'email_address_invalid': return 'Enter a valid email address.';
    default: return msg || 'Something went wrong. Please try again.';
  }
}
