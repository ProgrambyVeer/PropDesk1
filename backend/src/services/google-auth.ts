import { OAuth2Client } from 'google-auth-library';
import { config } from '../config';
import { AppError, unauthorized } from '../lib/http';

const client = new OAuth2Client();
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export async function verifyGoogleCredential(credential: string) {
  if (!config.googleClientId) throw new AppError(503, 'GOOGLE_AUTH_UNAVAILABLE', 'Google sign-in is not configured.');
  let ticket;
  try {
    ticket = await client.verifyIdToken({ idToken: credential, audience: config.googleClientId });
  } catch {
    throw unauthorized('Google sign-in was cancelled or the credential is invalid or expired. Please try again.');
  }
  const payload = ticket.getPayload();
  const audience = payload?.aud;
  if (!payload || !payload.sub || !ISSUERS.has(payload.iss || '') ||
    !(audience === config.googleClientId || (Array.isArray(audience) && audience.includes(config.googleClientId))) ||
    typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) {
    throw unauthorized('Google sign-in credential is invalid or expired. Please try again.');
  }
  if (payload.email_verified !== true || !payload.email?.trim()) {
    throw unauthorized('Use a Google account with a verified email address.');
  }
  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    name: payload.name?.trim() || payload.email.trim().toLowerCase(),
  };
}
