/**
 * User-Friendly Error Messages
 * 
 * Converts cryptic technical errors into actionable messages users can understand.
 */

/** Known error patterns and their user-friendly messages */
const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  message: (match: RegExpMatchArray, original: string) => string;
}> = [
  // Node.js version issues
  {
    pattern: /Given napi value is not an array/i,
    message: () => `Node.js version incompatibility detected.

The native bindings don't work with your Node version (likely v24+).

Fix: Switch to Node.js v22 LTS:
  nvm use 22
  openclaw gateway restart

This affects wallet/marketplace operations. Basic capture still works.`,
  },
  {
    pattern: /Failed to convert JavaScript value.*rust type/i,
    message: () => `Native binding error — likely Node.js v24+ incompatibility.

Fix: Use Node.js v22 LTS:
  nvm use 22
  openclaw gateway restart`,
  },
  
  // URL errors
  {
    pattern: /Invalid URL:?\s*(.+)/i,
    message: (match) => `Invalid URL: ${match[1] || 'unknown'}

Make sure the URL:
  - Starts with http:// or https://
  - Has a valid domain (e.g., example.com)
  - Contains no spaces or special characters`,
  },
  
  // Chrome/Browser errors
  {
    pattern: /Could not connect to Chrome|Chrome not running|CDP connection/i,
    message: () => `Can't connect to Chrome browser.

Unbrowse needs Chrome running with remote debugging enabled.

Fix: Close Chrome and try again (Unbrowse will launch it):
  pkill -f "Google Chrome"
  # Then run your command again

Or start Chrome manually:
  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222`,
  },
  {
    pattern: /browser.*timeout|page.*timeout/i,
    message: () => `Browser operation timed out.

The page might be slow or blocked. Try:
  1. Increase timeout: waitMs=10000
  2. Check if the site is accessible manually
  3. Some sites block automated browsers`,
  },
  
  // Wallet/Solana errors
  {
    pattern: /Invalid Solana private key/i,
    message: () => `Invalid Solana wallet key.

The private key must be base58-encoded. Get it from:
  - Phantom: Settings > Export Private Key
  - Solflare: Settings > Export Private Key

Or create a new wallet:
  unbrowse_wallet action="create"`,
  },
  {
    pattern: /insufficient.*funds|balance.*insufficient/i,
    message: () => `Insufficient wallet balance.

You need USDC to download skills from the marketplace.

1. Check your balance: unbrowse_wallet action="status"
2. Send USDC (Solana SPL) to your wallet address
3. Minimum: $0.01 per skill download`,
  },
  
  // Network errors
  {
    pattern: /ECONNREFUSED|ENOTFOUND|network.*error/i,
    message: () => `Network connection failed.

Check:
  1. Your internet connection
  2. The target site is accessible
  3. No firewall blocking the connection`,
  },
  {
    pattern: /ETIMEDOUT|timed?\s*out/i,
    message: () => `Request timed out.

The server didn't respond in time. Try:
  1. Check if the site is accessible manually
  2. Try again in a moment
  3. The site might be blocking automated requests`,
  },
  
  // File/Path errors
  {
    pattern: /ENOENT.*no such file/i,
    message: (match, original) => {
      const pathMatch = original.match(/'([^']+)'/);
      const path = pathMatch ? pathMatch[1] : 'the file';
      return `File not found: ${path}

Make sure the file exists and the path is correct.`;
    },
  },
  {
    pattern: /EACCES|permission denied/i,
    message: () => `Permission denied.

You don't have access to this file or directory. Try:
  1. Check file permissions
  2. Run with appropriate permissions
  3. Make sure the path is writable`,
  },
  
  // Skill errors
  {
    pattern: /skill.*not found|no skill.*exists/i,
    message: () => `Skill not found.

The skill might not be installed. Try:
  1. List installed skills: unbrowse_skills
  2. Search marketplace: unbrowse_search query="..."
  3. Capture the API: unbrowse_capture urls=["..."]`,
  },
  
  // Auth errors
  {
    pattern: /401|unauthorized|authentication.*failed/i,
    message: () => `Authentication failed (401 Unauthorized).

The saved auth may have expired. Try:
  1. Log in again: unbrowse_login loginUrl="..."
  2. Recapture the API: unbrowse_capture urls=["..."]`,
  },
  {
    pattern: /403|forbidden/i,
    message: () => `Access forbidden (403).

The site is blocking this request. Possible reasons:
  1. Bot detection / rate limiting
  2. Geographic restrictions
  3. Expired session`,
  },
];

/**
 * Convert a technical error into a user-friendly message.
 * Returns the original message if no pattern matches.
 */
export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  
  for (const { pattern, message: getMessage } of ERROR_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      return getMessage(match, message);
    }
  }
  
  // No pattern matched — return cleaned up original
  return message;
}

/**
 * Wrap an error with a user-friendly message while preserving the original.
 */
export function wrapError(error: unknown, context: string): Error {
  const friendly = friendlyError(error);
  const newError = new Error(`${context}: ${friendly}`);
  if (error instanceof Error) {
    newError.stack = error.stack;
    (newError as any).originalError = error;
  }
  return newError;
}

/**
 * Format an error for tool output (returns text content).
 */
export function formatErrorForTool(error: unknown, context?: string): string {
  const friendly = friendlyError(error);
  if (context) {
    return `❌ ${context}\n\n${friendly}`;
  }
  return `❌ ${friendly}`;
}
