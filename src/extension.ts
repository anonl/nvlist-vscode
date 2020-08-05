import * as vscode from 'vscode';

import { GradleTaskProvider } from './gradleTaskProvider';

let taskProvider: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext): void {  
	const workspaceRoot = vscode.workspace.rootPath;
	if (!workspaceRoot) {
		return;
	}    

    console.log("NVList extension activated");
    taskProvider = vscode.tasks.registerTaskProvider(GradleTaskProvider.NVLIST_TASK_TYPE,
            new GradleTaskProvider(workspaceRoot));
}

export function deactivate(): void {
    taskProvider?.dispose();
}
