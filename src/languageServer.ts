import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as net from 'net';

import { LanguageClient, LanguageClientOptions, ServerOptions, RequestType, TextDocumentIdentifier } from 'vscode-languageclient';

let client: LanguageClient;
let serverProcess: cp.ChildProcess;
let serverSocket: net.Server;
let socket: net.Socket;

export async function startLanguageServer(context: vscode.ExtensionContext, buildToolsFolder: string): Promise<void> {
    // Start listenening for incoming connections
    serverSocket = net.createServer();
    await new Promise((resolve, reject) => {
        serverSocket.listen().once('listening', resolve).once('error', reject);
    });
    const port: number = (serverSocket.address() as net.AddressInfo).port;

    // Start language server, telling it the port number we're listening on
    const gradleArgs = [
        'runLanguageServer',
        `-Pargs=${port}`
    ];
    const gradleWrapper = (os.platform() === 'win32' ? 'gradlew.bat' : 'gradlew');
    serverProcess = cp.spawn(gradleWrapper, gradleArgs, {
        cwd: buildToolsFolder,
    });
    serverProcess.stdout?.on('data', data => console.log(data.toString()));
    serverProcess.stderr?.on('data', data => console.warn(data.toString()));

    const serverOptions: ServerOptions = async () => {
        // Wait for incoming connection from language server
        socket = await new Promise((resolve, reject) => {
            serverSocket.on('connection', resolve).once('error', reject);
        });
        return { reader: socket, writer: socket };
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { language: 'nvlist' },
            { language: 'lua' },
        ],
        synchronize: {
            fileEvents: [
                vscode.workspace.createFileSystemWatcher('**/*.lua'),
                vscode.workspace.createFileSystemWatcher('**/*.lvn'),
            ],
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
    };

    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('nvlist-builtin', contentProvider));
}

export function stopLanguageServer() {
    serverSocket?.close();
    client?.stop();
    serverProcess?.kill();
}
