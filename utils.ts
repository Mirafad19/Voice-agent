/**
 * Safely encodes a UTF-8 string to a URL-safe Base64 string.
 * @param str The string to encode.
 * @returns The URL-safe Base64 encoded string.
 */
export function safeBtoa(str: string): string {
  try {
    const base64 = btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
        return String.fromCharCode(parseInt(p1, 16));
      })
    );
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch (e) {
    console.error("Failed to base64 encode string:", e);
    return "";
  }
}

/**
 * Safely decodes a URL-safe Base64 string to a UTF-8 string.
 * @param b64 The URL-safe Base64 string to decode.
 * @returns The decoded string.
 */
export function safeAtob(b64: string): string {
  try {
    let urlSafeB64 = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (urlSafeB64.length % 4) {
      urlSafeB64 += '=';
    }
    return decodeURIComponent(
      Array.prototype.map
        .call(atob(urlSafeB64), (c) => {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join('')
    );
  } catch (e) {
    console.error("Failed to decode base64 string:", e);
    return "";
  }
}

/**
 * Converts a Blob to a Base64 string.
 * @param blob The Blob to convert.
 * @returns A promise that resolves with the Base64 string.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to read blob as Base64 string.'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
