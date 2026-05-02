import { ConfigDB, type ConfigRecord } from './config-db';

export interface ConfigEntry {
  key: string;
  value: string;
  masked: string;
  encrypted: boolean;
  updatedAt: string;
  category: 'ai' | 'agent' | 'channel' | 'system';
  description: string;
}

const CONFIG_SCHEMA: Record<string, { category: ConfigEntry['category']; description: string; encrypted: boolean }> = {
  openai_api_key: { category: 'ai', description: 'OpenAI API Key (用于 Aider)', encrypted: true },
  openai_api_base: { category: 'ai', description: 'OpenAI API Base URL', encrypted: false },
  anthropic_api_key: { category: 'ai', description: 'Anthropic API Key (用于 Claude)', encrypted: true },
  default_agent: { category: 'agent', description: '默认使用的 Agent', encrypted: false },
  working_dir: { category: 'agent', description: 'Agent 工作目录', encrypted: false },
  container_cmd: { category: 'agent', description: '容器引擎命令 (docker/podman/nerdctl)', encrypted: false },
  feishu_app_id: { category: 'channel', description: '飞书应用 App ID', encrypted: false },
  feishu_app_secret: { category: 'channel', description: '飞书应用 Secret', encrypted: true },
  feishu_verification_token: { category: 'channel', description: '飞书验证 Token', encrypted: true },
  feishu_domain: { category: 'channel', description: '飞书域名 (feishu/lark)', encrypted: false },
  port: { category: 'system', description: 'HTTP 服务端口（需重启生效）', encrypted: false },
  host: { category: 'system', description: 'HTTP 监听地址（需重启生效）', encrypted: false },
  redis_url: { category: 'system', description: 'Redis 连接 URL（需重启生效）', encrypted: false },
  session_secret: { category: 'system', description: '会话加密密钥', encrypted: true },
  webhook_tokens: { category: 'system', description: 'Webhook 允许的 token（逗号分隔，* 为允许所有）', encrypted: false },
  github_token: { category: 'channel', description: 'GitHub Personal Access Token', encrypted: true },
  github_app_id: { category: 'channel', description: 'GitHub App ID', encrypted: false },
  github_private_key: { category: 'channel', description: 'GitHub App 私钥 (PEM)', encrypted: true },
  github_webhook_secret: { category: 'channel', description: 'GitHub Webhook 签名密钥', encrypted: true },
};

function xorEncryptDecrypt(input: string, key: string): string {
  if (!key) return input;
  const result: number[] = [];
  for (let i = 0; i < input.length; i++) {
    result.push(input.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return String.fromCharCode(...result);
}

function toBase64(input: string): string {
  try {
    return btoa(input);
  } catch {
    return Buffer.from(input).toString('base64');
  }
}

function fromBase64(input: string): string {
  try {
    return atob(input);
  } catch {
    return Buffer.from(input, 'base64').toString('utf-8');
  }
}

export class ConfigManager {
  private db: ConfigDB;
  private secretKey: string;

  constructor(secretKey = process.env.SESSION_SECRET || 'default-secret') {
    this.db = new ConfigDB();
    this.secretKey = secretKey;
  }

  private encrypt(value: string): string {
    return toBase64(xorEncryptDecrypt(value, this.secretKey));
  }

  private decrypt(value: string): string {
    return xorEncryptDecrypt(fromBase64(value), this.secretKey);
  }

  /**
   * Get raw value from DB or env fallback
   */
  get(key: string): string | undefined {
    const dbValue = this.db.get(key);
    if (dbValue !== undefined) {
      const record = this.db.getAll().find(r => r.key === key);
      if (record && record.encrypted) {
        try {
          return this.decrypt(dbValue);
        } catch {
          return dbValue;
        }
      }
      return dbValue;
    }
    // Fallback to env var
    const envKey = key.toUpperCase().replace(/\./g, '_');
    return process.env[envKey];
  }

  /**
   * Set value to DB and optionally hot-reload to process.env
   */
  set(key: string, value: string, hotReload = true): void {
    const schema = CONFIG_SCHEMA[key];
    const shouldEncrypt = schema?.encrypted ?? false;

    const storedValue = shouldEncrypt ? this.encrypt(value) : value;
    this.db.set(key, storedValue, shouldEncrypt);

    if (hotReload) {
      const envKey = key.toUpperCase().replace(/\./g, '_');
      process.env[envKey] = value;
    }
  }

  /**
   * Delete from DB (falls back to env on next get)
   */
  delete(key: string): void {
    this.db.delete(key);
  }

  /**
   * Get masked value for display (e.g. sk-...xxxx)
   */
  getMasked(key: string): string {
    const value = this.get(key);
    if (!value) return '';
    if (value.length <= 8) return '*'.repeat(value.length);
    return value.slice(0, 3) + '...' + value.slice(-4);
  }

  /**
   * Reload all DB configs into process.env
   */
  reloadEnvFromDb(): void {
    const all = this.db.getAll();
    for (const record of all) {
      const envKey = record.key.toUpperCase().replace(/\./g, '_');
      let value = record.value;
      if (record.encrypted) {
        try {
          value = this.decrypt(value);
        } catch {
          // Keep as-is if decryption fails
        }
      }
      // Only set if value is not empty; otherwise keep existing env var
      if (value && value.trim() !== '') {
        process.env[envKey] = value;
      }
    }
  }

  /**
   * Get all configs as display entries
   */
  getAllEntries(): ConfigEntry[] {
    const dbRecords = this.db.getAll();
    const result: ConfigEntry[] = [];

    for (const [key, meta] of Object.entries(CONFIG_SCHEMA)) {
      const record = dbRecords.find(r => r.key === key);
      const rawValue = record ? record.value : undefined;
      let value = rawValue ?? '';

      if (record && record.encrypted && value) {
        try {
          value = this.decrypt(value);
        } catch {
          // Keep encrypted
        }
      }

      result.push({
        key,
        value,
        masked: rawValue ? (record?.encrypted ? this.getMasked(key) : value) : '',
        encrypted: meta.encrypted,
        updatedAt: record?.updatedAt || '',
        category: meta.category,
        description: meta.description
      });
    }

    return result;
  }

  /**
   * Get all known env vars as entries (including ones not in schema)
   */
  getSystemEntries(): ConfigEntry[] {
    const knownKeys = Object.keys(CONFIG_SCHEMA);
    const entries: ConfigEntry[] = [];

    for (const [envKey, value] of Object.entries(process.env)) {
      if (!value) continue;
      const key = envKey.toLowerCase().replace(/_/g, '.');
      if (knownKeys.includes(key)) continue; // Already handled by getAllEntries

      entries.push({
        key,
        value,
        masked: value.length > 8 ? value.slice(0, 3) + '...' + value.slice(-4) : '*'.repeat(value.length),
        encrypted: false,
        updatedAt: '',
        category: 'system',
        description: '系统环境变量'
      });
    }

    return entries;
  }

  /**
   * Reset to defaults (clear DB keys, fallback to .env)
   */
  reset(): void {
    for (const key of Object.keys(CONFIG_SCHEMA)) {
      this.db.delete(key);
    }
    // Clear hot-reloaded env vars
    for (const key of Object.keys(CONFIG_SCHEMA)) {
      const envKey = key.toUpperCase().replace(/\./g, '_');
      delete process.env[envKey];
    }
  }

  close(): void {
    this.db.close();
  }
}

let globalConfigManager: ConfigManager | null = null;

export function getConfigManager(): ConfigManager {
  if (!globalConfigManager) {
    globalConfigManager = new ConfigManager();
  }
  return globalConfigManager;
}
