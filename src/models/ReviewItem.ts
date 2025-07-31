import * as vscode from 'vscode';
import * as path from 'path';
import { IssueDTO } from '../dto';

export class ReviewItem extends vscode.TreeItem {
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
