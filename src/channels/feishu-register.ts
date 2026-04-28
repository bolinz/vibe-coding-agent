/**
 * Feishu/Lark Bot Registration via QR Code
 * Based on Feishu's device-code-style app registration API
 * Reference: https://github.com/kohoj/connect-feishu-bot
 */

export interface FeishuRegistration {
  deviceCode: string;
  qrUrl: string;
  expiresIn: number;
  interval: number;
  status: 'pending' | 'success' | 'expired' | 'denied' | 'error';
  appId?: string;
  appSecret?: string;
  userOpenId?: string;
  domain?: 'feishu' | 'lark';
  error?: string;
  createdAt: number;
}

const FEISHU_URLS: Record<string, string> = {
  prod: 'https://accounts.feishu.cn',
  boe: 'https://accounts.feishu-boe.cn',
  pre: 'https://accounts.feishu-pre.cn',
};

const LARK_URLS: Record<string, string> = {
  prod: 'https://accounts.larksuite.com',
  boe: 'https://accounts.larksuite-boe.com',
  pre: 'https://accounts.larksuite-pre.com',
};

const ENDPOINT = '/oauth/v1/app/registration';
const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;

// In-memory store for registrations
const registrations = new Map<string, FeishuRegistration>();

// SSE subscribers for registration status changes
const sseSubscribers = new Map<string, Set<(reg: FeishuRegistration) => void>>();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function notifySubscribers(deviceCode: string): void {
  const reg = registrations.get(deviceCode);
  if (!reg) return;
  const subs = sseSubscribers.get(deviceCode);
  if (subs) {
    for (const cb of subs) {
      try { cb(reg); } catch {}
    }
  }
}

/**
 * Subscribe to registration status changes (for SSE)
 */
export function subscribeRegistration(
  deviceCode: string,
  callback: (reg: FeishuRegistration) => void,
): () => void {
  if (!sseSubscribers.has(deviceCode)) {
    sseSubscribers.set(deviceCode, new Set());
  }
  sseSubscribers.get(deviceCode)!.add(callback);
  return () => {
    sseSubscribers.get(deviceCode)?.delete(callback);
  };
}

async function post<T>(
  baseUrl: string,
  params: Record<string, string>
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      const res = await fetch(`${baseUrl}${ENDPOINT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await res.json() as T & { error?: string };
      return data;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      lastError = err;
      if (attempt < RETRY_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_MS * 2 ** attempt);
      }
    }
  }

  throw lastError;
}

interface InitResponse {
  supported_auth_methods?: string[];
  error?: string;
  error_description?: string;
}

interface BeginResponse {
  device_code: string;
  verification_uri_complete: string;
  interval?: number;
  expire_in?: number;
  error?: string;
  error_description?: string;
}

interface PollResponse {
  client_id?: string;
  client_secret?: string;
  user_info?: { open_id?: string; tenant_brand?: string };
  error?: string;
  error_description?: string;
}

/**
 * Start a new bot registration flow
 */
export async function startRegistration(env = 'prod'): Promise<FeishuRegistration> {
  let baseUrl = FEISHU_URLS[env] ?? FEISHU_URLS.prod;

  // Step 1: Init
  const initRes = await post<InitResponse>(baseUrl, { action: 'init' });

  if (!initRes.supported_auth_methods?.includes('client_secret')) {
    throw new Error('Environment does not support client_secret auth method');
  }

  // Step 2: Begin
  const beginRes = await post<BeginResponse>(baseUrl, {
    action: 'begin',
    archetype: 'PersonalAgent',
    auth_method: 'client_secret',
    request_user_info: 'open_id',
  });

  const qrUrl = new URL(beginRes.verification_uri_complete);
  qrUrl.searchParams.set('from', 'onboard');

  const reg: FeishuRegistration = {
    deviceCode: beginRes.device_code,
    qrUrl: qrUrl.toString(),
    expiresIn: beginRes.expire_in || 600,
    interval: beginRes.interval || 5,
    status: 'pending',
    createdAt: Date.now(),
  };

  registrations.set(reg.deviceCode, reg);

  // Step 3: Start polling in background
  pollRegistration(reg.deviceCode, baseUrl, env);

  return reg;
}

/**
 * Poll until user scans the QR code (runs in background)
 */
async function pollRegistration(
  deviceCode: string,
  initialBaseUrl: string,
  env: string
): Promise<void> {
  const reg = registrations.get(deviceCode);
  if (!reg) return;

  let baseUrl = initialBaseUrl;
  let interval = reg.interval;
  const expireIn = reg.expiresIn;
  const startTime = Date.now();
  let domainSwitched = false;

  while (Date.now() - startTime < expireIn * 1000) {
    await sleep(interval * 1000);

    // Check if registration was cancelled
    const current = registrations.get(deviceCode);
    if (!current) return;

    let pollRes: PollResponse;
    try {
      pollRes = await post<PollResponse>(baseUrl, {
        action: 'poll',
        device_code: deviceCode,
      });
    } catch {
      // Network errors are transient — continue polling
      continue;
    }

    // Auto-detect Lark (international)
    if (pollRes.user_info?.tenant_brand === 'lark' && !domainSwitched) {
      baseUrl = LARK_URLS[env] ?? LARK_URLS.prod;
      domainSwitched = true;
      continue;
    }

    // Success
    if (pollRes.client_id && pollRes.client_secret) {
      reg.status = 'success';
      reg.appId = pollRes.client_id;
      reg.appSecret = pollRes.client_secret;
      reg.userOpenId = pollRes.user_info?.open_id;
      reg.domain = domainSwitched ? 'lark' : 'feishu';
      registrations.set(deviceCode, reg);
      notifySubscribers(deviceCode);
      return;
    }

    // Handle errors
    if (pollRes.error) {
      switch (pollRes.error) {
        case 'authorization_pending':
          break; // Keep polling
        case 'slow_down':
          interval += 5;
          break;
        case 'access_denied':
          reg.status = 'denied';
          registrations.set(deviceCode, reg);
          notifySubscribers(deviceCode);
          return;
        case 'expired_token':
          reg.status = 'expired';
          registrations.set(deviceCode, reg);
          notifySubscribers(deviceCode);
          return;
        default:
          reg.status = 'error';
          reg.error = pollRes.error_description || pollRes.error;
          registrations.set(deviceCode, reg);
          notifySubscribers(deviceCode);
          return;
      }
    }
  }

  // Timed out
  reg.status = 'expired';
  registrations.set(deviceCode, reg);
  notifySubscribers(deviceCode);
}

/**
 * Get registration status
 */
export function getRegistration(deviceCode: string): FeishuRegistration | undefined {
  return registrations.get(deviceCode);
}

/**
 * Cleanup old registrations (call periodically)
 */
export function cleanupRegistrations(): void {
  const now = Date.now();
  for (const [deviceCode, reg] of registrations.entries()) {
    if (now - reg.createdAt > reg.expiresIn * 1000 + 60_000) {
      registrations.delete(deviceCode);
    }
  }
}

// Auto-cleanup every 5 minutes
setInterval(cleanupRegistrations, 5 * 60 * 1000);
