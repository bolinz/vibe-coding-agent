import type { RuntimeType } from '../types';
import type { RuntimeAdapter } from './types';

export class RuntimeRegistry {
  private runtimes = new Map<RuntimeType, RuntimeAdapter>();

  register(type: RuntimeType, adapter: RuntimeAdapter): void {
    this.runtimes.set(type, adapter);
  }

  get(type: RuntimeType): RuntimeAdapter {
    const adapter = this.runtimes.get(type);
    if (!adapter) {
      throw new Error(`Runtime not found for type: ${type}`);
    }
    return adapter;
  }

  has(type: RuntimeType): boolean {
    return this.runtimes.has(type);
  }

  list(): RuntimeType[] {
    return Array.from(this.runtimes.keys());
  }
}
