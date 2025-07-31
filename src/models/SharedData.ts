/**
 * Interface for shared data between tree view providers
 * This ensures all providers have access to the same data instances
 */
export interface SharedData {
    changedFiles: string[];
    reviewResults: Map<string, any>;
    selectedReviews: Set<string>;
}
