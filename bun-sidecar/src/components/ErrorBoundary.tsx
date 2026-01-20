import React, { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Copy, RotateCcw, Play } from "lucide-react";
import { toast } from "sonner";

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
    errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return {
            hasError: true,
            error,
        };
    }

    override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
        this.setState({
            error,
            errorInfo,
        });
    }

    handleCopyError = () => {
        const { error, errorInfo } = this.state;
        const errorText = `Error: ${error?.message || "Unknown error"}\n\nStack trace:\n${error?.stack || "No stack trace available"}\n\nComponent stack:${errorInfo?.componentStack || "No component stack available"}`;

        navigator.clipboard.writeText(errorText).then(
            () => {
                toast.success("Error details copied to clipboard");
            },
            (err) => {
                console.error("Failed to copy error to clipboard:", err);
                toast.error("Failed to copy to clipboard");
            }
        );
    };

    handleReload = () => {
        // Reload the entire window to restart the application
        // This works for both web and MacOS WKWebView contexts
        window.location.reload();
    };

    handleContinue = () => {
        // Dispatch event to reset any error triggers (like DevErrorTrigger)
        window.dispatchEvent(new CustomEvent("error-boundary:reset"));
        // Reset error boundary state to attempt recovery
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null,
        });
    };

    override render() {
        if (this.state.hasError) {
            const { error } = this.state;

            return (
                <div className="flex items-center justify-center min-h-screen p-4 bg-background">
                    <Card className="w-full max-w-2xl">
                        <CardHeader>
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-full bg-destructive/10">
                                    <AlertCircle className="h-6 w-6 text-destructive" />
                                </div>
                                <div>
                                    <CardTitle>Something went wrong</CardTitle>
                                    <CardDescription>
                                        The application encountered an unexpected error
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="rounded-md bg-muted p-4">
                                <p className="text-sm font-mono text-destructive break-all">
                                    {error?.message || "Unknown error occurred"}
                                </p>
                            </div>
                            {error?.stack && (
                                <details className="text-xs">
                                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground mb-2">
                                        View stack trace
                                    </summary>
                                    <pre className="rounded-md bg-muted p-4 overflow-auto max-h-64 text-[10px] font-mono">
                                        {error.stack}
                                    </pre>
                                </details>
                            )}
                        </CardContent>
                        <CardFooter className="flex gap-2">
                            <Button variant="outline" onClick={this.handleCopyError}>
                                <Copy className="h-4 w-4 mr-2" />
                                Copy Error
                            </Button>
                            <Button variant="outline" onClick={this.handleReload}>
                                <RotateCcw className="h-4 w-4 mr-2" />
                                Reload
                            </Button>
                            <Button onClick={this.handleContinue}>
                                <Play className="h-4 w-4 mr-2" />
                                Try to Continue
                            </Button>
                        </CardFooter>
                    </Card>
                </div>
            );
        }

        return this.props.children;
    }
}
