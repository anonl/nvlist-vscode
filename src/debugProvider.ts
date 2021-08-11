import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';

import { logger, LoggingDebugSession, InitializedEvent, TerminatedEvent, OutputEvent, DebugSession } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';

import * as path from 'path';
import * as net from 'net';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';

const DEFAULT_PORT = 4711;

export class DebugConfigProvider implements vscode.DebugConfigurationProvider {
    resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'nvlist') {
                config.type = 'nvlist';
                config.name = 'Launch';
                config.request = 'launch';
                // Suppress eslint: We so actually want to produce a string with ${file} in it (replaced by vscode at launch time)
                // eslint-disable-next-line no-template-curly-in-string
                config.program = '${file}';
                config.projectFolder = folder?.uri.fsPath ?? '';
                config.buildToolsFolder = path.join(config.projectFolder, 'build-tools');
                config.port = DEFAULT_PORT;
            }
        }
        return config;
    }
}

export class DebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): ProviderResult<vscode.DebugAdapterDescriptor> {
        return executable ?? new vscode.DebugAdapterInlineImplementation(new NvlistDebugSession(session.configuration));
    }
}

/**
 * NVList-specific launch request options
 */
interface LaunchRequest extends DebugProtocol.LaunchRequestArguments {
    program: string;
}

const defaultTimeout: number = 10_000;
const retryTimeout: number = 5_000;

class PipedDebugSession extends DebugSession {

    constructor(private client: DebugSession) {
        super();
    }

    handleMessage(msg: DebugProtocol.ProtocolMessage): void {
        if (msg.type === 'event') {
            console.log(`Received event from remote debug server: ${JSON.stringify(msg)}`);
            this.client.sendEvent(<DebugProtocol.Event>msg);
        }
        super.handleMessage(msg);
    }

}

class NvlistDebugSession extends LoggingDebugSession {

    private delegate?: DebugSession;
    private childProcess?: ChildProcess;

    constructor(private config: DebugConfiguration) {
        super(undefined, undefined, true);

        logger.init(e => this.sendEvent(e), undefined, true);
    }

    /** Forwards a request to the delegate debug session */
    private forwardRequest(request: DebugProtocol.Request) {
        if (!this.delegate) {
            console.warn(`Delegate is unavailable for request: ${JSON.stringify(request)}`);
        }

        this.delegate?.sendRequest(request.command, request.arguments, defaultTimeout, response => {
            response.seq = 0;
            response.request_seq = request.seq;
            this.sendResponse(response);
        });
    }

    public shutdown() {
        super.shutdown();

        console.log('Shutdown request received');
        this.childProcess?.kill();
        this.delegate?.stop();
        this.delegate?.dispose();
    }

    private sendOutput(category: string, text: string) {
        const event = new OutputEvent(text);
        event.body.category = category;
        this.sendEvent(event);
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments, request?: DebugProtocol.Request): void {
        console.log('Initialize request');

        // Start NVList process via Gradle
        // The NVList process hosts its own debug adapter server
        const gradleArgs = [
            '-PvnRoot=' + this.config.projectFolder,
            'runDesktop',
        ];
        if (this.config.javaHome) {
            gradleArgs.push('-Dorg.gradle.java.home=' + this.config.javaHome);
        }
        const gradleWrapper = (os.platform() === 'win32' ? 'gradlew.bat' : 'gradlew');
        const childProcess = spawn(gradleWrapper, gradleArgs, {
            cwd: this.config.buildToolsFolder
        });
        this.childProcess = childProcess;

        // Forward NVList output
        childProcess.stdout.on('data', data => this.sendOutput('stdout', data.toString()));
        childProcess.stderr.on('data', data => this.sendOutput('stderr', data.toString()));

        // Terminate when the launched process exits
        childProcess.on('exit', () => this.sendEvent(new TerminatedEvent()));

        // Connect to the debug adapter server in the child process
        console.log('Connecting to remote debug server...');
        this.connectToDebugServer(conn => {
            console.log('Connected to remote debug server');

            const delegate = new PipedDebugSession(this);
            delegate.setRunAsServer(true);
            delegate.start(conn, conn);
            this.delegate = delegate;

            // Initialize delegate
            delegate.sendRequest('initialize', request, defaultTimeout, initResponse => {
                // Return response to launch request
                console.log('Remote debug server initialized');

                initResponse.seq = response.seq;
                this.sendResponse(initResponse);
                this.sendEvent(new InitializedEvent());
            });
        });
    }

    private connectToDebugServer(connectionListener: (socket: net.Socket) => void): void {
        const conn = new net.Socket();
        conn.setTimeout(defaultTimeout);
        const reconnect = () => {
            if (this.childProcess?.exitCode === null) {
                // Retry connection attempt unless stopping/stopped
                setTimeout(() => this.connectToDebugServer(connectionListener), retryTimeout);
            }
        };
        conn.once('timeout', () => {
            console.trace('Timeout on connection to debug server');
            reconnect();
        });
        conn.once('error', err => {
            console.log(`Error on connection to debug server: ${err}`);
            reconnect();
        });
        conn.connect(this.config.port ?? DEFAULT_PORT, () => connectionListener(conn));
    }

    protected launchRequest(launchResponse: DebugProtocol.LaunchResponse, args: LaunchRequest, request?: DebugProtocol.Request): void {
        console.log(`Launch request: ${JSON.stringify(args)}`);

        this.forwardRequest(request!);
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): void {
        console.log(`Disconnect request: ${JSON.stringify(args)}`);

        // Send disconnect to delegate, but don't wait for its response
        this.delegate?.sendRequest('disconnect', args, defaultTimeout, r => {});
        this.sendResponse(response);

        this.shutdown();
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse, request?: DebugProtocol.Request): void {
        console.log('Threads request');

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

    protected sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments, request?: DebugProtocol.Request): void {
        console.log(`Source request: ${JSON.stringify(args)}`);

        this.forwardRequest(request!);
    }

}
