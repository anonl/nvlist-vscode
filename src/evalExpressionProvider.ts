import * as vscode from 'vscode';

export class NvlistEvalExpressionProvider implements vscode.EvaluatableExpressionProvider {

    async provideEvaluatableExpression(doc: vscode.TextDocument, pos: vscode.Position, token: vscode.CancellationToken): Promise<vscode.EvaluatableExpression | undefined> {
        const wordRange = doc.getWordRangeAtPosition(pos, /[A-Za-z_][A-Za-z0-9_]*/);
        if (wordRange) {
            return new vscode.EvaluatableExpression(wordRange);
        }
        return undefined;
    }

}
