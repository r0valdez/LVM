/**
 * License window logic
 */

let deviceSerial = '';

// Get device serial on load
window.lan.getDeviceSerial().then((serial) => {
  deviceSerial = serial;
  const deviceSerialEl = document.getElementById('deviceSerial');
  deviceSerialEl.textContent = serial;
});

// Copy device serial button
document.getElementById('copyBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(deviceSerial).then(() => {
    const btn = document.getElementById('copyBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    btn.style.background = '#27ae60';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '#667eea';
    }, 2000);
  }).catch((err) => {
    console.error('Failed to copy:', err);
  });
});

// License input formatting
const licenseInput = document.getElementById('licenseInput');
licenseInput.addEventListener('input', (e) => {
  // Allow base64 characters: A-Z, a-z, 0-9, +, /, =, and dashes for formatting
  let value = e.target.value.replace(/[^A-Za-z0-9+\/=\-]/gi, '');
  
  // Format with dashes every 6 characters (but preserve existing dashes)
  // Remove all dashes first, then re-add them
  const cleaned = value.replace(/-/g, '');
  const formatted = cleaned.match(/.{1,6}/g)?.join('-') || cleaned;
  
  e.target.value = formatted;
  
  // Clear error on input
  const errorEl = document.getElementById('licenseError');
  errorEl.textContent = '';
  licenseInput.classList.remove('error', 'success');
});

// Enter key to activate
licenseInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    activateLicense();
  }
});

// Activate button
document.getElementById('activateBtn').addEventListener('click', activateLicense);

async function activateLicense() {
  // Get and clean license key (remove extra whitespace, normalize)
  let licenseKey = licenseInput.value.trim().replace(/\s+/g, '');
  const errorEl = document.getElementById('licenseError');
  const infoEl = document.getElementById('licenseInfo');
  const activateBtn = document.getElementById('activateBtn');
  
  // Clear previous messages
  errorEl.textContent = '';
  infoEl.textContent = '';
  infoEl.className = 'license-info';
  licenseInput.classList.remove('error', 'success');
  
  if (!licenseKey || licenseKey.length < 10) {
    errorEl.textContent = 'Please enter a valid license key';
    licenseInput.classList.add('error');
    licenseInput.focus();
    return;
  }
  
  // Disable button during validation
  activateBtn.disabled = true;
  activateBtn.textContent = 'Validating...';
  
  try {
    const result = await window.lan.validateLicense(licenseKey, deviceSerial);
    
    if (result.valid) {
      // License is valid
      licenseInput.classList.add('success');
      infoEl.className = 'license-info success';
      infoEl.innerHTML = `
        <strong>License Activated Successfully!</strong><br>
        Expires: ${new Date(result.expirationDate).toLocaleDateString()}<br>
        Days Remaining: ${result.daysRemaining}
      `;
      
      // Save license
      await window.lan.saveLicense(licenseKey);
      
      // Wait a moment then close license window and open main window
      setTimeout(() => {
        window.lan.licenseActivated();
      }, 1500);
    } else {
      // License is invalid
      licenseInput.classList.add('error');
      errorEl.textContent = result.error || 'Invalid license key';
      licenseInput.focus();
      licenseInput.select();
    }
  } catch (error) {
    console.error('License validation error:', error);
    licenseInput.classList.add('error');
    errorEl.textContent = 'Error validating license. Please try again.';
    licenseInput.focus();
  } finally {
    activateBtn.disabled = false;
    activateBtn.textContent = 'Activate License';
  }
}

