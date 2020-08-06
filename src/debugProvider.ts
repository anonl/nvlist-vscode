import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';

import { LoggingDebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';

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

class NvlistDebugSession extends LoggingDebugSession {

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        console.log("Initialize request");

		response.body = {};
		this.sendResponse(response);

		this.sendEvent(new InitializedEvent());
	}

    private sendOutput(category: string, text: string) {
        const event = new OutputEvent(text);
        event.body.category = category;
        this.sendEvent(event);
    }

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequest) {
        console.log(`Launch request: ${JSON.stringify(args)}`);

        const process = spawn(`gradlew.bat`, ['-PvnRoot=' + args.projectFolder, 'run'], {
            cwd: args.buildToolsFolder
        })
        process.stdout.on('data', data => this.sendOutput('stdout', data.toString()));
        process.stderr.on('data', data => this.sendOutput('stderr', data.toString()));

        // Terminate when the launched process exits
        process.on('exit', () => this.sendEvent(new TerminatedEvent()));

		this.sendResponse(response);
	}

}
