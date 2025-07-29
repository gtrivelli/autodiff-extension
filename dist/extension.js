"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode = __toESM(require("vscode"));
var cp = __toESM(require("child_process"));
var path = __toESM(require("path"));
var fs = __toESM(require("fs"));

// src/dto.ts
var DTOUtils = class _DTOUtils {
  static parseIssueDTO(data) {
    return {
      issue: data.issue || "Unknown issue",
      severity: data.severity || "Medium" /* MEDIUM */,
      confidence: data.confidence || 50,
      line_numbers: Array.isArray(data.line_numbers) ? data.line_numbers : [],
      code: data.code || "",
      suggestion: data.suggestion || "No suggestion provided",
      review_type: data.review_type || "security" /* SECURITY */,
      file_path: data.file_path
    };
  }
  static parseFileAnalysisDTO(data) {
    return {
      file_path: data.file_path || "",
      issues: (data.issues || []).map((issue) => _DTOUtils.parseIssueDTO(issue)),
      review_types_analyzed: data.review_types_analyzed || []
    };
  }
  static parseAnalysisResultDTO(data) {
    return {
      files: (data.files || []).map((file) => _DTOUtils.parseFileAnalysisDTO(file)),
      total_issues: data.total_issues || 0,
      analysis_timestamp: data.analysis_timestamp || (/* @__PURE__ */ new Date()).toISOString(),
      review_types: data.review_types || []
    };
  }
  static parseFromJSON(jsonString) {
    try {
      console.log("DTOUtils.parseFromJSON: Input length:", jsonString.length);
      console.log("DTOUtils.parseFromJSON: First 100 chars:", jsonString.substring(0, 100));
      console.log("DTOUtils.parseFromJSON: Last 100 chars:", jsonString.substring(Math.max(0, jsonString.length - 100)));
      const data = JSON.parse(jsonString);
      console.log("DTOUtils.parseFromJSON: Parse successful, data.total_issues:", data.total_issues);
      return _DTOUtils.parseAnalysisResultDTO(data);
    } catch (error) {
      console.error("Error parsing AnalysisResultDTO from JSON:", error);
      console.error("Failed JSON string length:", jsonString.length);
      console.error("Failed JSON first 200 chars:", jsonString.substring(0, 200));
      return null;
    }
  }
  // Convert severity to file decoration status
  static severityToStatus(severity) {
    switch (severity) {
      case "High" /* HIGH */:
        return "fail";
      case "Medium" /* MEDIUM */:
        return "warning";
      case "Low" /* LOW */:
        return "warning";
      default:
        return "warning";
    }
  }
  // Get emoji for severity
  static severityToEmoji(severity) {
    switch (severity) {
      case "High" /* HIGH */:
        return "\u274C";
      case "Medium" /* MEDIUM */:
        return "\u26A0\uFE0F";
      case "Low" /* LOW */:
        return "\u26A0\uFE0F";
      default:
        return "\u26A0\uFE0F";
    }
  }
  // Format line numbers for display
  static formatLineNumbers(lineNumbers) {
    if (lineNumbers.length === 0) {
      return "";
    }
    if (lineNumbers.length === 1) {
      return lineNumbers[0].toString();
    }
    const sorted = [...lineNumbers].sort((a, b) => a - b);
    let ranges = [];
    let start = sorted[0];
    let end = sorted[0];
    for (let i = 1; i <= sorted.length; i++) {
      if (i < sorted.length && sorted[i] === end + 1) {
        end = sorted[i];
      } else {
        if (start === end) {
          ranges.push(start.toString());
        } else {
          ranges.push(`${start}-${end}`);
        }
        if (i < sorted.length) {
          start = end = sorted[i];
        }
      }
    }
    return ranges.join(", ");
  }
};

