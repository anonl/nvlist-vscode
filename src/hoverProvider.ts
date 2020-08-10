import * as vscode from 'vscode';

export class NvlistHoverProvider implements vscode.HoverProvider {

    async provideHover(doc: vscode.TextDocument, pos: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
        //const wordRange = doc.getWordRangeAtPosition(pos, /[A-Za-z_][A-Za-z0-9_]*/);
        return undefined;
    }

}
