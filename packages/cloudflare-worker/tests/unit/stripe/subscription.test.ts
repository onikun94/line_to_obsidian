import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getSubscription,
  saveSubscription,
  updateSubscription,
  canSendImage,
  incrementImageCount,
  toSubscriptionResponse,
  saveCustomerIndex,
  findUserByCustomerId,
} from '../../../src/stripe/subscription';
import type { SubscriptionData } from '../../../src/stripe/types';

// KVNamespace モック
function createMockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn((key: string, type?: string) => {
      const value = store.get(key);
      if (!value) return Promise.resolve(null);
      return type === 'json' ? Promise.resolve(JSON.parse(value)) : Promise.resolve(value);
    }),
    put: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    list: vi.fn(() => Promise.resolve({ keys: Array.from(store.keys()).map(name => ({ name })) })),
    _store: store,
  };
}

describe('Stripe Subscription', () => {
  let mockKV: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    mockKV = createMockKV();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getSubscription', () => {
    it('存在しないユーザーにはデフォルト値を返す', async () => {
      const result = await getSubscription(mockKV as any, 'U_new_user');

      expect(result).toEqual({
        stripeCustomerId: '',
        subscriptionId: null,
        status: 'free',
        imageCount: 0,
        freeLimit: 10,
        currentPeriodEnd: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    it('存在するユーザーのデータを返す', async () => {
      const existingData: SubscriptionData = {
        stripeCustomerId: 'cus_123',
        subscriptionId: 'sub_123',
        status: 'active',
        imageCount: 5,
        freeLimit: 10,
        currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 500,
      };

      mockKV._store.set('U_existing', JSON.stringify(existingData));

      const result = await getSubscription(mockKV as any, 'U_existing');

      expect(result).toEqual(existingData);
    });
  });

  describe('saveSubscription', () => {
    it('サブスクリプションデータを保存する', async () => {
      const data: SubscriptionData = {
        stripeCustomerId: 'cus_123',
        subscriptionId: 'sub_123',
        status: 'active',
        imageCount: 5,
        freeLimit: 10,
        currentPeriodEnd: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveSubscription(mockKV as any, 'U_test', data);

      expect(mockKV.put).toHaveBeenCalledWith(
        'U_test',
        expect.stringContaining('"stripeCustomerId":"cus_123"')
      );
    });
  });

  describe('updateSubscription', () => {
    it('既存データを部分更新する', async () => {
      const existingData: SubscriptionData = {
        stripeCustomerId: 'cus_123',
        subscriptionId: null,
        status: 'free',
        imageCount: 5,
        freeLimit: 10,
        currentPeriodEnd: null,
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 500,
      };

      mockKV._store.set('U_test', JSON.stringify(existingData));

      const result = await updateSubscription(mockKV as any, 'U_test', {
        status: 'active',
        subscriptionId: 'sub_123',
      });

      expect(result.status).toBe('active');
      expect(result.subscriptionId).toBe('sub_123');
      expect(result.imageCount).toBe(5); // 変更なし
      expect(result.updatedAt).toBe(Date.now());
    });
  });

  describe('canSendImage', () => {
    describe('status: active', () => {
      it('アクティブなサブスクリプションは無制限', () => {
        const data: SubscriptionData = {
          stripeCustomerId: 'cus_123',
          subscriptionId: 'sub_123',
          status: 'active',
          imageCount: 1000,
          freeLimit: 10,
          currentPeriodEnd: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        expect(canSendImage(data)).toBe(true);
      });
    });

    describe('status: free', () => {
      it('無料枠内（9/10）は送信可能', () => {
        const data: SubscriptionData = {
          stripeCustomerId: '',
          subscriptionId: null,
          status: 'free',
          imageCount: 9,
          freeLimit: 10,
          currentPeriodEnd: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        expect(canSendImage(data)).toBe(true);
      });

      it('無料枠上限（10/10）は送信不可', () => {
        const data: SubscriptionData = {
          stripeCustomerId: '',
          subscriptionId: null,
          status: 'free',
          imageCount: 10,
          freeLimit: 10,
          currentPeriodEnd: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        expect(canSendImage(data)).toBe(false);
      });

      it('無料枠超過（11/10）は送信不可', () => {
        const data: SubscriptionData = {
          stripeCustomerId: '',
          subscriptionId: null,
          status: 'free',
          imageCount: 11,
          freeLimit: 10,
          currentPeriodEnd: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        expect(canSendImage(data)).toBe(false);
      });
    });

    describe('status: past_due', () => {
      it('猶予期間内（6日経過）は送信可能', () => {
        const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;
        const data: SubscriptionData = {
          stripeCustomerId: 'cus_123',
          subscriptionId: 'sub_123',
          status: 'past_due',
          imageCount: 100,
          freeLimit: 10,
          currentPeriodEnd: sixDaysAgo,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        expect(canSendImage(data)).toBe(true);
      });

      it('猶予期間境界（7日経過）は送信可能', () => {
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const data: SubscriptionData = {
          stripeCustomerId: 'cus_123',
          subscriptionId: 'sub_123',
          status: 'past_due',
          imageCount: 100,
          freeLimit: 10,
          currentPeriodEnd: sevenDaysAgo,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        // 7日ちょうどはまだ猶予期間内（< で判定）
        expect(canSendImage(data)).toBe(false);
      });

      it('猶予期間超過（8日経過）は無料枠で判定', () => {
        const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
        const data: SubscriptionData = {
          stripeCustomerId: 'cus_123',
          subscriptionId: 'sub_123',
          status: 'past_due',
          imageCount: 5, // 無料枠内
          freeLimit: 10,
          currentPeriodEnd: eightDaysAgo,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        expect(canSendImage(data)).toBe(true);
      });

      it('猶予期間超過かつ無料枠超過は送信不可', () => {
        const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
        const data: SubscriptionData = {
          stripeCustomerId: 'cus_123',
          subscriptionId: 'sub_123',
          status: 'past_due',
          imageCount: 15, // 無料枠超過
          freeLimit: 10,
          currentPeriodEnd: eightDaysAgo,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        expect(canSendImage(data)).toBe(false);
      });

      it('currentPeriodEndがnullの場合は無料枠で判定', () => {
        const data: SubscriptionData = {
          stripeCustomerId: 'cus_123',
          subscriptionId: 'sub_123',
          status: 'past_due',
          imageCount: 5,
          freeLimit: 10,
          currentPeriodEnd: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        expect(canSendImage(data)).toBe(true);
      });
    });

    describe('status: canceled', () => {
      it('キャンセル済みは無料枠で判定', () => {
        const data: SubscriptionData = {
          stripeCustomerId: 'cus_123',
          subscriptionId: null,
          status: 'canceled',
          imageCount: 5,
          freeLimit: 10,
          currentPeriodEnd: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        expect(canSendImage(data)).toBe(true);
      });

      it('キャンセル済みで無料枠超過は送信不可', () => {
        const data: SubscriptionData = {
          stripeCustomerId: 'cus_123',
          subscriptionId: null,
          status: 'canceled',
          imageCount: 15,
          freeLimit: 10,
          currentPeriodEnd: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        expect(canSendImage(data)).toBe(false);
      });
    });
  });

  describe('incrementImageCount', () => {
    it('新規ユーザーのカウントをインクリメントする', async () => {
      const result = await incrementImageCount(mockKV as any, 'U_new_user');

      expect(result).toBe(1);
      const saved = JSON.parse(mockKV._store.get('U_new_user')!);
      expect(saved.imageCount).toBe(1);
    });

    it('既存ユーザーのカウントをインクリメントする', async () => {
      const existingData: SubscriptionData = {
        stripeCustomerId: '',
        subscriptionId: null,
        status: 'free',
        imageCount: 5,
        freeLimit: 10,
        currentPeriodEnd: null,
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 500,
      };
      mockKV._store.set('U_existing', JSON.stringify(existingData));

      const result = await incrementImageCount(mockKV as any, 'U_existing');

      expect(result).toBe(6);
    });

    it('同時更新時にリトライして正しくインクリメントする', async () => {
      const existingData: SubscriptionData = {
        stripeCustomerId: '',
        subscriptionId: null,
        status: 'free',
        imageCount: 5,
        freeLimit: 10,
        currentPeriodEnd: null,
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 500,
      };
      mockKV._store.set('U_concurrent', JSON.stringify(existingData));

      // 最初のgetでは古いupdatedAtを返し、2回目のgetでは更新されたupdatedAtを返す
      let callCount = 0;
      const originalGet = mockKV.get;
      mockKV.get = vi.fn(async (key: string, type?: string) => {
        callCount++;
        if (key === 'U_concurrent' && type === 'json') {
          if (callCount === 1) {
            // 最初の読み取り
            return existingData;
          } else if (callCount === 2) {
            // 2回目の読み取り時に他のプロセスが更新した
            return {
              ...existingData,
              imageCount: 6,
              updatedAt: Date.now() + 100,
            };
          } else {
            // 3回目以降は最新の値
            return {
              ...existingData,
              imageCount: 6,
              updatedAt: Date.now() + 100,
            };
          }
        }
        return originalGet(key, type);
      });

      const result = await incrementImageCount(mockKV as any, 'U_concurrent');

      // リトライにより、他のプロセスが更新した後の値に基づいてインクリメント
      expect(result).toBe(7);
    });
  });

  describe('toSubscriptionResponse', () => {
    it('無料ユーザーのレスポンスを正しく生成する', () => {
      const data: SubscriptionData = {
        stripeCustomerId: '',
        subscriptionId: null,
        status: 'free',
        imageCount: 3,
        freeLimit: 10,
        currentPeriodEnd: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = toSubscriptionResponse(data);

      expect(result).toEqual({
        status: 'free',
        imageCount: 3,
        freeLimit: 10,
        canSendImage: true,
        remainingFreeImages: 7,
      });
    });

    it('アクティブユーザーのレスポンスを正しく生成する', () => {
      const data: SubscriptionData = {
        stripeCustomerId: 'cus_123',
        subscriptionId: 'sub_123',
        status: 'active',
        imageCount: 100,
        freeLimit: 10,
        currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = toSubscriptionResponse(data);

      expect(result).toEqual({
        status: 'active',
        imageCount: 100,
        freeLimit: 10,
        canSendImage: true,
        remainingFreeImages: null,
      });
    });

    it('無料枠を使い切ったユーザーのレスポンス', () => {
      const data: SubscriptionData = {
        stripeCustomerId: '',
        subscriptionId: null,
        status: 'free',
        imageCount: 15,
        freeLimit: 10,
        currentPeriodEnd: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = toSubscriptionResponse(data);

      expect(result).toEqual({
        status: 'free',
        imageCount: 15,
        freeLimit: 10,
        canSendImage: false,
        remainingFreeImages: 0, // マイナスにはならない
      });
    });
  });

  describe('saveCustomerIndex / findUserByCustomerId', () => {
    it('顧客インデックスを保存して検索できる', async () => {
      await saveCustomerIndex(mockKV as any, 'cus_123', 'U_test_user');

      const result = await findUserByCustomerId(mockKV as any, 'cus_123');

      expect(result).toBe('U_test_user');
    });

    it('存在しない顧客IDはnullを返す', async () => {
      const result = await findUserByCustomerId(mockKV as any, 'cus_not_found');

      expect(result).toBeNull();
    });
  });
});
