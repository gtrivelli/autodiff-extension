// Data Transfer Objects for AutoDiff analysis results
// These interfaces match the Python DTOs in backend/dto.py

export enum Severity {
    HIGH = "High",
    MEDIUM = "Medium",
    LOW = "Low"
}

export enum ReviewType {
    SECURITY = "security",
    ACCESSIBILITY = "accessibility",
    PERFORMANCE = "performance"
}

export interface IssueDTO {
    issue: string;                    // Description of the issue
    severity: Severity;               // High, Medium, Low
    confidence: number;               // Percentage (0-100)
    line_numbers: number[];          // Line number(s) where issue occurs
    code: string;                    // The actual code with the issue
    suggestion: string;              // How to fix the issue
    review_type: ReviewType;         // Which review type found this issue
    file_path?: string;              // File path (optional)
}

export interface FileAnalysisDTO {
    file_path: string;
    issues: IssueDTO[];
    review_types_analyzed: ReviewType[];
}

export interface AnalysisResultDTO {
    files: FileAnalysisDTO[];
    total_issues: number;
    analysis_timestamp: string;
    review_types: ReviewType[];
}

// Utility functions for working with DTOs
export class DTOUtils {

    static parseIssueDTO(data: any): IssueDTO {
        return {
            issue: data.issue || 'Unknown issue',
            severity: data.severity as Severity || Severity.MEDIUM,
            confidence: data.confidence || 50,
            line_numbers: Array.isArray(data.line_numbers) ? data.line_numbers : [],
            code: data.code || '',
            suggestion: data.suggestion || 'No suggestion provided',
            review_type: data.review_type as ReviewType || ReviewType.SECURITY,
            file_path: data.file_path
        };
    }

    static parseFileAnalysisDTO(data: any): FileAnalysisDTO {
        return {
            file_path: data.file_path || '',
            issues: (data.issues || []).map((issue: any) => DTOUtils.parseIssueDTO(issue)),
            review_types_analyzed: data.review_types_analyzed || []
        };
    }

    static parseAnalysisResultDTO(data: any): AnalysisResultDTO {
        return {
            files: (data.files || []).map((file: any) => DTOUtils.parseFileAnalysisDTO(file)),
            total_issues: data.total_issues || 0,
            analysis_timestamp: data.analysis_timestamp || new Date().toISOString(),
            review_types: data.review_types || []
        };
    }

    static parseFromJSON(jsonString: string): AnalysisResultDTO | null {
        try {
            // Add temporary debug logging
            console.log('DTOUtils.parseFromJSON: Input length:', jsonString.length);
            console.log('DTOUtils.parseFromJSON: First 100 chars:', jsonString.substring(0, 100));
            console.log('DTOUtils.parseFromJSON: Last 100 chars:', jsonString.substring(Math.max(0, jsonString.length - 100)));

            const data = JSON.parse(jsonString);
            console.log('DTOUtils.parseFromJSON: Parse successful, data.total_issues:', data.total_issues);

            return DTOUtils.parseAnalysisResultDTO(data);
        } catch (error) {
            console.error('Error parsing AnalysisResultDTO from JSON:', error);
            console.error('Failed JSON string length:', jsonString.length);
            console.error('Failed JSON first 200 chars:', jsonString.substring(0, 200));
            return null;
        }
    }

    // Convert severity to file decoration status
    static severityToStatus(severity: Severity): 'pass' | 'fail' | 'warning' {
        switch (severity) {
            case Severity.HIGH:
                return 'fail';
            case Severity.MEDIUM:
                return 'warning';
            case Severity.LOW:
                return 'warning';
            default:
                return 'warning';
        }
    }

    // Get emoji for severity
    static severityToEmoji(severity: Severity): string {
        switch (severity) {
            case Severity.HIGH:
                return '❌';
            case Severity.MEDIUM:
                return '⚠️';
            case Severity.LOW:
                return '⚠️';
            default:
                return '⚠️';
        }
    }

    // Format line numbers for display
    static formatLineNumbers(lineNumbers: number[]): string {
        if (lineNumbers.length === 0) {
            return '';
        }
        if (lineNumbers.length === 1) {
            return lineNumbers[0].toString();
        }

        // Check if it's a continuous range
        const sorted = [...lineNumbers].sort((a, b) => a - b);
        let ranges: string[] = [];
        let start = sorted[0];
        let end = sorted[0];

        for (let i = 1; i <= sorted.length; i++) {
            if (i < sorted.length && sorted[i] === end + 1) {
                end = sorted[i];
            } else {
                if (start === end) {
                    ranges.push(start.toString());
                } else {
                    ranges.push(`${start}-${end}`);
                }
                if (i < sorted.length) {
                    start = end = sorted[i];
                }
            }
        }

        return ranges.join(', ');
    }
}
