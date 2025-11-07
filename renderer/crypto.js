import { log } from './utils.js';

/**
 * Crypto utility for AES-256-GCM encryption/decryption
 * Uses Web Crypto API available in browser
 */
export class CryptoManager {
  constructor(roomId) {
    this.roomId = roomId;
    this.key = null;
    this.algorithm = { name: 'AES-GCM', length: 256 };
    this.ivLength = 12; // 96 bits for GCM
  }

  /**
   * Derive encryption key from room ID
   * Uses PBKDF2 to derive a consistent key from the room ID
   */
  async init() {
    if (this.key) return;

    try {
      // Convert room ID to key material using PBKDF2
      const roomIdBuffer = new TextEncoder().encode(this.roomId);
      const baseKey = await crypto.subtle.importKey(
        'raw',
        roomIdBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
      );

      // Derive AES-GCM key
      const salt = new TextEncoder().encode('LVM-SALT-V1'); // Fixed salt for consistency
      this.key = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: 100000,
          hash: 'SHA-256'
        },
        baseKey,
        this.algorithm,
        false,
        ['encrypt', 'decrypt']
      );

      log('[CRYPTO] Key derived for room', this.roomId);
    } catch (e) {
      console.error('[CRYPTO] Error initializing key:', e);
      throw e;
    }
  }

  /**
   * Encrypt data using AES-256-GCM
   * @param {string} plaintext - Data to encrypt
   * @returns {Promise<string>} Base64 encoded encrypted data with IV
   */
  async encrypt(plaintext) {
    if (!this.key) await this.init();

    try {
      const iv = crypto.getRandomValues(new Uint8Array(this.ivLength));
      const plaintextBuffer = new TextEncoder().encode(plaintext);

      const encrypted = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        this.key,
        plaintextBuffer
      );

      // Combine IV and encrypted data
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(encrypted), iv.length);

      // Convert to base64 for transmission
      const base64 = btoa(String.fromCharCode(...combined));
      return base64;
    } catch (e) {
      console.error('[CRYPTO] Encryption error:', e);
      throw e;
    }
  }

  /**
   * Decrypt data using AES-256-GCM
   * @param {string} encryptedData - Base64 encoded encrypted data with IV
   * @returns {Promise<string>} Decrypted plaintext
   */
  async decrypt(encryptedData) {
    if (!this.key) await this.init();

    try {
      // Convert from base64
      const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));

      // Extract IV and encrypted data
      const iv = combined.slice(0, this.ivLength);
      const encrypted = combined.slice(this.ivLength);

      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        this.key,
        encrypted
      );

      return new TextDecoder().decode(decrypted);
    } catch (e) {
      console.error('[CRYPTO] Decryption error:', e);
      throw e;
    }
  }

  /**
   * ============================================================================
   * MEDIA STREAM ENCRYPTION METHODS
   * ============================================================================
   * These methods encrypt/decrypt binary data (video/audio frames) for WebRTC
   * Insertable Streams API. They work with Uint8Array instead of strings.
   */

  /**
   * Encrypt binary data (for video/audio frames)
   * @param {Uint8Array} data - Binary data to encrypt
   * @returns {Promise<Uint8Array>} Encrypted data with IV prepended
   */
  async encryptBinary(data) {
    if (!this.key) await this.init();

    try {
      const iv = crypto.getRandomValues(new Uint8Array(this.ivLength));
      const encrypted = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        this.key,
        data
      );

      // Combine IV and encrypted data
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(encrypted), iv.length);

      return combined;
    } catch (e) {
      console.error('[CRYPTO] Binary encryption error:', e);
      throw e;
    }
  }

  /**
   * Decrypt binary data (for video/audio frames)
   * @param {Uint8Array} encryptedData - Encrypted data with IV prepended
   * @returns {Promise<Uint8Array>} Decrypted binary data
   */
  async decryptBinary(encryptedData) {
    if (!this.key) await this.init();

    try {
      // Extract IV and encrypted data
      const iv = encryptedData.slice(0, this.ivLength);
      const encrypted = encryptedData.slice(this.ivLength);

      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        this.key,
        encrypted
      );

      return new Uint8Array(decrypted);
    } catch (e) {
      console.error('[CRYPTO] Binary decryption error:', e);
      throw e;
    }
  }
}

