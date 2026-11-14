# Golden Bell Judge

Mobile-first scoring web app for **Ring a Golden Bell** competitions (`Team` and `Individual` stages, 20 questions `Q1`–`Q20`), designed to run as a **100% static site on GitHub Pages** with **Google Sheets + Google Apps Script** acting as the shared backend database.

## Features

- **100% Static Web Hosting Ready**: Built into static HTML/JS/CSS (`dist/`) for GitHub Pages—no Node.js server required.
- **Google Sheets as Shared Backend (`appscript/Code.gs`)**: Uses `LockService`, `Config`, `Scores`, `Team_Leaderboard`, and `Individual_Leaderboard` sheets with tamper-proof rule checks directly inside Apps Script.
- **Independent Two-Judge Devices**: Each judge's phone keeps its own Stage, Question #, Range (`1st half` / `2nd half`), and `Undo Last`, while merging scores into the same Google Sheet.
- **Instant Local Queue + Batch Sync**: Taps record instantaneously in `localStorage` so `Undo Last` removes mistakes cleanly before flushing to Google Sheets on **`Next Q#`**, **`Save Q20 to Sheet`**, or **`Sync Now`**.
- **Competition Rules**:
  - Configurable points for every question (`Q1`–`Q20`) in **Sheets Setup**.
  - **1-Round Ban**: Wrong answer automatically bans the participant from `Q(n+1)` and restores eligibility in `Q(n+2)`, tracking full banned-question history on the leaderboard.
  - **Lucky Bell (`Q11–Q15`)**: `+3` points once per participant; automatically hidden once **Star of Hope** appears at `Q16`.
  - **Star of Hope (`Q16–Q20`)**: `+5` points for correct answers, `-3` points for wrong answers.
- **Performance Trends & CSV**: Client-side charts and one-tap CSV export.

## Deploy to GitHub Pages

1. Push this repository to GitHub on `main` (or `master`).
2. In your GitHub repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. The included `.github/workflows/deploy.yml` workflow will automatically run `npm run build` and publish `./dist` to GitHub Pages.

## Connect Your Google Sheet (2 Minutes)

1. Open your Google Spreadsheet and copy its link (`https://docs.google.com/spreadsheets/d/.../edit`).
2. Go to **Extensions → Apps Script** (or `script.google.com`).
3. Paste [`appscript/Code.gs`](./appscript/Code.gs) into `Code.gs` and paste your spreadsheet link into `SPREADSHEET_URL` at the top.
4. Click **Deploy → New deployment → Web app**:
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
5. Copy the `/exec` URL, open **Sheets** in the app, paste it into **Google Apps Script Web App URL**, and tap **Save All Settings** & **Test Sheet**.
6. Tap **Copy Judge 2 Link** and open that link on the second judge's phone so both devices share the exact same spreadsheet.
