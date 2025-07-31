import * as vscode from 'vscode';
import * as path from 'path';
import { ReviewItem, FileReviewResult } from '../models';
import { DTOUtils, IssueDTO, Severity, AnalysisResultDTO } from '../dto';
import { getGitDiff, getUntrackedFiles, getAvailableBranches } from '../utils';
import { AutoDiffFileDecorationProvider } from './AutoDiffFileDecorationProvider';

// Helper function to get severity emoji
function getSeverityEmoji(severity: string | Severity): string {
    // Convert severity to lowercase string for comparison
    const severityStr = severity.toLowerCase();
    
    switch (severityStr) {
        case 'high':
            return '🔴'; // Red circle for high severity
        case 'medium':
            return '🟠'; // Orange circle for medium severity
        case 'low':
            return '🟡'; // Yellow circle for low severity
        default:
            return '⚪'; // White circle for unknown severity
    }
}

// Helper function to format review type for display
function formatReviewType(reviewType: string): string {
    switch (reviewType.toLowerCase()) {
        case 'security':
            return '🔒 Security Review';
        case 'accessibility':
            return '♿ Accessibility Review';
        case 'performance':
            return '⚡ Performance Review';
        case 'quality':
            return '✨ Quality Review';
        default:
            return `📋 ${reviewType.charAt(0).toUpperCase() + reviewType.slice(1)} Review`;
    }
}

export class AutoDiffTreeDataProvider implements vscode.TreeDataProvider<ReviewItem> {
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
        this._onDidChangeTreeData.fire(undefined);
    }

    getSelectedReviews(): string[] {
        return Array.from(this.selectedReviews);
    }

    getReviewResults(): Map<string, any> {
        return this.reviewResults;
    }

    refresh(): void {
        this.loadChangedFiles();
        this._onDidChangeTreeData.fire(undefined);
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
        try {
            // Process review results and update file statuses
            for (const file of this.changedFiles) {
            if (!this.reviewResults.has(file)) {
                this.reviewResults.set(file, { file, results: {} });
            }

            const fileResult = this.reviewResults.get(file)!;
            const fileIssues = results.filter(r => r.file_path === file || r.file === file);

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
                issues: fileIssues.length,
                issueDetails: fileIssues // Store individual issues for tree view
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
        } catch (error) {
            console.error('[AutoDiff] Error in updateReviewResults:', error);
        }
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

            // Use VS Code's built-in file icon system - works for ANY file type
            const item = new ReviewItem(
                file,  // Clean filename without status indicators
                tooltip,
                vscode.TreeItemCollapsibleState.None,
                'file',
                vscode.ThemeIcon.File, // VS Code automatically selects appropriate icon
                false,
                file
            );

            // Set the resource URI for proper file icon theming and decorations
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
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
                        const severityEmoji = getSeverityEmoji(issue.severity);
                        
                        // Use the specific review type from the issue, or fall back to general logic
                        const specificReviewType = (issue as any).review_type;
                        const reviewTypeFormatted = specificReviewType 
                            ? formatReviewType(specificReviewType)
                            : (Object.keys(fileResult.results).length > 1 
                                ? `🔍 Multiple Reviews (${Object.keys(fileResult.results).join(', ')})`
                                : formatReviewType(reviewType));
                            
                        const item = new ReviewItem(
                            `${severityEmoji} ${issue.issue}`,
                            `Review Type: ${reviewTypeFormatted}\nFile: ${issue.file_path}\nLine: ${lineInfo}\nSeverity: ${issue.severity}\nConfidence: ${issue.confidence}%\n\nCode: ${issue.code}\n\nSuggestion: ${issue.suggestion}`,
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
                    const item = new ReviewItem(
                        `${fileName}`,
                        `✅ File passed all reviews: ${fileName}`,
                        vscode.TreeItemCollapsibleState.None,
                        'file',
                        vscode.ThemeIcon.File, // VS Code handles icon for any file type
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
                                const severityEmoji = getSeverityEmoji(issue.severity);
                                
                                // Use the specific review type from the issue, or fall back to general logic
                                const specificReviewType = (issue as any).review_type;
                                const reviewTypeFormatted = specificReviewType 
                                    ? formatReviewType(specificReviewType)
                                    : (Object.keys(fileResult.results).length > 1 
                                        ? `🔍 Multiple Reviews (${Object.keys(fileResult.results).join(', ')})`
                                        : formatReviewType(reviewType));
                                    
                                const item = new ReviewItem(
                                    `${severityEmoji} ${issue.issue}`,
                                    `Review Type: ${reviewTypeFormatted}\nFile: ${issue.file_path}\nLine: ${lineInfo}\nSeverity: ${issue.severity}\nConfidence: ${issue.confidence}%\n\nCode: ${issue.code}\n\nSuggestion: ${issue.suggestion}`,
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
                                const severityEmoji = getSeverityEmoji(issue.severity);
                                
                                // Use the specific review type from the issue, or fall back to general logic
                                const specificReviewType = (issue as any).review_type;
                                const reviewTypeFormatted = specificReviewType 
                                    ? formatReviewType(specificReviewType)
                                    : (Object.keys(fileResult.results).length > 1 
                                        ? `🔍 Multiple Reviews (${Object.keys(fileResult.results).join(', ')})`
                                        : formatReviewType(reviewType));
                                    
                                const item = new ReviewItem(
                                    `${severityEmoji} ${issue.issue}`,
                                    `Review Type: ${reviewTypeFormatted}\nFile: ${issue.file_path}\nLine: ${lineInfo}\nSeverity: ${issue.severity}\nConfidence: ${issue.confidence}%\n\nCode: ${issue.code}\n\nSuggestion: ${issue.suggestion}`,
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
            const typedResult = result as any;
            const statusEmoji = typedResult.status === 'pass' ? '✅' : typedResult.status === 'fail' ? '❌' : '⚠️';
            tooltip += `\n${reviewType}: ${statusEmoji} ${typedResult.issues} issues (${typedResult.confidence}% confidence)`;
        }
        return tooltip;
    }
}
