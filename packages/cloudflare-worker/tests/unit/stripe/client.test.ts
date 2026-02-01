import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createCheckoutSession,
  createPortalSession,
  verifyWebhookSignature,
} from '../../../src/stripe/client';

describe('Stripe Client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('createCheckoutSession', () => {
    it('正常にCheckoutセッションを作成する', async () => {
      const mockResponse = {
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/pay/cs_test_123',
        customer: 'cus_test_123',
        subscription: 'sub_test_123',
        metadata: { lineUserId: 'U1234567890abcdef1234567890abcdef' },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await createCheckoutSession({
        secretKey: 'sk_test_xxx',
        priceId: 'price_test_123',
        lineUserId: 'U1234567890abcdef1234567890abcdef',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.stripe.com/v1/checkout/sessions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer sk_test_xxx',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        })
      );

      // リクエストボディの検証
      const call = (global.fetch as any).mock.calls[0];
      const body = call[1].body;
      expect(body).toContain('mode=subscription');
      expect(body).toContain('metadata%5BlineUserId%5D=U1234567890abcdef1234567890abcdef');
    });

    it('Stripe APIエラー時に例外をスローする', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: () => Promise.resolve({
          error: { message: 'Invalid price_id' },
        }),
      });

      await expect(
        createCheckoutSession({
          secretKey: 'sk_test_xxx',
          priceId: 'invalid_price',
          lineUserId: 'U1234567890abcdef1234567890abcdef',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        })
      ).rejects.toThrow('Stripe API error: Invalid price_id');
    });
  });

  describe('createPortalSession', () => {
    it('正常にPortalセッションを作成する', async () => {
      const mockResponse = {
        url: 'https://billing.stripe.com/session/test_123',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await createPortalSession({
        secretKey: 'sk_test_xxx',
        customerId: 'cus_test_123',
        returnUrl: 'https://example.com',
      });

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.stripe.com/v1/billing_portal/sessions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer sk_test_xxx',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        })
      );
    });

    it('Stripe APIエラー時に例外をスローする', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
        json: () => Promise.resolve({
          error: { message: 'No such customer: cus_invalid' },
        }),
      });

      await expect(
        createPortalSession({
          secretKey: 'sk_test_xxx',
          customerId: 'cus_invalid',
          returnUrl: 'https://example.com',
        })
      ).rejects.toThrow('Stripe API error: No such customer: cus_invalid');
    });
  });

  describe('verifyWebhookSignature', () => {
    const secret = 'whsec_test_secret';
    const payload = JSON.stringify({
      id: 'evt_test_123',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_123' } },
    });

    // HMAC-SHA256署名を生成するヘルパー
    async function generateSignature(timestamp: number, payload: string, secret: string): Promise<string> {
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
      return Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }

    it('正常な署名を検証してイベントを返す', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const sig = await generateSignature(timestamp, payload, secret);
      const signature = `t=${timestamp},v1=${sig}`;

      const result = await verifyWebhookSignature(payload, signature, secret);

      expect(result).toEqual(JSON.parse(payload));
    });

    it('不正な署名形式の場合に例外をスローする', async () => {
      await expect(
        verifyWebhookSignature(payload, 'invalid_signature', secret)
      ).rejects.toThrow('Invalid Stripe signature format');
    });

    it('署名が一致しない場合に例外をスローする', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = `t=${timestamp},v1=invalid_signature_hash`;

      await expect(
        verifyWebhookSignature(payload, signature, secret)
      ).rejects.toThrow('Webhook signature verification failed');
    });

    it('タイムスタンプが古すぎる場合に例外をスローする', async () => {
      // 10分前のタイムスタンプ（許容は5分）
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
      const sig = await generateSignature(oldTimestamp, payload, secret);
      const signature = `t=${oldTimestamp},v1=${sig}`;

      await expect(
        verifyWebhookSignature(payload, signature, secret)
      ).rejects.toThrow('Webhook timestamp too old');
    });
  });
});
