import { CryptoUtils } from './cryptoUtils';
import { Plugin } from 'obsidian';

export interface EncryptionKeys {
  publicKey: string;
  encryptedPrivateKey: string;
  deviceId: string;
  keyId: string;
  createdAt: number;
  salt: string;
}

export interface PublicKeyInfo {
  userId: string;
  publicKey: string;
  keyId: string;
  fetchedAt: number;
}

export class KeyManager {
  private plugin: Plugin;
  private deviceKey: CryptoKey | null = null;
  private keyPair: CryptoKeyPair | null = null;
  private publicKeyCache: Map<string, PublicKeyInfo> = new Map();
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  async initialize(): Promise<void> {
    const keys = await this.loadKeys();

    if (!keys) {
      await this.generateAndSaveKeys();
    } else {
      await this.loadExistingKeys(keys);

      const data = await this.plugin.loadData();
      if (data?.pendingKeyRegistration) {
        try {
          await this.registerPublicKey(keys);
          delete data.pendingKeyRegistration;
          await this.plugin.saveData(data);
        } catch (error) {
          if (process.env.NODE_ENV === 'development') {
            console.error('Failed to complete pending key registration:', error);
          }
        }
      }
    }
  }

  private async generateAndSaveKeys(): Promise<void> {
    const deviceId = await CryptoUtils.generateDeviceId();

    this.keyPair = await CryptoUtils.generateKeyPair();

    const salt = crypto.getRandomValues(new Uint8Array(16));
    this.deviceKey = await CryptoUtils.deriveKeyFromDeviceId(deviceId, salt);

    const privateKeyPem = await CryptoUtils.exportPrivateKey(this.keyPair.privateKey);

    const encryptedPrivateKey = await this.encryptPrivateKey(privateKeyPem);

    const publicKeyPem = await CryptoUtils.exportPublicKey(this.keyPair.publicKey);

    const keyInfo: EncryptionKeys = {
      publicKey: publicKeyPem,
      encryptedPrivateKey: CryptoUtils.arrayBufferToBase64(encryptedPrivateKey),
      deviceId,
      keyId: crypto.randomUUID(),
      createdAt: Date.now(),
      salt: CryptoUtils.arrayBufferToBase64(salt)
    };

    await this.saveKeys(keyInfo);

    await this.registerPublicKey(keyInfo);
  }

  private async loadExistingKeys(keys: EncryptionKeys): Promise<void> {
    const salt = CryptoUtils.base64ToArrayBuffer(keys.salt);
    this.deviceKey = await CryptoUtils.deriveKeyFromDeviceId(keys.deviceId, new Uint8Array(salt));

    const encryptedPrivateKey = CryptoUtils.base64ToArrayBuffer(keys.encryptedPrivateKey);
    const privateKeyPem = await this.decryptPrivateKey(encryptedPrivateKey);

    const privateKey = await CryptoUtils.importPrivateKey(privateKeyPem);
    const publicKey = await CryptoUtils.importPublicKey(keys.publicKey);

    this.keyPair = {
      privateKey,
      publicKey
    };
  }

  private async encryptPrivateKey(privateKeyPem: string): Promise<ArrayBuffer> {
    if (!this.deviceKey) throw new Error('Device key not initialized');

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      this.deviceKey,
      new TextEncoder().encode(privateKeyPem)
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    return combined.buffer;
  }

  private async decryptPrivateKey(encryptedData: ArrayBuffer): Promise<string> {
    if (!this.deviceKey) throw new Error('Device key not initialized');

    const data = new Uint8Array(encryptedData);
    const iv = data.slice(0, 12);
    const encrypted = data.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      this.deviceKey,
      encrypted
    );

    return new TextDecoder().decode(decrypted);
  }

  private async saveKeys(keys: EncryptionKeys): Promise<void> {
    await this.plugin.saveData({
      ...await this.plugin.loadData(),
      encryptionKeys: keys
    });
  }

  async loadKeys(): Promise<EncryptionKeys | null> {
    const data = await this.plugin.loadData();
    return data?.encryptionKeys || null;
  }

  private async registerPublicKey(keyInfo: EncryptionKeys): Promise<void> {
    const settings = await this.plugin.loadData();

    const apiUrl = settings.apiUrl || 'http://localhost:8787';

    try {
      const { requestUrl } = require('obsidian');

      const response = await requestUrl({
        url: `${apiUrl}/publickey/register`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: settings.lineUserId,
          vaultId: settings.vaultId,
          publicKey: keyInfo.publicKey,
          keyId: keyInfo.keyId
        })
      });

      if (response.status !== 200) {
        throw new Error(`Failed to register public key: ${response.status}`);
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Failed to register public key:', error);
      }
      await this.plugin.saveData({
        ...await this.plugin.loadData(),
        pendingKeyRegistration: true
      });
      throw error;
    }
  }

  async getPublicKey(userId: string): Promise<CryptoKey> {
    const cached = this.publicKeyCache.get(userId);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_DURATION) {
      return await CryptoUtils.importPublicKey(cached.publicKey);
    }

    const settings = await this.plugin.loadData();
    const apiUrl = settings.apiUrl || 'https://line-to-obsidian-dev.ryotaminami0709.workers.dev';

    const { requestUrl } = require('obsidian');
    const response = await requestUrl({
      url: `${apiUrl}/publickey/${userId}`,
      method: 'GET',
      headers: {
        'X-Vault-Id': settings.vaultId
      }
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch public key for user ${userId}`);
    }

    const data = JSON.parse(response.text);

    this.publicKeyCache.set(userId, {
      userId,
      publicKey: data.publicKey,
      keyId: data.keyId,
      fetchedAt: Date.now()
    });

    return await CryptoUtils.importPublicKey(data.publicKey);
  }

  getKeyPair(): CryptoKeyPair {
    if (!this.keyPair) {
      throw new Error('Key pair not initialized');
    }
    return this.keyPair;
  }

  clearPublicKeyCache(): void {
    this.publicKeyCache.clear();
  }

  clearPublicKeyForUser(userId: string): void {
    this.publicKeyCache.delete(userId);
  }

  async forceRegisterPublicKey(): Promise<void> {
    const keys = await this.loadKeys();
    if (!keys) {
      throw new Error('No keys found to register');
    }

    await this.registerPublicKey(keys);
  }
}
