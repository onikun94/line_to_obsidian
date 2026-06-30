import { Platform } from 'obsidian';

export class CryptoUtils {
  private static encoder = new TextEncoder();
  private static decoder = new TextDecoder();

  private static bytesToBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
  }

  private static base64ToBytes(base64: string): Uint8Array {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  private static getPlatformFingerprint(): string {
    const parts: string[] = [];
    if (Platform.isMacOS) parts.push('macos');
    if (Platform.isWin) parts.push('win');
    if (Platform.isLinux) parts.push('linux');
    if (Platform.isIosApp) parts.push('ios');
    if (Platform.isAndroidApp) parts.push('android');
    if (Platform.isMobileApp) parts.push('mobile');
    if (Platform.isDesktopApp) parts.push('desktop');
    return parts.join('-') || 'unknown';
  }

  /**
   * RSA鍵ペアを生成
   */
  static async generateKeyPair(): Promise<CryptoKeyPair> {
    return await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * AES鍵を生成
   */
  static async generateAESKey(): Promise<CryptoKey> {
    return await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * 公開鍵をPEM形式にエクスポート
   */
  static async exportPublicKey(publicKey: CryptoKey): Promise<string> {
    const exported = await crypto.subtle.exportKey('spki', publicKey);
    const exportedAsBase64 = this.bytesToBase64(new Uint8Array(exported));
    return `-----BEGIN PUBLIC KEY-----\n${exportedAsBase64.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`;
  }

  /**
   * 秘密鍵をPEM形式にエクスポート
   */
  static async exportPrivateKey(privateKey: CryptoKey): Promise<string> {
    const exported = await crypto.subtle.exportKey('pkcs8', privateKey);
    const exportedAsBase64 = this.bytesToBase64(new Uint8Array(exported));
    return `-----BEGIN PRIVATE KEY-----\n${exportedAsBase64.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`;
  }

  /**
   * PEM形式の公開鍵をインポート
   */
  static async importPublicKey(pem: string): Promise<CryptoKey> {
    const pemHeader = '-----BEGIN PUBLIC KEY-----';
    const pemFooter = '-----END PUBLIC KEY-----';
    const pemContents = pem.substring(pemHeader.length, pem.length - pemFooter.length).replace(/\s/g, '');
    const binaryDer = this.base64ToBytes(pemContents);

    return await crypto.subtle.importKey(
      'spki',
      binaryDer,
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256',
      },
      true,
      ['encrypt']
    );
  }

  /**
   * PEM形式の秘密鍵をインポート
   */
  static async importPrivateKey(pem: string): Promise<CryptoKey> {
    const pemHeader = '-----BEGIN PRIVATE KEY-----';
    const pemFooter = '-----END PRIVATE KEY-----';
    const pemContents = pem.substring(pemHeader.length, pem.length - pemFooter.length).replace(/\s/g, '');
    const binaryDer = this.base64ToBytes(pemContents);

    return await crypto.subtle.importKey(
      'pkcs8',
      binaryDer,
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256',
      },
      true,
      ['decrypt']
    );
  }

  /**
   * メッセージをAES-GCMで暗号化
   */
  static async encryptMessage(message: string, aesKey: CryptoKey): Promise<{ encrypted: ArrayBuffer; iv: Uint8Array }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      aesKey,
      this.encoder.encode(message)
    );

    return { encrypted, iv };
  }

  /**
   * AES-GCMで暗号化されたメッセージを復号化
   */
  static async decryptMessage(encrypted: ArrayBuffer, aesKey: CryptoKey, iv: Uint8Array): Promise<string> {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      aesKey,
      encrypted
    );

    return this.decoder.decode(decrypted);
  }

  /**
   * AES鍵をRSA公開鍵で暗号化
   */
  static async encryptAESKey(aesKey: CryptoKey, publicKey: CryptoKey): Promise<ArrayBuffer> {
    const exportedKey = await crypto.subtle.exportKey('raw', aesKey);
    return await crypto.subtle.encrypt(
      {
        name: 'RSA-OAEP',
      },
      publicKey,
      exportedKey
    );
  }

  /**
   * RSA秘密鍵で暗号化されたAES鍵を復号化
   */
  static async decryptAESKey(encryptedKey: ArrayBuffer, privateKey: CryptoKey): Promise<CryptoKey> {
    // Node.js環境では、ArrayBufferの判定が特殊なケースがある
    let keyBuffer: ArrayBuffer;
    
    if (encryptedKey === null || encryptedKey === undefined) {
      throw new Error('Encrypted key is null or undefined');
    }
    
    // Node.jsとブラウザ環境の両方で動作するように修正
    if (encryptedKey instanceof ArrayBuffer) {
      keyBuffer = encryptedKey;
    } else if (ArrayBuffer.isView(encryptedKey)) {
      // TypedArrayやDataViewの場合
      const view = encryptedKey as ArrayBufferView;
      keyBuffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    } else {
      // encryptedKeyの型がArrayBufferと定義されているため、ここには到達しないはず
      // 念のためのフォールバック
      keyBuffer = encryptedKey;
    }

    const decryptedKey = await crypto.subtle.decrypt(
      {
        name: 'RSA-OAEP',
      },
      privateKey,
      keyBuffer
    );

    return await crypto.subtle.importKey(
      'raw',
      decryptedKey,
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * ArrayBufferをBase64文字列に変換
   */
  static arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return this.bytesToBase64(bytes);
  }

  /**
   * Base64文字列をArrayBufferに変換
   */
  static base64ToArrayBuffer(base64: string): ArrayBuffer {
    const bytes = this.base64ToBytes(base64);
    // ArrayBufferを正しく返す
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  /**
   * デバイス固有のIDを生成（ブラウザフィンガープリント）
   */
  static async generateDeviceId(): Promise<string> {
    const fingerprint = {
      platform: this.getPlatformFingerprint(),
      isMobile: Platform.isMobile,
      isDesktop: Platform.isDesktop,
      timestamp: Date.now(),
      random: crypto.getRandomValues(new Uint8Array(16))
    };

    const data = this.encoder.encode(JSON.stringify(fingerprint));
    const hash = await crypto.subtle.digest('SHA-256', data);
    return this.arrayBufferToBase64(hash);
  }

  /**
   * デバイスIDから暗号化キーを派生
   */
  static async deriveKeyFromDeviceId(deviceId: string, salt?: Uint8Array): Promise<CryptoKey> {
    if (!salt) {
      salt = crypto.getRandomValues(new Uint8Array(16));
    }

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      this.encoder.encode(deviceId),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
  }
}
