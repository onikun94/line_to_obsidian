import { CryptoUtils } from './cryptoUtils';
import { KeyManager } from './keyManager';

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
   * メッセージを暗号化（透過的）
   */
  async encryptMessage(message: string, recipientUserId: string): Promise<EncryptedMessage> {
    try {
      // 受信者の公開鍵を取得（キャッシュ済みまたは自動取得）
      const recipientPublicKey = await this.keyManager.getPublicKey(recipientUserId);
      
      // AES鍵を生成
      const aesKey = await CryptoUtils.generateAESKey();
      
      // メッセージをAESで暗号化
      const { encrypted, iv } = await CryptoUtils.encryptMessage(message, aesKey);
      
      // AES鍵を受信者の公開鍵で暗号化
      const encryptedAESKey = await CryptoUtils.encryptAESKey(aesKey, recipientPublicKey);
      
      // 自分の鍵IDを取得
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
        version: this.VERSION
      };
    } catch (error) {
      console.error('Encryption failed:', error);
      throw new Error('Failed to encrypt message');
    }
  }

  /**
   * メッセージを復号化（透過的）
   */
  async decryptMessage(encryptedMessage: EncryptedMessage): Promise<string> {
    try {
      // バージョンチェック
      if (encryptedMessage.version !== this.VERSION) {
        console.warn(`Message version mismatch: expected ${this.VERSION}, got ${encryptedMessage.version}`);
      }
      
      // 自分の秘密鍵を取得
      const keyPair = this.keyManager.getKeyPair();
      
      // Base64デコード
      const encryptedContent = CryptoUtils.base64ToArrayBuffer(encryptedMessage.encryptedContent);
      const encryptedAESKey = CryptoUtils.base64ToArrayBuffer(encryptedMessage.encryptedAESKey);
      const iv = new Uint8Array(CryptoUtils.base64ToArrayBuffer(encryptedMessage.iv));
      
      // AES鍵を復号化
      const aesKey = await CryptoUtils.decryptAESKey(encryptedAESKey, keyPair.privateKey);
      
      // メッセージを復号化
      const decrypted = await CryptoUtils.decryptMessage(encryptedContent, aesKey, iv);
      
      return decrypted;
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt message');
    }
  }

  /**
   * メッセージが暗号化されているかチェック
   */
  isEncryptedMessage(message: any): message is EncryptedMessage {
    return message &&
      typeof message === 'object' &&
      typeof message.encryptedContent === 'string' &&
      typeof message.encryptedAESKey === 'string' &&
      typeof message.iv === 'string' &&
      typeof message.version === 'string';
  }

  /**
   * レガシーメッセージとの互換性チェック
   */
  isLegacyMessage(message: any): boolean {
    return message &&
      typeof message === 'object' &&
      typeof message.text === 'string' &&
      !this.isEncryptedMessage(message);
  }

  /**
   * 透過的なメッセージ処理（暗号化/平文を自動判別）
   */
  async processMessage(message: any): Promise<string> {
    // LineMessageの暗号化フィールドをチェック
    if (message.encrypted === true && message.encryptedContent) {
      // 暗号化メッセージを復号化
      try {
        const encryptedMessage: EncryptedMessage = {
          encryptedContent: message.encryptedContent,
          encryptedAESKey: message.encryptedAESKey || message.encryptedAesKey,
          iv: message.iv,
          senderKeyId: message.senderKeyId,
          recipientUserId: message.recipientUserId,
          timestamp: message.timestamp,
          version: message.version || '1.0'
        };
        return await this.decryptMessage(encryptedMessage);
      } catch (error) {
        console.error('Failed to decrypt message:', error);
        return '🔒 暗号化されたメッセージ（復号化できません）';
      }
    } else if (this.isLegacyMessage(message)) {
      // レガシー平文メッセージ
      return message.text;
    } else if (typeof message === 'string') {
      // 単純な文字列
      return message;
    } else {
      console.warn('Unknown message format:', message);
      return JSON.stringify(message);
    }
  }

  /**
   * 公開鍵からキーIDを生成
   */
  private async generateKeyId(publicKeyPem: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(publicKeyPem);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hash));
    return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * バッチ暗号化（複数メッセージの効率的な暗号化）
   */
  async encryptBatch(messages: string[], recipientUserId: string): Promise<EncryptedMessage[]> {
    // 公開鍵を一度だけ取得
    const recipientPublicKey = await this.keyManager.getPublicKey(recipientUserId);
    
    const encryptedMessages = await Promise.all(
      messages.map(message => this.encryptMessageWithKey(message, recipientPublicKey, recipientUserId))
    );
    
    return encryptedMessages;
  }

  /**
   * 公開鍵を使用してメッセージを暗号化（内部用）
   */
  private async encryptMessageWithKey(
    message: string, 
    recipientPublicKey: CryptoKey, 
    recipientUserId: string
  ): Promise<EncryptedMessage> {
    const aesKey = await CryptoUtils.generateAESKey();
    const { encrypted, iv } = await CryptoUtils.encryptMessage(message, aesKey);
    const encryptedAESKey = await CryptoUtils.encryptAESKey(aesKey, recipientPublicKey);
    
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
      version: this.VERSION
    };
  }
}