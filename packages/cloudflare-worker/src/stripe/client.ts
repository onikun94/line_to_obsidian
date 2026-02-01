import type { StripeCheckoutSession, StripePortalSession, StripeWebhookEvent } from './types';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

/**
 * Create a Stripe Checkout Session for subscription
 */
export async function createCheckoutSession(params: {
  secretKey: string;
  priceId: string;
  lineUserId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<StripeCheckoutSession> {
  const body = new URLSearchParams({
    'mode': 'subscription',
    'line_items[0][price]': params.priceId,
    'line_items[0][quantity]': '1',
    'success_url': params.successUrl,
    'cancel_url': params.cancelUrl,
    'metadata[lineUserId]': params.lineUserId,
  });

  const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.json() as { error?: { message?: string } };
    throw new Error(`Stripe API error: ${error.error?.message || response.statusText}`);
  }

  return response.json();
}

/**
 * Create a Stripe Customer Portal Session
 */
export async function createPortalSession(params: {
  secretKey: string;
  customerId: string;
  returnUrl: string;
}): Promise<StripePortalSession> {
  const body = new URLSearchParams({
    'customer': params.customerId,
    'return_url': params.returnUrl,
  });

  const response = await fetch(`${STRIPE_API_BASE}/billing_portal/sessions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.json() as { error?: { message?: string } };
    throw new Error(`Stripe API error: ${error.error?.message || response.statusText}`);
  }

  return response.json();
}

/**
 * Verify Stripe webhook signature using Web Crypto API
 * Based on Stripe's signature verification algorithm
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<StripeWebhookEvent> {
  // Parse the signature header
  const signatureParts = signature.split(',');
  const timestamp = signatureParts.find(p => p.startsWith('t='))?.split('=')[1];
  const expectedSig = signatureParts.find(p => p.startsWith('v1='))?.split('=')[1];

  if (!timestamp || !expectedSig) {
    throw new Error('Invalid Stripe signature format');
  }

  // Check timestamp to prevent replay attacks (5 minute tolerance)
  const timestampMs = parseInt(timestamp, 10) * 1000;
  const now = Date.now();
  const tolerance = 5 * 60 * 1000; // 5 minutes

  if (Math.abs(now - timestampMs) > tolerance) {
    throw new Error('Webhook timestamp too old');
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signedPayload)
  );

  // Convert to hex string
  const computedSig = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison
  if (computedSig.length !== expectedSig.length) {
    throw new Error('Webhook signature verification failed');
  }

  let result = 0;
  for (let i = 0; i < computedSig.length; i++) {
    result |= computedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }

  if (result !== 0) {
    throw new Error('Webhook signature verification failed');
  }

  return JSON.parse(payload);
}
