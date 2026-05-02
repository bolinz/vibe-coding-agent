/**
 * GitHub authentication helpers.
 * Supports both Personal Access Token and GitHub App (JWT → Installation Token).
 */

export interface GitHubAuthConfig {
  /** Personal Access Token (mutually exclusive with appId+privateKey) */
  token?: string;
  /** GitHub App ID */
  appId?: string;
  /** GitHub App private key (PEM) */
  privateKey?: string;
}

export interface GitHubAuthResult {
  token: string;
  type: 'token' | 'app';
}

/**
 * Resolve an installation-scoped token for the given owner/repo.
 * Uses PAT directly if configured, otherwise uses GitHub App auth.
 */
export async function resolveInstallationToken(
  config: GitHubAuthConfig,
  owner: string,
  repo: string,
): Promise<GitHubAuthResult> {
  if (config.token) {
    return { token: config.token, type: 'token' };
  }
  if (config.appId && config.privateKey) {
    const token = await getInstallationToken(config.appId, config.privateKey, owner, repo);
    return { token, type: 'app' };
  }
  throw new Error('No GitHub credentials configured. Set github_token or github_app_id + github_private_key.');
}

/**
 * Verify GitHub webhook HMAC-SHA256 signature.
 */
export async function verifyWebhookSignature(
  secret: string,
  body: string,
  signatureHeader: string,
): Promise<boolean> {
  if (!secret) return false;
  const algo = { name: 'HMAC', hash: 'SHA-256' } as const;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), algo, false, ['sign']);
  const sig = await crypto.subtle.sign(algo, key, new TextEncoder().encode(body));
  const expected = 'sha256=' + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  // Constant-time comparison
  if (expected.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Parse a GitHub webhook event payload.
 */
export function parseGitHubEvent(
  eventType: string,
  payload: any,
): { owner: string; repo: string; issueNumber?: number; text: string; userId: string } | null {
  const repoFull = payload.repository?.full_name as string | undefined;
  if (!repoFull) return null;
  const [owner, repo] = repoFull.split('/');

  switch (eventType) {
    case 'issue_comment': {
      const action = payload.action as string;
      if (action !== 'created') return null;
      const commentBody = payload.comment?.body as string | undefined;
      const commenter = payload.comment?.user?.login as string | undefined;
      const issueNumber = payload.issue?.number as number | undefined;
      if (!commentBody || !issueNumber) return null;
      return { owner, repo, issueNumber, text: commentBody, userId: `github_${commenter}` };
    }
    case 'pull_request': {
      const action = payload.action as string;
      if (action !== 'opened' && action !== 'synchronize') return null;
      const prBody = payload.pull_request?.body as string | undefined;
      const prTitle = payload.pull_request?.title as string | undefined;
      const prUser = payload.pull_request?.user?.login as string | undefined;
      const issueNumber = payload.pull_request?.number as number | undefined;
      if (!issueNumber) return null;
      const text = `PR #${issueNumber}: ${prTitle}\n\n${prBody ?? ''}`;
      return { owner, repo, issueNumber, text, userId: `github_${prUser}_pr` };
    }
    default:
      return null;
  }
}

// ===== GitHub App JWT + Installation Token =====

async function getInstallationToken(
  appId: string,
  privateKeyPem: string,
  owner: string,
  repo: string,
): Promise<string> {
  const jwt = await createAppJWT(appId, privateKeyPem);

  // Find installation ID for this repo
  const installsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/installation`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' },
  });
  if (!installsRes.ok) {
    throw new Error(`Failed to get installation: ${installsRes.status} ${await installsRes.text()}`);
  }
  const installData = await installsRes.json() as { id: number };
  const installationId = installData.id;

  // Get installation access token
  const tokenRes = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' },
  });
  if (!tokenRes.ok) {
    throw new Error(`Failed to get access token: ${tokenRes.status}`);
  }
  const tokenData = await tokenRes.json() as { token: string };
  return tokenData.token;
}

async function createAppJWT(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Import PEM key
  const pemHeader = '-----BEGIN RSA PRIVATE KEY-----';
  const pemFooter = '-----END RSA PRIVATE KEY-----';
  const pemBody = privateKeyPem.includes(pemHeader)
    ? privateKeyPem
    : `${pemHeader}\n${privateKeyPem}\n${pemFooter}`;

  const pemData = pemBody
    .replace(pemHeader, '')
    .replace(pemFooter, '')
    .replace(/\n/g, '')
    .replace(/\r/g, '');

  const binaryDer = Uint8Array.from(atob(pemData), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', binaryDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);

  // JWT header + payload
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iat: now - 60,
    exp: now + 600,
    iss: appId,
  };

  const encode = (obj: any) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const data = `${encode(header)}.${encode(payload)}`;

  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(data));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${data}.${signature}`;
}
