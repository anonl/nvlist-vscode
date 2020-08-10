import * as vscode from 'vscode';

import { GradleTaskProvider } from './gradleTaskProvider';
import { DebugConfigProvider, DebugAdapterFactory } from './debugProvider';
import { NvlistHoverProvider } from './hoverProvider';
import { NvlistEvalExpressionProvider } from './evalExpressionProvider';

export function activate(context: vscode.ExtensionContext): void {  
	const workspaceRoot = vscode.workspace.rootPath;
	if (!workspaceRoot) {
		return;
	}    

    console.log("NVList extension activated");
    context.subscriptions.push(vscode.tasks.registerTaskProvider(GradleTaskProvider.NVLIST_TASK_TYPE,
            new GradleTaskProvider(workspaceRoot)));

    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('nvlist',
        new DebugConfigProvider()));
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('nvlist',
        new DebugAdapterFactory()));

    const documentSelector: vscode.DocumentSelector = {language: 'nvlist'};
    context.subscriptions.push(vscode.languages.registerHoverProvider(documentSelector, new NvlistHoverProvider()));
    context.subscriptions.push(vscode.languages.registerEvaluatableExpressionProvider(documentSelector, new NvlistEvalExpressionProvider()));
}

export function deactivate() {
}
