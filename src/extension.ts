import * as vscode from 'vscode';

import { GradleTaskProvider } from './gradleTaskProvider';
import { DebugConfigProvider, DebugAdapterFactory } from './debugProvider';
import { NvlistHoverProvider } from './hoverProvider';
import { NvlistEvalExpressionProvider } from './evalExpressionProvider';
import { NvlistStatusBarProvider } from './statusBarProvider';
import { NvlistCompletionProvider } from './completionProvider';
import { startLanguageServer, stopLanguageServer } from './languageServer';

export async function activate(context: vscode.ExtensionContext) {
    const workspaceRoot = vscode.workspace.rootPath;
    if (!workspaceRoot) {
        return;
    }

    console.log('NVList extension activated');
    context.subscriptions.push(new NvlistStatusBarProvider());

    context.subscriptions.push(vscode.tasks.registerTaskProvider(GradleTaskProvider.NVLIST_TASK_TYPE,
        new GradleTaskProvider(workspaceRoot)));

    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('nvlist',
        new DebugConfigProvider()));
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('nvlist',
        new DebugAdapterFactory()));

    const documentSelector: vscode.DocumentSelector = { language: 'nvlist' };
    context.subscriptions.push(vscode.languages.registerHoverProvider(documentSelector,
        new NvlistHoverProvider()));
    context.subscriptions.push(vscode.languages.registerEvaluatableExpressionProvider(documentSelector,
        new NvlistEvalExpressionProvider()));

    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(documentSelector,
        new NvlistCompletionProvider()));

    const config = vscode.workspace.getConfiguration('nvlist');
    const buildToolsFolder = config.get('buildToolsFolder');
    if (buildToolsFolder) {
        console.info(`Starting language server (buildToolsFolder=${buildToolsFolder})`);
        startLanguageServer(context, buildToolsFolder as string);
    } else {
        console.info('nvlist.buildToolsFolder not set, no language server will be started');
    }
}

export function deactivate() {
    stopLanguageServer();
}
