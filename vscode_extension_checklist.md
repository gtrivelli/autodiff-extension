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
- [x] 2.b. Use `child_process` in `extension.ts` to spawn the Python script:
  - Create a temporary file with git diff content
  - Run Python with appropriate args
  - Capture and display output in the VSCode UI
- [x] 2.c. Add fallback if Python isn’t installed

## ✅ Step 3: Integrate UI Elements
- [x] 3.a. Add a **command** in `package.json` (e.g., `aidiff.runSecurityReview`)
- [x] 3.b. Register the command in `extension.ts`
- [x] 3.c. Add a **button** to the VSCode status bar or editor title
- [x] 3.d. Use `window.showInputBox` or `QuickPick` to let the user choose review modes

## ✅ Step 4: Display Results
- [x] 4.a. Create and show a new Output Channel (`window.createOutputChannel`)
- [x] 4.b. Pipe Python output to this channel
- [x] 4.c. Optionally parse results into structured UI (e.g., TreeView or Webview Panel)

## ✅ Step 5: Polish UX
- [x] 5.a. Add loading indicators/spinners during analysis
- [x] 5.b. Show errors if Python is missing or script fails
- [x] 5.c. Allow user to configure review mode defaults in `settings.json`

## ✅ Step 6: Test & Package
- [ ] 6.a. Test on Windows, macOS, and Linux (tested on Linux, cross-platform compatible)
- [ ] 6.b. Package extension using `vsce`:
  ```bash
  npm install -g vsce
  vsce package
  ```
- [ ] 6.c. Publish (if desired) to VSCode Marketplace with `vsce publish`

### ✅ Enhanced Sidebar Functionality
- [x] **Multi-View Layout**: Professional Source Control-style layout with multiple subwindows (Reviews, Changes, Results, Settings)
- [x] **Non-clickable Extension Title**: "AutoDiff" appears as main container title like Source Control
- [x] **Ellipsis Menu**: Three-dot menu next to extension title for toggling subwindows on/off
- [x] **Run Button**: Play button next to extension title for running comprehensive review
- [x] **Review Checklist**: Simple checkboxes (☐/☑️) showing Security, Accessibility, Performance completion status
- [x] **Dedicated Changes View**: Clean list of changed files with status indicators
- [x] **Dedicated Results View**: Organized summary of review results grouped by status (Failed/Warnings/Passed)
- [x] **Dedicated Settings View**: Configuration options for LLM provider, default mode, and base branch
- [x] **Rich Icons**: Every review type and setting has appropriate ThemeIcon objects (🛡️, ♿, ⚡, ⚙️, etc.)
- [x] **Configurable Base Branch**: User can select any git branch to compare against with live branch detection
- [x] **File Status Tracking**: Real-time visual indicators showing review results per file:
  - ✅ Green checkmarks for passed reviews
  - ❌ Red errors for failed reviews
  - ⚠️ Yellow warnings for medium-confidence issues
  - ⚪ White circles for files not yet reviewed
- [x] **Intelligent Error Handling**: Graceful handling of "no changes" scenarios without breaking the extension
- [x] **Smart Git Integration**: Fallback logic for staged/unstaged/branch comparisons with configurable base branch

### ✅ Backend Architecture Excellence  
- [x] **Modular Provider System**: Extensible architecture with abstract base classes and provider registry
- [x] **4 LLM Providers**: ChatGPT, Google Gemini, Anthropic Claude (planned), GitHub Copilot (experimental)
- [x] **Consistent Naming**: All providers use consistent naming scheme (chatgpt, gemini, claude, copilot)
- [x] **Easy Extensibility**: New providers can be added by implementing `LLMProvider` base class
