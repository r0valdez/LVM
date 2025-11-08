/**
 * License validation and device serial generation
 */

const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const LICENSE_SECRET = 'LVM-LICENSE-SECRET-KEY-V1'; // In production, use environment variable or secure storage
const LICENSE_FILE = path.join(app.getPath('userData'), 'license.dat');

/**
 * Generate device-specific serial number
 * Uses hardware identifiers to create a unique device ID
 */
function getDeviceSerial() {
  try {
    const hostname = os.hostname();
    const platform = os.platform();
    const arch = os.arch();
    
    // Get MAC address from network interfaces
    const interfaces = os.networkInterfaces();
    let macAddress = '';
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          macAddress = iface.mac;
          break;
        }
      }
      if (macAddress) break;
    }
    
    // Combine hardware identifiers
    const deviceInfo = `${hostname}-${platform}-${arch}-${macAddress}`;
    
    // Create hash for consistent serial
    const hash = crypto.createHash('sha256').update(deviceInfo).digest('hex');
    
    // Format as readable serial (first 16 chars, grouped)
    const serial = hash.substring(0, 16).toUpperCase().match(/.{1,4}/g).join('-');
    
    return serial;
  } catch (error) {
    console.error('[LICENSE] Error generating device serial:', error);
    // Fallback to hostname-based serial
    const fallback = crypto.createHash('sha256').update(os.hostname()).digest('hex');
    return fallback.substring(0, 16).toUpperCase().match(/.{1,4}/g).join('-');
  }
}

/**
 * Generate license key from device serial and expiration date
 */
function generateLicenseKey(deviceSerial, expirationDate) {
  try {
    // Create license data
    const licenseData = {
      deviceSerial,
      expirationDate: expirationDate.toISOString(),
      version: '1.0'
    };
    
    // Create signature
    const dataString = JSON.stringify(licenseData);
    const signature = crypto
      .createHmac('sha256', LICENSE_SECRET)
      .update(dataString)
      .digest('hex');
    
    // Combine data and signature
    const combinedJson = JSON.stringify({ ...licenseData, signature });
    const combined = Buffer.from(combinedJson, 'utf-8').toString('base64');
    
    // Format as readable license key (grouped every 6 characters)
    // Remove any existing padding characters for formatting
    const base64WithoutPadding = combined.replace(/=+$/, '');
    const formatted = base64WithoutPadding.match(/.{1,6}/g)?.join('-') || base64WithoutPadding;
    
    return formatted;
  } catch (error) {
    console.error('[LICENSE] Error generating license key:', error);
    throw error;
  }
}

/**
 * Validate license key
 */
function validateLicenseKey(licenseKey, deviceSerial) {
  try {
    if (!licenseKey || typeof licenseKey !== 'string') {
      return { valid: false, error: 'Invalid license format' };
    }
    
    // Remove formatting (dashes and whitespace)
    const cleaned = licenseKey.replace(/[-\s]/g, '').trim();
    
    if (!cleaned || cleaned.length === 0) {
      return { valid: false, error: 'Invalid license format' };
    }
    
    // Validate base64 format (should only contain A-Z, a-z, 0-9, +, /, =)
    if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
      console.error('[LICENSE] Invalid base64 characters in license key');
      return { valid: false, error: 'Invalid license format' };
    }
    
    // Add padding if needed (base64 strings should be multiples of 4)
    let padded = cleaned;
    const remainder = padded.length % 4;
    if (remainder > 0) {
      padded += '='.repeat(4 - remainder);
    }
    
    // Decode base64
    let decoded;
    try {
      decoded = Buffer.from(padded, 'base64').toString('utf-8');
    } catch (decodeError) {
      console.error('[LICENSE] Base64 decode error:', decodeError.message);
      return { valid: false, error: 'Invalid license format' };
    }
    
    if (!decoded || decoded.trim().length === 0) {
      console.error('[LICENSE] Decoded data is empty');
      return { valid: false, error: 'Invalid license format' };
    }
    
    // Parse JSON
    let licenseData;
    try {
      licenseData = JSON.parse(decoded);
    } catch (parseError) {
      console.error('[LICENSE] JSON parse error:', parseError.message);
      console.error('[LICENSE] Decoded data:', decoded.substring(0, 100));
      return { valid: false, error: 'Invalid license format' };
    }
    
    // Verify signature
    const { signature, ...data } = licenseData;
    const dataString = JSON.stringify(data);
    const expectedSignature = crypto
      .createHmac('sha256', LICENSE_SECRET)
      .update(dataString)
      .digest('hex');
    
    if (signature !== expectedSignature) {
      console.error('[LICENSE] Invalid signature');
      return { valid: false, error: 'Invalid license signature' };
    }
    
    // Verify device serial matches
    if (licenseData.deviceSerial !== deviceSerial) {
      console.error('[LICENSE] Device serial mismatch');
      return { valid: false, error: 'License does not match this device' };
    }
    
    // Check expiration
    const expirationDate = new Date(licenseData.expirationDate);
    const now = new Date();
    
    if (now > expirationDate) {
      console.error('[LICENSE] License expired');
      return { valid: false, error: 'License has expired', expirationDate };
    }
    
    // License is valid
    return {
      valid: true,
      expirationDate,
      daysRemaining: Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24))
    };
  } catch (error) {
    console.error('[LICENSE] Error validating license:', error);
    return { valid: false, error: 'Invalid license format' };
  }
}

/**
 * Save license to file
 */
function saveLicense(licenseKey) {
  try {
    const licenseDir = path.dirname(LICENSE_FILE);
    if (!fs.existsSync(licenseDir)) {
      fs.mkdirSync(licenseDir, { recursive: true });
    }
    
    // Encrypt license before saving (simple obfuscation)
    const key = crypto.scryptSync(LICENSE_SECRET, 'salt', 32);
    const iv = Buffer.alloc(16, 0);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    let encrypted = cipher.update(licenseKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    fs.writeFileSync(LICENSE_FILE, encrypted, 'utf8');
    console.log('[LICENSE] License saved to', LICENSE_FILE);
    return true;
  } catch (error) {
    console.error('[LICENSE] Error saving license:', error);
    return false;
  }
}

/**
 * Load license from file
 */
function loadLicense() {
  try {
    if (!fs.existsSync(LICENSE_FILE)) {
      return null;
    }
    
    const encrypted = fs.readFileSync(LICENSE_FILE, 'utf8');
    
    // Decrypt license
    const key = crypto.scryptSync(LICENSE_SECRET, 'salt', 32);
    const iv = Buffer.alloc(16, 0);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('[LICENSE] Error loading license:', error);
    return null;
  }
}

/**
 * Check if license is valid (loads from file and validates)
 */
function checkLicense() {
  const deviceSerial = getDeviceSerial();
  const licenseKey = loadLicense();
  
  if (!licenseKey) {
    return { valid: false, deviceSerial, error: 'No license found' };
  }
  
  return validateLicenseKey(licenseKey, deviceSerial);
}

/**
 * Clear license (for testing/debugging)
 */
function clearLicense() {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      fs.unlinkSync(LICENSE_FILE);
      console.log('[LICENSE] License cleared');
      return true;
    }
    return false;
  } catch (error) {
    console.error('[LICENSE] Error clearing license:', error);
    return false;
  }
}

module.exports = {
  getDeviceSerial,
  generateLicenseKey,
  validateLicenseKey,
  saveLicense,
  loadLicense,
  checkLicense,
  clearLicense
};

