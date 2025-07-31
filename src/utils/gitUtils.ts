import * as vscode from 'vscode';
import * as cp from 'child_process';

/**
 * Get git diff content based on configuration settings
 */
export async function getGitDiff(workspacePath: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
        // First check if this is a git repository
        cp.exec('git rev-parse --git-dir', { cwd: workspacePath }, async (error) => {
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

/**
 * Get untracked files from git status
 */
export async function getUntrackedFiles(workspacePath: string): Promise<string[]> {
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

/**
 * Get available git branches
 */
export async function getAvailableBranches(): Promise<string[]> {
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

/**
 * Check if a branch exists
 */
export async function branchExists(branchName: string, workspacePath: string): Promise<boolean> {
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
