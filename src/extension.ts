// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AnalysisResultDTO, FileAnalysisDTO, IssueDTO, DTOUtils, Severity, ReviewType } from './dto';

// Add function to handle Copilot analysis
async function runCopilotAnalysis(modes: string[], diffContent: string, outputChannel: vscode.OutputChannel): Promise<string | null> {
	try {
		// Check if Language Model API is available
		if (!vscode.lm || !vscode.lm.selectChatModels) {
			outputChannel.appendLine('❌ VS Code Language Model API not available.\n');
			outputChannel.appendLine('   This feature requires VS Code 1.90+ and the experimental Language Model API.\n');
			outputChannel.appendLine('   GitHub Copilot integration is coming soon once the API becomes stable!\n');
			return null;
		}

		// Get available Copilot models
		const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });

		if (models.length === 0) {
			outputChannel.appendLine('❌ No GitHub Copilot models available.\n');
			outputChannel.appendLine('   Please make sure you have GitHub Copilot enabled and signed in.\n');
			outputChannel.appendLine('   Note: Copilot integration is experimental and may not be available in all VS Code versions.\n');
			return null;
		}

		// Log all available models for debugging
		outputChannel.appendLine(`🔍 Available Copilot models: ${models.length}\n`);
		for (let i = 0; i < models.length; i++) {
			const m = models[i];
			outputChannel.appendLine(`   ${i}: ${m.name} (${m.vendor}/${m.family}) - Max tokens: ${m.maxInputTokens}\n`);
		}

		// Try to find Claude/Anthropic model if available, otherwise use first available
		let selectedModel = models[0];
		const claudeModel = models.find(m =>
			m.name.toLowerCase().includes('claude') ||
			m.name.toLowerCase().includes('sonnet') ||
			m.family.toLowerCase().includes('claude') ||
			m.family.toLowerCase().includes('anthropic')
		);

		if (claudeModel) {
			selectedModel = claudeModel;
			outputChannel.appendLine(`🎯 Found Claude model: ${selectedModel.name}\n`);
		} else {
			outputChannel.appendLine(`⚠️  No Claude model found, using: ${selectedModel.name}\n`);
		}

		outputChannel.appendLine(`📡 Using model: ${selectedModel.name} (${selectedModel.vendor}/${selectedModel.family})\n`);

		// Build the prompt from the Python backend's templates
		const extensionPath = path.dirname(path.dirname(__filename));
		const backendPath = path.join(extensionPath, 'backend');

		// Load prompt templates for selected modes
		let prompt = '';
		for (const mode of modes) {
			const promptPath = path.join(backendPath, 'prompts', `${mode}.md`);
			if (fs.existsSync(promptPath)) {
				const promptTemplate = fs.readFileSync(promptPath, 'utf-8');
				prompt += promptTemplate + '\n\n';
			}
		}

		// Add the diff to the prompt
		prompt += `---\n\n### Git Diff\n\n\`\`\`diff\n${diffContent}\n\`\`\``;

		// Make the request to Copilot
		const cancellationTokenSource = new vscode.CancellationTokenSource();
		const chatResponse = await selectedModel.sendRequest([
			vscode.LanguageModelChatMessage.User(prompt)
		], {}, cancellationTokenSource.token);

		let responseText = '';
		for await (const fragment of chatResponse.text) {
			responseText += fragment;
		}

		outputChannel.appendLine('✅ Copilot analysis completed successfully.\n');
		return responseText;

	} catch (error: any) {
		if (error instanceof vscode.LanguageModelError) {
			outputChannel.appendLine(`❌ Copilot error: ${error.message} (${error.code})\n`);
			if (error.cause) {
				outputChannel.appendLine(`   Cause: ${error.cause}\n`);
			}
			// Common error scenarios
			if (error.code === 'NoPermissions') {
				outputChannel.appendLine('   💡 Try: Make sure GitHub Copilot extension is installed and you are signed in to Copilot.\n');
			} else if (error.code === 'Blocked') {
				outputChannel.appendLine('   💡 The request was blocked. This might be due to content policy restrictions.\n');
			}
		} else {
			outputChannel.appendLine(`❌ Unexpected error: ${error.message}\n`);
		}
		return null;
	}
}

// File decoration provider for review status indicators
class AutoDiffFileDecorationProvider implements vscode.FileDecorationProvider {
	private _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined> = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
	readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> = this._onDidChangeFileDecorations.event;

	private reviewResults: Map<string, any> = new Map();
	private changedFiles: Set<string> = new Set();

	constructor() { }

	updateReviewResults(results: Map<string, any>) {
		this.reviewResults = results;
		this._onDidChangeFileDecorations.fire(undefined); // Refresh all decorations
	}

	updateChangedFiles(files: string[]) {
		this.changedFiles = new Set(files);
		this._onDidChangeFileDecorations.fire(undefined); // Refresh all decorations
	}

	provideFileDecoration(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FileDecoration> {
		// Get relative path for the file
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
		if (!workspaceFolder) {
			return undefined;
		}

		const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);

		// Only show decorations for changed files
		if (!this.changedFiles.has(relativePath)) {
			return undefined;
		}

		const fileResult = this.reviewResults.get(relativePath);

		if (fileResult && Object.keys(fileResult.results).length > 0) {
			// File has review results - show status based on results
			const reviewTypes = ['security', 'accessibility', 'performance', 'quality'];
			let hasFailures = false;
			let hasWarnings = false;
			let hasPass = false;

			for (const reviewType of reviewTypes) {
				const result = fileResult.results[reviewType];
				if (result) {
					switch (result.status) {
						case 'fail':
							hasFailures = true;
							break;
						case 'warning':
							hasWarnings = true;
							break;
						case 'pass':
							hasPass = true;
							break;
					}
				}
			}

			// Determine badge based on worst status
			if (hasFailures) {
				return {
					badge: '❌',
					tooltip: 'Review found issues',
					propagate: false
				};
			} else if (hasWarnings) {
				return {
					badge: '⚠️',
					tooltip: 'Review found warnings',
					propagate: false
				};
			} else if (hasPass) {
				return {
					badge: '✅',
					tooltip: 'Review passed',
					propagate: false
				};
			}
		} else {
			// No review results yet - show neutral indicator
			return {
				badge: '○',
				tooltip: 'Not reviewed yet',
				propagate: false
			};
		}

		return undefined;
	}
}

// Interface for review results tracking
interface FileReviewResult {
	file: string;
	results: {
		[reviewType: string]: {
			status: 'pass' | 'fail' | 'warning';
			confidence: number;
			issues: number;
			issueDetails?: IssueDTO[]; // Store individual issues for detailed view
		}
	};
}

