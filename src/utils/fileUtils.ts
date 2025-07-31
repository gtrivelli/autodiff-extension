/**
 * Get appropriate ThemeIcon for a file - lets VS Code handle all file types
 * This supports any file extension VS Code recognizes and respects user's icon theme
 */
export function getFileThemeIcon(): any {
    // Use VS Code's built-in file icon system which supports all file types
    // and respects the user's file icon theme preferences
    return { id: 'file' };
}

/**
 * Legacy function for backward compatibility - use getFileThemeIcon instead
 * @deprecated Use getFileThemeIcon for better file type support
 */
export function getFileIconName(fileName: string): string {
    // Return generic 'file' - actual icon selection should be handled by VS Code's ThemeIcon.File
    return 'file';
}

/**
 * Parse review results from legacy text output format
 */
export function parseReviewResults(output: string): any[] {
    const results: any[] = [];
    const lines = output.split('\n');

    let currentIssue: any = {};
    let inIssueBlock = false;
    let currentFile = '';

    for (const line of lines) {
        const trimmedLine = line.trim();

        // Look for file headers like ### `app.js`
        const fileMatch = trimmedLine.match(/^### `(.+?)`/);
        if (fileMatch) {
            currentFile = fileMatch[1];
            continue;
        }

        // Look for issue start with emoji (🔒, 🌐, ⚡, etc.) followed by **Issue:**
        const issueMatch = trimmedLine.match(/^[🔒🌐⚡🎨🔧📱💻⚠️✨🛡️🚀💡🔍📊🎯🔄📈🔥💎⭐🎉🎊🌟💯🎪🎭🎨🎬🎮🎲🎯🎨🎪]+\s*\*\*Issue:\*\*\s*(.+)/);
        if (issueMatch) {
            // Save previous issue if it exists
            if (inIssueBlock && currentIssue.issue) {
                currentIssue.file_path = currentFile || currentIssue.file || currentIssue.file_path;
                
                // Convert line_number string to line_numbers array for DTO compatibility
                if (currentIssue.line_number) {
                    const lineNum = parseInt(currentIssue.line_number);
                    currentIssue.line_numbers = isNaN(lineNum) ? [] : [lineNum];
                    delete currentIssue.line_number; // Remove the old property
                }
                
                // Ensure file_path is set and remove old file property
                if (currentIssue.file && !currentIssue.file_path) {
                    currentIssue.file_path = currentIssue.file;
                }
                delete currentIssue.file; // Remove the old property
                
                results.push({ ...currentIssue });
            }
            // Start new issue
            currentIssue = { issue: issueMatch[1] };
            inIssueBlock = true;
            continue;
        }

        // Look for other fields with **Field:** format
        if (inIssueBlock && trimmedLine.startsWith('**')) {
            const match = trimmedLine.match(/\*\*(.+?):\*\*\s*(.+)/);
            if (match) {
                const field = match[1].toLowerCase().replace(/\s+/g, '_');
                const value = match[2];

                switch (field) {
                    case 'severity':
                        currentIssue.severity = value;
                        break;
                    case 'confidence':
                        currentIssue.confidence = value;
                        break;
                    case 'line_number':
                        currentIssue.line_number = value;
                        break;
                    case 'code':
                        currentIssue.code = value;
                        break;
                    case 'suggestion':
                        currentIssue.suggestion = value;
                        break;
                    case 'file':
                        currentIssue.file = value;
                        break;
                    case 'review_type':
                        currentIssue.review_type = value;
                        break;
                }
            }
        }
    }

    // Don't forget the last issue
    if (inIssueBlock && currentIssue.issue) {
        currentIssue.file_path = currentFile || currentIssue.file || currentIssue.file_path;
        
        // Convert line_number string to line_numbers array for DTO compatibility
        if (currentIssue.line_number) {
            const lineNum = parseInt(currentIssue.line_number);
            currentIssue.line_numbers = isNaN(lineNum) ? [] : [lineNum];
            delete currentIssue.line_number; // Remove the old property
        }
        
        // Ensure file_path is set and remove old file property
        if (currentIssue.file && !currentIssue.file_path) {
            currentIssue.file_path = currentIssue.file;
        }
        delete currentIssue.file; // Remove the old property
        
        results.push({ ...currentIssue });
    }

    return results;
}
