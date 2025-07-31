import * as vscode from 'vscode';

export class ConfigurationService {
    private getConfig() {
        return vscode.workspace.getConfiguration('autodiff');
    }

    getLlmProvider(): string {
        return this.getConfig().get<string>('llmProvider', 'chatgpt');
    }

    setLlmProvider(value: string): Thenable<void> {
        return this.getConfig().update('llmProvider', value, vscode.ConfigurationTarget.Workspace);
    }

    getEnableLLMAnalysis(): boolean {
        return this.getConfig().get<boolean>('enableLLMAnalysis', false);
    }

    setEnableLLMAnalysis(value: boolean): Thenable<void> {
        return this.getConfig().update('enableLLMAnalysis', value, vscode.ConfigurationTarget.Workspace);
    }

    getOpenaiApiKey(): string {
        return this.getConfig().get<string>('openaiApiKey', '');
    }

    setOpenaiApiKey(value: string): Thenable<void> {
        return this.getConfig().update('openaiApiKey', value, vscode.ConfigurationTarget.Global);
    }

    getGeminiApiKey(): string {
        return this.getConfig().get<string>('geminiApiKey', '');
    }

    setGeminiApiKey(value: string): Thenable<void> {
        return this.getConfig().update('geminiApiKey', value, vscode.ConfigurationTarget.Global);
    }

    getClaudeApiKey(): string {
        return this.getConfig().get<string>('claudeApiKey', '');
    }

    setClaudeApiKey(value: string): Thenable<void> {
        return this.getConfig().update('claudeApiKey', value, vscode.ConfigurationTarget.Global);
    }

    getBaseBranch(): string {
        return this.getConfig().get<string>('baseBranch', 'origin/main');
    }

    setBaseBranch(value: string): Thenable<void> {
        return this.getConfig().update('baseBranch', value, vscode.ConfigurationTarget.Workspace);
    }

    getEnableBranchComparison(): boolean {
        return this.getConfig().get<boolean>('enableBranchComparison', true);
    }

    setEnableBranchComparison(value: boolean): Thenable<void> {
        return this.getConfig().update('enableBranchComparison', value, vscode.ConfigurationTarget.Workspace);
    }

    getEnableDebugOutput(): boolean {
        return this.getConfig().get<boolean>('enableDebugOutput', false);
    }

    setEnableDebugOutput(value: boolean): Thenable<void> {
        return this.getConfig().update('enableDebugOutput', value, vscode.ConfigurationTarget.Workspace);
    }

    getShowOnlyFilesWithIssues(): boolean {
        return this.getConfig().get<boolean>('showOnlyFilesWithIssues', false);
    }

    setShowOnlyFilesWithIssues(value: boolean): Thenable<void> {
        return this.getConfig().update('showOnlyFilesWithIssues', value, vscode.ConfigurationTarget.Workspace);
    }

    getShowPassedReviews(): boolean {
        return this.getConfig().get<boolean>('showPassedReviews', true);
    }

    setShowPassedReviews(value: boolean): Thenable<void> {
        return this.getConfig().update('showPassedReviews', value, vscode.ConfigurationTarget.Workspace);
    }

    getExpandFilesByDefault(): boolean {
        return this.getConfig().get<boolean>('expandFilesByDefault', false);
    }

    setExpandFilesByDefault(value: boolean): Thenable<void> {
        return this.getConfig().update('expandFilesByDefault', value, vscode.ConfigurationTarget.Workspace);
    }
}
