/** Human-friendly numbers for download UIs (Internet Download Manager style). */

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 KB';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 912 KB/s, 6.4 MB/s ... (never rounds a slow connection down to "0.0 MB/s"). */
export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec < 1) return '0 KB/s';
  if (bytesPerSec >= 1024 ** 2) return `${(bytesPerSec / 1024 ** 2).toFixed(bytesPerSec >= 10 * 1024 ** 2 ? 1 : 2)} MB/s`;
  if (bytesPerSec >= 1024) return `${Math.round(bytesPerSec / 1024)} KB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
}

/** Same speed expressed like internet plans/ISPs do (Mbit/s). */
export function formatMbps(bytesPerSec: number): string {
  return `${((bytesPerSec * 8) / 1_000_000).toFixed(1)} Mbit/s`;
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !isFinite(totalSeconds) || totalSeconds < 0) return '--';
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}
