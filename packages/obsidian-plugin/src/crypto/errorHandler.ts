import { Notice } from 'obsidian';
import { KeyManager } from './keyManager';
import { MessageEncryptor } from './messageEncryptor';

export enum E2EEErrorType {
  KEY_NOT_INITIALIZED = 'KEY_NOT_INITIALIZED',
  KEY_NOT_FOUND = 'KEY_NOT_FOUND',
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
  ENCRYPTION_FAILED = 'ENCRYPTION_FAILED',
  PUBLIC_KEY_FETCH_FAILED = 'PUBLIC_KEY_FETCH_FAILED',
  KEY_GENERATION_FAILED = 'KEY_GENERATION_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR'
}

export class E2EEError extends Error {
  constructor(
    public type: E2EEErrorType,
    message: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'E2EEError';
  }
}

export class E2EEErrorHandler {
  private keyManager: KeyManager;
  private messageEncryptor: MessageEncryptor;
  private retryAttempts: Map<string, number> = new Map();
  private readonly MAX_RETRY_ATTEMPTS = 3;

  constructor(keyManager: KeyManager, messageEncryptor: MessageEncryptor) {
    this.keyManager = keyManager;
    this.messageEncryptor = messageEncryptor;
  }

  /**
   * エラーハンドリングのメインメソッド
   */
  async handleError(error: Error, context: string): Promise<any> {
    console.error(`E2EE Error in ${context}:`, error);

    if (error instanceof E2EEError) {
      switch (error.type) {
        case E2EEErrorType.KEY_NOT_INITIALIZED:
          return await this.handleKeyNotInitialized();
        
        case E2EEErrorType.KEY_NOT_FOUND:
          return await this.handleKeyNotFound(error);
        
        case E2EEErrorType.DECRYPTION_FAILED:
          return await this.handleDecryptionFailed(error);
        
        case E2EEErrorType.PUBLIC_KEY_FETCH_FAILED:
          return await this.handlePublicKeyFetchFailed(error);
        
        case E2EEErrorType.NETWORK_ERROR:
          return await this.handleNetworkError(error);
        
        default:
          return this.handleGenericError(error);
      }
    }

    return this.handleGenericError(error);
  }

  /**
   * 鍵が初期化されていない場合の処理
   */
  private async handleKeyNotInitialized(): Promise<void> {
    new Notice('暗号化キーを初期化しています...');
    
    try {
      await this.keyManager.initialize();
      new Notice('暗号化キーの初期化が完了しました');
    } catch (error) {
      console.error('Failed to initialize keys:', error);
      new Notice('暗号化キーの初期化に失敗しました。設定を確認してください。');
      throw new E2EEError(
        E2EEErrorType.KEY_GENERATION_FAILED,
        'Failed to initialize encryption keys',
        error as Error
      );
    }
  }

  /**
   * 鍵が見つからない場合の処理
   */
  private async handleKeyNotFound(error: E2EEError): Promise<void> {
    const userId = this.extractUserIdFromError(error);
    if (!userId) {
      throw error;
    }

    const retryKey = `key_not_found_${userId}`;
    const attempts = this.retryAttempts.get(retryKey) || 0;

    if (attempts < this.MAX_RETRY_ATTEMPTS) {
      this.retryAttempts.set(retryKey, attempts + 1);
      
      // キャッシュをクリアして再取得を試みる
      this.keyManager.clearPublicKeyForUser(userId);
      
      new Notice(`ユーザー ${userId} の公開鍵を再取得しています...`);
      
      try {
        await this.keyManager.getPublicKey(userId);
        this.retryAttempts.delete(retryKey);
        return;
      } catch (retryError) {
        if (attempts + 1 >= this.MAX_RETRY_ATTEMPTS) {
          this.retryAttempts.delete(retryKey);
          throw new E2EEError(
            E2EEErrorType.PUBLIC_KEY_FETCH_FAILED,
            `Failed to fetch public key for user ${userId} after ${this.MAX_RETRY_ATTEMPTS} attempts`,
            retryError as Error
          );
        }
      }
    }
  }

  /**
   * 復号化失敗時の処理
   */
  private async handleDecryptionFailed(error: E2EEError): Promise<string> {
    console.error('Decryption failed:', error);
    
    // ユーザーに通知（頻繁に表示されないように工夫）
    if (!this.hasShownDecryptionError()) {
      new Notice('一部のメッセージの復号化に失敗しました');
      this.markDecryptionErrorShown();
    }

    return '🔒 暗号化されたメッセージ（復号化できません）';
  }

  /**
   * 公開鍵取得失敗時の処理
   */
  private async handlePublicKeyFetchFailed(error: E2EEError): Promise<void> {
    const userId = this.extractUserIdFromError(error);
    
    if (userId) {
      // オフラインフラグを設定
      await this.markUserAsOffline(userId);
    }

    throw error;
  }

  /**
   * ネットワークエラー時の処理
   */
  private async handleNetworkError(error: E2EEError): Promise<void> {
    new Notice('ネットワークエラーが発生しました。インターネット接続を確認してください。');
    throw error;
  }

  /**
   * 一般的なエラー処理
   */
  private handleGenericError(error: Error): void {
    console.error('Unexpected E2EE error:', error);
    new Notice('暗号化処理中にエラーが発生しました');
    throw error;
  }

  /**
   * エラーメッセージからユーザーIDを抽出
   */
  private extractUserIdFromError(error: E2EEError): string | null {
    const match = error.message.match(/user\s+(\w+)/i);
    return match ? match[1] : null;
  }

  /**
   * 復号化エラーが表示済みかチェック
   */
  private hasShownDecryptionError(): boolean {
    const lastShown = localStorage.getItem('e2ee_decryption_error_shown');
    if (!lastShown) return false;
    
    const lastShownTime = parseInt(lastShown);
    const now = Date.now();
    
    // 1時間以内に表示済みの場合はtrue
    return now - lastShownTime < 60 * 60 * 1000;
  }

  /**
   * 復号化エラーを表示済みとマーク
   */
  private markDecryptionErrorShown(): void {
    localStorage.setItem('e2ee_decryption_error_shown', Date.now().toString());
  }

  /**
   * ユーザーをオフラインとマーク
   */
  private async markUserAsOffline(userId: string): Promise<void> {
    const offlineUsers = JSON.parse(localStorage.getItem('e2ee_offline_users') || '{}');
    offlineUsers[userId] = Date.now();
    localStorage.setItem('e2ee_offline_users', JSON.stringify(offlineUsers));
  }

  /**
   * リトライカウンタをリセット
   */
  clearRetryCounters(): void {
    this.retryAttempts.clear();
  }
}