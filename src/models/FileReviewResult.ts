import { IssueDTO } from '../dto';

export interface FileReviewResult {
    file: string;
    results: {
        [reviewType: string]: {
            status: 'pass' | 'fail' | 'warning';
            confidence: number;
            issues: number;
            issueDetails?: IssueDTO[]; // Store individual issues for detailed view
        }
    };
}
