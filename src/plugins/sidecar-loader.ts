import * as path from 'path';
import * as os from 'os';

export function findSidecarBinary(pluginName: string): string | null {
  const execDir = path.dirname(process.execPath);
  const cwd = process.cwd();

  const candidates = [
    path.join(execDir, 'plugins', pluginName, 'sidecar'),
    path.join(cwd, 'plugins', pluginName, 'sidecar'),
    path.join(os.homedir(), '.vibe-agent', 'plugins', pluginName, 'sidecar'),
  ];

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
