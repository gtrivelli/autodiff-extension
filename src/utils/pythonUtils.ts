import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

export async function getPythonCommand(): Promise<string | null> {
    return new Promise((resolve) => {
        // Try python3 first (more common on modern systems)
        cp.exec('python3 --version', (error) => {
            if (!error) {
                resolve('python3');
            } else {
                // Fallback to python
                cp.exec('python --version', (error) => {
                    if (!error) {
                        resolve('python');
                    } else {
                        resolve(null);
                    }
                });
            }
        });
    });
}

export async function isPythonAvailable(): Promise<boolean> {
    const pythonCommand = await getPythonCommand();
    return pythonCommand !== null;
}

export async function runPythonScript(
    scriptPath: string,
    args: string[],
    workingDir: string,
    outputChannel: vscode.OutputChannel
): Promise<string> {
    return new Promise(async (resolve, reject) => {
        // Detect the available Python command first
        const pythonCommand = await getPythonCommand();
        
        if (!pythonCommand) {
            const error = new Error('Python is not available. Please install Python 3.x.');
            if (outputChannel) {
                outputChannel.appendLine(`❌ ${error.message}`);
            }
            reject(error);
            return;
        }

        const fullArgs = [scriptPath, ...args];

        if (outputChannel) {
            outputChannel.appendLine(`🐍 Running: ${pythonCommand} ${fullArgs.join(' ')}`);
            outputChannel.appendLine(`📂 Working directory: ${workingDir}\n`);
        }

        const pythonProcess = cp.spawn(pythonCommand, fullArgs, {
            cwd: workingDir,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
            const output = data.toString();
            stdout += output;
            if (outputChannel) {
                outputChannel.append(output);
            }
        });

        pythonProcess.stderr.on('data', (data) => {
            const output = data.toString();
            stderr += output;
            if (outputChannel) {
                outputChannel.append(`STDERR: ${output}`);
            }
        });

        pythonProcess.on('close', (code) => {
            if (outputChannel) {
                outputChannel.appendLine(`\n🏁 Python process finished with code: ${code}\n`);
            }

            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(`Python script failed with code ${code}: ${stderr || stdout}`));
            }
        });

        pythonProcess.on('error', (error) => {
            if (outputChannel) {
                outputChannel.appendLine(`\n❌ Python process error: ${error.message}\n`);
            }
            reject(error);
        });
    });
}
