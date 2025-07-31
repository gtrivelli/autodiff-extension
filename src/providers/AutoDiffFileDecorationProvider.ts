import * as vscode from 'vscode';
import * as path from 'path';

export class AutoDiffFileDecorationProvider implements vscode.FileDecorationProvider {
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
