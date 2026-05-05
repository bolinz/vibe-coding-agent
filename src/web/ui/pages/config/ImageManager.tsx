import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { Box, Download, Trash2, RefreshCw, AlertCircle } from 'lucide-preact';

interface ImageInfo {
  repo: string;
  size: string;
  created: string;
  id: string;
}

export function ImageManager() {
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [pullName, setPullName] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadImages = async () => {
    try {
      const res = await fetch('/api/images');
      const data = await res.json();
      if (data.images) setImages(data.images);
      if (data.error) setError(data.error);
    } catch {
      setError('无法加载镜像列表');
    }
  };

  useEffect(() => { loadImages(); }, []);

  const handlePull = async () => {
    const name = pullName.trim();
    if (!name) return;
    setPulling(true);
    setPullResult(null);
    setPullName('');
    try {
      const res = await fetch('/api/images/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: name }),
      });
      const data = await res.json();
      setPullResult(data.success ? `拉取完成` : `失败: ${data.error}`);
      loadImages();
    } catch (e: any) {
      setPullResult(`请求失败: ${e.message}`);
    }
    setPulling(false);
  };

  const handleRemove = async (repo: string) => {
    if (!confirm(`确定删除镜像 "${repo}"？`)) return;
    try {
      const res = await fetch(`/api/images/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: repo }),
      });
      const data = await res.json();
      if (data.success) loadImages();
      else alert(data.error);
    } catch {}
  };

  return (
    <div class="image-manager">
      <div class="image-pull-row">
        <input
          type="text"
          value={pullName}
          onInput={(e) => setPullName((e.target as HTMLInputElement).value)}
          placeholder="输入镜像名，如 alpine:latest"
          disabled={pulling}
        />
        <button class="btn-pull" onClick={handlePull} disabled={pulling || !pullName.trim()}>
          <Download size={14} />
          {pulling ? '拉取中...' : '拉取'}
        </button>
        <button class="btn-refresh" onClick={loadImages} title="刷新">
          <RefreshCw size={14} />
        </button>
      </div>

      {pullResult && (
        <div class="pull-result" style={{ color: pullResult.startsWith('失败') ? 'var(--danger)' : 'var(--success)' }}>
          {pullResult}
        </div>
      )}

      {error && (
        <div class="pull-result" style="color:var(--danger);">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      <div class="image-table">
        <div class="image-table-header">
          <span>镜像</span>
          <span>大小</span>
          <span>创建时间</span>
          <span>操作</span>
        </div>
        {images.length === 0 && !error && (
          <div class="image-empty">无缓存镜像</div>
        )}
        {images.map(img => (
          <div class="image-table-row">
            <span class="image-repo"><Box size={13} /> {img.repo}</span>
            <span class="image-size">{img.size}</span>
            <span class="image-created">{img.created}</span>
            <span>
              <button class="btn-image-del" onClick={() => handleRemove(img.repo)} title="删除镜像">
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
