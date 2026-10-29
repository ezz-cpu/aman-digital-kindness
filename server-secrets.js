import { createHmac } from 'node:crypto';

export function deriveSecret(masterSecret, purpose) {
  if (!masterSecret) return null;
  if (typeof masterSecret !== 'string' || masterSecret.length < 32 || masterSecret.length > 512) {
    throw new Error('APP_SECRET must be a stable private value of at least 32 characters.');
  }
  return createHmac('sha256', masterSecret).update(`aman:${purpose}:v1`).digest();
}

export function validateHostedSecrets(masterSecret, ownerCode) {
  if (!masterSecret) throw new Error('Hosted databases require APP_SECRET. Keep the same value across deployments.');
  deriveSecret(masterSecret, 'validation');
  if (typeof ownerCode !== 'string' || ownerCode.trim().length < 32 || ownerCode.length > 100) {
    throw new Error('Hosted databases require a private TOBI_OWNER_CODE of 32 to 100 characters.');
  }
}
