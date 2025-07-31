import * as vscode from 'vscode';
import * as path from 'path';
import { DTOUtils } from '../dto';
import { ConfigurationService } from './ConfigurationService';
import {
    isPythonAvailable,
    runPythonScript,
    getGitDiff,
    getUntrackedFiles,
    parseReviewResults
} from '../utils';

// Type definition for AutoDiffTreeDataProvider (will be imported properly once providers are extracted)
interface AutoDiffTreeDataProvider {
    updateReviewResultsFromDTO(analysisResult: any, modes: string[]): void;
    updateReviewResults(reviewType: string, results: any[]): void;
    refresh(): void;
}

export class ReviewService {
    private configService: ConfigurationService;

    constructor() {
        this.configService = new ConfigurationService();
    }

    async runAutoDiffReview(
        modes: string[],
        provider?: AutoDiffTreeDataProvider,
        sharedProviders?: AutoDiffTreeDataProvider[],
        updateFileDecorations?: () => void
    ): Promise<void> {
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
        await vscode.window.withProgress({
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
                const llmProvider = this.configService.getLlmProvider();
                const enableLLMAnalysis = this.configService.getEnableLLMAnalysis();
                const chatgptApiKey = this.configService.getOpenaiApiKey();
                const geminiApiKey = this.configService.getGeminiApiKey();
                const claudeApiKey = this.configService.getClaudeApiKey();
                const baseBranch = this.configService.getBaseBranch();
                const enableDebugOutput = this.configService.getEnableDebugOutput();

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
                    '--output', 'plain',  // Use plain output format (json no longer supported)
                    '--base', baseBranch
                ];

                // Add --include-untracked flag if we have untracked files
                if (hasUntrackedFiles) {
                    args.push('--include-untracked');
                    if (outputChannel) {
                        outputChannel.appendLine(`🔍 Including untracked files in analysis\n`);
                    }
                }

                // Handle different provider configurations
                await this.configureProviderArgs(args, modes, diffContent, enableLLMAnalysis, llmProvider, chatgptApiKey, geminiApiKey, claudeApiKey, outputChannel);

                const pythonOutput = await runPythonScript(pythonScript, args, workspaceFolder.uri.fsPath, outputChannel || vscode.window.createOutputChannel('AutoDiff Results'));

                // Parse results and update provider if we have one
                if (provider && pythonOutput) {
                    await this.parseAndUpdateResults(pythonOutput, provider, modes, sharedProviders, updateFileDecorations, outputChannel);
                }
            } catch (error) {
                await this.handleAnalysisError(error, modes, provider, sharedProviders, updateFileDecorations);
            }
        });
    }

    private async configureProviderArgs(
        args: string[],
        modes: string[],
        diffContent: string,
        enableLLMAnalysis: boolean,
        llmProvider: string,
        chatgptApiKey: string,
        geminiApiKey: string,
        claudeApiKey: string,
        outputChannel: vscode.OutputChannel | null
    ): Promise<void> {
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
        } else if (llmProvider === 'claude' && !claudeApiKey) {
            args.push('--dry-run');
            if (outputChannel) {
                outputChannel.appendLine('ℹ️  Running in dry-run mode (Claude API key not configured). Set API key in settings for actual analysis.\n');
            }
        } else {
            // Add provider configuration
            args.push('--provider', llmProvider);

            // Set environment variables for API keys instead of CLI arguments
            if (llmProvider === 'chatgpt' && chatgptApiKey) {
                process.env.OPENAI_API_KEY = chatgptApiKey;
            } else if (llmProvider === 'gemini' && geminiApiKey) {
                process.env.GEMINI_API_KEY = geminiApiKey;
            } else if (llmProvider === 'claude' && claudeApiKey) {
                process.env.ANTHROPIC_API_KEY = claudeApiKey;
            }

            if (outputChannel) {
                outputChannel.appendLine(`🤖 Using ${llmProvider.charAt(0).toUpperCase() + llmProvider.slice(1)} provider for analysis...\n`);
            }
        }
    }

    private async parseAndUpdateResults(
        pythonOutput: string,
        provider: AutoDiffTreeDataProvider,
        modes: string[],
        sharedProviders?: AutoDiffTreeDataProvider[],
        updateFileDecorations?: () => void,
        outputChannel?: vscode.OutputChannel | null
    ): Promise<void> {
        // Parse the plain text output using the legacy parser
        // (JSON output is no longer supported by the backend)
        const results = parseReviewResults(pythonOutput);
        
        if (outputChannel) {
            outputChannel.appendLine(`📊 Analysis complete: ${results.length} issues found\n`);
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

    private async handleAnalysisError(
        error: any,
        modes: string[],
        provider?: AutoDiffTreeDataProvider,
        sharedProviders?: AutoDiffTreeDataProvider[],
        updateFileDecorations?: () => void
    ): Promise<void> {
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
                        this.configService.setLlmProvider('chatgpt');
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
                        this.configService.setLlmProvider('gemini');
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
                    this.runAutoDiffReview(modes, provider, sharedProviders, updateFileDecorations);
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
                        this.runAutoDiffReview(modes, provider, sharedProviders, updateFileDecorations);
                    }, 3000);
                } else if (selection === 'Switch Provider') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'autodiff.llmProvider');
                } else if (selection === 'Run Dry-Run') {
                    // Temporarily disable LLM analysis and run in dry-run mode
                    const originalValue = this.configService.getEnableLLMAnalysis();

                    // Temporarily disable LLM analysis
                    this.configService.setEnableLLMAnalysis(false);

                    // Run the analysis in dry-run mode
                    this.runAutoDiffReview(modes, provider, sharedProviders, updateFileDecorations).finally(() => {
                        // Restore original setting
                        this.configService.setEnableLLMAnalysis(originalValue);
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
}
