/* tsUnit (c) Copyright 2012-2015 Steve Fenton, licensed under Apache 2.0 https://github.com/Steve-Fenton/tsUnit */

///<reference path="AsyncTaskRunner.ts"/>


module tsUnit {


    export class TestEngine {
        public privateMemberPrefix = '_';
        private testResult: TestResult = null;

        private tests: TestDefintion[] = [];
        private testRunLimiter: TestRunLimiter;
        private reservedMethodNameContainer: TestClass;

        public onResultChange: (result: TestResult) => void = null;



        constructor(...testModules: any[]) {
            this.createTestLimiter();
            this.reservedMethodNameContainer = new AsyncSetUpTestClass();

            for (var i = 0; i < testModules.length; i++) {
                var testModule = testModules[i];
                for (var testClass in testModule) {
                    this.addTestClass(new testModule[testClass](), testClass);
                }
            }
        }



        addTestClass(testClass: TestClass, name: string = 'Tests'): void {
            this.tests.push(new TestDefintion(testClass, name));
        }



        private _internalOnTestReady(asyncTestClass: AsyncSetUpTestClass, testResult: TestResult, testsGroupName: string): void {
            this.testResult.asyncSetUpTestMap[testsGroupName] = { state: AsyncSetUpTestState.DONE, error_message: '' };
            this.onResultChange && this.onResultChange(this.testResult);
            this.executeTestClass(testResult, asyncTestClass, testsGroupName, this.testRunLimiter);
        }


        private _internalOnAsyncSetUpFailure(asyncTestClass: AsyncSetUpTestClass, testResult: TestResult, testsGroupName: string, msg: string): void {
            this.testResult.asyncSetUpTestMap[testsGroupName] = { state: AsyncSetUpTestState.FAILED, error_message: msg };
            this.onResultChange && this.onResultChange(this.testResult);
            testResult.errors.push(new TestDescription(testsGroupName, TestContext.getNameOfClass(asyncTestClass), null, msg));
        }


        run(testRunLimiter: ITestRunLimiter = null): void {
            var testContext = new TestContext();
            this.testResult = new TestResult();

            if (testRunLimiter == null) {
                testRunLimiter = this.testRunLimiter;
            }

            for (var i = 0; i < this.tests.length; ++i) {
                var testClass = this.tests[i].testClass;
                var testsGroupName = this.tests[i].name;

                if (testRunLimiter && !testRunLimiter.isTestsGroupActive(testsGroupName)) {
                    continue;
                }

                if (testClass instanceof AsyncSetUpTestClass) {
                    let runner: AsyncTestRunner = new AsyncTestRunner(testClass, this.testResult, testsGroupName,
                        (asyncTestClass, testResult, testsGroupName): void => { this._internalOnTestReady(asyncTestClass, testResult, testsGroupName) },
                        (asyncTestClass, testResult, testsGroupName, msg): void => { this._internalOnAsyncSetUpFailure(asyncTestClass, testResult, testsGroupName, msg) });
                    runner.runAsync(testClass.setUpTimeLimit);

                    this.testResult.asyncSetUpTestMap[testsGroupName] = { state: AsyncSetUpTestState.SETTING_UP, error_message: '' };
                    this.onResultChange && this.onResultChange(this.testResult);
                } else
                    this.executeTestClass(this.testResult, testClass, testsGroupName, testRunLimiter);
            }
        }



        private executeTestClass(testResult: TestResult, testClass: TestClass, testsGroupName: string, testRunLimiter: ITestRunLimiter): void {
            let dynamicTestClass = <any>testClass;
            let parameters: any[][] = null;

            for (var unitTestName in testClass) {
                if (this.isReservedFunctionName(unitTestName)
                    || (unitTestName.substring(0, this.privateMemberPrefix.length) === this.privateMemberPrefix)
                    || (typeof dynamicTestClass[unitTestName] !== 'function')
                    || (testRunLimiter && !testRunLimiter.isTestActive(unitTestName))) {
                    continue;
                }

                if (typeof dynamicTestClass[unitTestName].parameters !== 'undefined') {
                    parameters = dynamicTestClass[unitTestName].parameters;
                    for (var parameterIndex = 0; parameterIndex < parameters.length; parameterIndex++) {
                        if (testRunLimiter && !testRunLimiter.isParametersSetActive(parameterIndex)) {
                            continue;
                        }

                        this.runSingleTest(testResult, testClass, unitTestName, testsGroupName, parameters, parameterIndex);
                    }
                } else {

                    this.runSingleTest(testResult, testClass, unitTestName, testsGroupName);
                }
            }
        }



