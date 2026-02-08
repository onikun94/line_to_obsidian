import type { SubscriptionData, SubscriptionResponse } from './types';

const DEFAULT_FREE_LIMIT = 10;
const GRACE_PERIOD_DAYS = 7;

/**
 * Get subscription data for a LINE user
 * Creates a default free subscription if none exists
 */
export async function getSubscription(
  kv: KVNamespace,
  lineUserId: string
): Promise<SubscriptionData> {
  const data = await kv.get(lineUserId, 'json') as SubscriptionData | null;

  if (!data) {
    // Return default free subscription (don't save yet)
    return {
      stripeCustomerId: '',
      subscriptionId: null,
      status: 'free',
      imageCount: 0,
      freeLimit: DEFAULT_FREE_LIMIT,
      currentPeriodEnd: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  return data;
}

/**
 * Save subscription data
 */
export async function saveSubscription(
  kv: KVNamespace,
  lineUserId: string,
  data: SubscriptionData
): Promise<void> {
  await kv.put(lineUserId, JSON.stringify({
    ...data,
    updatedAt: Date.now(),
  }));
}

/**
 * Update subscription data (partial update)
 */
export async function updateSubscription(
  kv: KVNamespace,
  lineUserId: string,
  updates: Partial<SubscriptionData>
): Promise<SubscriptionData> {
  const current = await getSubscription(kv, lineUserId);
  const updated: SubscriptionData = {
    ...current,
    ...updates,
    updatedAt: Date.now(),
  };

  await saveSubscription(kv, lineUserId, updated);
  return updated;
}

/**
 * Check if user can send an image
 */
export function canSendImage(data: SubscriptionData): boolean {
  // Active subscription: unlimited
  if (data.status === 'active') {
    return true;
  }

  // Past due with grace period
  if (data.status === 'past_due' && data.currentPeriodEnd) {
    const gracePeriodMs = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();
    if (now < data.currentPeriodEnd + gracePeriodMs) {
      return true;
    }
  }

  // Free tier: check image count
  return data.imageCount < data.freeLimit;
}

/**
 * Increment image count with retry for race condition handling
 * Uses optimistic locking pattern to handle concurrent updates
 */
export async function incrementImageCount(
  kv: KVNamespace,
  lineUserId: string,
  maxRetries: number = 3
): Promise<number> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const subscription = await getSubscription(kv, lineUserId);
    const newCount = subscription.imageCount + 1;
    const expectedUpdatedAt = subscription.updatedAt;

    // Re-read to check for concurrent modification
    const current = await kv.get(lineUserId, 'json') as SubscriptionData | null;

    // If no data exists yet, create it
    if (!current) {
      const newData: SubscriptionData = {
        ...subscription,
        imageCount: newCount,
        updatedAt: Date.now(),
      };
      await kv.put(lineUserId, JSON.stringify(newData));
      return newCount;
    }

    // Check if another request modified the data
    if (current.updatedAt !== expectedUpdatedAt) {
      // Data was modified, retry with fresh data
      if (attempt < maxRetries - 1) {
        continue;
      }
      // On last attempt, use the latest count
      const latestCount = current.imageCount + 1;
      await updateSubscription(kv, lineUserId, { imageCount: latestCount });
      return latestCount;
    }

    // No concurrent modification, safe to update
    await updateSubscription(kv, lineUserId, { imageCount: newCount });
    return newCount;
  }

  // Should not reach here, but fallback
  const subscription = await getSubscription(kv, lineUserId);
  return subscription.imageCount;
}

/**
 * Get subscription response for API
 */
export function toSubscriptionResponse(data: SubscriptionData): SubscriptionResponse {
  const canSend = canSendImage(data);

  let remainingFreeImages: number | null = null;
  if (data.status === 'free' || data.status === 'canceled') {
    remainingFreeImages = Math.max(0, data.freeLimit - data.imageCount);
  }

  return {
    status: data.status,
    imageCount: data.imageCount,
    freeLimit: data.freeLimit,
    canSendImage: canSend,
    remainingFreeImages,
  };
}

// Reverse index key prefix for customer ID to LINE user ID mapping
const CUSTOMER_INDEX_PREFIX = 'customer:';

/**
 * Save reverse index for customer ID to LINE user ID
 */
export async function saveCustomerIndex(
  kv: KVNamespace,
  customerId: string,
  lineUserId: string
): Promise<void> {
  await kv.put(`${CUSTOMER_INDEX_PREFIX}${customerId}`, lineUserId);
}

/**
 * Delete reverse index for customer ID
 */
export async function deleteCustomerIndex(
  kv: KVNamespace,
  customerId: string
): Promise<void> {
  await kv.delete(`${CUSTOMER_INDEX_PREFIX}${customerId}`);
}

/**
 * Find LINE user ID by Stripe customer ID
 * Uses reverse index for O(1) lookup
 * Falls back to O(n) scan if index is not found (for backwards compatibility)
 */
export async function findUserByCustomerId(
  kv: KVNamespace,
  customerId: string
): Promise<string | null> {
  // First, try the reverse index (O(1))
  const indexedUserId = await kv.get(`${CUSTOMER_INDEX_PREFIX}${customerId}`);
  if (indexedUserId) {
    return indexedUserId;
  }

  // Fallback: O(n) scan for backwards compatibility with existing data
  // This will only happen once per customer, then the index will be created
  const { keys } = await kv.list();

  for (const key of keys) {
    // Skip index keys
    if (key.name.startsWith(CUSTOMER_INDEX_PREFIX)) {
      continue;
    }

    const data = await kv.get(key.name, 'json') as SubscriptionData | null;
    if (data && data.stripeCustomerId === customerId) {
      // Create the reverse index for future lookups
      await saveCustomerIndex(kv, customerId, key.name);
      return key.name;
    }
  }

  return null;
}
