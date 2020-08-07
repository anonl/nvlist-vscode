import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';

import { LoggingDebugSession, InitializedEvent, TerminatedEvent, OutputEvent, DebugSession } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';

import * as path from 'path';
import * as net from 'net';
import { spawn, ChildProcess } from 'child_process';
import { logger, LogLevel } from 'vscode-debugadapter/lib/logger';

export class DebugConfigProvider implements vscode.DebugConfigurationProvider {
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'nvlist') {
				config.type = 'nvlist';
				config.name = 'Launch';
                config.request = 'launch';
                config.program = '${file}';
                config.projectFolder = folder?.uri.fsPath ?? '';
                config.buildToolsFolder = path.join(config.projectFolder, 'build-tools');
			}
		}
		return config;
	}
}

export class DebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
	createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): ProviderResult<vscode.DebugAdapterDescriptor> {
		return executable ?? new vscode.DebugAdapterInlineImplementation(new NvlistDebugSession());
	}
}

interface LaunchRequest extends DebugProtocol.LaunchRequestArguments {
    projectFolder: string;
    buildToolsFolder: string;
	program: string;
}

const defaultTimeout: number = 10_000;

class PipedDebugSession extends DebugSession {

    constructor(private client: DebugSession) {
        super();
    }

    handleMessage(msg: DebugProtocol.ProtocolMessage): void {
        if (msg.type == 'event') {
            this.client.sendEvent(<DebugProtocol.Event>msg);
        }
        super.handleMessage(msg);
    }

}

class NvlistDebugSession extends LoggingDebugSession {

    private delegate?: DebugSession;
    private childProcess?: ChildProcess;

    private forwardRequest(request: DebugProtocol.Request) {
        this.delegate?.sendRequest(request.command, request.arguments, defaultTimeout, response => {
            response.seq = 0;
            response.request_seq = request.seq;
            this.sendResponse(response);
        });
    }

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        console.log("Initialize request");

        logger.setup(LogLevel.Verbose, true);

        // TODO: Open socket to remote, pass in/out streams to delegate
        const conn = net.connect({
            port: 12345,
            timeout: 30_000,
        }, () => {
            console.log("Connected to remote debug server");
        });
        
        const delegate = new PipedDebugSession(this);
        delegate.start(conn, conn);
        this.delegate = delegate;

        this.forwardRequest({command: 'initialize', type: 'request', seq: 1, arguments: args});

		this.sendEvent(new InitializedEvent());
	}

    public shutdown() {
        super.shutdown();

        console.log('Shutdown request received');

        this.childProcess?.kill(0);
        this.delegate?.dispose();
    }

    private sendOutput(category: string, text: string) {
        const event = new OutputEvent(text);
        event.body.category = category;
        this.sendEvent(event);
    }

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequest) {
        console.log(`Launch request: ${JSON.stringify(args)}`);

        const childProcess = spawn(`gradlew.bat`, ['-PvnRoot=' + args.projectFolder, 'runDesktop'], {
            cwd: args.buildToolsFolder
        })
        this.childProcess = childProcess;

        // Forward output
        childProcess.stdout.on('data', data => this.sendOutput('stdout', data.toString()));
        childProcess.stderr.on('data', data => this.sendOutput('stderr', data.toString()));

        // Terminate when the launched process exits
        childProcess.on('exit', () => this.sendEvent(new TerminatedEvent()));

		this.sendResponse(response);
	}

    protected threadsRequest(response: DebugProtocol.ThreadsResponse, request?: DebugProtocol.Request): void {
        console.log(`Threads request: ${JSON.stringify(request)}`);

        this.forwardRequest(request!);
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments, request?: DebugProtocol.Request): void {
        console.log(`StackTrace request: ${JSON.stringify(args)}`);

        this.forwardRequest(request!);
    }

    protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments, request?: DebugProtocol.Request): void {
        console.log(`Pause request: ${JSON.stringify(args)}`);

        this.forwardRequest(request!);
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments, request?: DebugProtocol.Request): void {
        console.log(`Continue request: ${JSON.stringify(args)}`);

        this.forwardRequest(request!);
    }

}
