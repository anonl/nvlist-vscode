import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';

import { logger, LoggingDebugSession, InitializedEvent, TerminatedEvent, OutputEvent, DebugSession } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';

import * as path from 'path';
import * as net from 'net';
import { spawn, ChildProcess } from 'child_process';

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
const retryTimeout: number = 5_000;

class PipedDebugSession extends DebugSession {

    constructor(private client: DebugSession) {
        super();
    }

    handleMessage(msg: DebugProtocol.ProtocolMessage): void {
        if (msg.type == 'event') {
            console.log(`Received event from remote debug server: ${JSON.stringify(msg)}`);
            this.client.sendEvent(<DebugProtocol.Event>msg);
        }
        super.handleMessage(msg);
    }

}

class NvlistDebugSession extends LoggingDebugSession {

    private stopping: boolean = false;
    private delegate?: DebugSession;
    private childProcess?: ChildProcess;

    constructor() {
        super(undefined, undefined, true);

        logger.init(e => this.sendEvent(e), undefined, true);
    }

    private forwardRequest(request: DebugProtocol.Request) {
        this.delegate?.sendRequest(request.command, request.arguments, defaultTimeout, response => {
            response.seq = 0;
            response.request_seq = request.seq;
            this.sendResponse(response);
        });
    }

    public shutdown() {
        super.shutdown();
        
        console.log('Shutdown request received');
        this.stopping = true;

        this.childProcess?.kill();
        this.delegate?.dispose();
    }

    private sendOutput(category: string, text: string) {
        const event = new OutputEvent(text);
        event.body.category = category;
        this.sendEvent(event);
    }

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        console.log("Initialize request");

        // logger.setup(Logger.LogLevel.Verbose, false);

        response.body = {
            supportsEvaluateForHovers: true,
        };
        this.sendResponse(response);
	}

	protected launchRequest(launchResponse: DebugProtocol.LaunchResponse, args: LaunchRequest): void {
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

        // Connect to the debug adapter server in the child process
        console.log('Connecting to remote debug server...')
        const conn = new net.Socket();
        conn.setTimeout(defaultTimeout);        
        conn.on('connect', () => {
            console.log("Connected to remote debug server");

            const delegate = new PipedDebugSession(this);
            delegate.setRunAsServer(true);
            delegate.start(conn, conn);
            this.delegate = delegate;

            // Initialize delegate
            delegate.sendRequest('initialize', {seq: 0, arguments: {}}, defaultTimeout, initResponse => {
                // Return response to launch request
                console.log("Remote debug server initialized");

                this.sendEvent(new InitializedEvent());
                this.sendResponse(launchResponse);
            });
        });
        conn.on('close', () => {
            if (!this.stopping) {
                // Keep reconnecting until stopped
                setTimeout(() => conn.connect(4711), retryTimeout);
            }
        })
        conn.connect(4711);
	}

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): void {
        console.log(`Disconnect request: ${JSON.stringify(args)}`);

        this.forwardRequest(request!);
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse, request?: DebugProtocol.Request): void {
        console.log(`Threads request`);

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

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments, request?: DebugProtocol.Request): void {
        console.log(`Next request: ${JSON.stringify(args)}`);

        this.forwardRequest(request!);
    }

    protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments, request?: DebugProtocol.Request): void {
        console.log(`Step-in request: ${JSON.stringify(args)}`);

        this.forwardRequest(request!);
    }

    protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments, request?: DebugProtocol.Request): void {
        console.log(`Step-out request: ${JSON.stringify(args)}`);

        this.forwardRequest(request!);
    }

    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request): void {
        console.log(`SetBreakpoints request: ${JSON.stringify(args)}`);

        this.forwardRequest(request!);
    }

    protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments, request?: DebugProtocol.Request): void {
        console.log(`Evaluate request: ${JSON.stringify(args)}`);

        this.forwardRequest(request!);
    }

    protected setExpressionRequest(response: DebugProtocol.SetExpressionResponse, args: DebugProtocol.SetExpressionArguments, request?: DebugProtocol.Request): void {
        console.log(`SetExpression request: ${JSON.stringify(args)}`);

        this.forwardRequest(request!);
    }

}
