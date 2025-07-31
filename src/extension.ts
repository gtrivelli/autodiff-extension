// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { AutoDiffTreeDataProvider, AutoDiffFileDecorationProvider } from './providers';
import { getAvailableBranches} from './utils';
import { ReviewService } from './services';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "autodiff" is now active!');

	// Create review service
	const reviewService = new ReviewService();

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

	// Share the data objects between all providers
	[branchProvider, reviewsProvider, changesProvider, resultsProvider].forEach(provider => {
		provider.setSharedData(sharedData);
	});

	// Load shared data once using the main provider
	await reviewsProvider.loadInitialData();

	// Update file decoration provider with shared data
	fileDecorationProvider.updateChangedFiles(sharedData.changedFiles);
	fileDecorationProvider.updateReviewResults(sharedData.reviewResults);

	// Share state between providers - they should all reference the same data
	const sharedProviders = [branchProvider, reviewsProvider, changesProvider, resultsProvider];

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

		await reviewService.runAutoDiffReview(['security'], reviewsProvider, sharedProviders, updateFileDecorations);
	});

	const accessibilityReviewDisposable = vscode.commands.registerCommand('autodiff.runAccessibilityReview', async () => {
		// Clear previous results before starting new review
		reviewsProvider.clearReviewResults(['accessibility']);
		updateFileDecorations();

		await reviewService.runAutoDiffReview(['accessibility'], reviewsProvider, sharedProviders, updateFileDecorations);
	});

	const performanceReviewDisposable = vscode.commands.registerCommand('autodiff.runPerformanceReview', async () => {
		// Clear previous results before starting new review
		reviewsProvider.clearReviewResults(['performance']);
		updateFileDecorations();

		await reviewService.runAutoDiffReview(['performance'], reviewsProvider, sharedProviders, updateFileDecorations);
	});

	const qualityReviewDisposable = vscode.commands.registerCommand('autodiff.runQualityReview', async () => {
		// Clear previous results before starting new review
		reviewsProvider.clearReviewResults(['quality']);
		updateFileDecorations();

		await reviewService.runAutoDiffReview(['quality'], reviewsProvider, sharedProviders, updateFileDecorations);
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

			await reviewService.runAutoDiffReview(modes, reviewsProvider, sharedProviders, updateFileDecorations);
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

		await reviewService.runAutoDiffReview(selectedReviews, reviewsProvider, sharedProviders, updateFileDecorations);
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
		toggleChangesViewDisposable,
		toggleResultsViewDisposable,
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

// This method is called when your extension is deactivated
export function deactivate() { }
