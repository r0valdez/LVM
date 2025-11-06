export function uuidv4() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export async function getDefaultRoomName() {
  try {
    const host = await window.lan.getHostname();
    return host || 'Host-PC';
  } catch {
    return 'Host-PC';
  }
}

export function log(...args) {
  console.log('[LAN]', ...args);
}


