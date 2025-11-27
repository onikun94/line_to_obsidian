import { CryptoUtils } from './cryptoUtils';
import type { KeyManager } from './keyManager';

export interface EncryptedMessage {
  encryptedContent: string;
  encryptedAESKey: string;
  iv: string;
  senderKeyId: string;
  recipientUserId: string;
  timestamp: number;
  version: string;
}

export class MessageEncryptor {
  private keyManager: KeyManager;
  private readonly VERSION = '1.0';

  constructor(keyManager: KeyManager) {
    this.keyManager = keyManager;
  }

  /**
   * Encrypts a message for a specific recipient
   */
  async encryptMessage(
    message: string,
    recipientUserId: string,
  ): Promise<EncryptedMessage> {
    try {
      const recipientPublicKey =
        await this.keyManager.getPublicKey(recipientUserId);

      const aesKey = await CryptoUtils.generateAESKey();

      const { encrypted, iv } = await CryptoUtils.encryptMessage(
        message,
        aesKey,
      );

      const encryptedAESKey = await CryptoUtils.encryptAESKey(
        aesKey,
        recipientPublicKey,
      );

      const keyPair = this.keyManager.getKeyPair();
      const publicKeyPem = await CryptoUtils.exportPublicKey(keyPair.publicKey);
      const senderKeyId = await this.generateKeyId(publicKeyPem);

      return {
        encryptedContent: CryptoUtils.arrayBufferToBase64(encrypted),
        encryptedAESKey: CryptoUtils.arrayBufferToBase64(encryptedAESKey),
        iv: CryptoUtils.arrayBufferToBase64(iv),
        senderKeyId,
        recipientUserId,
        timestamp: Date.now(),
        version: this.VERSION,
      };
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Encryption failed:', error);
      }
      throw new Error('Failed to encrypt message');
    }
  }

  /**
   * Decrypts an encrypted message
   */
  async decryptMessage(encryptedMessage: EncryptedMessage): Promise<string> {
    try {
      if (encryptedMessage.version !== this.VERSION) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            `Message version mismatch: expected ${this.VERSION}, got ${encryptedMessage.version}`,
          );
        }
      }

      const keyPair = this.keyManager.getKeyPair();

      const encryptedContent = CryptoUtils.base64ToArrayBuffer(
        encryptedMessage.encryptedContent,
      );
      const encryptedAESKey = CryptoUtils.base64ToArrayBuffer(
        encryptedMessage.encryptedAESKey,
      );
      const iv = new Uint8Array(
        CryptoUtils.base64ToArrayBuffer(encryptedMessage.iv),
      );

      const aesKey = await CryptoUtils.decryptAESKey(
        encryptedAESKey,
        keyPair.privateKey,
      );

      const decrypted = await CryptoUtils.decryptMessage(
        encryptedContent,
        aesKey,
        iv,
      );

      return decrypted;
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Decryption failed:', error);
      }
      throw new Error('Failed to decrypt message');
    }
  }

  /**
   * Type guard for encrypted messages
   */
  isEncryptedMessage(message: any): message is EncryptedMessage {
    return (
      message &&
      typeof message === 'object' &&
      typeof message.encryptedContent === 'string' &&
      typeof message.encryptedAESKey === 'string' &&
      typeof message.iv === 'string' &&
      typeof message.version === 'string'
    );
  }

  /**
   * Checks for legacy message format compatibility
   */
  isLegacyMessage(message: any): boolean {
    return (
      message &&
      typeof message === 'object' &&
      typeof message.text === 'string' &&
      !this.isEncryptedMessage(message)
    );
  }

  /**
   * Processes messages transparently regardless of format
   */
  async processMessage(message: any): Promise<string> {
    if (message.encrypted === true && message.encryptedContent) {
      try {
        const encryptedMessage: EncryptedMessage = {
          encryptedContent: message.encryptedContent,
          encryptedAESKey: message.encryptedAESKey || message.encryptedAesKey,
          iv: message.iv,
          senderKeyId: message.senderKeyId,
          recipientUserId: message.recipientUserId,
          timestamp: message.timestamp,
          version: message.version || '1.0',
        };
        return await this.decryptMessage(encryptedMessage);
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Failed to decrypt message:', error);
        }
        return '[メッセージを読み込めませんでした]';
      }
    } else if (this.isLegacyMessage(message)) {
      return message.text;
    } else if (typeof message === 'string') {
      return message;
    } else {
      if (process.env.NODE_ENV === 'development') {
        console.warn('Unknown message format:', message);
      }
      return JSON.stringify(message);
    }
  }

  /**
   * Generates a unique key identifier
   */
  private async generateKeyId(publicKeyPem: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(publicKeyPem);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hash));
    return hashArray
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Efficiently encrypts multiple messages for the same recipient
   */
  async encryptBatch(
    messages: string[],
    recipientUserId: string,
  ): Promise<EncryptedMessage[]> {
    const recipientPublicKey =
      await this.keyManager.getPublicKey(recipientUserId);

    const encryptedMessages = await Promise.all(
      messages.map((message) =>
        this.encryptMessageWithKey(
          message,
          recipientPublicKey,
          recipientUserId,
        ),
      ),
    );

    return encryptedMessages;
  }

  /**
   * Internal method for message encryption
   */
  private async encryptMessageWithKey(
    message: string,
    recipientPublicKey: CryptoKey,
    recipientUserId: string,
  ): Promise<EncryptedMessage> {
    const aesKey = await CryptoUtils.generateAESKey();
    const { encrypted, iv } = await CryptoUtils.encryptMessage(message, aesKey);
    const encryptedAESKey = await CryptoUtils.encryptAESKey(
      aesKey,
      recipientPublicKey,
    );

    const keyPair = this.keyManager.getKeyPair();
    const publicKeyPem = await CryptoUtils.exportPublicKey(keyPair.publicKey);
    const senderKeyId = await this.generateKeyId(publicKeyPem);

    return {
      encryptedContent: CryptoUtils.arrayBufferToBase64(encrypted),
      encryptedAESKey: CryptoUtils.arrayBufferToBase64(encryptedAESKey),
      iv: CryptoUtils.arrayBufferToBase64(iv),
      senderKeyId,
      recipientUserId,
      timestamp: Date.now(),
      version: this.VERSION,
    };
  }
}
