import * as vscode from 'vscode';

interface NVListGradleTaskDefinition extends vscode.TaskDefinition {
    /**
     * The Gradle task to execute
     */
    gradleTask: string;

    /**
     * Path to the build-tools folder in your NVList installation.
     */
    buildToolsFolder: string;
}

export class GradleTaskProvider implements vscode.TaskProvider {

    static NVLIST_TASK_TYPE = 'nvlist';

    private tasks: vscode.Task[] | undefined;

    constructor(private workspaceRoot: string) {
    }

    public async provideTasks(): Promise<vscode.Task[]> {
        return this.getTasks();
    }

    public resolveTask(task: vscode.Task): vscode.Task | undefined {
        const gradleTask = task.definition.gradleTask;
        if (gradleTask) {
            return this.getTask(gradleTask, <any>task.definition);
        }
        return undefined;
    }

    private getTasks(): vscode.Task[] {
        if (this.tasks !== undefined) {
            return this.tasks;
        }

        console.log("getTasks");

        return this.tasks = [this.getTask('run')];
    }

    private getTask(gradleTask: string, def?: NVListGradleTaskDefinition): vscode.Task {
        if (def === undefined) {
            def = {
                type: GradleTaskProvider.NVLIST_TASK_TYPE,
                gradleTask,
                buildToolsFolder: this.workspaceRoot + '/build-tools'
            };
        }
        return new vscode.Task(def, vscode.TaskScope.Workspace, `Run NVList`, GradleTaskProvider.NVLIST_TASK_TYPE,
            new vscode.ShellExecution('./gradlew',
                ['-PvnRoot=' + this.workspaceRoot, def.gradleTask],
                { cwd: def.buildToolsFolder }));
    }
}
