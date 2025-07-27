// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "autodiff" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('autodiff.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from autodiff!');
	});

	// Register the new AutoDiff command
	const autodiffDisposable = vscode.commands.registerCommand('autodiff.runSecurityReview', async () => {
		await runAutoDiffReview(['security']);
	});

	context.subscriptions.push(disposable, autodiffDisposable);
}

async function runAutoDiffReview(modes: string[]) {
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
			// Get git diff
			const diffContent = await getGitDiff(workspaceFolder.uri.fsPath);
			
			if (!diffContent) {
				vscode.window.showInformationMessage('No changes found to review.');
				return;
			}

			// Create output channel
			const outputChannel = vscode.window.createOutputChannel('AutoDiff Results');
			outputChannel.show();
			outputChannel.appendLine('=== AutoDiff Analysis Starting ===\n');

			// Run Python script
			const extensionPath = path.dirname(path.dirname(__filename)); // Go up from dist/ to extension root
			const backendPath = path.join(extensionPath, 'backend');
			const pythonScript = path.join(backendPath, 'main.py');

			const args = [
				'--modes', ...modes,
				'--output', 'markdown',
				'--staged' // For now, only analyze staged changes
			];

			await runPythonScript(pythonScript, args, workspaceFolder.uri.fsPath, outputChannel);

		} catch (error) {
			vscode.window.showErrorMessage(`AutoDiff analysis failed: ${error}`);
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
	return new Promise((resolve, reject) => {
		cp.exec('git diff --staged', { cwd: workspacePath }, (error, stdout, stderr) => {
			if (error) {
				// If no staged changes, try unstaged changes
				cp.exec('git diff HEAD', { cwd: workspacePath }, (error2, stdout2, stderr2) => {
					if (error2) {
						reject(`Git diff failed: ${stderr2}`);
					} else {
						resolve(stdout2);
					}
				});
			} else {
				resolve(stdout);
			}
		});
	});
}

async function runPythonScript(scriptPath: string, args: string[], cwd: string, outputChannel: vscode.OutputChannel): Promise<void> {
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
				resolve();
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
						resolve();
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
export function deactivate() {}
// Test change for AutoDiff
