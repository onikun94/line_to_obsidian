import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageEncryptor } from '../../src/crypto/messageEncryptor';
import { KeyManager } from '../../src/crypto/keyManager';
import { CryptoUtils } from '../../src/crypto/cryptoUtils';

describe('MessageEncryptor', () => {
  let messageEncryptor: MessageEncryptor;
  let keyManager: KeyManager;
  let mockKeyPair: CryptoKeyPair;
  let mockPublicKey: CryptoKey;

  beforeEach(async () => {
    // モックキーペアを生成
    mockKeyPair = await CryptoUtils.generateKeyPair();
    mockPublicKey = mockKeyPair.publicKey;

    // KeyManagerのモック
    keyManager = {
      getKeyPair: vi.fn(() => mockKeyPair),
      getPublicKey: vi.fn(() => Promise.resolve(mockPublicKey)),
      clearPublicKeyCache: vi.fn(),
      clearPublicKeyForUser: vi.fn(),
    } as any;

    messageEncryptor = new MessageEncryptor(keyManager);
  });

  describe('Message Encryption', () => {
    it('should encrypt a message', async () => {
      const message = 'テストメッセージ123';
      const recipientUserId = 'user123';

      const encrypted = await messageEncryptor.encryptMessage(message, recipientUserId);

      expect(encrypted).toBeDefined();
      expect(encrypted.encryptedContent).toBeDefined();
      expect(encrypted.encryptedAESKey).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.senderKeyId).toBeDefined();
      expect(encrypted.recipientUserId).toBe(recipientUserId);
      expect(encrypted.version).toBe('1.0');
      expect(encrypted.timestamp).toBeDefined();
    });

    it('should call getPublicKey with correct userId', async () => {
      const message = 'test';
      const recipientUserId = 'user456';

      await messageEncryptor.encryptMessage(message, recipientUserId);

      expect(keyManager.getPublicKey).toHaveBeenCalledWith(recipientUserId);
    });
  });

  describe('Message Decryption', () => {
    it('should decrypt an encrypted message', async () => {
      const originalMessage = 'これは暗号化テストです！';
      const recipientUserId = 'user789';

      // メッセージを暗号化
      const encrypted = await messageEncryptor.encryptMessage(originalMessage, recipientUserId);

      // メッセージを復号化
      const decrypted = await messageEncryptor.decryptMessage(encrypted);

      expect(decrypted).toBe(originalMessage);
    });

    it('should handle version mismatch with warning', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const message = 'test';
      const encrypted = await messageEncryptor.encryptMessage(message, 'user123');
      encrypted.version = '2.0'; // バージョンを変更

      const decrypted = await messageEncryptor.decryptMessage(encrypted);

      expect(decrypted).toBe(message);
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Message version mismatch'));
      
      consoleWarnSpy.mockRestore();
    });
  });

  describe('Message Type Detection', () => {
    it('should identify encrypted messages', () => {
      const encryptedMessage = {
        encryptedContent: 'base64data',
        encryptedAESKey: 'base64key',
        iv: 'base64iv',
        version: '1.0',
        senderKeyId: 'key123',
        recipientUserId: 'user123',
        timestamp: Date.now()
      };

      expect(messageEncryptor.isEncryptedMessage(encryptedMessage)).toBe(true);
    });

    it('should identify legacy messages', () => {
      const legacyMessage = {
        text: 'This is a plain text message',
        timestamp: Date.now(),
        userId: 'user123'
      };

      expect(messageEncryptor.isLegacyMessage(legacyMessage)).toBe(true);
      expect(messageEncryptor.isEncryptedMessage(legacyMessage)).toBe(false);
    });
  });

  describe('Transparent Message Processing', () => {
    it('should process encrypted messages', async () => {
      const originalMessage = 'Encrypted content';
      const encrypted = await messageEncryptor.encryptMessage(originalMessage, 'user123');

      const processed = await messageEncryptor.processMessage(encrypted);

      expect(processed).toBe(originalMessage);
    });

    it('should process legacy plain text messages', async () => {
      const legacyMessage = {
        text: 'Plain text message',
        timestamp: Date.now()
      };

      const processed = await messageEncryptor.processMessage(legacyMessage);

      expect(processed).toBe('Plain text message');
    });

    it('should handle decryption errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const invalidEncrypted = {
        encryptedContent: 'invalid-base64',
        encryptedAESKey: 'invalid-key',
        iv: 'invalid-iv',
        version: '1.0',
        senderKeyId: 'key123',
        recipientUserId: 'user123',
        timestamp: Date.now()
      };

      const processed = await messageEncryptor.processMessage(invalidEncrypted);

      expect(processed).toBe('🔒 暗号化されたメッセージ（復号化できません）');
      expect(consoleErrorSpy).toHaveBeenCalled();
      
      consoleErrorSpy.mockRestore();
    });

    it('should handle string messages', async () => {
      const simpleString = 'Just a string';
      const processed = await messageEncryptor.processMessage(simpleString);
      expect(processed).toBe(simpleString);
    });

    it('should handle unknown message formats', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const unknownFormat = { foo: 'bar', baz: 123 };
      const processed = await messageEncryptor.processMessage(unknownFormat);

      expect(processed).toBe(JSON.stringify(unknownFormat));
      expect(consoleWarnSpy).toHaveBeenCalledWith('Unknown message format:', unknownFormat);
      
      consoleWarnSpy.mockRestore();
    });
  });

  describe('Batch Encryption', () => {
    it('should encrypt multiple messages efficiently', async () => {
      const messages = ['Message 1', 'Message 2', 'Message 3'];
      const recipientUserId = 'user123';

      const encryptedMessages = await messageEncryptor.encryptBatch(messages, recipientUserId);

      expect(encryptedMessages).toHaveLength(3);
      expect(keyManager.getPublicKey).toHaveBeenCalledTimes(1); // 公開鍵は1回だけ取得

      // 各メッセージが正しく暗号化されていることを確認
      for (let i = 0; i < messages.length; i++) {
        const decrypted = await messageEncryptor.decryptMessage(encryptedMessages[i]);
        expect(decrypted).toBe(messages[i]);
      }
    });
  });

  describe('Error Handling', () => {
    it('should throw error when encryption fails', async () => {
      // 公開鍵取得を失敗させる
      keyManager.getPublicKey = vi.fn(() => Promise.reject(new Error('Network error')));

      await expect(
        messageEncryptor.encryptMessage('test', 'user123')
      ).rejects.toThrow('Failed to encrypt message');
    });

    it('should throw error when decryption fails with invalid data', async () => {
      const invalidEncrypted = {
        encryptedContent: 'not-valid-base64!!!',
        encryptedAESKey: 'also-invalid!!!',
        iv: 'bad-iv!!!',
        version: '1.0',
        senderKeyId: 'key123',
        recipientUserId: 'user123',
        timestamp: Date.now()
      };

      await expect(
        messageEncryptor.decryptMessage(invalidEncrypted)
      ).rejects.toThrow('Failed to decrypt message');
    });
  });
});