        private createTestLimiter() {
            try {
                if (typeof window !== 'undefined') {
                    this.testRunLimiter = new TestRunLimiter();
                }
            } catch (ex) { }
        }



        private isReservedFunctionName(functionName: string): boolean {
            for (var prop in this.reservedMethodNameContainer) {
                if (prop === functionName) {
                    return true;
                }
            }
            return false;
        }



        private runSingleTest(testResult: TestResult, testClass: TestClass, unitTestName: string, testsGroupName: string, parameters: any[][] = null, parameterSetIndex: number = null) {
            if (typeof testClass['setUp'] === 'function') {
                testClass['setUp']();
            }

            try {
                var dynamicTestClass: any = testClass;
                var args = (parameterSetIndex !== null) ? parameters[parameterSetIndex] : null;
                dynamicTestClass[unitTestName].apply(testClass, args);

                testResult.passes.push(new TestDescription(testsGroupName, unitTestName, parameterSetIndex, 'OK'));
                this.onResultChange && this.onResultChange(this.testResult);
            } catch (err) {
                testResult.errors.push(new TestDescription(testsGroupName, unitTestName, parameterSetIndex, err.toString()));
                this.onResultChange && this.onResultChange(this.testResult);
            }

            if (typeof testClass['tearDown'] === 'function') {
                testClass['tearDown']();
            }
        }
    }



    export interface ITestRunLimiter {
        isTestsGroupActive(groupName: string): boolean;
        isTestActive(testName: string): boolean;
        isParametersSetActive(paramatersSetNumber: number): boolean;
    }



    export interface IThrowsParameters {
        fn: () => void;
        message?: string;
        errorString?: string;
    }



    class TestRunLimiterRunAll implements ITestRunLimiter {
        isTestsGroupActive(groupName: string): boolean {
            return true;
        }

        isTestActive(testName: string): boolean {
            return true;
        }

        isParametersSetActive(paramatersSetNumber: number): boolean {
            return true;
        }
    }



    class TestRunLimiter implements ITestRunLimiter {
        private groupName: string = null;
        private testName: string = null;
        private parameterSet: number = null;

        constructor() {
            this.setRefreshOnLinksWithHash();
            this.translateStringIntoTestsLimit(window.location.hash);
        }

        public isTestsGroupActive(groupName: string): boolean {
            if (this.groupName === null) {
                return true;
            }

            return this.groupName === groupName;
        }

        public isTestActive(testName: string): boolean {
            if (this.testName === null) {
                return true;
            }

            return this.testName === testName;
        }

        public isParametersSetActive(paramatersSet: number): boolean {
            if (this.parameterSet === null) {
                return true;
            }

            return this.parameterSet === paramatersSet;
        }

        private setRefreshOnLinksWithHash() {
            var previousHandler = window.onhashchange;

            window.onhashchange = function(ev: HashChangeEvent) {
                window.location.reload();

                if (typeof previousHandler === 'function') {
                    previousHandler(ev);
                }
            };
        }

        private translateStringIntoTestsLimit(value: string) {
            var regex = /^#([_a-zA-Z0-9]+)((\/([_a-zA-Z0-9]+))(\(([0-9]+)\))?)?$/
            var result = regex.exec(value);

            if (result === null) {
                return;
            }

            if (result.length > 1 && !!result[1]) {
                this.groupName = result[1];
            }

            if (result.length > 4 && !!result[4]) {
                this.testName = result[4];
            }

            if (result.length > 6 && !!result[6]) {
                this.parameterSet = parseInt(result[6], 10);
            }
        }
    }



    class TestDefintion {
        constructor(public testClass: TestClass, public name: string) {
        }
    }