// src/extension.ts
async function runCopilotAnalysis(modes, diffContent, outputChannel) {
  try {
    if (!vscode.lm || !vscode.lm.selectChatModels) {
      outputChannel.appendLine("\u274C VS Code Language Model API not available.\n");
      outputChannel.appendLine("   This feature requires VS Code 1.90+ and the experimental Language Model API.\n");
      outputChannel.appendLine("   GitHub Copilot integration is coming soon once the API becomes stable!\n");
      return null;
    }
    const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    if (models.length === 0) {
      outputChannel.appendLine("\u274C No GitHub Copilot models available.\n");
      outputChannel.appendLine("   Please make sure you have GitHub Copilot enabled and signed in.\n");
      outputChannel.appendLine("   Note: Copilot integration is experimental and may not be available in all VS Code versions.\n");
      return null;
    }
    outputChannel.appendLine(`\u{1F50D} Available Copilot models: ${models.length}
`);
    for (let i = 0; i < models.length; i++) {
      const m = models[i];
      outputChannel.appendLine(`   ${i}: ${m.name} (${m.vendor}/${m.family}) - Max tokens: ${m.maxInputTokens}
`);
    }
    let selectedModel = models[0];
    const claudeModel = models.find(
      (m) => m.name.toLowerCase().includes("claude") || m.name.toLowerCase().includes("sonnet") || m.family.toLowerCase().includes("claude") || m.family.toLowerCase().includes("anthropic")
    );
    if (claudeModel) {
      selectedModel = claudeModel;
      outputChannel.appendLine(`\u{1F3AF} Found Claude model: ${selectedModel.name}
`);
    } else {
      outputChannel.appendLine(`\u26A0\uFE0F  No Claude model found, using: ${selectedModel.name}
`);
    }
    outputChannel.appendLine(`\u{1F4E1} Using model: ${selectedModel.name} (${selectedModel.vendor}/${selectedModel.family})
`);
    const extensionPath = path.dirname(path.dirname(__filename));
    const backendPath = path.join(extensionPath, "backend");
    let prompt = "";
    for (const mode of modes) {
      const promptPath = path.join(backendPath, "prompts", `${mode}.md`);
      if (fs.existsSync(promptPath)) {
        const promptTemplate = fs.readFileSync(promptPath, "utf-8");
        prompt += promptTemplate + "\n\n";
      }
    }
    prompt += `---

### Git Diff

\`\`\`diff
${diffContent}
\`\`\``;
    const cancellationTokenSource = new vscode.CancellationTokenSource();
    const chatResponse = await selectedModel.sendRequest([
      vscode.LanguageModelChatMessage.User(prompt)
    ], {}, cancellationTokenSource.token);
    let responseText = "";
    for await (const fragment of chatResponse.text) {
      responseText += fragment;
    }
    outputChannel.appendLine("\u2705 Copilot analysis completed successfully.\n");
    return responseText;
  } catch (error) {
    if (error instanceof vscode.LanguageModelError) {
      outputChannel.appendLine(`\u274C Copilot error: ${error.message} (${error.code})
`);
      if (error.cause) {
        outputChannel.appendLine(`   Cause: ${error.cause}
`);
      }
      if (error.code === "NoPermissions") {
        outputChannel.appendLine("   \u{1F4A1} Try: Make sure GitHub Copilot extension is installed and you are signed in to Copilot.\n");
      } else if (error.code === "Blocked") {
        outputChannel.appendLine("   \u{1F4A1} The request was blocked. This might be due to content policy restrictions.\n");
      }
    } else {
      outputChannel.appendLine(`\u274C Unexpected error: ${error.message}
`);
    }
    return null;
  }
}
var AutoDiffFileDecorationProvider = class {
  _onDidChangeFileDecorations = new vscode.EventEmitter();
  onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
  reviewResults = /* @__PURE__ */ new Map();
  changedFiles = /* @__PURE__ */ new Set();
  constructor() {
  }
  updateReviewResults(results) {
    this.reviewResults = results;
    this._onDidChangeFileDecorations.fire(void 0);
  }
  updateChangedFiles(files) {
    this.changedFiles = new Set(files);
    this._onDidChangeFileDecorations.fire(void 0);
  }
  provideFileDecoration(uri, token) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
      return void 0;
    }
    const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
    if (!this.changedFiles.has(relativePath)) {
      return void 0;
    }
    const fileResult = this.reviewResults.get(relativePath);
    if (fileResult && Object.keys(fileResult.results).length > 0) {
      const reviewTypes = ["security", "accessibility", "performance"];
      let hasFailures = false;
      let hasWarnings = false;
      let hasPass = false;
      for (const reviewType of reviewTypes) {
        const result2 = fileResult.results[reviewType];
        if (result2) {
          switch (result2.status) {
            case "fail":
              hasFailures = true;
              break;
            case "warning":
              hasWarnings = true;
              break;
            case "pass":
              hasPass = true;
              break;
          }
        }
      }
      if (hasFailures) {
        return {
          badge: "\u274C",
          tooltip: "Review found issues",
          propagate: false
        };
      } else if (hasWarnings) {
        return {
          badge: "\u26A0\uFE0F",
          tooltip: "Review found warnings",
          propagate: false
        };
      } else if (hasPass) {
        return {
          badge: "\u2705",
          tooltip: "Review passed",
          propagate: false
        };
      }
    } else {
      return {
        badge: "\u25CB",
        tooltip: "Not reviewed yet",
        propagate: false
      };
    }
    return void 0;
  }
};
var AutoDiffTreeDataProvider = class {
  _onDidChangeTreeData = new vscode.EventEmitter();
  onDidChangeTreeData = this._onDidChangeTreeData.event;
  changedFiles = [];
  reviewResults = /* @__PURE__ */ new Map();
  selectedReviews = /* @__PURE__ */ new Set(["security"]);
  // Default to only security selected
  viewType;
  context;
  fileDecorationProvider;
  sharedData;
  constructor(viewType, context, fileDecorationProvider) {
    this.viewType = viewType;
    this.context = context;
    this.fileDecorationProvider = fileDecorationProvider;
    this.loadSelectedReviews();
    this.loadChangedFiles();
  }
  setSharedData(sharedData) {
    this.changedFiles = sharedData.changedFiles;
    this.reviewResults = sharedData.reviewResults;
    this.selectedReviews = sharedData.selectedReviews;
    this.sharedData = sharedData;
  }
  // Initialize shared data once
  async loadInitialData() {
    if (this.sharedData && this.sharedData.changedFiles.length === 0) {
      const files = await this.loadChangedFiles();
      this.sharedData.changedFiles.splice(0, this.sharedData.changedFiles.length, ...files);
    }
  }
  loadSelectedReviews() {
    const saved = this.context.workspaceState.get("autodiff.selectedReviews", ["security"]);
    this.selectedReviews = new Set(saved);
  }
  saveSelectedReviews() {
    this.context.workspaceState.update("autodiff.selectedReviews", Array.from(this.selectedReviews));
  }
  toggleReviewSelection(reviewType) {
    if (this.selectedReviews.has(reviewType)) {
      this.selectedReviews.delete(reviewType);
    } else {
      this.selectedReviews.add(reviewType);
    }
    this.saveSelectedReviews();
    this._onDidChangeTreeData.fire();
  }
  getSelectedReviews() {
    return Array.from(this.selectedReviews);
  }
  getReviewResults() {
    return this.reviewResults;
  }
  refresh() {
    this.loadChangedFiles();
    this._onDidChangeTreeData.fire();
  }
  async loadChangedFiles() {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        this.changedFiles = [];
        return this.changedFiles;
      }
      try {
        const files = /* @__PURE__ */ new Set();
        const diffContent = await getGitDiff(workspaceFolder.uri.fsPath);
        if (diffContent) {
          const filePattern = /^diff --git a\/(.+?) b\/(.+?)$/gm;
          let match;
          while ((match = filePattern.exec(diffContent)) !== null) {
            files.add(match[2]);
          }
        }
        const untrackedFiles = await getUntrackedFiles(workspaceFolder.uri.fsPath);
        untrackedFiles.forEach((file) => {
          if (!file.includes(".git/")) {
            files.add(file);
          }
        });
        this.changedFiles = Array.from(files);
      } catch (gitError) {
        console.log("No git changes found:", gitError);
        this.changedFiles = [];
      }
    } catch (error) {
      console.error("Error loading changed files:", error);
      this.changedFiles = [];
    }
    if (this.fileDecorationProvider && !this.sharedData) {
      this.fileDecorationProvider.updateChangedFiles(this.changedFiles);
      this.fileDecorationProvider.updateReviewResults(this.reviewResults);
    }
    return this.changedFiles;
  }
  updateReviewResults(reviewType, results) {
    for (const file of this.changedFiles) {
      if (!this.reviewResults.has(file)) {
        this.reviewResults.set(file, { file, results: {} });
      }
      const fileResult = this.reviewResults.get(file);
      const fileIssues = results.filter((r) => r.file === file);
      let status = "pass";
      let avgConfidence = 100;
      if (fileIssues.length > 0) {
        const hasHighSeverity = fileIssues.some(
          (issue) => ["critical", "high"].includes(issue.severity?.toLowerCase())
        );
        const hasLowSeverity = fileIssues.some(
          (issue) => ["low", "medium"].includes(issue.severity?.toLowerCase())
        );
        const confidences = fileIssues.map((issue) => parseInt(issue.confidence?.replace("%", "") || "50")).filter((c) => !isNaN(c));
        avgConfidence = confidences.length > 0 ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 50;
        if (hasHighSeverity && avgConfidence >= 70) {
          status = "fail";
        } else if (hasLowSeverity || avgConfidence < 70) {
          status = "warning";
        } else if (hasHighSeverity && avgConfidence < 50) {
          status = "warning";
        } else {
          status = "fail";
        }
      }
      fileResult.results[reviewType] = {
        status,
        confidence: avgConfidence,
        issues: fileIssues.length
      };
    }
    if (this.fileDecorationProvider) {
      if (this.sharedData) {
        this.fileDecorationProvider.updateChangedFiles(this.sharedData.changedFiles);
        this.fileDecorationProvider.updateReviewResults(this.sharedData.reviewResults);
      } else {
        this.fileDecorationProvider.updateReviewResults(this.reviewResults);
      }
    }
    this.refresh();
  }
  // New method to handle DTO-based results
  updateReviewResultsFromDTO(analysisResult, reviewTypes) {
    this.clearReviewResults(reviewTypes);
    for (const fileAnalysis of analysisResult.files) {
      if (!this.reviewResults.has(fileAnalysis.file_path)) {
        this.reviewResults.set(fileAnalysis.file_path, {
          file: fileAnalysis.file_path,
          results: {}
        });
      }
      const fileResult = this.reviewResults.get(fileAnalysis.file_path);
      const issuesByType = {};
      for (const issue of fileAnalysis.issues) {
        const reviewType = issue.review_type;
        if (!issuesByType[reviewType]) {
          issuesByType[reviewType] = [];
        }
        issuesByType[reviewType].push(issue);
      }
      for (const reviewType of reviewTypes) {
        const typeIssues = issuesByType[reviewType] || [];
        let status = "pass";
        let avgConfidence = 100;
        if (typeIssues.length > 0) {
          const hasHighSeverity = typeIssues.some((issue) => issue.severity === "High" /* HIGH */);
          const hasLowSeverity = typeIssues.some(
            (issue) => issue.severity === "Low" /* LOW */ || issue.severity === "Medium" /* MEDIUM */
          );
          const confidences = typeIssues.map((issue) => issue.confidence);
          avgConfidence = confidences.length > 0 ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 50;
          if (hasHighSeverity && avgConfidence >= 70) {
            status = "fail";
          } else if (hasLowSeverity || avgConfidence < 70) {
            status = "warning";
          } else if (hasHighSeverity && avgConfidence < 50) {
            status = "warning";
          } else {
            status = "fail";
          }
        }
        fileResult.results[reviewType] = {
          status,
          confidence: avgConfidence,
          issues: typeIssues.length,
          issueDetails: typeIssues
          // Store individual issues
        };
      }
    }
    if (this.fileDecorationProvider) {
      if (this.sharedData) {
        this.fileDecorationProvider.updateChangedFiles(this.sharedData.changedFiles);
        this.fileDecorationProvider.updateReviewResults(this.sharedData.reviewResults);
      } else {
        this.fileDecorationProvider.updateReviewResults(this.reviewResults);
      }
    }
    this.refresh();
  }
  // Clear review results for selected review types (called before starting new review)
  clearReviewResults(reviewTypes) {
    for (const file of this.changedFiles) {
      if (this.reviewResults.has(file)) {
        const fileResult = this.reviewResults.get(file);
        fileResult.results = {};
        if (Object.keys(fileResult.results).length === 0) {
          this.reviewResults.delete(file);
        }
      }
    }
    if (this.fileDecorationProvider) {
      if (this.sharedData) {
        this.fileDecorationProvider.updateChangedFiles(this.sharedData.changedFiles);
        this.fileDecorationProvider.updateReviewResults(this.sharedData.reviewResults);
      } else {
        this.fileDecorationProvider.updateReviewResults(this.reviewResults);
      }
    }
    this.refresh();
  }
  getTreeItem(element) {
    return element;
  }
  getChildren(element) {
    if (!element) {
      switch (this.viewType) {
        case "branch":
          return this.getBranchChildren();
        case "reviews":
          return this.getReviewsChildren();
        case "changes":
          return this.getChangesChildren();
        case "results":
          return this.getResultsChildren();
        case "settings":
          return this.getSettingsChildren();
        default:
          return Promise.resolve([]);
      }
    } else if (element.reviewType === "group") {
      return this.getResultsGroupChildren(element.label);
    }
    return Promise.resolve([]);
  }
  getReviewsChildren() {
    const isSecuritySelected = this.selectedReviews.has("security");
    const isAccessibilitySelected = this.selectedReviews.has("accessibility");
    const isPerformanceSelected = this.selectedReviews.has("performance");
    return Promise.resolve([
      new ReviewItem(
        "Security",
        "Scan for security vulnerabilities",
        vscode.TreeItemCollapsibleState.None,
        "security",
        new vscode.ThemeIcon(isSecuritySelected ? "check" : "square"),
        false
      ),
      new ReviewItem(
        "Accessibility",
        "Check accessibility compliance",
        vscode.TreeItemCollapsibleState.None,
        "accessibility",
        new vscode.ThemeIcon(isAccessibilitySelected ? "check" : "square"),
        false
      ),
      new ReviewItem(
        "Performance",
        "Analyze performance impact",
        vscode.TreeItemCollapsibleState.None,
        "performance",
        new vscode.ThemeIcon(isPerformanceSelected ? "check" : "square"),
        false
      )
    ]);
  }
  async getBranchChildren() {
    const config = vscode.workspace.getConfiguration("autodiff");
    const currentBranch = config.get("baseBranch", "origin/main");
    try {
      const branches = await getAvailableBranches();
      if (branches.length === 0) {
        return [
          new ReviewItem(
            "No branches found",
            "No git branches available",
            vscode.TreeItemCollapsibleState.None,
            "info",
            new vscode.ThemeIcon("warning"),
            false
          )
        ];
      }
      return branches.map((branch) => {
        const isCurrent = branch === currentBranch;
        return new ReviewItem(
          branch,
          isCurrent ? "Current base branch" : "Click to set as base branch",
          vscode.TreeItemCollapsibleState.None,
          "base-branch",
          new vscode.ThemeIcon(isCurrent ? "check" : "git-branch"),
          false
        );
      });
    } catch (error) {
      console.error("Error loading branches:", error);
      return [
        new ReviewItem(
          "Error loading branches",
          "Failed to load git branches",
          vscode.TreeItemCollapsibleState.None,
          "info",
          new vscode.ThemeIcon("error"),
          false
        )
      ];
    }
  }
  getChangesChildren() {
    if (this.changedFiles.length === 0) {
      return Promise.resolve([
        new ReviewItem(
          "No changes found",
          "Make some changes to your files to see them here",
          vscode.TreeItemCollapsibleState.None,
          "info",
          new vscode.ThemeIcon("info"),
          false
        )
      ]);
    }
    const items = this.changedFiles.map((file) => {
      const fileResult = this.reviewResults.get(file);
      const tooltip = `Click to open: ${file}${fileResult ? this.getFileTooltip(fileResult) : "\n\nNo reviews completed yet - run a review to see results here."}`;
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      let fileIcon;
      if (workspaceFolder) {
        const fileUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, file));
        fileIcon = vscode.ThemeIcon.File;
      } else {
        fileIcon = new vscode.ThemeIcon("file");
      }
      const item = new ReviewItem(
        file,
        // Clean filename without status indicators
        tooltip,
        vscode.TreeItemCollapsibleState.None,
        "file",
        fileIcon,
        false,
        file
      );
      if (workspaceFolder) {
        item.resourceUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, file));
      }
      return item;
    });
    return Promise.resolve(items);
  }
  getResultsChildren() {
    const results = Array.from(this.reviewResults.values());
    if (results.length === 0) {
      return Promise.resolve([
        new ReviewItem(
          "No results yet",
          "Run a review to see results here",
          vscode.TreeItemCollapsibleState.None,
          "info",
          new vscode.ThemeIcon("info"),
          false
        )
      ]);
    }
    const failedIssues = [];
    const warningIssues = [];
    const fileStatuses = /* @__PURE__ */ new Map();
    results.forEach((fileResult) => {
      let worstStatus = "pass";
      Object.entries(fileResult.results).forEach(([reviewType, result2]) => {
        if (result2.status === "fail") {
          worstStatus = "fail";
        } else if (result2.status === "warning" && worstStatus !== "fail") {
          worstStatus = "warning";
        }
        if (result2.issueDetails && result2.issueDetails.length > 0) {
          result2.issueDetails.forEach((issue, index) => {
            const lineInfo = DTOUtils.formatLineNumbers(issue.line_numbers);
            const item = new ReviewItem(
              `${issue.issue}`,
              `File: ${issue.file_path}
Line: ${lineInfo}
Severity: ${issue.severity}
Confidence: ${issue.confidence}%

Code: ${issue.code}

Suggestion: ${issue.suggestion}`,
              vscode.TreeItemCollapsibleState.None,
              "issue",
              void 0,
              false,
              issue.file_path,
              issue
              // Pass the issue data for navigation
            );
            if (result2.status === "fail") {
              failedIssues.push(item);
            } else {
              warningIssues.push(item);
            }
          });
        } else if (result2.issues > 0) {
          const item = new ReviewItem(
            `${fileResult.file}`,
            `Issues: ${result2.issues}, Confidence: ${result2.confidence}%`,
            vscode.TreeItemCollapsibleState.None,
            "result",
            void 0,
            false,
            fileResult.file
          );
          if (result2.status === "fail") {
            failedIssues.push(item);
          } else if (result2.status === "warning") {
            warningIssues.push(item);
          }
        }
      });
      fileStatuses.set(fileResult.file, worstStatus);
    });
    const passedFiles = [];
    fileStatuses.forEach((status, fileName) => {
      if (status === "pass") {
        const item = new ReviewItem(
          `${fileName}`,
          `No issues found`,
          vscode.TreeItemCollapsibleState.None,
          "result",
          void 0,
          false,
          fileName
        );
        passedFiles.push(item);
      }
    });
    const allResults = [];
    if (failedIssues.length > 0) {
      allResults.push(new ReviewItem(
        `\u274C Critical Issues (${failedIssues.length})`,
        "Click to expand and see individual issues",
        vscode.TreeItemCollapsibleState.Expanded,
        "group",
        void 0,
        true
      ));
    }
    if (warningIssues.length > 0) {
      allResults.push(new ReviewItem(
        `\u26A0\uFE0F Warnings (${warningIssues.length})`,
        "Click to expand and see individual issues",
        vscode.TreeItemCollapsibleState.Expanded,
        "group",
        void 0,
        true
      ));
    }
    if (passedFiles.length > 0) {
      allResults.push(new ReviewItem(
        `\u2705 Passed (${passedFiles.length})`,
        "Click to expand and see files with no issues",
        vscode.TreeItemCollapsibleState.Expanded,
        "group",
        void 0,
        true
      ));
    }
    return Promise.resolve(allResults);
  }
  getResultsGroupChildren(groupLabel) {
    const results = Array.from(this.reviewResults.values());
    const groupItems = [];
    if (groupLabel.startsWith("\u2705")) {
      const fileStatuses = /* @__PURE__ */ new Map();
      results.forEach((fileResult) => {
        let worstStatus = "pass";
        Object.entries(fileResult.results).forEach(([reviewType, result2]) => {
          if (result2.status === "fail") {
            worstStatus = "fail";
          } else if (result2.status === "warning" && worstStatus !== "fail") {
            worstStatus = "warning";
          }
        });
        fileStatuses.set(fileResult.file, worstStatus);
      });
      fileStatuses.forEach((status, fileName) => {
        if (status === "pass") {
          const fileIconName = this.getFileIconName(fileName);
          const item = new ReviewItem(
            `${fileName}`,
            `\u2705 File passed all reviews: ${fileName}`,
            vscode.TreeItemCollapsibleState.None,
            "file",
            new vscode.ThemeIcon(fileIconName),
            false,
            fileName
          );
          groupItems.push(item);
        }
      });
    } else {
      results.forEach((fileResult) => {
        Object.entries(fileResult.results).forEach(([reviewType, result2]) => {
          if (groupLabel.startsWith("\u274C") && result2.status === "fail") {
            if (result2.issueDetails && result2.issueDetails.length > 0) {
              result2.issueDetails.forEach((issue) => {
                const lineInfo = DTOUtils.formatLineNumbers(issue.line_numbers);
                const item = new ReviewItem(
                  `${issue.issue}`,
                  `File: ${issue.file_path}
Line: ${lineInfo}
Severity: ${issue.severity}
Confidence: ${issue.confidence}%

Code: ${issue.code}

Suggestion: ${issue.suggestion}`,
                  vscode.TreeItemCollapsibleState.None,
                  "issue",
                  void 0,
                  false,
                  issue.file_path,
                  issue
                );
                groupItems.push(item);
              });
            }
          } else if (groupLabel.startsWith("\u26A0\uFE0F") && result2.status === "warning") {
            if (result2.issueDetails && result2.issueDetails.length > 0) {
              result2.issueDetails.forEach((issue) => {
                const lineInfo = DTOUtils.formatLineNumbers(issue.line_numbers);
                const item = new ReviewItem(
                  `${issue.issue}`,
                  `File: ${issue.file_path}
Line: ${lineInfo}
Severity: ${issue.severity}
Confidence: ${issue.confidence}%

Code: ${issue.code}

Suggestion: ${issue.suggestion}`,
                  vscode.TreeItemCollapsibleState.None,
                  "issue",
                  void 0,
                  false,
                  issue.file_path,
                  issue
                );
                groupItems.push(item);
              });
            }
          }
        });
      });
    }
    return Promise.resolve(groupItems);
  }
  getSettingsChildren() {
    const config = vscode.workspace.getConfiguration("autodiff");
    const llmProvider = config.get("llmProvider", "chatgpt");
    const enableBranchComparison = config.get("enableBranchComparison", true);
    const baseBranch = config.get("baseBranch", "origin/main");
    const enableDebugOutput = config.get("enableDebugOutput", false);
    return Promise.resolve([
      new ReviewItem(
        `LLM Provider: ${llmProvider}`,
        "Click to change AI provider",
        vscode.TreeItemCollapsibleState.None,
        "llm-provider",
        new vscode.ThemeIcon("robot"),
        true
      ),
      new ReviewItem(
        `Branch Comparison: ${enableBranchComparison ? "Enabled" : "Disabled"}`,
        `Compare against: ${baseBranch}`,
        vscode.TreeItemCollapsibleState.None,
        "branch-comparison",
        new vscode.ThemeIcon("git-branch"),
        true
      ),
      new ReviewItem(
        `Debug Output: ${enableDebugOutput ? "Enabled" : "Disabled"}`,
        "Show detailed console output during analysis",
        vscode.TreeItemCollapsibleState.None,
        "debug-output",
        new vscode.ThemeIcon("debug"),
        true
      ),
      new ReviewItem(
        "Configuration",
        "Extension settings",
        vscode.TreeItemCollapsibleState.None,
        "config",
        new vscode.ThemeIcon("gear"),
        true
      )
    ]);
  }
  getFileTooltip(fileResult) {
    let tooltip = "\n\nReview Results:";
    for (const [reviewType, result2] of Object.entries(fileResult.results)) {
      const statusEmoji = result2.status === "pass" ? "\u2705" : result2.status === "fail" ? "\u274C" : "\u26A0\uFE0F";
      tooltip += `
${reviewType}: ${statusEmoji} ${result2.issues} issues (${result2.confidence}% confidence)`;
    }
    return tooltip;
  }
  getFileIconName(fileName) {
    const extension = fileName.split(".").pop()?.toLowerCase();
    const iconMap = {
      // Web files
      "js": "file-code",
      "jsx": "file-code",
      "ts": "file-code",
      "tsx": "file-code",
      "html": "file-code",
      "htm": "file-code",
      "css": "file-code",
      "scss": "file-code",
      "sass": "file-code",
      "less": "file-code",
      "vue": "file-code",
      "svelte": "file-code",
      // Backend languages
      "py": "file-code",
      "java": "file-code",
      "cpp": "file-code",
      "c": "file-code",
      "cs": "file-code",
      "php": "file-code",
      "rb": "file-code",
      "go": "file-code",
      "rs": "file-code",
      "swift": "file-code",
      "kt": "file-code",
      // Config files
      "json": "file-code",
      "xml": "file-code",
      "yaml": "file-code",
      "yml": "file-code",
      "toml": "file-code",
      "ini": "file-code",
      "env": "file-code",
      // Documentation
      "md": "file-text",
      "txt": "file-text",
      "rst": "file-text",
      // Images
      "png": "file-media",
      "jpg": "file-media",
      "jpeg": "file-media",
      "gif": "file-media",
      "svg": "file-media",
      "ico": "file-media",
      // Archives
      "zip": "file-zip",
      "tar": "file-zip",
      "gz": "file-zip",
      "rar": "file-zip",
      "7z": "file-zip",
      // Binaries
      "exe": "file-binary",
      "dll": "file-binary",
      "so": "file-binary",
      "dylib": "file-binary"
    };
    return iconMap[extension || ""] || "file";
  }
};
var ReviewItem = class extends vscode.TreeItem {
  constructor(label, tooltip, collapsibleState, reviewType, iconPath, isGroup = false, filePath, issueData) {
    super(label, collapsibleState);
    this.label = label;
    this.tooltip = tooltip;
    this.collapsibleState = collapsibleState;
    this.reviewType = reviewType;
    this.iconPath = iconPath;
    this.isGroup = isGroup;
    this.filePath = filePath;
    this.issueData = issueData;
    this.tooltip = tooltip;
    if (iconPath) {
      this.iconPath = iconPath;
    }
    if (reviewType !== "info" && !isGroup && reviewType !== "file") {
      if (["security", "accessibility", "performance"].includes(reviewType)) {
        this.command = {
          command: `autodiff.toggle${reviewType.charAt(0).toUpperCase() + reviewType.slice(1)}Review`,
          title: label,
          arguments: [reviewType]
        };
      } else {
        this.command = {
          command: `autodiff.run${reviewType.charAt(0).toUpperCase() + reviewType.slice(1)}Review`,
          title: label,
          arguments: [reviewType]
        };
      }
    }
    if (reviewType === "base-branch") {
      this.command = {
        command: "autodiff.changeBaseBranch",
        title: "Change base branch",
        arguments: [label]
        // Pass the branch name as argument
      };
    }
    if (reviewType === "branch-comparison") {
      this.command = {
        command: "autodiff.toggleBranchComparison",
        title: "Toggle branch comparison",
        arguments: []
      };
    }
    if (reviewType === "debug-output") {
      this.command = {
        command: "autodiff.toggleDebugOutput",
        title: "Toggle debug output",
        arguments: []
      };
    }
    if (reviewType === "file" && filePath) {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        const fullPath = path.join(workspaceFolder.uri.fsPath, filePath);
        this.command = {
          command: "vscode.open",
          title: "Open file",
          arguments: [vscode.Uri.file(fullPath)]
        };
      }
    }
    if (reviewType === "issue" && issueData && issueData.file_path) {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        const fullPath = path.join(workspaceFolder.uri.fsPath, issueData.file_path);
        const lineNumber = issueData.line_numbers && issueData.line_numbers.length > 0 ? issueData.line_numbers[0] : 1;
        this.command = {
          command: "autodiff.navigateToIssue",
          title: "Navigate to issue",
          arguments: [fullPath, lineNumber - 1]
          // VS Code uses 0-based line numbers
        };
      }
    }
  }
};
async function activate(context) {
  console.log('Congratulations, your extension "autodiff" is now active!');
  const fileDecorationProvider = new AutoDiffFileDecorationProvider();
  const decorationDisposable = vscode.window.registerFileDecorationProvider(fileDecorationProvider);
  context.subscriptions.push(decorationDisposable);
  const sharedData = {
    changedFiles: [],
    reviewResults: /* @__PURE__ */ new Map(),
    selectedReviews: /* @__PURE__ */ new Set(["security"])
    // Default to only security selected
  };
  const branchProvider = new AutoDiffTreeDataProvider("branch", context, fileDecorationProvider);
  const reviewsProvider = new AutoDiffTreeDataProvider("reviews", context, fileDecorationProvider);
  const changesProvider = new AutoDiffTreeDataProvider("changes", context, fileDecorationProvider);
  const resultsProvider = new AutoDiffTreeDataProvider("results", context, fileDecorationProvider);
  const settingsProvider = new AutoDiffTreeDataProvider("settings", context, fileDecorationProvider);
  [branchProvider, reviewsProvider, changesProvider, resultsProvider, settingsProvider].forEach((provider) => {
    provider.setSharedData(sharedData);
  });
  await reviewsProvider.loadInitialData();
  fileDecorationProvider.updateChangedFiles(sharedData.changedFiles);
  fileDecorationProvider.updateReviewResults(sharedData.reviewResults);
  const sharedProviders = [branchProvider, reviewsProvider, changesProvider, resultsProvider, settingsProvider];
  const updateFileDecorations = () => {
    fileDecorationProvider.updateChangedFiles(sharedData.changedFiles);
    fileDecorationProvider.updateReviewResults(sharedData.reviewResults);
  };
  vscode.window.createTreeView("autodiffBranchView", {
    treeDataProvider: branchProvider,
    showCollapseAll: false
  });
  vscode.window.createTreeView("autodiffReviewView", {
    treeDataProvider: reviewsProvider,
    showCollapseAll: false
  });
  vscode.window.createTreeView("autodiffChangesView", {
    treeDataProvider: changesProvider,
    showCollapseAll: false
  });
  vscode.window.createTreeView("autodiffResultsView", {
    treeDataProvider: resultsProvider,
    showCollapseAll: false
  });
  vscode.window.createTreeView("autodiffSettingsView", {
    treeDataProvider: settingsProvider,
    showCollapseAll: false
  });
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    const fileSystemWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceFolder, "**/*"),
      false,
      // Don't ignore creates
      true,
      // Ignore changes (we only care about creates/deletes for the changes view)
      false
      // Don't ignore deletes
    );
    fileSystemWatcher.onDidCreate(() => {
      sharedProviders.forEach((provider) => provider.refresh());
      updateFileDecorations();
    });
    fileSystemWatcher.onDidDelete(() => {
      sharedProviders.forEach((provider) => provider.refresh());
      updateFileDecorations();
    });
    context.subscriptions.push(fileSystemWatcher);
  }
  const disposable = vscode.commands.registerCommand("autodiff.helloWorld", () => {
    vscode.window.showInformationMessage("Hello World from autodiff!");
  });
  const securityReviewDisposable = vscode.commands.registerCommand("autodiff.runSecurityReview", async () => {
    reviewsProvider.clearReviewResults(["security"]);
    updateFileDecorations();
    await runAutoDiffReview(["security"], reviewsProvider, sharedProviders, updateFileDecorations);
  });
  const accessibilityReviewDisposable = vscode.commands.registerCommand("autodiff.runAccessibilityReview", async () => {
    reviewsProvider.clearReviewResults(["accessibility"]);
    updateFileDecorations();
    await runAutoDiffReview(["accessibility"], reviewsProvider, sharedProviders, updateFileDecorations);
  });
  const performanceReviewDisposable = vscode.commands.registerCommand("autodiff.runPerformanceReview", async () => {
    reviewsProvider.clearReviewResults(["performance"]);
    updateFileDecorations();
    await runAutoDiffReview(["performance"], reviewsProvider, sharedProviders, updateFileDecorations);
  });
  const customReviewDisposable = vscode.commands.registerCommand("autodiff.runCustomReview", async () => {
    const selectedModes = await vscode.window.showQuickPick(
      [
        { label: "Security", picked: true },
        { label: "Accessibility", picked: false },
        { label: "Performance", picked: false }
      ],
      {
        canPickMany: true,
        placeHolder: "Select review modes"
      }
    );
    if (selectedModes && selectedModes.length > 0) {
      const modes = selectedModes.map((mode) => mode.label.toLowerCase());
      reviewsProvider.clearReviewResults(modes);
      updateFileDecorations();
      await runAutoDiffReview(modes, reviewsProvider, sharedProviders, updateFileDecorations);
    }
  });
  const comprehensiveReviewDisposable = vscode.commands.registerCommand("autodiff.runComprehensiveReview", async () => {
    const selectedReviews = reviewsProvider.getSelectedReviews();
    if (selectedReviews.length === 0) {
      vscode.window.showWarningMessage("No reviews selected. Please select at least one review type in the Reviews panel.");
      return;
    }
    reviewsProvider.clearReviewResults(selectedReviews);
    updateFileDecorations();
    await runAutoDiffReview(selectedReviews, reviewsProvider, sharedProviders, updateFileDecorations);
  });
  const changeBaseBranchDisposable = vscode.commands.registerCommand("autodiff.changeBaseBranch", async (branchName) => {
    const config = vscode.workspace.getConfiguration("autodiff");
    const currentBranch = config.get("baseBranch", "origin/main");
    if (branchName) {
      if (branchName === currentBranch) {
        return;
      }
      await config.update("baseBranch", branchName, vscode.ConfigurationTarget.Workspace);
      vscode.window.showInformationMessage(`Base branch changed to: ${branchName}`);
      sharedProviders.forEach((provider) => provider.refresh());
      updateFileDecorations();
    } else {
      const branches = await getAvailableBranches();
      if (branches.length === 0) {
        vscode.window.showWarningMessage("No git branches found.");
        return;
      }
      const selectedBranch = await vscode.window.showQuickPick(
        branches.map((branch) => ({
          label: branch,
          picked: branch === currentBranch,
          description: branch === currentBranch ? "(current)" : ""
        })),
        {
          placeHolder: `Select base branch to compare against (current: ${currentBranch})`
        }
      );
      if (selectedBranch) {
        await config.update("baseBranch", selectedBranch.label, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Base branch changed to: ${selectedBranch.label}`);
        sharedProviders.forEach((provider) => provider.refresh());
        updateFileDecorations();
      }
    }
  });
  const refreshViewDisposable = vscode.commands.registerCommand("autodiff.refreshView", () => {
    sharedProviders.forEach((provider) => provider.refresh());
    updateFileDecorations();
  });
  const settingsDisposable = vscode.commands.registerCommand("autodiff.runSettingsReview", async () => {
    await vscode.commands.executeCommand("workbench.action.openSettings", "autodiff");
  });
  const toggleChangesViewDisposable = vscode.commands.registerCommand("autodiff.toggleChangesView", async () => {
    const config = vscode.workspace.getConfiguration("autodiff");
    const currentValue = config.get("showChangesView", true);
    await config.update("showChangesView", !currentValue, vscode.ConfigurationTarget.Workspace);
    vscode.window.showInformationMessage(`Changes view ${!currentValue ? "enabled" : "disabled"}`);
  });
  const toggleResultsViewDisposable = vscode.commands.registerCommand("autodiff.toggleResultsView", async () => {
    const config = vscode.workspace.getConfiguration("autodiff");
    const currentValue = config.get("showResultsView", true);
    await config.update("showResultsView", !currentValue, vscode.ConfigurationTarget.Workspace);
    vscode.window.showInformationMessage(`Results view ${!currentValue ? "enabled" : "disabled"}`);
  });
  const toggleSettingsViewDisposable = vscode.commands.registerCommand("autodiff.toggleSettingsView", async () => {
    const config = vscode.workspace.getConfiguration("autodiff");
    const currentValue = config.get("showSettingsView", false);
    await config.update("showSettingsView", !currentValue, vscode.ConfigurationTarget.Workspace);
    vscode.window.showInformationMessage(`Settings view ${!currentValue ? "enabled" : "disabled"}`);
  });
  const toggleSecurityReviewDisposable = vscode.commands.registerCommand("autodiff.toggleSecurityReview", () => {
    reviewsProvider.toggleReviewSelection("security");
    sharedProviders.forEach((provider) => provider.refresh());
    updateFileDecorations();
  });
  const toggleAccessibilityReviewDisposable = vscode.commands.registerCommand("autodiff.toggleAccessibilityReview", () => {
    reviewsProvider.toggleReviewSelection("accessibility");
    sharedProviders.forEach((provider) => provider.refresh());
    updateFileDecorations();
  });
  const togglePerformanceReviewDisposable = vscode.commands.registerCommand("autodiff.togglePerformanceReview", () => {
    reviewsProvider.toggleReviewSelection("performance");
    sharedProviders.forEach((provider) => provider.refresh());
    updateFileDecorations();
  });
  const toggleBranchComparisonDisposable = vscode.commands.registerCommand("autodiff.toggleBranchComparison", async () => {
    const config = vscode.workspace.getConfiguration("autodiff");
    const currentValue = config.get("enableBranchComparison", true);
    await config.update("enableBranchComparison", !currentValue, vscode.ConfigurationTarget.Workspace);
    sharedProviders.forEach((provider) => provider.refresh());
    vscode.window.showInformationMessage(
      `Branch comparison ${!currentValue ? "enabled" : "disabled"}. ${!currentValue ? "Will compare against base branch." : "Will only check staged/unstaged changes."}`
    );
  });
  const toggleDebugOutputDisposable = vscode.commands.registerCommand("autodiff.toggleDebugOutput", async () => {
    const config = vscode.workspace.getConfiguration("autodiff");
    const currentValue = config.get("enableDebugOutput", false);
    await config.update("enableDebugOutput", !currentValue, vscode.ConfigurationTarget.Workspace);
    sharedProviders.forEach((provider) => provider.refresh());
    vscode.window.showInformationMessage(
      `Debug output ${!currentValue ? "enabled" : "disabled"}. ${!currentValue ? "Console output will be shown during analysis." : "Console output will be hidden."}`
    );
  });
  const navigateToIssueDisposable = vscode.commands.registerCommand("autodiff.navigateToIssue", async (filePath, lineNumber) => {
    try {
      const document = await vscode.workspace.openTextDocument(filePath);
      const editor = await vscode.window.showTextDocument(document);
      const position = new vscode.Position(lineNumber, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open file: ${error}`);
    }
  });
  context.subscriptions.push(
    disposable,
    securityReviewDisposable,
    accessibilityReviewDisposable,
    performanceReviewDisposable,
    customReviewDisposable,
    comprehensiveReviewDisposable,
    changeBaseBranchDisposable,
    refreshViewDisposable,
    settingsDisposable,
    toggleChangesViewDisposable,
    toggleResultsViewDisposable,
    toggleSettingsViewDisposable,
    toggleSecurityReviewDisposable,
    toggleAccessibilityReviewDisposable,
    togglePerformanceReviewDisposable,
    toggleBranchComparisonDisposable,
    toggleDebugOutputDisposable,
    navigateToIssueDisposable
  );
}
function parseReviewResults(output) {
  const results = [];
  const lines = output.split("\n");
  let currentIssue = {};
  let inIssueBlock = false;
  let currentFile = "";
  for (const line of lines) {
    const trimmedLine = line.trim();
    const fileMatch = trimmedLine.match(/^### `(.+?)`/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }
    const issueMatch = trimmedLine.match(/^[🔒🌐⚡🎨🔧📱💻⚠️✨🛡️🚀💡🔍📊🎯🔄📈🔥💎⭐🎉🎊🌟💯🎪🎭🎨🎬🎮🎲🎯🎨🎪]+\s*\*\*Issue:\*\*\s*(.+)/);
    if (issueMatch) {
      if (inIssueBlock && currentIssue.issue) {
        currentIssue.file = currentFile;
        results.push({ ...currentIssue });
      }
      currentIssue = { issue: issueMatch[1] };
      inIssueBlock = true;
      continue;
    }
    if (inIssueBlock && trimmedLine.startsWith("**")) {
      const match = trimmedLine.match(/\*\*(.+?):\*\*\s*(.+)/);
      if (match) {
        const field = match[1].toLowerCase().replace(/\s+/g, "_");
        const value = match[2];
        switch (field) {
          case "severity":
            currentIssue.severity = value;
            break;
          case "confidence":
            currentIssue.confidence = value;
            break;
          case "line_number":
            currentIssue.line_number = value;
            break;
          case "code":
            currentIssue.code = value;
            break;
          case "suggestion":
            currentIssue.suggestion = value;
            break;
          case "file":
            currentIssue.file = value;
            break;
        }
      }
    }
  }
  if (inIssueBlock && currentIssue.issue) {
    currentIssue.file = currentFile || currentIssue.file;
    results.push({ ...currentIssue });
  }
  return results;
}
async function getAvailableBranches() {
  return new Promise((resolve) => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      resolve([]);
      return;
    }
    cp.exec("git rev-parse --git-dir", { cwd: workspaceFolder.uri.fsPath }, (error) => {
      if (error) {
        resolve([]);
        return;
      }
      cp.exec('git branch -a --format="%(refname:short)"', { cwd: workspaceFolder.uri.fsPath }, (error2, stdout) => {
        if (error2) {
          cp.exec("git branch -r && git branch", { cwd: workspaceFolder.uri.fsPath }, (error22, stdout2) => {
            if (error22) {
              resolve([]);
              return;
            }
            const branches2 = stdout2.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("*") && !line.includes("HEAD")).map((line) => line.replace(/^remotes\//, "")).sort();
            resolve([...new Set(branches2)]);
          });
          return;
        }
        const branches = stdout.split("\n").map((line) => line.trim()).filter((line) => line && !line.includes("HEAD")).map((line) => {
          if (line.startsWith("origin/")) {
            return line;
          }
          return line;
        }).sort();
        resolve([...new Set(branches)]);
      });
    });
  });
}
async function branchExists(branchName, workspacePath) {
  return new Promise((resolve) => {
    cp.exec(
      `git show-ref --verify --quiet refs/heads/${branchName} || git show-ref --verify --quiet refs/remotes/${branchName}`,
      { cwd: workspacePath },
      (error) => {
        resolve(!error);
      }
    );
  });
}
async function runAutoDiffReview(modes, provider, sharedProviders, updateFileDecorations) {
  if (!await isPythonAvailable()) {
    vscode.window.showErrorMessage("Python is not installed or not available in PATH. Please install Python to use AutoDiff.");
    return;
  }
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("No workspace folder found. Please open a folder or workspace.");
    return;
  }
  vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Running AutoDiff analysis...",
    cancellable: false
  }, async (progress) => {
    try {
      const diffContent = await getGitDiff(workspaceFolder.uri.fsPath);
      const untrackedFiles = await getUntrackedFiles(workspaceFolder.uri.fsPath);
      const hasTrackedChanges = diffContent && diffContent.trim();
      const hasUntrackedFiles = untrackedFiles.length > 0;
      if (!hasTrackedChanges && !hasUntrackedFiles) {
        vscode.window.showInformationMessage("No git changes found to review. Make some changes to your files first, then try again.");
        return;
      }
      const config = vscode.workspace.getConfiguration("autodiff");
      const llmProvider = config.get("llmProvider", "copilot");
      const enableLLMAnalysis = config.get("enableLLMAnalysis", false);
      const chatgptApiKey = config.get("openaiApiKey", "");
      const geminiApiKey = config.get("geminiApiKey", "");
      const baseBranch = config.get("baseBranch", "origin/main");
      const enableDebugOutput = config.get("enableDebugOutput", false);
      let outputChannel = null;
      if (enableDebugOutput) {
        outputChannel = vscode.window.createOutputChannel("AutoDiff Results");
        outputChannel.show();
        outputChannel.appendLine("=== AutoDiff Analysis Starting ===\n");
        outputChannel.appendLine(`Working directory: ${workspaceFolder.uri.fsPath}
`);
        if (hasTrackedChanges) {
          outputChannel.appendLine(`\u{1F4DD} Found tracked changes to review
`);
        }
        if (hasUntrackedFiles) {
          outputChannel.appendLine(`\u{1F4C2} Found ${untrackedFiles.length} untracked files: ${untrackedFiles.join(", ")}
`);
        }
      }
      const extensionPath = path.dirname(path.dirname(__filename));
      const backendPath = path.join(extensionPath, "backend");
      const pythonScript = path.join(backendPath, "main.py");
      const args = [
        "--modes",
        ...modes,
        "--output",
        "json",
        // Use JSON output for structured data
        "--base",
        baseBranch
      ];
      if (hasUntrackedFiles) {
        args.push("--include-untracked");
        if (outputChannel) {
          outputChannel.appendLine(`\u{1F50D} Including untracked files in analysis
`);
        }
      }
      if (!enableLLMAnalysis) {
        args.push("--dry-run");
        if (outputChannel) {
          outputChannel.appendLine("\u2139\uFE0F  Running in dry-run mode (LLM analysis disabled). Enable in settings to get actual analysis.\n");
        }
      } else if (llmProvider === "chatgpt" && !chatgptApiKey) {
        args.push("--dry-run");
        if (outputChannel) {
          outputChannel.appendLine("\u2139\uFE0F  Running in dry-run mode (ChatGPT API key not configured). Set API key in settings for actual analysis.\n");
        }
      } else if (llmProvider === "gemini" && !geminiApiKey) {
        args.push("--dry-run");
        if (outputChannel) {
          outputChannel.appendLine("\u2139\uFE0F  Running in dry-run mode (Gemini API key not configured). Set API key in settings for actual analysis.\n");
        }
      } else if (llmProvider === "copilot") {
        try {
          if (outputChannel) {
            outputChannel.appendLine("\u{1F916} Using GitHub Copilot for analysis...\n");
          }
          const analysisResult = await runCopilotAnalysis(modes, diffContent, outputChannel || vscode.window.createOutputChannel("AutoDiff Results"));
          if (analysisResult) {
            args.push("--llm-result", analysisResult);
            args.push("--provider", llmProvider);
          } else {
            args.push("--dry-run");
            if (outputChannel) {
              outputChannel.appendLine("\u26A0\uFE0F  Copilot analysis failed, falling back to dry-run mode.\n");
              outputChannel.appendLine("\u{1F4A1} GitHub Copilot integration is coming soon! For now, try OpenAI provider with an API key.\n");
            }
          }
        } catch (error) {
          if (outputChannel) {
            outputChannel.appendLine(`\u26A0\uFE0F  Copilot analysis error: ${error}
`);
            outputChannel.appendLine("\u{1F4A1} GitHub Copilot integration is coming soon! For now, try ChatGPT or Gemini provider with an API key.\n");
          }
          args.push("--dry-run");
        }
      } else if (llmProvider === "claude") {
        args.push("--dry-run");
        if (outputChannel) {
          outputChannel.appendLine("\u2139\uFE0F  Running in dry-run mode (Claude provider not yet implemented).\n");
          outputChannel.appendLine("\u{1F4A1} Anthropic Claude support is planned for a future release. For now, try ChatGPT or Gemini provider.\n");
        }
      } else {
        args.push("--provider", llmProvider);
        if (llmProvider === "chatgpt" && chatgptApiKey) {
          args.push("--chatgpt-api-key", chatgptApiKey);
        } else if (llmProvider === "gemini" && geminiApiKey) {
          args.push("--gemini-api-key", geminiApiKey);
        }
        if (outputChannel) {
          outputChannel.appendLine(`\u{1F916} Using ${llmProvider.charAt(0).toUpperCase() + llmProvider.slice(1)} provider for analysis...
`);
        }
      }
      const pythonOutput = await runPythonScript(pythonScript, args, workspaceFolder.uri.fsPath, outputChannel || vscode.window.createOutputChannel("AutoDiff Results"));
      if (provider && pythonOutput) {
        let jsonString = pythonOutput.trim();
        const jsonStart = pythonOutput.indexOf("{");
        const jsonEnd = pythonOutput.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          jsonString = pythonOutput.substring(jsonStart, jsonEnd + 1);
        }
        const analysisResult = DTOUtils.parseFromJSON(jsonString);
        if (analysisResult) {
          if (outputChannel) {
            outputChannel.appendLine(`\u{1F4CA} Analysis complete: ${analysisResult.total_issues} issues found across ${analysisResult.files.length} files
`);
          }
          provider.updateReviewResultsFromDTO(analysisResult, modes);
        } else {
          const results = parseReviewResults(pythonOutput);
          if (outputChannel) {
            outputChannel.appendLine(`\u{1F4CA} Analysis complete: ${results.length} issues found (legacy format)
`);
          }
          if (results.length > 0) {
            if (modes.length === 1) {
              provider.updateReviewResults(modes[0], results);
            } else {
              for (const reviewType of modes) {
                provider.updateReviewResults(reviewType, results);
              }
            }
          } else {
            for (const reviewType of modes) {
              provider.updateReviewResults(reviewType, []);
            }
          }
        }
        if (sharedProviders) {
          sharedProviders.forEach((sharedProvider) => {
            sharedProvider.refresh();
          });
        }
        if (updateFileDecorations) {
          updateFileDecorations();
        }
      }
    } catch (error) {
      let errorMessage = `AutoDiff analysis failed: ${error}`;
      let showErrorMessage = true;
      const errorStr = String(error).toLowerCase();
      if (errorStr.includes("quota") || errorStr.includes("rate limit") || errorStr.includes("429")) {
        if (errorStr.includes("gemini")) {
          errorMessage = "Gemini API quota exceeded. Try switching to ChatGPT provider or wait for quota reset.";
          vscode.window.showWarningMessage(errorMessage, "Open Settings", "Switch to ChatGPT").then((selection) => {
            if (selection === "Open Settings") {
              vscode.commands.executeCommand("workbench.action.openSettings", "autodiff.llmProvider");
            } else if (selection === "Switch to ChatGPT") {
              const config = vscode.workspace.getConfiguration("autodiff");
              config.update("llmProvider", "chatgpt", vscode.ConfigurationTarget.Workspace);
              vscode.window.showInformationMessage("LLM provider switched to ChatGPT. Please set your OpenAI API key in settings.");
            }
          });
          showErrorMessage = false;
        } else if (errorStr.includes("openai") || errorStr.includes("chatgpt")) {
          errorMessage = "OpenAI API rate limit exceeded. Try switching to Gemini provider or wait for rate limit reset.";
          vscode.window.showWarningMessage(errorMessage, "Open Settings", "Switch to Gemini").then((selection) => {
            if (selection === "Open Settings") {
              vscode.commands.executeCommand("workbench.action.openSettings", "autodiff.llmProvider");
            } else if (selection === "Switch to Gemini") {
              const config = vscode.workspace.getConfiguration("autodiff");
              config.update("llmProvider", "gemini", vscode.ConfigurationTarget.Workspace);
              vscode.window.showInformationMessage("LLM provider switched to Gemini. Please set your Gemini API key in settings.");
            }
          });
          showErrorMessage = false;
        }
      } else if (errorStr.includes("timeout") || errorStr.includes("connection") || errorStr.includes("network")) {
        errorMessage = "Network timeout or connection error. Please check your internet connection and try again.";
        vscode.window.showWarningMessage(errorMessage, "Try Again", "Switch Provider").then((selection) => {
          if (selection === "Try Again") {
            runAutoDiffReview(modes, provider, sharedProviders, updateFileDecorations);
          } else if (selection === "Switch Provider") {
            vscode.commands.executeCommand("workbench.action.openSettings", "autodiff.llmProvider");
          }
        });
        showErrorMessage = false;
      } else if (errorStr.includes("server error") || errorStr.includes("500") || errorStr.includes("502") || errorStr.includes("503") || errorStr.includes("service unavailable")) {
        const providerName = errorStr.includes("gemini") ? "Gemini" : errorStr.includes("openai") ? "OpenAI" : "API";
        errorMessage = `${providerName} servers are experiencing issues (${errorStr.includes("503") ? "service unavailable" : "server error"}). This is usually temporary.`;
        vscode.window.showWarningMessage(errorMessage, "Try Again", "Switch Provider", "Run Dry-Run").then((selection) => {
          if (selection === "Try Again") {
            setTimeout(() => {
              runAutoDiffReview(modes, provider, sharedProviders, updateFileDecorations);
            }, 3e3);
          } else if (selection === "Switch Provider") {
            vscode.commands.executeCommand("workbench.action.openSettings", "autodiff.llmProvider");
          } else if (selection === "Run Dry-Run") {
            const config = vscode.workspace.getConfiguration("autodiff");
            const originalValue = config.get("enableLLMAnalysis", false);
            config.update("enableLLMAnalysis", false, vscode.ConfigurationTarget.Workspace).then(() => {
              runAutoDiffReview(modes, provider, sharedProviders, updateFileDecorations).finally(() => {
                config.update("enableLLMAnalysis", originalValue, vscode.ConfigurationTarget.Workspace);
              });
            });
          }
        });
        showErrorMessage = false;
      } else if (errorStr.includes("unauthorized") || errorStr.includes("invalid api key") || errorStr.includes("authentication")) {
        const providerName = errorStr.includes("gemini") ? "Gemini" : errorStr.includes("openai") ? "OpenAI" : "API";
        errorMessage = `${providerName} API key is invalid or missing. Please check your API key in settings.`;
        vscode.window.showErrorMessage(errorMessage, "Open Settings").then((selection) => {
          if (selection === "Open Settings") {
            vscode.commands.executeCommand("workbench.action.openSettings", "autodiff");
          }
        });
        showErrorMessage = false;
      }
      if (showErrorMessage) {
        vscode.window.showErrorMessage(errorMessage);
      }
      console.error("AutoDiff Error:", error);
    }
  });
}
async function isPythonAvailable() {
  return new Promise((resolve) => {
    cp.exec("python --version", (error) => {
      if (error) {
        cp.exec("python3 --version", (error2) => {
          resolve(!error2);
        });
      } else {
        resolve(true);
      }
    });
  });
}
async function getGitDiff(workspacePath) {
  return new Promise(async (resolve, reject) => {
    cp.exec("git rev-parse --git-dir", { cwd: workspacePath }, (error) => {
      if (error) {
        reject(`Not a git repository. Please open a folder that contains a git repository.`);
        return;
      }
      const config = vscode.workspace.getConfiguration("autodiff");
      const baseBranch = config.get("baseBranch", "origin/main");
      const enableBranchComparison = config.get("enableBranchComparison", true);
      cp.exec("git diff --staged", { cwd: workspacePath }, async (error2, stdout, stderr) => {
        if (!error2 && stdout.trim()) {
          resolve(stdout);
          return;
        }
        if (enableBranchComparison) {
          const branchExistsResult = await branchExists(baseBranch, workspacePath);
          if (!branchExistsResult) {
            reject(`Base branch '${baseBranch}' does not exist. Please select a valid branch or disable branch comparison in settings.`);
            return;
          }
          cp.exec(`git diff ${baseBranch}`, { cwd: workspacePath }, (error22, stdout2, stderr2) => {
            if (!error22 && stdout2.trim()) {
              resolve(stdout2);
              return;
            }
            tryLocalChanges();
          });
        } else {
          tryLocalChanges();
        }
        function tryLocalChanges() {
          cp.exec("git diff", { cwd: workspacePath }, (error3, stdout3, stderr3) => {
            if (!error3 && stdout3.trim()) {
              resolve(stdout3);
              return;
            }
            cp.exec("git diff HEAD", { cwd: workspacePath }, (error4, stdout4, stderr4) => {
              if (!error4 && stdout4.trim()) {
                resolve(stdout4);
                return;
              }
              resolve("");
            });
          });
        }
      });
    });
  });
}
async function getUntrackedFiles(workspacePath) {
  return new Promise((resolve, reject) => {
    cp.exec("git ls-files --others --exclude-standard", { cwd: workspacePath }, (error, stdout, stderr) => {
      if (error) {
        console.log("Error getting untracked files:", error);
        resolve([]);
        return;
      }
      const untrackedFiles = stdout.trim().split("\n").filter((line) => line.trim().length > 0).filter((file) => {
        const excludePatterns = [
          ".DS_Store",
          "node_modules/",
          ".git/",
          "*.log",
          "*.tmp",
          "*.temp"
        ];
        return !excludePatterns.some((pattern) => {
          if (pattern.includes("*")) {
            const regex = new RegExp(pattern.replace("*", ".*"));
            return regex.test(file);
          }
          return file.includes(pattern);
        });
      });
      resolve(untrackedFiles);
    });
  });
}
async function runPythonScript(scriptPath, args, cwd, outputChannel) {
  return new Promise((resolve, reject) => {
    const pythonCommand = "python3";
    const child = cp.spawn(pythonCommand, [scriptPath, ...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let outputData = "";
    let errorData = "";
    child.stdout?.on("data", (data) => {
      const output = data.toString();
      outputData += output;
      outputChannel.append(output);
    });
    child.stderr?.on("data", (data) => {
      const error = data.toString();
      errorData += error;
      outputChannel.append(`Error: ${error}`);
    });
    child.on("close", (code) => {
      if (code === 0) {
        outputChannel.appendLine("\n=== AutoDiff Analysis Complete ===");
        resolve(outputData);
      } else {
        outputChannel.appendLine(`
=== AutoDiff Analysis Failed (exit code: ${code}) ===`);
        reject(`Python script failed with exit code: ${code}
${errorData}`);
      }
    });
    child.on("error", (error) => {
      if (pythonCommand === "python3") {
        const fallbackChild = cp.spawn("python", [scriptPath, ...args], {
          cwd,
          stdio: ["pipe", "pipe", "pipe"]
        });
        let fallbackOutput = "";
        let fallbackError = "";
        fallbackChild.stdout?.on("data", (data) => {
          const output = data.toString();
          fallbackOutput += output;
          outputChannel.append(output);
        });
        fallbackChild.stderr?.on("data", (data) => {
          const error2 = data.toString();
          fallbackError += error2;
          outputChannel.append(`Error: ${error2}`);
        });
        fallbackChild.on("close", (code) => {
          if (code === 0) {
            outputChannel.appendLine("\n=== AutoDiff Analysis Complete ===");
            resolve(fallbackOutput);
          } else {
            outputChannel.appendLine(`
=== AutoDiff Analysis Failed (exit code: ${code}) ===`);
            reject(`Python script failed with exit code: ${code}
${fallbackError}`);
          }
        });
        fallbackChild.on("error", (fallbackError2) => {
          reject(`Failed to execute Python script: ${fallbackError2.message}`);
        });
      } else {
        reject(`Failed to execute Python script: ${error.message}`);
      }
    });
  });
}
function deactivate() {
}
function processUserInput(userInput) {
  const result = eval(userInput);
  return result;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