// TreeDataProvider for the AutoDiff sidebar
class AutoDiffTreeDataProvider implements vscode.TreeDataProvider<ReviewItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<ReviewItem | undefined | null | void> = new vscode.EventEmitter<ReviewItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<ReviewItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private changedFiles: string[] = [];
	private reviewResults: Map<string, any> = new Map();
	private selectedReviews: Set<string> = new Set(['security']); // Default to only security selected
	private viewType: string;
	private context: vscode.ExtensionContext;
	private fileDecorationProvider?: AutoDiffFileDecorationProvider;
	private sharedData?: { changedFiles: string[], reviewResults: Map<string, any>, selectedReviews: Set<string> };

	constructor(viewType: string, context: vscode.ExtensionContext, fileDecorationProvider?: AutoDiffFileDecorationProvider) {
		this.viewType = viewType;
		this.context = context;
		this.fileDecorationProvider = fileDecorationProvider;
		this.loadSelectedReviews();
		this.loadChangedFiles();
	}

	setSharedData(sharedData: { changedFiles: string[], reviewResults: Map<string, any>, selectedReviews: Set<string> }): void {
		// Replace instance data with shared references
		this.changedFiles = sharedData.changedFiles;
		this.reviewResults = sharedData.reviewResults;
		this.selectedReviews = sharedData.selectedReviews;

		// Store shared data reference for later use
		this.sharedData = sharedData;
	}

	// Initialize shared data once
	async loadInitialData() {
		if (this.sharedData && this.sharedData.changedFiles.length === 0) {
			// Load changed files into shared data
			const files = await this.loadChangedFiles();
			this.sharedData.changedFiles.splice(0, this.sharedData.changedFiles.length, ...files);
		}
	}

	private loadSelectedReviews(): void {
		// Load selected reviews from workspace state, defaulting to only security
		const saved = this.context.workspaceState.get<string[]>('autodiff.selectedReviews', ['security']);
		this.selectedReviews = new Set(saved);
	}

	private saveSelectedReviews(): void {
		// Save selected reviews to workspace state
		this.context.workspaceState.update('autodiff.selectedReviews', Array.from(this.selectedReviews));
	}

	toggleReviewSelection(reviewType: string) {
		if (this.selectedReviews.has(reviewType)) {
			this.selectedReviews.delete(reviewType);
		} else {
			this.selectedReviews.add(reviewType);
		}
		this.saveSelectedReviews();
		this._onDidChangeTreeData.fire();
	}

	getSelectedReviews(): string[] {
		return Array.from(this.selectedReviews);
	}

	getReviewResults(): Map<string, any> {
		return this.reviewResults;
	}

	refresh(): void {
		this.loadChangedFiles();
		this._onDidChangeTreeData.fire();
	}

	private async loadChangedFiles(): Promise<string[]> {
		try {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				this.changedFiles = [];
				return this.changedFiles;
			}

			// Gracefully handle case when there are no git changes
			try {
				const files = new Set<string>();

				// Get tracked changed files from git diff
				const diffContent = await getGitDiff(workspaceFolder.uri.fsPath);
				if (diffContent) {
					const filePattern = /^diff --git a\/(.+?) b\/(.+?)$/gm;
					let match;
					while ((match = filePattern.exec(diffContent)) !== null) {
						files.add(match[2]); // Use the "b/" file path (after changes)
					}
				}

				// Also get untracked files
				const untrackedFiles = await getUntrackedFiles(workspaceFolder.uri.fsPath);
				untrackedFiles.forEach((file: string) => {
					// Include all untracked files except git internals
					if (!file.includes('.git/')) {
						files.add(file);
					}
				});

				this.changedFiles = Array.from(files);
			} catch (gitError) {
				// Silently handle git errors - just show empty file list
				console.log('No git changes found:', gitError);
				this.changedFiles = [];
			}
		} catch (error) {
			console.error('Error loading changed files:', error);
			this.changedFiles = [];
		}

		// Update file decorations when changed files are loaded (only if not using shared data)
		if (this.fileDecorationProvider && !this.sharedData) {
			this.fileDecorationProvider.updateChangedFiles(this.changedFiles);
			this.fileDecorationProvider.updateReviewResults(this.reviewResults);
		}

		return this.changedFiles;
	}

	updateReviewResults(reviewType: string, results: any[]): void {
		// Process review results and update file statuses
		for (const file of this.changedFiles) {
			if (!this.reviewResults.has(file)) {
				this.reviewResults.set(file, { file, results: {} });
			}

			const fileResult = this.reviewResults.get(file)!;
			const fileIssues = results.filter(r => r.file === file);

			let status: 'pass' | 'fail' | 'warning' = 'pass';
			let avgConfidence = 100;

			if (fileIssues.length > 0) {
				const hasHighSeverity = fileIssues.some(issue =>
					['critical', 'high'].includes(issue.severity?.toLowerCase())
				);
				const hasLowSeverity = fileIssues.some(issue =>
					['low', 'medium'].includes(issue.severity?.toLowerCase())
				);
				const confidences = fileIssues
					.map(issue => parseInt(issue.confidence?.replace('%', '') || '50'))
					.filter(c => !isNaN(c));

				avgConfidence = confidences.length > 0 ?
					Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 50;

				// Fail (❌): High severity issues OR high confidence issues
				if (hasHighSeverity && avgConfidence >= 70) {
					status = 'fail';
				}
				// Warning (⚠️): Low severity issues OR low confidence issues
				else if (hasLowSeverity || avgConfidence < 70) {
					status = 'warning';
				}
				// Edge case: High severity but very low confidence should still be warning
				else if (hasHighSeverity && avgConfidence < 50) {
					status = 'warning';
				}
				// Default to fail for high severity with medium confidence
				else {
					status = 'fail';
				}
			}

			// Always set the result, even if no issues (status = 'pass')
			fileResult.results[reviewType] = {
				status,
				confidence: avgConfidence,
				issues: fileIssues.length
			};
		}

		// Update file decorations if provider is available
		if (this.fileDecorationProvider) {
			if (this.sharedData) {
				// When using shared data, update from shared data
				this.fileDecorationProvider.updateChangedFiles(this.sharedData.changedFiles);
				this.fileDecorationProvider.updateReviewResults(this.sharedData.reviewResults);
			} else {
				// When not using shared data, update from instance data
				this.fileDecorationProvider.updateReviewResults(this.reviewResults);
			}
		}

		this.refresh();
	}

	// New method to handle DTO-based results
	updateReviewResultsFromDTO(analysisResult: AnalysisResultDTO, reviewTypes: string[]): void {
		// Clear previous results for the review types
		this.clearReviewResults(reviewTypes);

		// Process each file in the analysis result
		for (const fileAnalysis of analysisResult.files) {
			if (!this.reviewResults.has(fileAnalysis.file_path)) {
				this.reviewResults.set(fileAnalysis.file_path, {
					file: fileAnalysis.file_path,
					results: {}
				});
			}

			const fileResult = this.reviewResults.get(fileAnalysis.file_path)!;

			// Group issues by review type
			const issuesByType: { [key: string]: IssueDTO[] } = {};
			for (const issue of fileAnalysis.issues) {
				const reviewType = issue.review_type;
				if (!issuesByType[reviewType]) {
					issuesByType[reviewType] = [];
				}
				issuesByType[reviewType].push(issue);
			}

			// Update results for each review type
			for (const reviewType of reviewTypes) {
				const typeIssues = issuesByType[reviewType] || [];
				let status: 'pass' | 'fail' | 'warning' = 'pass';
				let avgConfidence = 100;

				if (typeIssues.length > 0) {
					const hasHighSeverity = typeIssues.some(issue => issue.severity === Severity.HIGH);
					const hasLowSeverity = typeIssues.some(issue =>
						issue.severity === Severity.LOW || issue.severity === Severity.MEDIUM
					);

					const confidences = typeIssues.map(issue => issue.confidence);
					avgConfidence = confidences.length > 0 ?
						Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 50;

					// Determine status based on severity and confidence
					if (hasHighSeverity && avgConfidence >= 70) {
						status = 'fail';
					} else if (hasLowSeverity || avgConfidence < 70) {
						status = 'warning';
					} else if (hasHighSeverity && avgConfidence < 50) {
						status = 'warning';
					} else {
						status = 'fail';
					}
				}

				fileResult.results[reviewType] = {
					status,
					confidence: avgConfidence,
					issues: typeIssues.length,
					issueDetails: typeIssues // Store individual issues
				};
			}
		}

		// Update file decorations
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
	clearReviewResults(reviewTypes: string[]): void {
		// Clear ALL previous results to avoid confusion when switching between scan types
		for (const file of this.changedFiles) {
			if (this.reviewResults.has(file)) {
				const fileResult = this.reviewResults.get(file)!;
				// Clear ALL review types, not just the selected ones
				fileResult.results = {};

				// If no results remain, remove the file entry
				if (Object.keys(fileResult.results).length === 0) {
					this.reviewResults.delete(file);
				}
			}
		}

		// Update file decorations to reflect cleared results
		if (this.fileDecorationProvider) {
			if (this.sharedData) {
				// When using shared data, update from shared data
				this.fileDecorationProvider.updateChangedFiles(this.sharedData.changedFiles);
				this.fileDecorationProvider.updateReviewResults(this.sharedData.reviewResults);
			} else {
				// When not using shared data, update from instance data
				this.fileDecorationProvider.updateReviewResults(this.reviewResults);
			}
		}

		this.refresh();
	}

	getTreeItem(element: ReviewItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: ReviewItem): Thenable<ReviewItem[]> {
		if (!element) {
			// Root level - show different content based on view type
			switch (this.viewType) {
				case 'branch':
					return this.getBranchChildren();
				case 'reviews':
					return this.getReviewsChildren();
				case 'changes':
					return this.getChangesChildren();
				case 'results':
					return this.getResultsChildren();
				case 'settings':
					return this.getSettingsChildren();
				default:
					return Promise.resolve([]);
			}
		} else if (element.reviewType === 'group') {
			// Handle group expansion in Results view
			return this.getResultsGroupChildren(element.label);
		}
		return Promise.resolve([]);
	}

	private getReviewsChildren(): Thenable<ReviewItem[]> {
		// Reviews view - show checkboxes with selection state
		const isSecuritySelected = this.selectedReviews.has('security');
		const isAccessibilitySelected = this.selectedReviews.has('accessibility');
		const isPerformanceSelected = this.selectedReviews.has('performance');
		const isQualitySelected = this.selectedReviews.has('quality');

		return Promise.resolve([
			new ReviewItem(
				'Security',
				'Scan for security vulnerabilities',
				vscode.TreeItemCollapsibleState.None,
				'security',
				new vscode.ThemeIcon(isSecuritySelected ? 'check' : 'square'),
				false
			),
			new ReviewItem(
				'Accessibility',
				'Check accessibility compliance',
				vscode.TreeItemCollapsibleState.None,
				'accessibility',
				new vscode.ThemeIcon(isAccessibilitySelected ? 'check' : 'square'),
				false
			),
			new ReviewItem(
				'Performance',
				'Analyze performance impact',
				vscode.TreeItemCollapsibleState.None,
				'performance',
				new vscode.ThemeIcon(isPerformanceSelected ? 'check' : 'square'),
				false
			),
			new ReviewItem(
				'Quality',
				'Check code quality and best practices',
				vscode.TreeItemCollapsibleState.None,
				'quality',
				new vscode.ThemeIcon(isQualitySelected ? 'check' : 'square'),
				false
			)
		]);
	}

	private async getBranchChildren(): Promise<ReviewItem[]> {
		// Branch view - show all available branches with current one highlighted
		const config = vscode.workspace.getConfiguration('autodiff');
		const currentBranch = config.get<string>('baseBranch', 'origin/main');

		try {
			const branches = await getAvailableBranches();

			if (branches.length === 0) {
				return [
					new ReviewItem(
						'No branches found',
						'No git branches available',
						vscode.TreeItemCollapsibleState.None,
						'info',
						new vscode.ThemeIcon('warning'),
						false
					)
				];
			}

			// Create branch items with current branch highlighted
			return branches.map(branch => {
				const isCurrent = branch === currentBranch;
				return new ReviewItem(
					branch,
					isCurrent ? 'Current base branch' : 'Click to set as base branch',
					vscode.TreeItemCollapsibleState.None,
					'base-branch',
					new vscode.ThemeIcon(isCurrent ? 'check' : 'git-branch'),
					false
				);
			});
		} catch (error) {
			console.error('Error loading branches:', error);
			return [
				new ReviewItem(
					'Error loading branches',
					'Failed to load git branches',
					vscode.TreeItemCollapsibleState.None,
					'info',
					new vscode.ThemeIcon('error'),
					false
				)
			];
		}
	}

	private getChangesChildren(): Thenable<ReviewItem[]> {
		// Changed files view
		if (this.changedFiles.length === 0) {
			return Promise.resolve([
				new ReviewItem(
					'No changes found',
					'Make some changes to your files to see them here',
					vscode.TreeItemCollapsibleState.None,
					'info',
					new vscode.ThemeIcon('info'),
					false
				)
			]);
		}

		const items = this.changedFiles.map(file => {
			const fileResult = this.reviewResults.get(file);
			const tooltip = `Click to open: ${file}${fileResult ? this.getFileTooltip(fileResult) : '\n\nNo reviews completed yet - run a review to see results here.'}`;

			// Create file URI for proper file icon
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			let fileIcon: vscode.ThemeIcon;

			if (workspaceFolder) {
				const fileUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, file));
				fileIcon = vscode.ThemeIcon.File;
			} else {
				fileIcon = new vscode.ThemeIcon('file');
			}

			const item = new ReviewItem(
				file,  // Clean filename without status indicators
				tooltip,
				vscode.TreeItemCollapsibleState.None,
				'file',
				fileIcon,
				false,
				file
			);

			// Set the resource URI for proper file icon theming and decorations
			if (workspaceFolder) {
				item.resourceUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, file));
			}

			return item;
		});

		return Promise.resolve(items);
	}

	private getResultsChildren(): Thenable<ReviewItem[]> {
		const results = Array.from(this.reviewResults.values());
		if (results.length === 0) {
			return Promise.resolve([
				new ReviewItem(
					'No results yet',
					'Run a review to see results here',
					vscode.TreeItemCollapsibleState.None,
					'info',
					new vscode.ThemeIcon('info'),
					false
				)
			]);
		}

		// Collect all individual issues and track file statuses
		const failedIssues: ReviewItem[] = [];
		const warningIssues: ReviewItem[] = [];
		const fileStatuses = new Map<string, 'fail' | 'warning' | 'pass'>(); // Track worst status per file

		results.forEach(fileResult => {
			let worstStatus: 'fail' | 'warning' | 'pass' = 'pass';

			Object.entries(fileResult.results).forEach(([reviewType, result]: [string, any]) => {
				// Update worst status for this file
				if (result.status === 'fail') {
					worstStatus = 'fail';
				} else if (result.status === 'warning' && worstStatus !== 'fail') {
					worstStatus = 'warning';
				}

				// Collect individual issues
				if (result.issueDetails && result.issueDetails.length > 0) {
					result.issueDetails.forEach((issue: IssueDTO, index: number) => {
						const lineInfo = DTOUtils.formatLineNumbers(issue.line_numbers);
						const item = new ReviewItem(
							`${issue.issue}`,
							`File: ${issue.file_path}\nLine: ${lineInfo}\nSeverity: ${issue.severity}\nConfidence: ${issue.confidence}%\n\nCode: ${issue.code}\n\nSuggestion: ${issue.suggestion}`,
							vscode.TreeItemCollapsibleState.None,
							'issue',
							undefined,
							false,
							issue.file_path,
							issue // Pass the issue data for navigation
						);

						if (result.status === 'fail') {
							failedIssues.push(item);
						} else {
							warningIssues.push(item);
						}
					});
				} else if (result.issues > 0) {
					// Fallback for legacy format without issueDetails
					const item = new ReviewItem(
						`${fileResult.file}`,
						`Issues: ${result.issues}, Confidence: ${result.confidence}%`,
						vscode.TreeItemCollapsibleState.None,
						'result',
						undefined,
						false,
						fileResult.file
					);

					if (result.status === 'fail') {
						failedIssues.push(item);
					} else if (result.status === 'warning') {
						warningIssues.push(item);
					}
				}
			});

			// Store the worst status for this file
			fileStatuses.set(fileResult.file, worstStatus);
		});

		// Create passed files list - only include files that passed ALL reviews
		const passedFiles: ReviewItem[] = [];
		fileStatuses.forEach((status, fileName) => {
			if (status === 'pass') {
				const item = new ReviewItem(
					`${fileName}`,
					`No issues found`,
					vscode.TreeItemCollapsibleState.None,
					'result',
					undefined,
					false,
					fileName
				);
				passedFiles.push(item);
			}
		});

		// Return group headers with counts
		const allResults: ReviewItem[] = [];
		if (failedIssues.length > 0) {
			allResults.push(new ReviewItem(
				`❌ Critical Issues (${failedIssues.length})`,
				'Click to expand and see individual issues',
				vscode.TreeItemCollapsibleState.Expanded,
				'group',
				undefined,
				true
			));
		}
		if (warningIssues.length > 0) {
			allResults.push(new ReviewItem(
				`⚠️ Warnings (${warningIssues.length})`,
				'Click to expand and see individual issues',
				vscode.TreeItemCollapsibleState.Expanded,
				'group',
				undefined,
				true
			));
		}
		if (passedFiles.length > 0) {
			allResults.push(new ReviewItem(
				`✅ Passed (${passedFiles.length})`,
				'Click to expand and see files with no issues',
				vscode.TreeItemCollapsibleState.Expanded,
				'group',
				undefined,
				true
			));
		}

		return Promise.resolve(allResults);
	}

	private getResultsGroupChildren(groupLabel: string): Thenable<ReviewItem[]> {
		const results = Array.from(this.reviewResults.values());
		const groupItems: ReviewItem[] = [];

		if (groupLabel.startsWith('✅')) {
			// For passed files, only show files that passed ALL reviews (no duplicates)
			const fileStatuses = new Map<string, 'fail' | 'warning' | 'pass'>();

			results.forEach(fileResult => {
				let worstStatus: 'fail' | 'warning' | 'pass' = 'pass';

				Object.entries(fileResult.results).forEach(([reviewType, result]: [string, any]) => {
					if (result.status === 'fail') {
						worstStatus = 'fail';
					} else if (result.status === 'warning' && worstStatus !== 'fail') {
						worstStatus = 'warning';
					}
				});

				fileStatuses.set(fileResult.file, worstStatus);
			});

			// Only show files that passed all reviews
			fileStatuses.forEach((status, fileName) => {
				if (status === 'pass') {
					const fileIconName = this.getFileIconName(fileName);
					const item = new ReviewItem(
						`${fileName}`,
						`✅ File passed all reviews: ${fileName}`,
						vscode.TreeItemCollapsibleState.None,
						'file',
						new vscode.ThemeIcon(fileIconName),
						false,
						fileName
					);
					groupItems.push(item);
				}
			});
		} else {
			// For critical issues and warnings, show individual issues
			results.forEach(fileResult => {
				Object.entries(fileResult.results).forEach(([reviewType, result]: [string, any]) => {
					if (groupLabel.startsWith('❌') && result.status === 'fail') {
						// Show individual critical issues
						if (result.issueDetails && result.issueDetails.length > 0) {
							result.issueDetails.forEach((issue: IssueDTO) => {
								const lineInfo = DTOUtils.formatLineNumbers(issue.line_numbers);
								const item = new ReviewItem(
									`${issue.issue}`,
									`File: ${issue.file_path}\nLine: ${lineInfo}\nSeverity: ${issue.severity}\nConfidence: ${issue.confidence}%\n\nCode: ${issue.code}\n\nSuggestion: ${issue.suggestion}`,
									vscode.TreeItemCollapsibleState.None,
									'issue',
									undefined,
									false,
									issue.file_path,
									issue
								);
								groupItems.push(item);
							});
						}
					} else if (groupLabel.startsWith('⚠️') && result.status === 'warning') {
						// Show individual warning issues
						if (result.issueDetails && result.issueDetails.length > 0) {
							result.issueDetails.forEach((issue: IssueDTO) => {
								const lineInfo = DTOUtils.formatLineNumbers(issue.line_numbers);
								const item = new ReviewItem(
									`${issue.issue}`,
									`File: ${issue.file_path}\nLine: ${lineInfo}\nSeverity: ${issue.severity}\nConfidence: ${issue.confidence}%\n\nCode: ${issue.code}\n\nSuggestion: ${issue.suggestion}`,
									vscode.TreeItemCollapsibleState.None,
									'issue',
									undefined,
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

	private getSettingsChildren(): Thenable<ReviewItem[]> {
		const config = vscode.workspace.getConfiguration('autodiff');
		const llmProvider = config.get<string>('llmProvider', 'chatgpt');
		const enableBranchComparison = config.get<boolean>('enableBranchComparison', true);
		const baseBranch = config.get<string>('baseBranch', 'origin/main');
		const enableDebugOutput = config.get<boolean>('enableDebugOutput', false);

		return Promise.resolve([
			new ReviewItem(
				`LLM Provider: ${llmProvider}`,
				'Click to change AI provider',
				vscode.TreeItemCollapsibleState.None,
				'llm-provider',
				new vscode.ThemeIcon('robot'),
				true
			),
			new ReviewItem(
				`Branch Comparison: ${enableBranchComparison ? 'Enabled' : 'Disabled'}`,
				`Compare against: ${baseBranch}`,
				vscode.TreeItemCollapsibleState.None,
				'branch-comparison',
				new vscode.ThemeIcon('git-branch'),
				true
			),
			new ReviewItem(
				`Debug Output: ${enableDebugOutput ? 'Enabled' : 'Disabled'}`,
				'Show detailed console output during analysis',
				vscode.TreeItemCollapsibleState.None,
				'debug-output',
				new vscode.ThemeIcon('debug'),
				true
			),
			new ReviewItem(
				'Configuration',
				'Extension settings',
				vscode.TreeItemCollapsibleState.None,
				'config',
				new vscode.ThemeIcon('gear'),
				true
			)
		]);
	}

	private getFileTooltip(fileResult: FileReviewResult): string {
		let tooltip = '\n\nReview Results:';
		for (const [reviewType, result] of Object.entries(fileResult.results)) {
			const statusEmoji = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⚠️';
			tooltip += `\n${reviewType}: ${statusEmoji} ${result.issues} issues (${result.confidence}% confidence)`;
		}
		return tooltip;
	}

	private getFileIconName(fileName: string): string {
		const extension = fileName.split('.').pop()?.toLowerCase();

		// Map file extensions to VS Code icon names (without $() syntax)
		const iconMap: { [key: string]: string } = {
			// Web files
			'js': 'file-code',
			'jsx': 'file-code',
			'ts': 'file-code',
			'tsx': 'file-code',
			'html': 'file-code',
			'htm': 'file-code',
			'css': 'file-code',
			'scss': 'file-code',
			'sass': 'file-code',
			'less': 'file-code',
			'vue': 'file-code',
			'svelte': 'file-code',

			// Backend languages
			'py': 'file-code',
			'java': 'file-code',
			'cpp': 'file-code',
			'c': 'file-code',
			'cs': 'file-code',
			'php': 'file-code',
			'rb': 'file-code',
			'go': 'file-code',
			'rs': 'file-code',
			'swift': 'file-code',
			'kt': 'file-code',

			// Config files
			'json': 'file-code',
			'xml': 'file-code',
			'yaml': 'file-code',
			'yml': 'file-code',
			'toml': 'file-code',
			'ini': 'file-code',
			'env': 'file-code',

			// Documentation
			'md': 'file-text',
			'txt': 'file-text',
			'rst': 'file-text',

			// Images
			'png': 'file-media',
			'jpg': 'file-media',
			'jpeg': 'file-media',
			'gif': 'file-media',
			'svg': 'file-media',
			'ico': 'file-media',

			// Archives
			'zip': 'file-zip',
			'tar': 'file-zip',
			'gz': 'file-zip',
			'rar': 'file-zip',
			'7z': 'file-zip',

			// Binaries
			'exe': 'file-binary',
			'dll': 'file-binary',
			'so': 'file-binary',
			'dylib': 'file-binary',
		};

		return iconMap[extension || ''] || 'file';
	}
}

class ReviewItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly tooltip: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly reviewType: string,
		public readonly iconPath?: string | vscode.ThemeIcon,
		public readonly isGroup: boolean = false,
		public readonly filePath?: string,
		public readonly issueData?: IssueDTO // Add issue data for navigation
	) {
		super(label, collapsibleState);
		this.tooltip = tooltip;
		if (iconPath) {
			this.iconPath = iconPath;
		}

		// Only add commands for actionable items, not info items or groups
		if (reviewType !== 'info' && !isGroup && reviewType !== 'file') {
			// Use toggle commands for review types in the reviews view
			if (['security', 'accessibility', 'performance', 'quality'].includes(reviewType)) {
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

		// Add base branch change command
		if (reviewType === 'base-branch') {
			this.command = {
				command: 'autodiff.changeBaseBranch',
				title: 'Change base branch',
				arguments: [label] // Pass the branch name as argument
			};
		}

		// Add branch comparison toggle command
		if (reviewType === 'branch-comparison') {
			this.command = {
				command: 'autodiff.toggleBranchComparison',
				title: 'Toggle branch comparison',
				arguments: []
			};
		}

		// Add debug output toggle command
		if (reviewType === 'debug-output') {
			this.command = {
				command: 'autodiff.toggleDebugOutput',
				title: 'Toggle debug output',
				arguments: []
			};
		}

		// Add file opening command for files
		if (reviewType === 'file' && filePath) {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (workspaceFolder) {
				const fullPath = path.join(workspaceFolder.uri.fsPath, filePath);
				this.command = {
					command: 'vscode.open',
					title: 'Open file',
					arguments: [vscode.Uri.file(fullPath)]
				};
			}
		}

		// Add issue navigation command for individual issues
		if (reviewType === 'issue' && issueData && issueData.file_path) {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (workspaceFolder) {
				const fullPath = path.join(workspaceFolder.uri.fsPath, issueData.file_path);
				const lineNumber = issueData.line_numbers && issueData.line_numbers.length > 0 ? issueData.line_numbers[0] : 1;
				this.command = {
					command: 'autodiff.navigateToIssue',
					title: 'Navigate to issue',
					arguments: [fullPath, lineNumber - 1] // VS Code uses 0-based line numbers
				};
			}
		}
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "autodiff" is now active!');

	// Create file decoration provider for review status indicators
	const fileDecorationProvider = new AutoDiffFileDecorationProvider();
	const decorationDisposable = vscode.window.registerFileDecorationProvider(fileDecorationProvider);
	context.subscriptions.push(decorationDisposable);

	// Create shared data that all providers will reference
	const sharedData = {
		changedFiles: [] as string[],
		reviewResults: new Map<string, any>(),
		selectedReviews: new Set<string>(['security']) // Default to only security selected
	};

	// Create tree data providers for each view - they all share the same data
	const branchProvider = new AutoDiffTreeDataProvider('branch', context, fileDecorationProvider);
	const reviewsProvider = new AutoDiffTreeDataProvider('reviews', context, fileDecorationProvider);
	const changesProvider = new AutoDiffTreeDataProvider('changes', context, fileDecorationProvider);
	const resultsProvider = new AutoDiffTreeDataProvider('results', context, fileDecorationProvider);
	const settingsProvider = new AutoDiffTreeDataProvider('settings', context, fileDecorationProvider);

	// Share the data objects between all providers
	[branchProvider, reviewsProvider, changesProvider, resultsProvider, settingsProvider].forEach(provider => {
		provider.setSharedData(sharedData);
	});

	// Load shared data once using the main provider
	await reviewsProvider.loadInitialData();

	// Update file decoration provider with shared data
	fileDecorationProvider.updateChangedFiles(sharedData.changedFiles);
	fileDecorationProvider.updateReviewResults(sharedData.reviewResults);

	// Share state between providers - they should all reference the same data
	const sharedProviders = [branchProvider, reviewsProvider, changesProvider, resultsProvider, settingsProvider];

	// Update file decoration provider when review results change
	const updateFileDecorations = () => {
		fileDecorationProvider.updateChangedFiles(sharedData.changedFiles);
		fileDecorationProvider.updateReviewResults(sharedData.reviewResults);
	};

	// Register tree views for each sub-view
	vscode.window.createTreeView('autodiffBranchView', {
		treeDataProvider: branchProvider,
		showCollapseAll: false
	});

	vscode.window.createTreeView('autodiffReviewView', {
		treeDataProvider: reviewsProvider,
		showCollapseAll: false
	});

	vscode.window.createTreeView('autodiffChangesView', {
		treeDataProvider: changesProvider,
		showCollapseAll: false
	});

	vscode.window.createTreeView('autodiffResultsView', {
		treeDataProvider: resultsProvider,
		showCollapseAll: false
	});

	vscode.window.createTreeView('autodiffSettingsView', {
		treeDataProvider: settingsProvider,
		showCollapseAll: false
	});

	// Set up file system watcher to refresh Changes view when files are added/deleted
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (workspaceFolder) {
		const fileSystemWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(workspaceFolder, '**/*'),
			false, // Don't ignore creates
			true,  // Ignore changes (we only care about creates/deletes for the changes view)
			false  // Don't ignore deletes
		);

		fileSystemWatcher.onDidCreate(() => {
			// Refresh all providers when files are created (might be new untracked files)
			sharedProviders.forEach(provider => provider.refresh());
			updateFileDecorations();
		});

		fileSystemWatcher.onDidDelete(() => {
			// Refresh all providers when files are deleted (untracked files might be removed)
			sharedProviders.forEach(provider => provider.refresh());
			updateFileDecorations();
		});

		context.subscriptions.push(fileSystemWatcher);
	}

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('autodiff.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from autodiff!');
	});

	// Register the AutoDiff commands
	const securityReviewDisposable = vscode.commands.registerCommand('autodiff.runSecurityReview', async () => {
		// Clear previous results before starting new review
		reviewsProvider.clearReviewResults(['security']);
		updateFileDecorations();

		await runAutoDiffReview(['security'], reviewsProvider, sharedProviders, updateFileDecorations);
	});

	const accessibilityReviewDisposable = vscode.commands.registerCommand('autodiff.runAccessibilityReview', async () => {
		// Clear previous results before starting new review
		reviewsProvider.clearReviewResults(['accessibility']);
		updateFileDecorations();

		await runAutoDiffReview(['accessibility'], reviewsProvider, sharedProviders, updateFileDecorations);
	});

	const performanceReviewDisposable = vscode.commands.registerCommand('autodiff.runPerformanceReview', async () => {
		// Clear previous results before starting new review
		reviewsProvider.clearReviewResults(['performance']);
		updateFileDecorations();

		await runAutoDiffReview(['performance'], reviewsProvider, sharedProviders, updateFileDecorations);
	});

	const qualityReviewDisposable = vscode.commands.registerCommand('autodiff.runQualityReview', async () => {
		// Clear previous results before starting new review
		reviewsProvider.clearReviewResults(['quality']);
		updateFileDecorations();

		await runAutoDiffReview(['quality'], reviewsProvider, sharedProviders, updateFileDecorations);
	});

	const customReviewDisposable = vscode.commands.registerCommand('autodiff.runCustomReview', async () => {
		const selectedModes = await vscode.window.showQuickPick(
			[
				{ label: 'Security', picked: true },
				{ label: 'Accessibility', picked: false },
				{ label: 'Performance', picked: false },
				{ label: 'Quality', picked: false }
			],
			{
				canPickMany: true,
				placeHolder: 'Select review modes'
			}
		);

		if (selectedModes && selectedModes.length > 0) {
			const modes = selectedModes.map(mode => mode.label.toLowerCase());

			// Clear previous results before starting new review
			reviewsProvider.clearReviewResults(modes);
			updateFileDecorations();

			await runAutoDiffReview(modes, reviewsProvider, sharedProviders, updateFileDecorations);
		}
	});

	const comprehensiveReviewDisposable = vscode.commands.registerCommand('autodiff.runComprehensiveReview', async () => {
		const selectedReviews = reviewsProvider.getSelectedReviews();
		if (selectedReviews.length === 0) {
			vscode.window.showWarningMessage('No reviews selected. Please select at least one review type in the Reviews panel.');
			return;
		}

		// Clear previous results for the selected review types before starting new review
		reviewsProvider.clearReviewResults(selectedReviews);

		// Update file decorations after clearing results
		updateFileDecorations();

		await runAutoDiffReview(selectedReviews, reviewsProvider, sharedProviders, updateFileDecorations);
	});

	const changeBaseBranchDisposable = vscode.commands.registerCommand('autodiff.changeBaseBranch', async (branchName?: string) => {
		const config = vscode.workspace.getConfiguration('autodiff');
		const currentBranch = config.get<string>('baseBranch', 'origin/main');

		if (branchName) {
			// Direct branch selection from the branch list
			if (branchName === currentBranch) {
				// Already selected, no need to change
				return;
			}

			await config.update('baseBranch', branchName, vscode.ConfigurationTarget.Workspace);
			vscode.window.showInformationMessage(`Base branch changed to: ${branchName}`);
			// Refresh all providers
			sharedProviders.forEach(provider => provider.refresh());
			updateFileDecorations();
		} else {
			// Fallback to dropdown selection (for command palette usage)
			const branches = await getAvailableBranches();
			if (branches.length === 0) {
				vscode.window.showWarningMessage('No git branches found.');
				return;
			}

			const selectedBranch = await vscode.window.showQuickPick(
				branches.map((branch: string) => ({
					label: branch,
					picked: branch === currentBranch,
					description: branch === currentBranch ? '(current)' : ''
				})),
				{
					placeHolder: `Select base branch to compare against (current: ${currentBranch})`
				}
			);

			if (selectedBranch) {
				await config.update('baseBranch', selectedBranch.label, vscode.ConfigurationTarget.Workspace);
				vscode.window.showInformationMessage(`Base branch changed to: ${selectedBranch.label}`);
				// Refresh all providers
				sharedProviders.forEach(provider => provider.refresh());
				updateFileDecorations();
			}
		}
	});

	const refreshViewDisposable = vscode.commands.registerCommand('autodiff.refreshView', () => {
		sharedProviders.forEach(provider => provider.refresh());
		updateFileDecorations();
	});

	const settingsDisposable = vscode.commands.registerCommand('autodiff.runSettingsReview', async () => {
		// Open the settings UI for AutoDiff
		await vscode.commands.executeCommand('workbench.action.openSettings', 'autodiff');
	});

	// Toggle view commands
	const toggleChangesViewDisposable = vscode.commands.registerCommand('autodiff.toggleChangesView', async () => {
		const config = vscode.workspace.getConfiguration('autodiff');
		const currentValue = config.get<boolean>('showChangesView', true);
		await config.update('showChangesView', !currentValue, vscode.ConfigurationTarget.Workspace);
		vscode.window.showInformationMessage(`Changes view ${!currentValue ? 'enabled' : 'disabled'}`);
	});

	const toggleResultsViewDisposable = vscode.commands.registerCommand('autodiff.toggleResultsView', async () => {
		const config = vscode.workspace.getConfiguration('autodiff');
		const currentValue = config.get<boolean>('showResultsView', true);
		await config.update('showResultsView', !currentValue, vscode.ConfigurationTarget.Workspace);
		vscode.window.showInformationMessage(`Results view ${!currentValue ? 'enabled' : 'disabled'}`);
	});

	const toggleSettingsViewDisposable = vscode.commands.registerCommand('autodiff.toggleSettingsView', async () => {
		const config = vscode.workspace.getConfiguration('autodiff');
		const currentValue = config.get<boolean>('showSettingsView', false);
		await config.update('showSettingsView', !currentValue, vscode.ConfigurationTarget.Workspace);
		vscode.window.showInformationMessage(`Settings view ${!currentValue ? 'enabled' : 'disabled'}`);
	});

	// Toggle review selection commands
	const toggleSecurityReviewDisposable = vscode.commands.registerCommand('autodiff.toggleSecurityReview', () => {
		reviewsProvider.toggleReviewSelection('security');
		// Refresh all providers to keep them in sync
		sharedProviders.forEach(provider => provider.refresh());
		updateFileDecorations();
	});

	const toggleAccessibilityReviewDisposable = vscode.commands.registerCommand('autodiff.toggleAccessibilityReview', () => {
		reviewsProvider.toggleReviewSelection('accessibility');
		// Refresh all providers to keep them in sync
		sharedProviders.forEach(provider => provider.refresh());
		updateFileDecorations();
	});

	const togglePerformanceReviewDisposable = vscode.commands.registerCommand('autodiff.togglePerformanceReview', () => {
		reviewsProvider.toggleReviewSelection('performance');
		// Refresh all providers to keep them in sync
		sharedProviders.forEach(provider => provider.refresh());
		updateFileDecorations();
	});

	const toggleQualityReviewDisposable = vscode.commands.registerCommand('autodiff.toggleQualityReview', () => {
		reviewsProvider.toggleReviewSelection('quality');
		// Refresh all providers to keep them in sync
		sharedProviders.forEach(provider => provider.refresh());
		updateFileDecorations();
	});

	const toggleBranchComparisonDisposable = vscode.commands.registerCommand('autodiff.toggleBranchComparison', async () => {
		const config = vscode.workspace.getConfiguration('autodiff');
		const currentValue = config.get<boolean>('enableBranchComparison', true);

		// Toggle the setting
		await config.update('enableBranchComparison', !currentValue, vscode.ConfigurationTarget.Workspace);

		// Refresh all providers to show updated status
		sharedProviders.forEach(provider => provider.refresh());

		vscode.window.showInformationMessage(
			`Branch comparison ${!currentValue ? 'enabled' : 'disabled'}. ${!currentValue ? 'Will compare against base branch.' : 'Will only check staged/unstaged changes.'}`
		);
	});

	const toggleDebugOutputDisposable = vscode.commands.registerCommand('autodiff.toggleDebugOutput', async () => {
		const config = vscode.workspace.getConfiguration('autodiff');
		const currentValue = config.get<boolean>('enableDebugOutput', false);

		// Toggle the setting
		await config.update('enableDebugOutput', !currentValue, vscode.ConfigurationTarget.Workspace);

		// Refresh all providers to show updated status
		sharedProviders.forEach(provider => provider.refresh());

		vscode.window.showInformationMessage(
			`Debug output ${!currentValue ? 'enabled' : 'disabled'}. ${!currentValue ? 'Console output will be shown during analysis.' : 'Console output will be hidden.'}`
		);
	});

	// Command to navigate to a specific issue
	const navigateToIssueDisposable = vscode.commands.registerCommand('autodiff.navigateToIssue', async (filePath: string, lineNumber: number) => {
		try {
			const document = await vscode.workspace.openTextDocument(filePath);
			const editor = await vscode.window.showTextDocument(document);

			// Navigate to the specific line
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
		qualityReviewDisposable,
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
		toggleQualityReviewDisposable,
		toggleBranchComparisonDisposable,
		toggleDebugOutputDisposable,
		navigateToIssueDisposable
	);
}

// Function to parse review results from Python output
function parseReviewResults(output: string): any[] {
	const results: any[] = [];
	const lines = output.split('\n');

	let currentIssue: any = {};
	let inIssueBlock = false;
	let currentFile = '';

	for (const line of lines) {
		const trimmedLine = line.trim();

		// Look for file headers like ### `app.js`
		const fileMatch = trimmedLine.match(/^### `(.+?)`/);
		if (fileMatch) {
			currentFile = fileMatch[1];
			continue;
		}

		// Look for issue start with emoji (🔒, 🌐, ⚡, etc.) followed by **Issue:**
		const issueMatch = trimmedLine.match(/^[🔒🌐⚡🎨🔧📱💻⚠️✨🛡️🚀💡🔍📊🎯🔄📈🔥💎⭐🎉🎊🌟💯🎪🎭🎨🎬🎮🎲🎯🎨🎪]+\s*\*\*Issue:\*\*\s*(.+)/);
		if (issueMatch) {
			// Save previous issue if it exists
			if (inIssueBlock && currentIssue.issue) {
				currentIssue.file = currentFile;
				results.push({ ...currentIssue });
			}
			// Start new issue
			currentIssue = { issue: issueMatch[1] };
			inIssueBlock = true;
			continue;
		}

		// Look for other fields with **Field:** format
		if (inIssueBlock && trimmedLine.startsWith('**')) {
			const match = trimmedLine.match(/\*\*(.+?):\*\*\s*(.+)/);
			if (match) {
				const field = match[1].toLowerCase().replace(/\s+/g, '_');
				const value = match[2];

				switch (field) {
					case 'severity':
						currentIssue.severity = value;
						break;
					case 'confidence':
						currentIssue.confidence = value;
						break;
					case 'line_number':
						currentIssue.line_number = value;
						break;
					case 'code':
						currentIssue.code = value;
						break;
					case 'suggestion':
						currentIssue.suggestion = value;
						break;
					case 'file':
						currentIssue.file = value;
						break;
				}
			}
		}
	}

	// Don't forget the last issue
	if (inIssueBlock && currentIssue.issue) {
		currentIssue.file = currentFile || currentIssue.file;
		results.push({ ...currentIssue });
	}

	return results;
}

// Function to get available git branches
async function getAvailableBranches(): Promise<string[]> {
	return new Promise((resolve) => {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			resolve([]);
			return;
		}

		// First check if this is a git repository
		cp.exec('git rev-parse --git-dir', { cwd: workspaceFolder.uri.fsPath }, (error) => {
			if (error) {
				resolve([]);
				return;
			}

			// Get both local and remote branches
			cp.exec('git branch -a --format="%(refname:short)"', { cwd: workspaceFolder.uri.fsPath }, (error, stdout) => {
				if (error) {
					// Fallback to basic branch commands
					cp.exec('git branch -r && git branch', { cwd: workspaceFolder.uri.fsPath }, (error2, stdout2) => {
						if (error2) {
							resolve([]);
							return;
						}

						const branches = stdout2
							.split('\n')
							.map(line => line.trim())
							.filter(line => line && !line.startsWith('*') && !line.includes('HEAD'))
							.map(line => line.replace(/^remotes\//, ''))
							.sort();

						resolve([...new Set(branches)]);
					});
					return;
				}

				const branches = stdout
					.split('\n')
					.map(line => line.trim())
					.filter(line => line && !line.includes('HEAD'))
					.map(line => {
						// Handle remote branch format
						if (line.startsWith('origin/')) {
							return line;
						}
						// Local branches - keep as is unless they have a remote tracking branch
						return line;
					})
					.sort();

				resolve([...new Set(branches)]);
			});
		});
	});
}

// Function to check if a branch exists
async function branchExists(branchName: string, workspacePath: string): Promise<boolean> {
	return new Promise((resolve) => {
		// Check if the branch exists locally or as a remote reference
		cp.exec(`git show-ref --verify --quiet refs/heads/${branchName} || git show-ref --verify --quiet refs/remotes/${branchName}`,
			{ cwd: workspacePath },
			(error) => {
				resolve(!error);
			}
		);
	});
}

async function runAutoDiffReview(modes: string[], provider?: AutoDiffTreeDataProvider, sharedProviders?: AutoDiffTreeDataProvider[], updateFileDecorations?: () => void) {
	// Check if Python is available
	if (!await isPythonAvailable()) {
		vscode.window.showErrorMessage('Python is not installed or not available in PATH. Please install Python to use AutoDiff.');
		return;
	}

	// Get the current workspace folder
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		vscode.window.showErrorMessage('No workspace folder found. Please open a folder or workspace.');
		return;
	}

	// Show progress indicator
	vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "Running AutoDiff analysis...",
		cancellable: false
	}, async (progress) => {
		try {
			// Get git diff for tracked changes
			const diffContent = await getGitDiff(workspaceFolder.uri.fsPath);

			// Also check for untracked files
			const untrackedFiles = await getUntrackedFiles(workspaceFolder.uri.fsPath);

			// Check if we have any changes to review (either tracked changes or untracked files)
			const hasTrackedChanges = diffContent && diffContent.trim();
			const hasUntrackedFiles = untrackedFiles.length > 0;

			if (!hasTrackedChanges && !hasUntrackedFiles) {
				vscode.window.showInformationMessage('No git changes found to review. Make some changes to your files first, then try again.');
				return;
			}

			// Get configuration
			const config = vscode.workspace.getConfiguration('autodiff');
			const llmProvider = config.get<string>('llmProvider', 'copilot');
			const enableLLMAnalysis = config.get<boolean>('enableLLMAnalysis', false);
			const chatgptApiKey = config.get<string>('openaiApiKey', '');
			const geminiApiKey = config.get<string>('geminiApiKey', '');
			const baseBranch = config.get<string>('baseBranch', 'origin/main');
			const enableDebugOutput = config.get<boolean>('enableDebugOutput', false);

			// Create output channel only if debug output is enabled
			let outputChannel: vscode.OutputChannel | null = null;
			if (enableDebugOutput) {
				outputChannel = vscode.window.createOutputChannel('AutoDiff Results');
				outputChannel.show();
				outputChannel.appendLine('=== AutoDiff Analysis Starting ===\n');
				outputChannel.appendLine(`Working directory: ${workspaceFolder.uri.fsPath}\n`);

				if (hasTrackedChanges) {
					outputChannel.appendLine(`📝 Found tracked changes to review\n`);
				}
				if (hasUntrackedFiles) {
					outputChannel.appendLine(`📂 Found ${untrackedFiles.length} untracked files: ${untrackedFiles.join(', ')}\n`);
				}
			}

			// Setup Python script path
			const extensionPath = path.dirname(path.dirname(__filename)); // Go up from dist/ to extension root
			const backendPath = path.join(extensionPath, 'backend');
			const pythonScript = path.join(backendPath, 'main.py');

			const args = [
				'--modes', ...modes,
				'--output', 'json',  // Use JSON output for structured data
				'--base', baseBranch
			];

			// Add --include-untracked flag if we have untracked files
			if (hasUntrackedFiles) {
				args.push('--include-untracked');
				if (outputChannel) {
					outputChannel.appendLine(`🔍 Including untracked files in analysis\n`);
				}
			}

			// Add dry-run if LLM analysis is disabled or no API key configured
			if (!enableLLMAnalysis) {
				args.push('--dry-run');
				if (outputChannel) {
					outputChannel.appendLine('ℹ️  Running in dry-run mode (LLM analysis disabled). Enable in settings to get actual analysis.\n');
				}
			} else if (llmProvider === 'chatgpt' && !chatgptApiKey) {
				args.push('--dry-run');
				if (outputChannel) {
					outputChannel.appendLine('ℹ️  Running in dry-run mode (ChatGPT API key not configured). Set API key in settings for actual analysis.\n');
				}
			} else if (llmProvider === 'gemini' && !geminiApiKey) {
				args.push('--dry-run');
				if (outputChannel) {
					outputChannel.appendLine('ℹ️  Running in dry-run mode (Gemini API key not configured). Set API key in settings for actual analysis.\n');
				}
			} else if (llmProvider === 'copilot') {
				// Handle Copilot provider with VS Code Language Model API
				try {
					if (outputChannel) {
						outputChannel.appendLine('🤖 Using GitHub Copilot for analysis...\n');
					}
					const analysisResult = await runCopilotAnalysis(modes, diffContent, outputChannel || vscode.window.createOutputChannel('AutoDiff Results'));
					if (analysisResult) {
						// Pass the result to Python for formatting and output
						args.push('--llm-result', analysisResult);
						args.push('--provider', llmProvider);
					} else {
						// Fallback to dry-run if Copilot analysis fails
						args.push('--dry-run');
						if (outputChannel) {
							outputChannel.appendLine('⚠️  Copilot analysis failed, falling back to dry-run mode.\n');
							outputChannel.appendLine('💡 GitHub Copilot integration is coming soon! For now, try OpenAI provider with an API key.\n');
						}
					}
				} catch (error) {
					if (outputChannel) {
						outputChannel.appendLine(`⚠️  Copilot analysis error: ${error}\n`);
						outputChannel.appendLine('💡 GitHub Copilot integration is coming soon! For now, try ChatGPT or Gemini provider with an API key.\n');
					}
					args.push('--dry-run');
				}
			} else if (llmProvider === 'claude') {
				// Claude is not yet implemented
				args.push('--dry-run');
				if (outputChannel) {
					outputChannel.appendLine('ℹ️  Running in dry-run mode (Claude provider not yet implemented).\n');
					outputChannel.appendLine('💡 Anthropic Claude support is planned for a future release. For now, try ChatGPT or Gemini provider.\n');
				}
			} else {
				// Add provider configuration
				args.push('--provider', llmProvider);

				// Add API keys if available
				if (llmProvider === 'chatgpt' && chatgptApiKey) {
					args.push('--chatgpt-api-key', chatgptApiKey);
				} else if (llmProvider === 'gemini' && geminiApiKey) {
					args.push('--gemini-api-key', geminiApiKey);
				}

				if (outputChannel) {
					outputChannel.appendLine(`🤖 Using ${llmProvider.charAt(0).toUpperCase() + llmProvider.slice(1)} provider for analysis...\n`);
				}
			}

			const pythonOutput = await runPythonScript(pythonScript, args, workspaceFolder.uri.fsPath, outputChannel || vscode.window.createOutputChannel('AutoDiff Results'));

			// Parse results and update provider if we have one
			if (provider && pythonOutput) {
				// Try to parse as JSON first (new DTO format)
				// The output may contain mixed text, so extract just the JSON part
				let jsonString = pythonOutput.trim();

				// Look for JSON object in the output (starts with { and ends with })
				// Handle multiline JSON properly
				const jsonStart = pythonOutput.indexOf('{');
				const jsonEnd = pythonOutput.lastIndexOf('}');

				if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
					jsonString = pythonOutput.substring(jsonStart, jsonEnd + 1);
				}

				const analysisResult = DTOUtils.parseFromJSON(jsonString);

				if (analysisResult) {
					// Use new DTO system
					if (outputChannel) {
						outputChannel.appendLine(`📊 Analysis complete: ${analysisResult.total_issues} issues found across ${analysisResult.files.length} files\n`);
					}

					// Update provider with new DTO results
					provider.updateReviewResultsFromDTO(analysisResult, modes);
				} else {
					// Fallback to legacy parsing for backward compatibility
					const results = parseReviewResults(pythonOutput);
					if (outputChannel) {
						outputChannel.appendLine(`📊 Analysis complete: ${results.length} issues found (legacy format)\n`);
					}

					if (results.length > 0) {
						// Group results by review type based on the analysis that was performed
						if (modes.length === 1) {
							// Single review type - update directly
							provider.updateReviewResults(modes[0], results);
						} else {
							// Multiple review types - we need to process each type
							for (const reviewType of modes) {
								provider.updateReviewResults(reviewType, results);
							}
						}
					} else {
						// No issues found - still need to update to show 'pass' status
						for (const reviewType of modes) {
							provider.updateReviewResults(reviewType, []);
						}
					}
				}

				// Refresh all shared providers to update all views with the new results
				if (sharedProviders) {
					sharedProviders.forEach(sharedProvider => {
						sharedProvider.refresh();
					});
				}

				// Update file decorations to reflect the new results
				if (updateFileDecorations) {
					updateFileDecorations();
				}
			}
		} catch (error) {
			let errorMessage = `AutoDiff analysis failed: ${error}`;
			let showErrorMessage = true;

			// Check for different types of errors and provide helpful guidance
			const errorStr = String(error).toLowerCase();

			// Handle quota/rate limit errors
			if (errorStr.includes('quota') || errorStr.includes('rate limit') || errorStr.includes('429')) {
				if (errorStr.includes('gemini')) {
					errorMessage = 'Gemini API quota exceeded. Try switching to ChatGPT provider or wait for quota reset.';
					vscode.window.showWarningMessage(errorMessage, 'Open Settings', 'Switch to ChatGPT').then(selection => {
						if (selection === 'Open Settings') {
							vscode.commands.executeCommand('workbench.action.openSettings', 'autodiff.llmProvider');
						} else if (selection === 'Switch to ChatGPT') {
							const config = vscode.workspace.getConfiguration('autodiff');
							config.update('llmProvider', 'chatgpt', vscode.ConfigurationTarget.Workspace);
							vscode.window.showInformationMessage('LLM provider switched to ChatGPT. Please set your OpenAI API key in settings.');
						}
					});
					showErrorMessage = false;
				} else if (errorStr.includes('openai') || errorStr.includes('chatgpt')) {
					errorMessage = 'OpenAI API rate limit exceeded. Try switching to Gemini provider or wait for rate limit reset.';
					vscode.window.showWarningMessage(errorMessage, 'Open Settings', 'Switch to Gemini').then(selection => {
						if (selection === 'Open Settings') {
							vscode.commands.executeCommand('workbench.action.openSettings', 'autodiff.llmProvider');
						} else if (selection === 'Switch to Gemini') {
							const config = vscode.workspace.getConfiguration('autodiff');
							config.update('llmProvider', 'gemini', vscode.ConfigurationTarget.Workspace);
							vscode.window.showInformationMessage('LLM provider switched to Gemini. Please set your Gemini API key in settings.');
						}
					});
					showErrorMessage = false;
				}
			}
			// Handle timeout and network errors
			else if (errorStr.includes('timeout') || errorStr.includes('connection') || errorStr.includes('network')) {
				errorMessage = 'Network timeout or connection error. Please check your internet connection and try again.';
				vscode.window.showWarningMessage(errorMessage, 'Try Again', 'Switch Provider').then(selection => {
					if (selection === 'Try Again') {
						// Re-run the same review
						runAutoDiffReview(modes, provider, sharedProviders, updateFileDecorations);
					} else if (selection === 'Switch Provider') {
						vscode.commands.executeCommand('workbench.action.openSettings', 'autodiff.llmProvider');
					}
				});
				showErrorMessage = false;
			}
			// Handle server errors (503, 500, 502, etc.)
			else if (errorStr.includes('server error') || errorStr.includes('500') || errorStr.includes('502') || errorStr.includes('503') || errorStr.includes('service unavailable')) {
				const providerName = errorStr.includes('gemini') ? 'Gemini' : errorStr.includes('openai') ? 'OpenAI' : 'API';
				errorMessage = `${providerName} servers are experiencing issues (${errorStr.includes('503') ? 'service unavailable' : 'server error'}). This is usually temporary.`;

				// For server errors, offer more options including dry-run mode
				vscode.window.showWarningMessage(errorMessage, 'Try Again', 'Switch Provider', 'Run Dry-Run').then(selection => {
					if (selection === 'Try Again') {
						// Re-run the same review after a brief delay
						setTimeout(() => {
							runAutoDiffReview(modes, provider, sharedProviders, updateFileDecorations);
						}, 3000);
					} else if (selection === 'Switch Provider') {
						vscode.commands.executeCommand('workbench.action.openSettings', 'autodiff.llmProvider');
					} else if (selection === 'Run Dry-Run') {
						// Temporarily disable LLM analysis and run in dry-run mode
						const config = vscode.workspace.getConfiguration('autodiff');
						const originalValue = config.get<boolean>('enableLLMAnalysis', false);

						// Temporarily disable LLM analysis
						config.update('enableLLMAnalysis', false, vscode.ConfigurationTarget.Workspace).then(() => {
							// Run the analysis in dry-run mode
							runAutoDiffReview(modes, provider, sharedProviders, updateFileDecorations).finally(() => {
								// Restore original setting
								config.update('enableLLMAnalysis', originalValue, vscode.ConfigurationTarget.Workspace);
							});
						});
					}
				});
				showErrorMessage = false;
			}
			// Handle authentication and API key errors
			else if (errorStr.includes('unauthorized') || errorStr.includes('invalid api key') || errorStr.includes('authentication')) {
				const providerName = errorStr.includes('gemini') ? 'Gemini' : errorStr.includes('openai') ? 'OpenAI' : 'API';
				errorMessage = `${providerName} API key is invalid or missing. Please check your API key in settings.`;
				vscode.window.showErrorMessage(errorMessage, 'Open Settings').then(selection => {
					if (selection === 'Open Settings') {
						vscode.commands.executeCommand('workbench.action.openSettings', 'autodiff');
					}
				});
				showErrorMessage = false;
			}

			if (showErrorMessage) {
				vscode.window.showErrorMessage(errorMessage);
			}
			console.error('AutoDiff Error:', error);
		}
	});
}

async function isPythonAvailable(): Promise<boolean> {
	return new Promise((resolve) => {
		cp.exec('python --version', (error) => {
			if (error) {
				// Try python3 if python fails
				cp.exec('python3 --version', (error) => {
					resolve(!error);
				});
			} else {
				resolve(true);
			}
		});
	});
}

async function getGitDiff(workspacePath: string): Promise<string> {
	return new Promise(async (resolve, reject) => {
		// First check if this is a git repository
		cp.exec('git rev-parse --git-dir', { cwd: workspacePath }, (error) => {
			if (error) {
				reject(`Not a git repository. Please open a folder that contains a git repository.`);
				return;
			}

			// Get configuration
			const config = vscode.workspace.getConfiguration('autodiff');
			const baseBranch = config.get<string>('baseBranch', 'origin/main');
			const enableBranchComparison = config.get<boolean>('enableBranchComparison', true);

			// Try staged changes first
			cp.exec('git diff --staged', { cwd: workspacePath }, async (error, stdout, stderr) => {
				if (!error && stdout.trim()) {
					// Found staged changes
					resolve(stdout);
					return;
				}

				// Check if branch comparison is enabled
				if (enableBranchComparison) {
					// Check if the base branch exists
					const branchExistsResult = await branchExists(baseBranch, workspacePath);
					if (!branchExistsResult) {
						reject(`Base branch '${baseBranch}' does not exist. Please select a valid branch or disable branch comparison in settings.`);
						return;
					}

					// Try comparing against base branch
					cp.exec(`git diff ${baseBranch}`, { cwd: workspacePath }, (error2, stdout2, stderr2) => {
						if (!error2 && stdout2.trim()) {
							// Found changes against base branch
							resolve(stdout2);
							return;
						}

						// Continue with local changes fallback
						tryLocalChanges();
					});
				} else {
					// Branch comparison disabled, skip to local changes
					tryLocalChanges();
				}

				function tryLocalChanges() {
					// Try unstaged changes as fallback
					cp.exec('git diff', { cwd: workspacePath }, (error3, stdout3, stderr3) => {
						if (!error3 && stdout3.trim()) {
							// Found unstaged changes
							resolve(stdout3);
							return;
						}

						// Try against HEAD
						cp.exec('git diff HEAD', { cwd: workspacePath }, (error4, stdout4, stderr4) => {
							if (!error4 && stdout4.trim()) {
								// Found changes against HEAD
								resolve(stdout4);
								return;
							}

							// No changes found anywhere - this is normal, don't error
							resolve('');
						});
					});
				}
			});
		});
	});
}

async function getUntrackedFiles(workspacePath: string): Promise<string[]> {
	return new Promise((resolve, reject) => {
		// Get untracked files from git status
		cp.exec('git ls-files --others --exclude-standard', { cwd: workspacePath }, (error, stdout, stderr) => {
			if (error) {
				console.log('Error getting untracked files:', error);
				resolve([]); // Return empty array instead of rejecting
				return;
			}

			// Parse the output to get file paths
			const untrackedFiles = stdout.trim()
				.split('\n')
				.filter(line => line.trim().length > 0)
				.filter(file => {
					// Filter out common files we don't want to review
					const excludePatterns = [
						'.DS_Store',
						'node_modules/',
						'.git/',
						'*.log',
						'*.tmp',
						'*.temp'
					];

					return !excludePatterns.some(pattern => {
						if (pattern.includes('*')) {
							const regex = new RegExp(pattern.replace('*', '.*'));
							return regex.test(file);
						}
						return file.includes(pattern);
					});
				});

			resolve(untrackedFiles);
		});
	});
}

async function runPythonScript(scriptPath: string, args: string[], cwd: string, outputChannel: vscode.OutputChannel): Promise<string> {
	return new Promise((resolve, reject) => {
		// Try python first, then python3
		const pythonCommand = 'python3'; // Start with python3 as it's more common on Linux

		const child = cp.spawn(pythonCommand, [scriptPath, ...args], {
			cwd: cwd,
			stdio: ['pipe', 'pipe', 'pipe']
		});

		let outputData = '';
		let errorData = '';

		child.stdout?.on('data', (data) => {
			const output = data.toString();
			outputData += output;
			outputChannel.append(output);
		});

		child.stderr?.on('data', (data) => {
			const error = data.toString();
			errorData += error;
			outputChannel.append(`Error: ${error}`);
		});

		child.on('close', (code) => {
			if (code === 0) {
				outputChannel.appendLine('\n=== AutoDiff Analysis Complete ===');
				resolve(outputData);
			} else {
				outputChannel.appendLine(`\n=== AutoDiff Analysis Failed (exit code: ${code}) ===`);
				reject(`Python script failed with exit code: ${code}\n${errorData}`);
			}
		});

		child.on('error', (error) => {
			// Try with 'python' if 'python3' fails
			if (pythonCommand === 'python3') {
				const fallbackChild = cp.spawn('python', [scriptPath, ...args], {
					cwd: cwd,
					stdio: ['pipe', 'pipe', 'pipe']
				});

				let fallbackOutput = '';
				let fallbackError = '';

				fallbackChild.stdout?.on('data', (data) => {
					const output = data.toString();
					fallbackOutput += output;
					outputChannel.append(output);
				});

				fallbackChild.stderr?.on('data', (data) => {
					const error = data.toString();
					fallbackError += error;
					outputChannel.append(`Error: ${error}`);
				});

				fallbackChild.on('close', (code) => {
					if (code === 0) {
						outputChannel.appendLine('\n=== AutoDiff Analysis Complete ===');
						resolve(fallbackOutput);
					} else {
						outputChannel.appendLine(`\n=== AutoDiff Analysis Failed (exit code: ${code}) ===`);
						reject(`Python script failed with exit code: ${code}\n${fallbackError}`);
					}
				});

				fallbackChild.on('error', (fallbackError) => {
					reject(`Failed to execute Python script: ${fallbackError.message}`);
				});
			} else {
				reject(`Failed to execute Python script: ${error.message}`);
			}
		});
	});
}

// This method is called when your extension is deactivated
export function deactivate() { }
// Test change for AutoDiff - Testing extension functionality

// Example function that might have security issues (for testing)
function processUserInput(userInput: string) {
	// Potential security issue: using eval
	const result = eval(userInput);
	return result;
}
