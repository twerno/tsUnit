/* 
	The MIT License (MIT)
	
	Copyright (c) 2015 Werno Tomasz
 */

"use strict";

namespace asyncRunner {

    export const enum AsyncTaskState {
        NEW,
        WORKING,
        FINISHED_SUCCESS,
        FINISHED_ERROR,
        FINISHED_TIMEOUT,
        FINISHED_KILLED
    }
    export const enum AsyncTaskFailureCode { ERROR, TIMEOUT }


    export type AsyncWorker = (onSuccess: AsyncTaskSuccess, onFailure: AsyncTaskFailure) => void;
    export type AsyncTaskSuccess = (result?: Object) => void;
    export type AsyncTaskFailure = (message?: string, details?: Object) => void;


    export type AsyncRunnerSuccess = (task: IAsyncTask, result?: Object) => void;
    export type AsyncRunnerFailure = (task: IAsyncTask, code: AsyncTaskFailureCode, message?: string, details?: Object) => void;



    export class AsyncTaskTimeoutError extends Error {
        timeLimit: number;

        constructor(message: string) {
            super();
            this.message = message;
        };
    }



    export abstract class IAsyncTask {
        asyncTaskState: AsyncTaskState;

        abstract run(onSuccess: AsyncTaskSuccess, onFailure: AsyncTaskFailure): void;
    }



	export abstract class ITaskRunner {

        abstract runAsync(timeLimit: number): void;
        abstract kill(): void;
        abstract isWorking(): boolean;
    }



    export class AsyncTaskRunner extends ITaskRunner {

        private timeoutHandler: number = 0;
        private timeLimit: number = 0;


        constructor(
            private task: IAsyncTask,
            private onSuccess: AsyncRunnerSuccess,
            private onFailure: AsyncRunnerFailure) { super(); }


        runAsync(timeLimit: number): void {

            if ((this.task || null) === null)
                throw new Error(`Task cant be null.`);

            if (!(this.task instanceof IAsyncTask))
                throw new Error(`Task has to be IAsyncTask type.`);

            if (typeof this.task.run != 'function')
                throw new Error(`Task has no "run" method.`);

            this.task.asyncTaskState = AsyncTaskState.NEW;
            this.timeLimit = timeLimit || 0;

            if (timeLimit > 0)
                this.timeoutHandler = setTimeout(() => this.internalOnTimeout(), timeLimit);

            setTimeout(() => this._internalRun(), 1);
        }


        kill(): void {
            clearTimeout(this.timeoutHandler);
            if (this.task === null)
                return;

            this.task.asyncTaskState = AsyncTaskState.FINISHED_KILLED;
            this.cleanUp();
        }


        isWorking(): boolean {
            return this.task != null && this.task.asyncTaskState === AsyncTaskState.WORKING;
        }


        private _internalRun(): void {
            try {
                this.task.run(
                    (result): void => this.internalOnSuccess(result || null),
                    (message, details): void => this.internalOnFailure(AsyncTaskFailureCode.ERROR, message || '', details || null));
            } catch (error) {
                this.internalOnFailure(AsyncTaskFailureCode.ERROR, error.message, { error: error });
            }
        }


        private internalOnSuccess(result: Object) {
            clearTimeout(this.timeoutHandler);
            if (this.task === null)
                return;

            let task: IAsyncTask = this.task;
            let onSuccess: AsyncRunnerSuccess = this.onSuccess;

            this.cleanUp();

            task.asyncTaskState = AsyncTaskState.FINISHED_SUCCESS;
            onSuccess && onSuccess(task, result);
        }


        private internalOnFailure(code: AsyncTaskFailureCode, message?: string, details?: Object): void {
            clearTimeout(this.timeoutHandler);
            if (this.task === null && !this.emergencyThrowError(code, message, details)) 
                return;
            
            let task: IAsyncTask = this.task;
            let onFailure: AsyncRunnerFailure = this.onFailure;

            this.cleanUp();

            task.asyncTaskState = (code === AsyncTaskFailureCode.TIMEOUT ? AsyncTaskState.FINISHED_TIMEOUT : AsyncTaskState.FINISHED_ERROR);
            onFailure && onFailure(task, code, message, details);
        }


        private emergencyThrowError(code: AsyncTaskFailureCode, message?: string, details?: Object): boolean {
            if (code === AsyncTaskFailureCode.ERROR) {
                if (details && details['error'] instanceof Error)
                    throw  details['error'];
                else if (message && message != '')
                    throw new Error(message);
                else
                    throw new Error('Unknown error');
            }

            return false;
        }


        private internalOnTimeout() {
            clearTimeout(this.timeoutHandler);
            if (this.task === null)
                return;

            let error: AsyncTaskTimeoutError = new AsyncTaskTimeoutError(`[timeout] ${this.timeLimit} milliseconds.`);
            error.timeLimit = this.timeLimit;

            this.internalOnFailure(AsyncTaskFailureCode.TIMEOUT, error.message, { error: error });
        }


        private cleanUp(): void {
            clearTimeout(this.timeoutHandler);

            this.task = null;
            this.timeoutHandler = null;
            this.timeLimit = null;
            this.onSuccess = null;
            this.onFailure = null;
        }
    }



    class AsyncMethodWrapperTask extends IAsyncTask {

        run(onSuccess: AsyncTaskSuccess, onFailure: AsyncTaskFailure): void {
            this.worker(onSuccess, onFailure);
        }

        constructor(private worker: AsyncWorker) {
            super();
        }
    }



    export class AsyncMethodRunner extends ITaskRunner {
        private asyncRunner: AsyncTaskRunner;

        constructor(
            worker: AsyncWorker,
            private onSuccess: AsyncRunnerSuccess,
            private onFailure: AsyncRunnerFailure) {

            super();
            this.asyncRunner = new AsyncTaskRunner(new AsyncMethodWrapperTask(worker), onSuccess, onFailure);
        }


        runAsync(timeLimit: number): void {
            this.asyncRunner.runAsync(timeLimit);
        }


        kill(): void {
            this.asyncRunner.kill();
        }


        isWorking(): boolean {
            return this.asyncRunner.isWorking();
        }
    }



    export type SyncWorker = () => void;

    class MethodWrapperTask extends IAsyncTask {

        run(onSuccess: AsyncTaskSuccess, onFailure: AsyncTaskFailure): void {
            this.syncWorker();
            onSuccess(null);
        }

        constructor(private syncWorker: SyncWorker) {
            super();
        }
    }



    export class SyncMethodRunner extends ITaskRunner {
        private asyncRunner: AsyncTaskRunner;

        constructor(
            syncWorker: SyncWorker,
            private onSuccess: AsyncRunnerSuccess,
            private onFailure: AsyncRunnerFailure) {

            super();
            this.asyncRunner = new AsyncTaskRunner(new MethodWrapperTask(syncWorker), onSuccess, onFailure);
        }


        runAsync(timeLimit: number): void {
            this.asyncRunner.runAsync(timeLimit);
        }


        kill(): void {
            this.asyncRunner.kill();
        }


        isWorking(): boolean {
            return this.asyncRunner.isWorking();
        }
    }
}