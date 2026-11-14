import type { CompetitionEvent, ScoreEvent } from '../types.ts';

export interface AppsScriptStateResponse {
  ok: boolean;
  error?: string;
  message?: string;
  appended?: number;
  rejected?: Array<{ clientTxId: string; reason: string }>;
  undoneTxId?: string | null;
  event?: CompetitionEvent & { resetVersion?: number };
  scores?: ScoreEvent[];
}

export function validateAppsScriptUrl(rawUrl: string): string | null {
  const cleanUrl = rawUrl.trim();
  if (!cleanUrl || !cleanUrl.startsWith('https://script.google.com/')) {
    return 'Enter a valid Google Apps Script Web App URL starting with https://script.google.com/';
  }
  if (cleanUrl.endsWith('/dev') || cleanUrl.includes('/dev?')) {
    return 'You pasted a /dev test URL. Click Deploy -> New deployment -> Web app and paste the /exec URL instead.';
  }
  return null;
}

async function parseAppsScriptResponse(res: Response): Promise<AppsScriptStateResponse> {
  const text = await res.text();
  let parsed: AppsScriptStateResponse;
  try {
    parsed = JSON.parse(text) as AppsScriptStateResponse;
  } catch {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'HTTP 403 Forbidden: In Apps Script click Deploy -> Manage deployments -> Edit -> set "Execute as: Me" and "Who has access: Anyone", authorize access, and save.'
      );
    }
    if (text.toLowerCase().includes('accounts.google.com') || text.toLowerCase().includes('<html')) {
      throw new Error(
        'Apps Script redirected to a Google login/HTML page. Set "Who has access" to "Anyone" (not "Only myself" or "Anyone with Google account") and re-deploy.'
      );
    }
    throw new Error(`HTTP ${res.status} response from Apps Script`);
  }

  if (parsed.ok === false) {
    throw new Error(parsed.error || 'Apps Script returned an error');
  }

  return parsed;
}

export async function callAppsScript(
  url: string,
  payload: Record<string, unknown>,
  timeoutMs = 30000
): Promise<AppsScriptStateResponse> {
  const cleanUrl = url.trim();
  const validationError = validateAppsScriptUrl(cleanUrl);
  if (validationError) {
    throw new Error(validationError);
  }

  const encodedPayload = JSON.stringify(payload);

  try {
    const res = await fetch(cleanUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: encodedPayload,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return await parseAppsScriptResponse(res);
  } catch (err) {
    if (
      (err instanceof DOMException && err.name === 'TimeoutError') ||
      (err instanceof Error && /timed out|timeout/i.test(err.message))
    ) {
      throw new Error(
        'Apps Script took too long (>30s) to respond. Click Test Sheet again and verify your /exec URL & SPREADSHEET_URL.'
      );
    }

    // If POST hits a browser CORS/redirect restriction, retry via GET for eligible payloads
    if (err instanceof TypeError) {
      const sep = cleanUrl.includes('?') ? '&' : '?';
      const getUrl = `${cleanUrl}${sep}payload=${encodeURIComponent(encodedPayload)}`;
      if (getUrl.length < 2000) {
        try {
          const getRes = await fetch(getUrl, {
            method: 'GET',
            redirect: 'follow',
            signal: AbortSignal.timeout(timeoutMs),
          });
          return await parseAppsScriptResponse(getRes);
        } catch {
          // Fall through to CORS diagnostic message below
        }
      }

      throw new Error(
        'Blocked by Google Apps Script CORS. Open your /exec URL in an Incognito/Private window: if Google asks you to sign in, change "Who has access" to "Anyone" (NOT "Anyone with Google account" or "Only myself") and deploy a New version.'
      );
    }

    throw err instanceof Error ? err : new Error('Failed to communicate with Google Apps Script');
  }
}

export async function testAppsScriptDirect(url: string): Promise<{ ok: boolean; message: string }> {
  const validationError = validateAppsScriptUrl(url);
  if (validationError) {
    return { ok: false, message: validationError };
  }
  try {
    const res = await callAppsScript(url, { type: 'ping' }, 30000);
    return { ok: true, message: res.message || 'Connected to Google Apps Script' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Connection failed' };
  }
}
