import * as path from 'path';
import * as os from 'os';

export function findSidecarBinary(): string | null {
  const platform = os.platform();
  const arch = os.arch();
  const archVariants = arch === 'x64' ? ['x64', 'amd64'] : [arch];
  const platformArchs = archVariants.map((a) => `${platform}-${a}`);

  const candidates: string[] = [];
  for (const pa of platformArchs) {
    candidates.push(path.join(process.cwd(), 'sidecars', 'feishu', `feishu-sidecar-${pa}`));
  }
  candidates.push(path.join(process.cwd(), 'sidecars', 'feishu', 'feishu-sidecar'));
  for (const pa of platformArchs) {
    candidates.push(path.join(__dirname, '..', '..', '..', 'sidecars', 'feishu', `feishu-sidecar-${pa}`));
  }
  candidates.push(path.join(__dirname, '..', '..', '..', 'sidecars', 'feishu', 'feishu-sidecar'));
  candidates.push(path.join(os.homedir(), '.vibe-agent', 'sidecars', 'feishu-sidecar'));
  for (const c of candidates) {
    try {
      const fs = require('fs');
      if (fs.existsSync(c)) {
        return fs.realpathSync(c);
      }
    } catch {
      // ignore
    }
  }
  return null;
}
