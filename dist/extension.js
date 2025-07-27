"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode = __toESM(require("vscode"));
var cp = __toESM(require("child_process"));
var path = __toESM(require("path"));
function activate(context) {
  console.log('Congratulations, your extension "autodiff" is now active!');
  const disposable = vscode.commands.registerCommand("autodiff.helloWorld", () => {
    vscode.window.showInformationMessage("Hello World from autodiff!");
  });
  const autodiffDisposable = vscode.commands.registerCommand("autodiff.runSecurityReview", async () => {
    await runAutoDiffReview(["security"]);
  });
  context.subscriptions.push(disposable, autodiffDisposable);
}
async function runAutoDiffReview(modes) {
  if (!await isPythonAvailable()) {
    vscode.window.showErrorMessage("Python is not installed or not available in PATH. Please install Python to use AutoDiff.");
    return;
  }
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("No workspace folder found. Please open a folder or workspace.");
    return;
  }
  vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Running AutoDiff analysis...",
    cancellable: false
  }, async (progress) => {
    try {
      const diffContent = await getGitDiff(workspaceFolder.uri.fsPath);
      if (!diffContent) {
        vscode.window.showInformationMessage("No changes found to review.");
        return;
      }
      const outputChannel = vscode.window.createOutputChannel("AutoDiff Results");
      outputChannel.show();
      outputChannel.appendLine("=== AutoDiff Analysis Starting ===\n");
      const extensionPath = path.dirname(path.dirname(__filename));
      const backendPath = path.join(extensionPath, "backend");
      const pythonScript = path.join(backendPath, "main.py");
      const args = [
        "--modes",
        ...modes,
        "--output",
        "markdown",
        "--staged"
        // For now, only analyze staged changes
      ];
      await runPythonScript(pythonScript, args, workspaceFolder.uri.fsPath, outputChannel);
    } catch (error) {
      vscode.window.showErrorMessage(`AutoDiff analysis failed: ${error}`);
    }
  });
}
async function isPythonAvailable() {
  return new Promise((resolve) => {
    cp.exec("python --version", (error) => {
      if (error) {
        cp.exec("python3 --version", (error2) => {
          resolve(!error2);
        });
      } else {
        resolve(true);
      }
    });
  });
}
async function getGitDiff(workspacePath) {
  return new Promise((resolve, reject) => {
    cp.exec("git diff --staged", { cwd: workspacePath }, (error, stdout, stderr) => {
      if (error) {
        cp.exec("git diff HEAD", { cwd: workspacePath }, (error2, stdout2, stderr2) => {
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
async function runPythonScript(scriptPath, args, cwd, outputChannel) {
  return new Promise((resolve, reject) => {
    const pythonCommand = "python3";
    const child = cp.spawn(pythonCommand, [scriptPath, ...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let outputData = "";
    let errorData = "";
    child.stdout?.on("data", (data) => {
      const output = data.toString();
      outputData += output;
      outputChannel.append(output);
    });
    child.stderr?.on("data", (data) => {
      const error = data.toString();
      errorData += error;
      outputChannel.append(`Error: ${error}`);
    });
    child.on("close", (code) => {
      if (code === 0) {
        outputChannel.appendLine("\n=== AutoDiff Analysis Complete ===");
        resolve();
      } else {
        outputChannel.appendLine(`
=== AutoDiff Analysis Failed (exit code: ${code}) ===`);
        reject(`Python script failed with exit code: ${code}
${errorData}`);
      }
    });
    child.on("error", (error) => {
      if (pythonCommand === "python3") {
        const fallbackChild = cp.spawn("python", [scriptPath, ...args], {
          cwd,
          stdio: ["pipe", "pipe", "pipe"]
        });
        let fallbackOutput = "";
        let fallbackError = "";
        fallbackChild.stdout?.on("data", (data) => {
          const output = data.toString();
          fallbackOutput += output;
          outputChannel.append(output);
        });
        fallbackChild.stderr?.on("data", (data) => {
          const error2 = data.toString();
          fallbackError += error2;
          outputChannel.append(`Error: ${error2}`);
        });
        fallbackChild.on("close", (code) => {
          if (code === 0) {
            outputChannel.appendLine("\n=== AutoDiff Analysis Complete ===");
            resolve();
          } else {
            outputChannel.appendLine(`
=== AutoDiff Analysis Failed (exit code: ${code}) ===`);
            reject(`Python script failed with exit code: ${code}
${fallbackError}`);
          }
        });
        fallbackChild.on("error", (fallbackError2) => {
          reject(`Failed to execute Python script: ${fallbackError2.message}`);
        });
      } else {
        reject(`Failed to execute Python script: ${error.message}`);
      }
    });
  });
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
