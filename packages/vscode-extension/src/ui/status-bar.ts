/**
 * Status Bar
 *
 * Manages the REST Lens status bar item.
 */

import * as vscode from "vscode";

type MaxSeverity = "error" | "warning" | "info" | null;

export class StatusBar {
  private item: vscode.StatusBarItem;
  private isAuthenticated = false;
  private isEvaluating = false;
  private violationCount = 0;
  private maxSeverity: MaxSeverity = null;
  private errorMessage: string | null = null;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.show();
    this.update();
  }

  setNotAuthenticated(): void {
    this.isAuthenticated = false;
    this.isEvaluating = false;
    this.errorMessage = null;
    this.update();
  }

  setAuthenticating(): void {
    this.isAuthenticated = false;
    this.isEvaluating = false;
    this.errorMessage = "authenticating";
    this.update();
  }

  setAuthenticated(): void {
    this.isAuthenticated = true;
    this.errorMessage = null;
    // Don't touch isEvaluating - it's managed separately
    this.update();
  }

  setEvaluating(): void {
    this.isEvaluating = true;
    this.update();
  }

  setError(message: string): void {
    this.errorMessage = message;
    this.isEvaluating = false;
    this.update();
  }

  setViolationCount(count: number, maxSeverity: MaxSeverity = null): void {
    this.violationCount = count;
    this.maxSeverity = maxSeverity;
    this.isEvaluating = false;
    this.update();
  }

  private update(): void {
    // Priority: error > authenticating > evaluating > authenticated > not authenticated
    if (this.errorMessage && this.errorMessage !== "authenticating") {
      this.item.text = "$(alert) REST Lens: Error";
      this.item.tooltip = this.errorMessage;
      this.item.command = "restlens.signIn";
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      return;
    }

    if (this.errorMessage === "authenticating") {
      this.item.text = "$(sync~spin) REST Lens: Signing in...";
      this.item.tooltip = "Waiting for authentication";
      this.item.command = undefined;
      this.item.backgroundColor = undefined;
      return;
    }

    if (!this.isAuthenticated) {
      this.item.text = "$(key) REST Lens: Sign In";
      this.item.tooltip = "Click to sign in to REST Lens";
      this.item.command = "restlens.signIn";
      this.item.backgroundColor = undefined;
      return;
    }

    if (this.isEvaluating) {
      this.item.text = "$(sync~spin) REST Lens: Evaluating...";
      this.item.tooltip = "Evaluation in progress - click to view problems";
      this.item.command = "workbench.actions.view.problems";
      this.item.backgroundColor = undefined;
      return;
    }

    // Authenticated and not evaluating
    if (this.violationCount > 0) {
      const icon = this.maxSeverity === "error" ? "error" : this.maxSeverity === "warning" ? "warning" : "info";
      this.item.text = `$(${icon}) REST Lens: ${this.violationCount} issues`;
      this.item.tooltip = `${this.violationCount} API design issues found - click to view`;
      this.item.command = "workbench.actions.view.problems";

      // Color based on max severity
      if (this.maxSeverity === "error") {
        this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      } else if (this.maxSeverity === "warning") {
        this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      } else {
        this.item.backgroundColor = undefined;
      }
    } else {
      this.item.text = "$(check) REST Lens: Ready";
      this.item.tooltip = "No issues found - click to evaluate";
      this.item.command = "restlens.evaluate";
      this.item.backgroundColor = undefined;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
