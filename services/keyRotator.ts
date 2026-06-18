
export class KeyRotator {
  private static STORAGE_KEY = 'geminiApiKeys';
  private static OLD_STORAGE_KEY = 'geminiApiKey';
  private static failedKeys: Record<string, number> = {}; // key -> cooldown timestamp UTC ms
  private static currentIndex = 0;

  /**
   * Retrieves all Gemini keys available in the current context
   */
  public static getKeys(): string[] {
    // 1. Check multi-key storage
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr) && arr.length > 0) {
          return arr.filter(k => typeof k === 'string' && k.trim() !== '');
        }
      }
    } catch (e) {
      console.error("Failed to parse geminiApiKeys:", e);
    }

    // 2. Fallback to old single-key storage
    try {
      const single = localStorage.getItem(this.OLD_STORAGE_KEY);
      if (single && single.trim() !== '') {
        return [single.trim()];
      }
    } catch (e) {
      console.error("Failed to read old geminiApiKey:", e);
    }

    // 3. Fallback to build-time defined env key
    const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (envKey && envKey.trim() !== '') {
      return [envKey.trim()];
    }

    return [];
  }

  /**
   * Saves the list of keys to storage, updating both the array and the single fallback key.
   */
  public static saveKeys(keys: string[]): void {
    const cleaned = keys.map(k => k.trim()).filter(k => k !== '');
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cleaned));
    
    if (cleaned.length > 0) {
      localStorage.setItem(this.OLD_STORAGE_KEY, cleaned[0]);
    } else {
      localStorage.removeItem(this.OLD_STORAGE_KEY);
    }
    
    // Dispatch standard storage event to trigger reactive UI updates in React
    window.dispatchEvent(new Event('storage'));
  }

  /**
   * Sidelists/cools down a key for 60 seconds when it experiences an API failure or rate limit.
   */
  public static reportFailure(key: string): void {
    if (!key) return;
    this.failedKeys[key] = Date.now() + 60000; // Cool down for exactly 1 minute
    console.warn(`[KeyRotator] Key ${key.substring(0, 10)}... reported failed. Cooling down for 60 seconds.`);
  }

  /**
   * Returns keys that are healthy and not currently in their cooling down period.
   */
  public static getActiveKeys(): string[] {
    const allKeys = this.getKeys();
    const now = Date.now();
    
    const active = allKeys.filter(k => {
      const cooldownEnd = this.failedKeys[k];
      return !cooldownEnd || now > cooldownEnd;
    });

    // Fallback: If all configured keys are in cooldown, revive all of them as a desperation attempt
    if (active.length === 0) {
      return allKeys;
    }
    return active;
  }

  /**
   * Returns a running/round-robin key from the healthy key pool.
   */
  public static getNextKey(): string {
    const keys = this.getActiveKeys();
    if (keys.length === 0) return '';
    
    this.currentIndex = (this.currentIndex + 1) % keys.length;
    const chosenKey = keys[this.currentIndex];
    console.log(`[KeyRotator] Selected key: ${chosenKey.substring(0, 10)}... | Pool: ${keys.length} active keys`);
    return chosenKey;
  }

  /**
   * Utility to execute an async operation that utilizes an API Key, automatically
   * retrying with another key if it fails.
   */
  public static async executeWithRetry<T>(operation: (key: string) => Promise<T>): Promise<T> {
    const keys = this.getActiveKeys();
    if (keys.length === 0) {
      throw new Error("No Gemini API keys found. Please set your keys in the Settings modal.");
    }

    let lastError: any = null;
    // Attempt with each active key in turn, up to 3 keys max
    const maxAttempts = Math.min(keys.length, 5); 
    
    for (let i = 0; i < maxAttempts; i++) {
      const key = this.getNextKey();
      try {
        return await operation(key);
      } catch (err: any) {
        lastError = err;
        console.error(`[KeyRotator] Action failed with key ${key.substring(0, 10)}...:`, err);
        
        // Report failure to cool it down
        this.reportFailure(key);
        
        // If it's an authorization/quota issue (codes 403, 429), retry with another key straight away.
        const errMsg = String(err.message || err).toLowerCase();
        const isRateOrQuota = err.status === 429 || err.status === 403 || 
                               errMsg.includes("limit") || errMsg.includes("quota") || errMsg.includes("api key") || errMsg.includes("invalid key");
        
        if (!isRateOrQuota) {
          // If it isn't a quota/key error, it might be a user input or coding error, so throw immediately or retry just once
          if (i === 0 && keys.length > 1) {
             console.log("[KeyRotator] Non-quota error, trying once more with different key as fallback...");
             continue;
          }
          throw err;
        }
      }
    }
    
    throw lastError || new Error("All rotated Gemini API keys failed the request.");
  }
}
