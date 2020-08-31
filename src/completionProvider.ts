import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface PathMatch {
    pathPrefix: string;
    quotedRange: vscode.Range;
}

export class NvlistCompletionProvider implements vscode.CompletionItemProvider {

    async provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position, token: vscode.CancellationToken,
        context: vscode.CompletionContext)
    {

        const results: vscode.CompletionItem[] = [];
        const curLine = doc.lineAt(pos.line).text;
        if (pos.character === 0 || (pos.character === 1 && curLine.charAt(0) === '$')) {
            for (const s of this.getSpeakers(doc)) {
                const item = new vscode.CompletionItem(s);
                item.kind = vscode.CompletionItemKind.User;
                results.push(item);
            }
        }

        const pathResults = await this.getPathCompletionItems(doc, pos);
        if (pathResults) {
            results.push(...pathResults);
        }
        return results;
    }

    private async getPathCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.CompletionItem[] | undefined> {
        const pathMatch: PathMatch | null = this.getPathMatchAt(doc, pos);
        if (pathMatch === null) {
            return [];
        }

        const wsFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
        if (wsFolder === undefined) {
            return [];
        }

        // TODO: Take context into account to switch between img/snd/script/video
        const baseDir = path.join(wsFolder.uri.fsPath, 'res', 'img');

        // Note: NVList paths always use '/' as a separator
        const dirs: string[] = [];
        let namePrefix;
        const pathPrefix = pathMatch.pathPrefix;
        if (pathPrefix.length === 0 || pathPrefix.endsWith('/')) {
            dirs.push(path.join(baseDir, pathPrefix));
            namePrefix = '';
        } else {
            dirs.push(path.resolve(baseDir, pathPrefix, '..'));
            namePrefix = path.basename(pathPrefix);
        }

        const results: vscode.CompletionItem[] = [];
        for (const dir of dirs) {
            for (const name of await fs.promises.readdir(dir)) {
                if (!name.startsWith(namePrefix)) {
                    continue;
                }

                const pathString = path.join(dir, name);
                const stat = await fs.promises.lstat(pathString);

                const relPath = path.parse(path.relative(dir, pathString));
                let stripped = (relPath.dir ? relPath.dir + '/' : '') + relPath.name;
                if (stat.isDirectory()) {
                    stripped += '/';
                }

                // TODO: Should replace the whole string (until ['"#]) instead of inserting
                const item = new vscode.CompletionItem(stripped);
                const splitIndex = pathPrefix.lastIndexOf('/') + 1;

                // The filterText must match the text at item.range
                item.filterText = pathPrefix;
                item.range = pathMatch.quotedRange.with(pathMatch.quotedRange.start.translate(0, splitIndex));
                if (stat.isDirectory()) {
                    item.kind = vscode.CompletionItemKind.Folder;
                    item.sortText = 'dir';
                } else {
                    item.kind = vscode.CompletionItemKind.File;
                    item.sortText = 'file';
                }
                results.push(item);
            }
        }
        return results;
    }

    private getPathMatchAt(doc: vscode.TextDocument, pos: vscode.Position): PathMatch | null {
        const line = doc.lineAt(pos.line).text;
        const re = /(["'])(\\.|[^\\])*?\1/g;

        let match: RegExpExecArray | null;
        while ((match = re.exec(line)) != null) {
            if (match.index > pos.character) {
                break; // This string starts past our position
            }

            const matchLength = match[0].length;
            const endIndex = match.index + matchLength;
            if (pos.character < endIndex) {
                // Match starts before our position and ends after out position
                return {
                    pathPrefix: match[0].substring(1, matchLength - (endIndex - pos.character)),
                    quotedRange: new vscode.Range(pos.line, match.index + 1, pos.line, endIndex - 1),
                };
            }
        }
        return null;
    }

    private getSpeakers(doc: vscode.TextDocument): Set<string> {
        const results: Set<string> = new Set();
        for (let lineIndex = 0; lineIndex < doc.lineCount; lineIndex++) {
            const line = doc.lineAt(lineIndex).text;

            const re = /\$\S+/g;
            let match: RegExpExecArray | null;
            while ((match = re.exec(line)) != null) {
                results.add(match[0]);
            }
        }
        return results;
    }

}
