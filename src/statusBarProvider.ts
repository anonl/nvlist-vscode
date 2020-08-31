import * as vscode from 'vscode';

export class NvlistStatusBarProvider implements vscode.Disposable {

    private readonly statusBarItem : vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1_000);
    private readonly listeners: vscode.Disposable[] = [];

    constructor() {
        this.listeners.push(vscode.window.onDidChangeActiveTextEditor(() => this.updateWordCount()));
        this.listeners.push(vscode.workspace.onDidChangeTextDocument(() => this.updateWordCount()));

        this.updateWordCount();
    }

    private updateWordCount() {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'nvlist') {
            let count = 0;
            let block;
            for (let lineNum = 0; lineNum < editor.document.lineCount; lineNum++) {
                const text = editor.document.lineAt(lineNum).text.trim();
                if (block) {
                    if (text.startsWith(block)) {
                        block = undefined;
                    }
                } else {
                    if (text.startsWith('@@')) {
                        block = '@@';
                    } else if (text.startsWith('##')) {
                        block = '##';
                    } else if (text.startsWith('@') || text.startsWith('#')) {
                        // Ignore
                    } else {
                        // This is very basic, but it's probably good enough
                        count += text.split(/\s+/)
                            .filter(w => w.length > 0)
                            .length;
                    }
                }
            }
            this.statusBarItem.text = `Word count: ${count}`;
            this.statusBarItem.show();
        } else {
            this.statusBarItem.hide();
        }
    }

    dispose() {
        this.listeners.forEach(ls => ls.dispose());
        this.statusBarItem?.dispose();
    }
}
