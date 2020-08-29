import * as vscode from 'vscode';
import * as util from 'util';
import * as cp from 'child_process';
import * as os from 'os';
import * as net from 'net';

import { LanguageClient, LanguageClientOptions, ServerOptions, RequestType, TextDocumentIdentifier, StreamInfo } from 'vscode-languageclient';

let client: LanguageClient;
let serverProcess: cp.ChildProcess;

export async function startLanguageServer(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('nvlist');

    // TODO: Remove this hack to quickly recompile the langserver before every execution
    await util.promisify(cp.exec)('gradlew.bat :nvlist-langserver:shadowJar', {
        cwd: 'D:/git/nvlist'
    });

    // TODO: Remove hardcoded settings
    const projectFolder = 'D:/git/nvlist';
    const port = 12345;
    const javaHome = config.get('javaHome') || 'C:/Java8';
    const gradleArgs = ['runLangServer', `-Dorg.gradle.java.home=${javaHome}`];
    const gradleWrapper = (os.platform() == 'win32' ? 'gradlew.bat' : 'gradlew');

    serverProcess = cp.spawn(gradleWrapper, gradleArgs, {
        cwd: projectFolder,
    });

    let serverOptions: ServerOptions = () => {
        const socket: net.Socket = net.connect({ port });
        return Promise.resolve({
            reader: socket,
            writer: socket,
        });
    };

    let clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'nvlist' },
            { scheme: 'nvlist-builtin', language: 'nvlist' },
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.lvn'),
        },
    };

    // We need to wait for the language server to start
    client = new LanguageClient('nvlist', 'NVList', serverOptions, clientOptions);
    client.start();
    
    const builtinSourceRequestType = new RequestType<TextDocumentIdentifier, string, void, void>('nvlist/builtinSource');
    const contentProvider: vscode.TextDocumentContentProvider = {
        provideTextDocumentContent: async (uri: vscode.Uri, token: vscode.CancellationToken): Promise<string> => {
            if (!client) {
                return '';
            }
            const docId: TextDocumentIdentifier = { uri: uri.toString() };
            return client.sendRequest(builtinSourceRequestType, docId, token).then(contents => contents ?? '');
        }
    }

	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('nvlist-builtin', contentProvider));
}

export function stopLanguageServer() {
    client?.stop();
    serverProcess?.kill();
}
