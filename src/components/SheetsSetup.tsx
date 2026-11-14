import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Download, Link2, RefreshCw, Send, Trash2 } from 'lucide-react';
import type { CompetitionEvent, ScoreEvent } from '../types.ts';
import { APPS_SCRIPT_CODE } from '../lib/appsScriptTemplate.ts';
import { testAppsScriptDirect } from '../lib/appsScriptClient.ts';
import { downloadScoresCsv } from '../lib/scoringEngine.ts';

interface SheetsSetupProps {
  event: CompetitionEvent;
  scores: ScoreEvent[];
  syncStats: { pending: number; synced: number; failed: number };
  onSaveConfig: (input: Partial<CompetitionEvent>) => Promise<void>;
  onResetEvent: (scope: 'all') => Promise<void>;
  onSyncNow: () => Promise<{ synced: number; failed: number }>;
}

export const SheetsSetup: React.FC<SheetsSetupProps> = ({
  event,
  scores,
  syncStats,
  onSaveConfig,
  onResetEvent,
  onSyncNow,
}) => {
  const [name, setName] = useState(event.name);
  const [teamCount, setTeamCount] = useState(event.teamCount);
  const [individualCount, setIndividualCount] = useState(event.individualCount);
  const [questionPoints, setQuestionPoints] = useState<number[]>(event.questionPoints);
  const [appsScriptUrl, setAppsScriptUrl] = useState(event.appsScriptUrl);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [spreadsheetLink, setSpreadsheetLink] = useState('');
  const [showScript, setShowScript] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    setName(event.name);
    setTeamCount(event.teamCount);
    setIndividualCount(event.individualCount);
    setQuestionPoints(event.questionPoints);
    setAppsScriptUrl(event.appsScriptUrl);
  }, [event]);

  function updateQuestionScore(idx: number, val: string) {
    const num = Math.max(0, Math.min(100, Math.floor(Number(val) || 0)));
    setQuestionPoints((prev) => prev.map((p, i) => (i === idx ? num : p)));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      await onSaveConfig({
        name,
        teamCount,
        individualCount,
        questionPoints,
        appsScriptUrl,
      });
      setSaveMessage(
        appsScriptUrl.trim()
          ? 'Saved locally & synced settings to Google Sheet'
          : 'Saved question scores locally (add Apps Script URL to share across devices)'
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const data = await testAppsScriptDirect(appsScriptUrl);
      setTestResult(data);
    } finally {
      setTesting(false);
    }
  }

  async function handleManualSync() {
    setSyncing(true);
    try {
      await onSyncNow();
    } finally {
      setSyncing(false);
    }
  }

  function buildCodeWithSpreadsheetLink(rawCode: string) {
    const trimmed = spreadsheetLink.trim();
    if (!trimmed) return rawCode;
    return rawCode.replace(
      'PASTE_YOUR_GOOGLE_SPREADSHEET_LINK_HERE',
      trimmed.replace(/'/g, "\\'")
    );
  }

  async function handleCopyCode() {
    await navigator.clipboard.writeText(buildCodeWithSpreadsheetLink(APPS_SCRIPT_CODE));
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }

  async function handleCopyJudgeLink() {
    const urlToShare = appsScriptUrl.trim() || event.appsScriptUrl.trim();
    if (!urlToShare) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?sheet=${encodeURIComponent(urlToShare)}`;
    await navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-3 sm:px-6 py-4 sm:py-6 pb-20 md:pb-10 space-y-5">
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
          Sheets & Question Setup
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
          Set points for Q1–Q20 and connect your Google Sheet as the shared database
        </p>
      </div>

      <form onSubmit={(e) => void handleSave(e)} className="space-y-5">
        {/* 20 Question Scores Card */}
        <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">20 Question Scores</h2>
              <p className="text-xs text-slate-500">Points awarded for a correct answer on Q1 through Q20</p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              Total: {questionPoints.reduce((a, b) => a + b, 0)}p
            </span>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2.5">
            {questionPoints.map((pts, idx) => (
              <label
                key={idx}
                className="flex flex-col rounded-xl border border-slate-200 bg-slate-50/60 px-2.5 py-2 focus-within:border-amber-500 focus-within:bg-white"
              >
                <span className="text-[11px] font-mono font-semibold text-slate-500">
                  Q{String(idx + 1).padStart(2, '0')}
                </span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={pts}
                  onChange={(e) => updateQuestionScore(idx, e.target.value)}
                  className="mt-0.5 w-full bg-transparent text-base font-mono tabular-nums font-bold text-slate-900 focus:outline-none"
                />
              </label>
            ))}
          </div>
        </section>

        {/* Event & Google Apps Script Card */}
        <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
          <h2 className="font-display text-base font-bold text-slate-900">Participants & Google Sheets</h2>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Event Title</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Teams (1..n)</label>
              <input
                type="number"
                min={1}
                max={500}
                value={teamCount}
                onChange={(e) => setTeamCount(Number(e.target.value) || 1)}
                className="w-full px-3 py-2.5 text-sm font-mono tabular-nums border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Individuals (1..m)</label>
              <input
                type="number"
                min={1}
                max={500}
                value={individualCount}
                onChange={(e) => setIndividualCount(Number(e.target.value) || 1)}
                className="w-full px-3 py-2.5 text-sm font-mono tabular-nums border border-slate-200 rounded-xl"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Google Apps Script Web App URL
            </label>
            <input
              type="url"
              value={appsScriptUrl}
              onChange={(e) => setAppsScriptUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="w-full px-3 py-2.5 text-sm font-mono border border-slate-200 rounded-xl"
            />
            <p className="mt-1.5 text-[11px] text-slate-500">
              Deploy as Web app &rarr; Execute as: <strong>Me</strong> &rarr; Who has access: <strong>Anyone</strong> &rarr; paste the <code>/exec</code> URL.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold min-h-[44px]"
            >
              {saving ? 'Saving...' : 'Save All Settings'}
            </button>

            <button
              type="button"
              disabled={testing || !appsScriptUrl}
              onClick={() => void handleTestConnection()}
              className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{testing ? 'Testing...' : 'Test Sheet'}</span>
            </button>

            {(appsScriptUrl.trim() || event.appsScriptUrl.trim()) && (
              <button
                type="button"
                onClick={() => void handleCopyJudgeLink()}
                className="px-4 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-xs font-semibold text-amber-900 inline-flex items-center gap-1.5 min-h-[44px]"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Link2 className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Judge Link Copied' : 'Copy Judge 2 Link'}</span>
              </button>
            )}
          </div>

          {saveMessage && <p className="text-xs text-emerald-700 font-medium">{saveMessage}</p>}
          {saveError && <p className="text-xs text-red-700 font-medium">{saveError}</p>}
          {testResult && (
            <p className={`text-xs font-medium ${testResult.ok ? 'text-emerald-700' : 'text-red-700'}`}>
              {testResult.message}
            </p>
          )}
        </section>
      </form>

      {/* Sync Controls & Collapsible Apps Script */}
      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">Sync Status</h2>
            <p className="text-xs text-slate-500 font-mono tabular-nums">
              Synced: {syncStats.synced} · Pending: {syncStats.pending} · Failed: {syncStats.failed}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={syncing || !event.appsScriptUrl}
              onClick={() => void handleManualSync()}
              className="px-3.5 py-2 rounded-xl bg-amber-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 min-h-[40px] disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>Sync Now</span>
            </button>
            <button
              type="button"
              onClick={() => downloadScoresCsv(scores)}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 min-h-[40px]"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 space-y-2.5">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Your Google Spreadsheet Link (auto-fills into Code.gs)
            </label>
            <input
              type="url"
              value={spreadsheetLink}
              onChange={(e) => setSpreadsheetLink(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-xl"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowScript((v) => !v)}
              className="text-xs font-semibold text-slate-700 inline-flex items-center gap-1 py-1.5 min-h-[40px]"
            >
              {showScript ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              <span>{showScript ? 'Hide Apps Script (Code.gs)' : 'Show Apps Script (Code.gs)'}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleCopyCode()}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 min-h-[38px]"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCode ? 'Copied' : 'Copy Code.gs'}</span>
            </button>
          </div>
        </div>

        {showScript && (
          <pre className="p-3 rounded-xl bg-slate-950 text-slate-100 text-[11px] font-mono overflow-x-auto max-h-56">
            {buildCodeWithSpreadsheetLink(APPS_SCRIPT_CODE)}
          </pre>
        )}
      </section>

      {/* Reset Event */}
      <section className="bg-white border border-red-200 rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Reset Competition Scores</h3>
          <p className="text-xs text-slate-600">Clears all recorded answers and sets scores to 0.</p>
        </div>
        {!confirmReset ? (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="px-3.5 py-2 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold inline-flex items-center gap-1.5 min-h-[40px]"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Reset Event</span>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 min-h-[40px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void onResetEvent('all');
                setConfirmReset(false);
              }}
              className="px-3.5 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold min-h-[40px]"
            >
              Confirm Reset
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