    export class TestDescription {
        constructor(public testName: string, public funcName: string, public parameterSetNumber: number, public message: string) {
        }
    }

    export enum AsyncSetUpTestState { SETTING_UP, DONE, FAILED }
    export interface AsyncSetUpTestInfo { state: AsyncSetUpTestState, error_message: string }
    export interface AsyncSetUpTestInfoMap { [key: string]: AsyncSetUpTestInfo }

    export class TestResult {
        public passes: TestDescription[] = [];
        public errors: TestDescription[] = [];
        public asyncSetUpTestMap: AsyncSetUpTestInfoMap = {};
    }


    class AsyncTestRunner {

        private runner: asyncRunner.AsyncMethodRunner = null;

        constructor(
            public asyncTest: AsyncSetUpTestClass,
            public testResult: TestResult,
            public testsGroupName: string,
            public onTestReady: (asyncTest: AsyncSetUpTestClass, testResult: TestResult, testsGroupName: string) => void,
            public onSetUpFailure: (asyncTest: AsyncSetUpTestClass, testResult: TestResult, testsGroupName: string, msg?: string) => void) { }


        runAsync(timeLimit: number): void {
            this.runner != null && this.runner.kill();
            this.runner = null;
            this.runner = new asyncRunner.AsyncMethodRunner(
                this.asyncTest.asyncSetUp,
                (task: asyncRunner.IAsyncTask, result?: Object): void => {
                    this.onTestReady(this.asyncTest, this.testResult, this.testsGroupName)
                },
                (task: asyncRunner.IAsyncTask, code: asyncRunner.AsyncTaskFailureCode, msg?: string, details?: Object): void => {
                    this.onSetUpFailure(this.asyncTest, this.testResult, this.testsGroupName, msg);

                });

            this.runner.runAsync(timeLimit * 1000);
        }
    }



    export class TestResultPainter {

        getHTML(result: TestResult): string {
            return `
				<article>
                    <h1>${this.getTestResult(result)}</h1>
                    <p>${this.getTestSummary(result)}</p>
                    ${this.getLimitCleaner()}

                    <section id="tsFail">
                        <h2>Errors</h2>
                        <ul class="bad">${this.getTestResultList(result.errors)}</ul>
                    </section>
                    <section id="tsOkay">
                        <h2>Passing Tests</h2>
                        <ul class="good">${this.getTestResultList(result.passes)}</ul>
                    </section>
                    <section>
                        <h2>Async set up</h2>
                        <ul>${this.getAsyncTestState(result.asyncSetUpTestMap)}</ul>
                    </section>
                </article>
                ${this.getLimitCleaner()}`;
            
        }

        showResults(target: HTMLElement, result: TestResult): void {
            target.innerHTML = this.getHTML(result);
        }

        private getTestResult(result: TestResult) {
            return result.errors.length === 0 ? 'Test Passed' : 'Test Failed';
        }

        private getTestSummary(result: TestResult) {
            return 'Total tests: <span id="tsUnitTotalCout">' + (result.passes.length + result.errors.length).toString() + '</span>. ' +
                'Passed tests: <span id="tsUnitPassCount" class="good">' + result.passes.length + '</span>. ' +
                'Failed tests: <span id="tsUnitFailCount" class="bad">' + result.errors.length + '</span>.';
        }

        private getTestResultList(testResults: TestDescription[]) {
            var list = '';
            var group = '';
            var isFirst = true;
            for (var i = 0; i < testResults.length; ++i) {
                var result = testResults[i];
                if (result.testName !== group) {
                    group = result.testName;
                    if (isFirst) {
                        isFirst = false;
                    } else {
                        list += '</li></ul>';
                    }
                    list += '<li>' + this.getLimiterForGroup(group) + result.testName + '<ul>';
                }

                var resultClass = (result.message === 'OK') ? 'success' : 'error';
                var functionLabal = result.funcName + ((result.parameterSetNumber === null)
                    ? '()'
                    : '(' + this.getLimiterForTest(group, result.funcName, result.parameterSetNumber) + ' paramater set: ' + result.parameterSetNumber + ')');

                list += '<li class="' + resultClass + '">' + this.getLimiterForTest(group, result.funcName) + functionLabal + ': ' + this.encodeHtmlEntities(result.message) + '</li>';
            }
            return list + '</ul>';
        }

