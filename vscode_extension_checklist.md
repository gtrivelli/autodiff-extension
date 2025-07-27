# VSCode Extension Conversion Checklist

This checklist guides the conversion of a Python-based CLI tool into a fully functional VSCode extension. Designed for use with GitHub Copilot.

## ✅ Step 1: Set Up Extension Project
- [x] 1.a. Install [Node.js](https://nodejs.org/) (if not already installed)
- [x] 1.b. Install VSCode Extension Generator: `npm install -g yo generator-code`
- [x] 1.c. Scaffold new extension with generator: `yo code` (choose TypeScript, "New Extension (Command)")
- [x] 1.d. Verify structure (`package.json`, `src/extension.ts`, etc.) is created
- [x] 1.e. Open project folder in VSCode and run the extension in Extension Development Host (F5)
- [x] 1.e. Open project folder in VSCode and run the extension in Extension Development Host (F5)

## ✅ Step 2: Connect CLI Logic
- [x] 2.a. Copy necessary files from your CLI project (`core/`, `diff_parser.py`, etc.) into a `backend/` folder in the extension project
- [ ] 2.b. Use `child_process` in `extension.ts` to spawn the Python script:
  - Create a temporary file with git diff content
  - Run Python with appropriate args
  - Capture and display output in the VSCode UI
- [ ] 2.c. Add fallback if Python isn’t installed

## ✅ Step 3: Integrate UI Elements
- [ ] 3.a. Add a **command** in `package.json` (e.g., `aidiff.runSecurityReview`)
- [ ] 3.b. Register the command in `extension.ts`
- [ ] 3.c. Add a **button** to the VSCode status bar or editor title
- [ ] 3.d. Use `window.showInputBox` or `QuickPick` to let the user choose review modes

## ✅ Step 4: Display Results
- [ ] 4.a. Create and show a new Output Channel (`window.createOutputChannel`)
- [ ] 4.b. Pipe Python output to this channel
- [ ] 4.c. Optionally parse results into structured UI (e.g., TreeView or Webview Panel)

## ✅ Step 5: Polish UX
- [ ] 5.a. Add loading indicators/spinners during analysis
- [ ] 5.b. Show errors if Python is missing or script fails
- [ ] 5.c. Allow user to configure review mode defaults in `settings.json`

## ✅ Step 6: Test & Package
- [ ] 6.a. Test on Windows, macOS, and Linux
- [ ] 6.b. Package extension using `vsce`:
  ```bash
  npm install -g vsce
  vsce package
  ```
- [ ] 6.c. Publish (if desired) to VSCode Marketplace with `vsce publish`
