import { describe, it, expect, beforeEach } from 'vitest';
import { CryptoUtils } from '../../src/crypto/cryptoUtils';

describe('CryptoUtils', () => {
  describe('Key Generation', () => {
    it('should generate RSA key pair', async () => {
      const keyPair = await CryptoUtils.generateKeyPair();

      expect(keyPair).toBeDefined();
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.publicKey.type).toBe('public');
      expect(keyPair.privateKey.type).toBe('private');
    });

    it('should generate AES key', async () => {
      const aesKey = await CryptoUtils.generateAESKey();

      expect(aesKey).toBeDefined();
      expect(aesKey.type).toBe('secret');
      expect(aesKey.algorithm.name).toBe('AES-GCM');
    });
  });

  describe('Key Export/Import', () => {
    let keyPair: CryptoKeyPair;

    beforeEach(async () => {
      keyPair = await CryptoUtils.generateKeyPair();
    });

    it('should export and import public key', async () => {
      const exportedPublicKey = await CryptoUtils.exportPublicKey(
        keyPair.publicKey,
      );
      expect(exportedPublicKey).toContain('-----BEGIN PUBLIC KEY-----');
      expect(exportedPublicKey).toContain('-----END PUBLIC KEY-----');

      const importedPublicKey =
        await CryptoUtils.importPublicKey(exportedPublicKey);
      expect(importedPublicKey).toBeDefined();
      expect(importedPublicKey.type).toBe('public');
    });

    it('should export and import private key', async () => {
      const exportedPrivateKey = await CryptoUtils.exportPrivateKey(
        keyPair.privateKey,
      );
      expect(exportedPrivateKey).toContain('-----BEGIN PRIVATE KEY-----');
      expect(exportedPrivateKey).toContain('-----END PRIVATE KEY-----');

      const importedPrivateKey =
        await CryptoUtils.importPrivateKey(exportedPrivateKey);
      expect(importedPrivateKey).toBeDefined();
      expect(importedPrivateKey.type).toBe('private');
    });
  });

  describe('Message Encryption/Decryption', () => {
    let aesKey: CryptoKey;
    const testMessage = 'Hello, E2EE World! 暗号化テスト';

    beforeEach(async () => {
      aesKey = await CryptoUtils.generateAESKey();
    });

    it('should encrypt and decrypt message with AES-GCM', async () => {
      const { encrypted, iv } = await CryptoUtils.encryptMessage(
        testMessage,
        aesKey,
      );

      expect(encrypted).toBeDefined();
      expect(iv).toBeDefined();
      expect(iv.length).toBe(12);

      const decrypted = await CryptoUtils.decryptMessage(encrypted, aesKey, iv);
      expect(decrypted).toBe(testMessage);
    });

    it('should produce different ciphertext for same message', async () => {
      const result1 = await CryptoUtils.encryptMessage(testMessage, aesKey);
      const result2 = await CryptoUtils.encryptMessage(testMessage, aesKey);

      // ArrayBufferを比較のためにUint8Arrayに変換
      const encrypted1 = new Uint8Array(result1.encrypted);
      const encrypted2 = new Uint8Array(result2.encrypted);

      // 異なるIVのため、暗号文は異なるはず
      expect(encrypted1).not.toEqual(encrypted2);
      expect(result1.iv).not.toEqual(result2.iv);
    });
  });

  describe('AES Key Encryption with RSA', () => {
    let keyPair: CryptoKeyPair;
    let aesKey: CryptoKey;

    beforeEach(async () => {
      keyPair = await CryptoUtils.generateKeyPair();
      aesKey = await CryptoUtils.generateAESKey();
    });

    it('should encrypt and decrypt AES key with RSA', async () => {
      const encryptedAESKey = await CryptoUtils.encryptAESKey(
        aesKey,
        keyPair.publicKey,
      );
      expect(encryptedAESKey).toBeDefined();

      const decryptedAESKey = await CryptoUtils.decryptAESKey(
        encryptedAESKey,
        keyPair.privateKey,
      );
      expect(decryptedAESKey).toBeDefined();
      expect(decryptedAESKey.type).toBe('secret');
      expect(decryptedAESKey.algorithm.name).toBe('AES-GCM');
    });
  });

  describe('Base64 Conversion', () => {
    it('should convert ArrayBuffer to Base64 and back', () => {
      const testData = new TextEncoder().encode('Test data 123');
      const base64 = CryptoUtils.arrayBufferToBase64(testData.buffer);

      expect(base64).toBeDefined();
      expect(typeof base64).toBe('string');

      const restored = CryptoUtils.base64ToArrayBuffer(base64);
      const restoredText = new TextDecoder().decode(restored);

      expect(restoredText).toBe('Test data 123');
    });
  });

  describe('Device ID Generation', () => {
    it('should generate unique device ID', async () => {
      const deviceId1 = await CryptoUtils.generateDeviceId();
      const deviceId2 = await CryptoUtils.generateDeviceId();

      expect(deviceId1).toBeDefined();
      expect(typeof deviceId1).toBe('string');
      expect(deviceId1.length).toBeGreaterThan(0);

      // デバイスIDは時間とランダム値を含むため異なるはず
      expect(deviceId1).not.toBe(deviceId2);
    });
  });

  describe('Key Derivation', () => {
    it('should derive key from device ID', async () => {
      const deviceId = await CryptoUtils.generateDeviceId();
      const salt = crypto.getRandomValues(new Uint8Array(16));

      const derivedKey = await CryptoUtils.deriveKeyFromDeviceId(
        deviceId,
        salt,
      );

      expect(derivedKey).toBeDefined();
      expect(derivedKey.type).toBe('secret');
      expect(derivedKey.algorithm.name).toBe('AES-GCM');
    });

    it('should derive same key with same inputs', async () => {
      const deviceId = 'test-device-id';
      const salt = new Uint8Array([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      ]);

      const key1 = await CryptoUtils.deriveKeyFromDeviceId(deviceId, salt);
      const key2 = await CryptoUtils.deriveKeyFromDeviceId(deviceId, salt);

      // 同じ入力から同じキーが導出されることを確認
      const rawKey1 = await crypto.subtle.exportKey('raw', key1);
      const rawKey2 = await crypto.subtle.exportKey('raw', key2);

      expect(new Uint8Array(rawKey1)).toEqual(new Uint8Array(rawKey2));
    });
  });
});
