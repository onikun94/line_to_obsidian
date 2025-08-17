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
   * Main error handling entry point
   */
  async handleError(error: Error, context: string): Promise<any> {
    if (process.env.NODE_ENV === 'development') {
      console.error(`E2EE Error in ${context}:`, error);
    }

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
   * Handles uninitialized key scenarios
   */
  private async handleKeyNotInitialized(): Promise<void> {
    try {
      await this.keyManager.initialize();
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Failed to initialize keys:', error);
      }
      new Notice('接続エラーが発生しました。設定を確認してください。');
      throw new E2EEError(
        E2EEErrorType.KEY_GENERATION_FAILED,
        'Failed to initialize encryption keys',
        error as Error
      );
    }
  }

  /**
   * Handles missing key scenarios with retry logic
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
      
      this.keyManager.clearPublicKeyForUser(userId);
      
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
   * Handles decryption failures gracefully
   */
  private async handleDecryptionFailed(error: E2EEError): Promise<string> {
    if (process.env.NODE_ENV === 'development') {
      console.error('Decryption failed:', error);
    }
    
    return '[メッセージを読み込めませんでした]';
  }

  /**
   * Handles public key fetch failures
   */
  private async handlePublicKeyFetchFailed(error: E2EEError): Promise<void> {
    const userId = this.extractUserIdFromError(error);
    
    if (userId) {
      await this.markUserAsOffline(userId);
    }

    throw error;
  }

  /**
   * Handles network-related errors
   */
  private async handleNetworkError(error: E2EEError): Promise<void> {
    new Notice('ネットワークエラーが発生しました。インターネット接続を確認してください。');
    throw error;
  }

  /**
   * Handles unexpected errors
   */
  private handleGenericError(error: Error): void {
    if (process.env.NODE_ENV === 'development') {
      console.error('Unexpected E2EE error:', error);
    }
    new Notice('処理中にエラーが発生しました');
    throw error;
  }

  /**
   * Extracts user ID from error messages
   */
  private extractUserIdFromError(error: E2EEError): string | null {
    const match = error.message.match(/user\s+(\w+)/i);
    return match ? match[1] : null;
  }

  /**
   * Checks if decryption error was recently shown
   */
  private hasShownDecryptionError(): boolean {
    const lastShown = localStorage.getItem('line_plugin_error_shown');
    if (!lastShown) return false;
    
    const lastShownTime = parseInt(lastShown);
    const now = Date.now();
    
    return now - lastShownTime < 60 * 60 * 1000;
  }

  /**
   * Records when decryption error was shown
   */
  private markDecryptionErrorShown(): void {
    localStorage.setItem('line_plugin_error_shown', Date.now().toString());
  }

  /**
   * Marks a user as offline in local storage
   */
  private async markUserAsOffline(userId: string): Promise<void> {
    const offlineUsers = JSON.parse(localStorage.getItem('line_plugin_offline_users') || '{}');
    offlineUsers[userId] = Date.now();
    localStorage.setItem('line_plugin_offline_users', JSON.stringify(offlineUsers));
  }

  /**
   * Clears all retry attempt counters
   */
  clearRetryCounters(): void {
    this.retryAttempts.clear();
  }
}