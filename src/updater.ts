// Update channel: checks the latest GitHub release and offers the new APK.

export const REPO = 'nugggy/paint-pixels';
export const APP_VERSION: string = __APP_VERSION__;

export interface UpdateInfo {
  version: string;
  notes: string;
  apkUrl: string;
  pageUrl: string;
  published: string;
}

function parse(v: string) {
  return v.replace(/^v/i, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
}

export function isNewer(remote: string, local: string) {
  const a = parse(remote), b = parse(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 404) return null; // no releases published yet
  if (!res.ok) throw new Error('GitHub returned ' + res.status);
  const rel = await res.json();
  const version = String(rel.tag_name || '').replace(/^v/i, '');
  if (!version || !isNewer(version, APP_VERSION)) return null;
  const apk = (rel.assets || []).find((a: { name: string }) => a.name.endsWith('.apk'));
  return {
    version,
    notes: rel.body || '',
    apkUrl: apk?.browser_download_url || rel.html_url,
    pageUrl: rel.html_url,
    published: rel.published_at || '',
  };
}