        private getAsyncTestState(infoMap: AsyncSetUpTestInfoMap): string {
            let result: string = '';
            let info: AsyncSetUpTestInfo;
            for (let key in infoMap) {
                info = infoMap[key];

                result += `<li>${key}: ${this.getAsyncTestStateColor(info.state) }
                	${AsyncSetUpTestState[info.state]} ${info.error_message}</span> </li>`;
            }

            return result;
        }

        private getAsyncTestStateColor(state: AsyncSetUpTestState): string {
            if (state === AsyncSetUpTestState.DONE)
                return `<span class='good'>`;

            else if (state === AsyncSetUpTestState.FAILED)
                return `<span class='bad'>`;

            else
                return `<span>`;
        }

        private getLimiterForGroup(groupName: string): string {
            return '&nbsp;<a href="#' + groupName + '" class="ascii">&#9658;</a>&nbsp;';
        }

        private getLimitCleaner(): string {
            return '<p><a href="#">Run all tests <span class="ascii">&#9658;</span></a></p>';
        }

        private getLimiterForTest(groupName: string, testName: string, parameterSet: number = null): string {
            if (parameterSet !== null) {
                testName += '(' + parameterSet + ')';
            }

            return '&nbsp;<a href="#' + groupName + '/' + testName + '\" class="ascii">&#9658;</a>&nbsp;';
        }

        private encodeHtmlEntities(input: string) {
            return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
    }


    export class TestResultLivePainter {

        private painter: TestResultPainter = new TestResultPainter();

        constructor(public target: HTMLElement, public testEngine: TestEngine) {
            testEngine.onResultChange = (result: TestResult): void => { this._repaint(result) };
        }

        private _repaint(result: TestResult): void {
            this.painter.showResults(this.target, result);
        }
    }






    export class TestContext {
        setUp() {
        }

        tearDown() {
        }

        protected areIdentical(expected: any, actual: any, message = ''): void {
            if (expected !== actual) {
                throw this.getError('areIdentical failed when given ' +
                    this.printVariable(expected) + ' and ' + this.printVariable(actual),
                    message);
            }
        }

        protected areNotIdentical(expected: any, actual: any, message = ''): void {
            if (expected === actual) {
                throw this.getError('areNotIdentical failed when given ' +
                    this.printVariable(expected) + ' and ' + this.printVariable(actual),
                    message);
            }
        }

        protected areCollectionsIdentical(expected: any[], actual: any[], message = ''): void {
            function resultToString(result: number[]): string {
                var msg = '';

                while (result.length > 0) {
                    msg = '[' + result.pop() + ']' + msg;
                }

                return msg;
            }

            var compareArray = (expected: any[], actual: any[], result: number[]): void => {
                var indexString = '';

                if (expected === null) {
                    if (actual !== null) {
                        indexString = resultToString(result);
                        throw this.getError('areCollectionsIdentical failed when array a' +
                            indexString + ' is null and b' +
                            indexString + ' is not null',
                            message);
                    }

                    return; // correct: both are nulls
                } else if (actual === null) {
                    indexString = resultToString(result);
                    throw this.getError('areCollectionsIdentical failed when array a' +
                        indexString + ' is not null and b' +
                        indexString + ' is null',
                        message);
                }

                if (expected.length !== actual.length) {
                    indexString = resultToString(result);
                    throw this.getError('areCollectionsIdentical failed when length of array a' +
                        indexString + ' (length: ' + expected.length + ') is different of length of array b' +
                        indexString + ' (length: ' + actual.length + ')',
                        message);
                }

                for (var i = 0; i < expected.length; i++) {
                    if ((expected[i] instanceof Array) && (actual[i] instanceof Array)) {
                        result.push(i);
                        compareArray(expected[i], actual[i], result);
                        result.pop();
                    } else if (expected[i] !== actual[i]) {
                        result.push(i);
                        indexString = resultToString(result);
                        throw this.getError('areCollectionsIdentical failed when element a' +
                            indexString + ' (' + this.printVariable(expected[i]) + ') is different than element b' +
                            indexString + ' (' + this.printVariable(actual[i]) + ')',
                            message);
                    }
                }

                return;
            }

            compareArray(expected, actual, []);
        }

        protected areCollectionsNotIdentical(expected: any[], actual: any[], message = ''): void {
            try {
                this.areCollectionsIdentical(expected, actual);
            } catch (ex) {
                return;
            }

            throw this.getError('areCollectionsNotIdentical failed when both collections are identical', message);
        }

        protected isTrue(actual: boolean, message = '') {
            if (!actual) {
                throw this.getError('isTrue failed when given ' + this.printVariable(actual), message);
            }
        }

        protected isFalse(actual: boolean, message = '') {
            if (actual) {
                throw this.getError('isFalse failed when given ' + this.printVariable(actual), message);
            }
        }

        protected isTruthy(actual: any, message = '') {
            if (!actual) {
                throw this.getError('isTrue failed when given ' + this.printVariable(actual), message);
            }
        }

        protected isFalsey(actual: any, message = '') {
            if (actual) {
                throw this.getError('isFalse failed when given ' + this.printVariable(actual), message);
            }
        }

        protected throws(params: IThrowsParameters): void;
        protected throws(actual: () => void, message?: string): void;
        protected throws(a: any, message = '', errorString = '') {
            var actual: () => void;

            if (a.fn) {
                actual = a.fn;
                message = a.message;
                errorString = a.exceptionString;
            }

            var isThrown = false;
            try {
                actual();
            } catch (ex) {
                if (!errorString || ex.message === errorString) {
                    isThrown = true;
                }

                if (errorString && ex.message !== errorString) {
                    throw this.getError('different error string than supplied');
                }

            }
            if (!isThrown) {
                throw this.getError('did not throw an error', message || '');
            }
        }

        protected executesWithin(actual: () => void, timeLimit: number, message: string = null): void {
            function getTime() {
                return window.performance.now();
            }

            function timeToString(value: number) {
                return Math.round(value * 100) / 100;
            }

            var startOfExecution = getTime();

            try {
                actual();
            } catch (ex) {
                throw this.getError('isExecuteTimeLessThanLimit fails when given code throws an exception: "' + ex + '"', message);
            }

            var executingTime = getTime() - startOfExecution;
            if (executingTime > timeLimit) {
                throw this.getError('isExecuteTimeLessThanLimit fails when execution time of given code (' + timeToString(executingTime) + ' ms) ' +
                    'exceed the given limit(' + timeToString(timeLimit) + ' ms)',
                    message);
            }
        }

        protected fail(message = '') {
            throw this.getError('fail', message);
        }

        private getError(resultMessage: string, message: string = '') {
            if (message) {
                return new Error(resultMessage + '. ' + message);
            }

            return new Error(resultMessage);
        }

        public static getNameOfClass(inputClass: {}) {
            // see: https://www.stevefenton.co.uk/Content/Blog/Date/201304/Blog/Obtaining-A-Class-Name-At-Runtime-In-TypeScript/
            var funcNameRegex = /function (.{1,})\(/;
            var results = (funcNameRegex).exec((<any> inputClass).constructor.toString());
            return (results && results.length > 1) ? results[1] : '';
        }

        private printVariable(variable: any) {
            if (variable === null) {
                return '"null"';
            }

            if (typeof variable === 'object') {
                return '{object: ' + TestContext.getNameOfClass(variable) + '}';
            }

            return '{' + (typeof variable) + '} "' + variable + '"';
        }
    }

    export class TestClass extends TestContext {
        protected parameterizeUnitTest(method: Function, parametersArray: any[][]) {
            (<any>method).parameters = parametersArray;
        }
    }

    export class AsyncSetUpTestClass extends TestClass {

        public setUpTimeLimit: number = 0;

        asyncSetUp(onSuccess: asyncRunner.AsyncTaskSuccess, onFailure: asyncRunner.AsyncTaskFailure): void {
            throw new Error('not implemented yet');
        }
    }
}